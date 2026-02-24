import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { chatGPT } from './chatgpt';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeSessionOptions {
  debug: boolean;
  sync?: boolean;
}

interface FileContext {
  absPath: string;
  relPath: string;
  content: string;
}

interface ParsedFile {
  filePath: string;
  content: string;
}

interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTEXT_CHARS = 200_000;

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.cache', 'coverage', '.nyc_output', 'vendor', '.turbo', '.output',
]);

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.lock', '.map',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
]);

const KNOWN_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'c', 'cpp',
  'csharp', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'shell', 'bash',
  'sh', 'zsh', 'fish', 'powershell', 'sql', 'html', 'css', 'scss',
  'sass', 'less', 'xml', 'yaml', 'yml', 'toml', 'ini', 'markdown', 'md',
  'json', 'graphql', 'proto', 'dockerfile', 'makefile', 'cmake', 'diff',
  'plaintext', 'text', 'txt', 'log', 'jsx', 'tsx',
]);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function status(msg: string): void {
  process.stderr.write(`[code] ${msg}\n`);
}

function detectWorkspaceRoot(): string {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (root) return root;
  } catch {}
  return process.cwd();
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// File enumeration & resolution
// ---------------------------------------------------------------------------

let projectFilesCache: string[] | null = null;

function listProjectFiles(root: string): string[] {
  if (projectFilesCache) return projectFilesCache;
  const results: string[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SKIP_EXTENSIONS.has(ext)) {
          results.push(path.relative(root, full));
        }
      }
    }
  }
  walk(root);
  projectFilesCache = results;
  return results;
}

function resolveFileReference(ref: string, workspaceRoot: string): string[] {
  const query = ref.replace(/^@/, '');

  // 1. Exact match
  const exact = path.resolve(workspaceRoot, query);
  if (fs.existsSync(exact)) {
    const stat = fs.statSync(exact);
    if (stat.isDirectory()) {
      return listFilesInDir(exact, workspaceRoot);
    }
    return [path.relative(workspaceRoot, exact)];
  }

  const allFiles = listProjectFiles(workspaceRoot);

  // 2. Substring match
  const matches = allFiles.filter(f => f.includes(query));
  if (matches.length > 0) return matches.slice(0, 10);

  // 3. Extension inference
  if (!path.extname(query)) {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py', '.go', '.rs', '.rb'];
    for (const ext of extensions) {
      const found = allFiles.filter(f => f.endsWith(query + ext));
      if (found.length > 0) return found;
    }
    // Also try basename matching without extension
    const base = path.basename(query);
    const baseMatches = allFiles.filter(f => {
      const fb = path.basename(f, path.extname(f));
      return fb === base || fb.includes(base);
    });
    if (baseMatches.length > 0) return baseMatches.slice(0, 10);
  }

  return [];
}

function listFilesInDir(dir: string, workspaceRoot: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SKIP_EXTENSIONS.has(ext)) {
          results.push(path.relative(workspaceRoot, full));
        }
      }
    }
  } catch {}
  return results;
}

function loadFile(relPath: string, workspaceRoot: string, files: Map<string, FileContext>): void {
  if (files.has(relPath)) return;
  const absPath = path.resolve(workspaceRoot, relPath);
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    files.set(relPath, { absPath, relPath, content });
    const lines = content.split('\n').length;
    status(`added: ${relPath} (${lines} lines)`);
  } catch (err: any) {
    status(`failed to read: ${relPath} (${err.message})`);
  }
}

function refreshFiles(workspaceRoot: string, files: Map<string, FileContext>): void {
  for (const [relPath, ctx] of files) {
    try {
      const fresh = fs.readFileSync(ctx.absPath, 'utf-8');
      if (fresh !== ctx.content) {
        ctx.content = fresh;
        status(`refreshed: ${relPath}`);
      }
    } catch {}
  }
}

function extractMentions(input: string): string[] {
  const regex = /@(\S+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = regex.exec(input)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

function composePrompt(query: string, files: Map<string, FileContext>): string {
  let prompt = `Given the following file(s), make modifications for the following query:
<query_user>
${query}
</query_user>
<rules>
- MUST output ONLY the complete new file contents
- MUST output the entire modified version, not just an extract
- MUST NOT include explanations or comments about changes
- MUST NOT include intro or conclusion
</rules>
`;

  if (files.size > 0) {
    prompt += '\n<files_content>\n\n';
    for (const [relPath, ctx] of files) {
      prompt += '```' + relPath + '\n';
      prompt += ctx.content;
      if (!ctx.content.endsWith('\n')) prompt += '\n';
      prompt += '```\n\n';
    }
    prompt += '</files_content>\n';
  }

  return prompt;
}

function validateContextSize(files: Map<string, FileContext>): void {
  let totalChars = 0;
  for (const ctx of files.values()) {
    totalChars += ctx.content.length;
  }
  if (totalChars > MAX_CONTEXT_CHARS) {
    const kb = Math.round(totalChars / 1024);
    status(`warning: context is ${kb}KB — response quality may degrade`);
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function looksLikeFilePath(s: string): boolean {
  if (s.includes('/') || s.includes('\\')) return true;
  if (KNOWN_LANGUAGES.has(s.toLowerCase())) return false;
  return /\.\w+$/.test(s);
}

function parseResponseFiles(response: string): ParsedFile[] {
  const results: ParsedFile[] = [];
  const regex = /```([^\n`]+)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    const rawPath = match[1].trim();
    const content = match[2];

    if (looksLikeFilePath(rawPath)) {
      results.push({
        filePath: rawPath,
        content: content.endsWith('\n') ? content.slice(0, -1) : content,
      });
    }
  }

  return results;
}

function parseResponseWithFallback(
  response: string,
  contextFiles: Map<string, FileContext>,
): ParsedFile[] {
  const parsed = parseResponseFiles(response);
  if (parsed.length > 0) return parsed;

  // Fallback: single file in context — treat any code block as that file
  if (contextFiles.size === 1) {
    const regex = /```\w*\n([\s\S]*?)```/g;
    const match = regex.exec(response);
    if (match) {
      const [relPath] = contextFiles.keys();
      const content = match[1];
      return [{
        filePath: relPath,
        content: content.endsWith('\n') ? content.slice(0, -1) : content,
      }];
    }
  }

  return [];
}

function computeDiffSummary(oldContent: string, newContent: string): DiffSummary {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const minLen = Math.min(oldLines.length, newLines.length);
  let changed = 0;

  for (let i = 0; i < minLen; i++) {
    if (oldLines[i] !== newLines[i]) changed++;
  }

  return {
    added: Math.max(0, newLines.length - oldLines.length),
    removed: Math.max(0, oldLines.length - newLines.length),
    changed,
  };
}

// ---------------------------------------------------------------------------
// Grep
// ---------------------------------------------------------------------------

function handleGrep(pattern: string, workspaceRoot: string): void {
  try {
    const result = execSync(
      `grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.json' --include='*.md' --include='*.py' --include='*.go' --include='*.rs' --include='*.rb' --include='*.swift' --include='*.kt' --include='*.java' --include='*.c' --include='*.cpp' --include='*.h' --include='*.css' --include='*.scss' --include='*.html' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=.next -- ${escapeShellArg(pattern)} .`,
      {
        encoding: 'utf-8',
        cwd: workspaceRoot,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

    const lines = result.trim().split('\n').slice(0, 20);
    const fileSet = new Set<string>();

    for (const line of lines) {
      process.stderr.write(`  ${line}\n`);
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        fileSet.add(line.substring(0, colonIdx).replace(/^\.\//, ''));
      }
    }

    status(`${lines.length} result(s) in ${fileSet.size} file(s). Use /add @file to add.`);
  } catch (err: any) {
    if (err.status === 1) {
      status('no matches found');
    } else {
      status(`grep failed: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

async function handleCommand(
  input: string,
  workspaceRoot: string,
  files: Map<string, FileContext>,
  rl: readline.Interface,
): Promise<void> {
  const spaceIdx = input.indexOf(' ');
  const cmd = spaceIdx > 0 ? input.substring(0, spaceIdx).toLowerCase() : input.toLowerCase();
  const arg = spaceIdx > 0 ? input.substring(spaceIdx + 1).trim() : '';

  switch (cmd) {
    case '/add': {
      if (!arg) {
        status('usage: /add @file_or_folder');
        return;
      }
      const resolved = resolveFileReference(arg, workspaceRoot);
      if (resolved.length === 0) {
        status(`no files matched: ${arg}`);
        const allFiles = listProjectFiles(workspaceRoot);
        const query = arg.replace(/^@/, '').toLowerCase();
        const suggestions = allFiles
          .filter(f => f.toLowerCase().includes(query))
          .slice(0, 5);
        if (suggestions.length > 0) {
          status('did you mean:');
          for (const s of suggestions) {
            process.stderr.write(`  ${s}\n`);
          }
        }
        return;
      }
      for (const rel of resolved) {
        loadFile(rel, workspaceRoot, files);
      }
      return;
    }

    case '/files': {
      if (files.size === 0) {
        status('no files in context. Use /add @file or @file inline.');
        return;
      }
      status(`${files.size} file(s) in context:`);
      for (const [rel, ctx] of files) {
        const lines = ctx.content.split('\n').length;
        process.stderr.write(`  ${rel} (${lines} lines)\n`);
      }
      return;
    }

    case '/clear': {
      const count = files.size;
      files.clear();
      projectFilesCache = null;
      status(`cleared ${count} file(s) from context`);
      return;
    }

    case '/remove': {
      if (!arg) {
        status('usage: /remove @file');
        return;
      }
      const query = arg.replace(/^@/, '');
      let removed = false;
      for (const key of Array.from(files.keys())) {
        if (key.includes(query)) {
          files.delete(key);
          status(`removed: ${key}`);
          removed = true;
        }
      }
      if (!removed) status(`not in context: ${query}`);
      return;
    }

    case '/grep': {
      if (!arg) {
        status('usage: /grep <pattern>');
        return;
      }
      handleGrep(arg, workspaceRoot);
      return;
    }

    case '/help': {
      printHelp();
      return;
    }

    case '/quit':
    case '/exit':
    case '/q': {
      rl.close();
      return;
    }

    default:
      status(`unknown command: ${cmd}. Type /help for commands.`);
  }
}

// ---------------------------------------------------------------------------
// Query handler
// ---------------------------------------------------------------------------

async function handleQuery(
  input: string,
  workspaceRoot: string,
  files: Map<string, FileContext>,
  options: CodeSessionOptions,
): Promise<void> {
  // 1. Extract and resolve inline @mentions
  const mentions = extractMentions(input);
  for (const mention of mentions) {
    const resolved = resolveFileReference(mention, workspaceRoot);
    for (const rel of resolved) {
      loadFile(rel, workspaceRoot, files);
    }
  }

  // 2. Clean query (remove @mentions since files are in context)
  const cleanQuery = input.replace(/@\S+/g, '').trim();

  if (files.size === 0) {
    status('no files in context. Add files with @file or /add first.');
    return;
  }

  if (!cleanQuery) {
    status('empty query after removing @mentions. Type your coding request.');
    return;
  }

  // 3. Refresh files from disk
  refreshFiles(workspaceRoot, files);

  // 4. Size check
  validateContextSize(files);

  // 5. Compose and send
  const prompt = composePrompt(cleanQuery, files);
  status(`sending ${files.size} file(s) + query (${prompt.length} chars)...`);

  const response = await chatGPT(prompt, { debug: options.debug, sync: options.sync });
  status(`response received (${response.length} chars)`);

  // 6. Parse response
  const parsedFiles = parseResponseWithFallback(response, files);

  if (parsedFiles.length === 0) {
    status('no file blocks detected in response. Raw output:');
    process.stderr.write('\n' + response + '\n\n');
    return;
  }

  // 7. Write files
  for (const pf of parsedFiles) {
    const relPath = pf.filePath;
    const existing = files.get(relPath);
    const absPath = path.resolve(workspaceRoot, relPath);

    // Diff summary
    if (existing) {
      const diff = computeDiffSummary(existing.content, pf.content);
      status(`${relPath}: +${diff.added} -${diff.removed} ~${diff.changed}`);
    } else {
      const lines = pf.content.split('\n').length;
      status(`${relPath}: new file (${lines} lines)`);
    }

    // Write
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, pf.content.endsWith('\n') ? pf.content : pf.content + '\n');
    status(`written: ${relPath}`);

    // Update context
    const freshContent = fs.readFileSync(absPath, 'utf-8');
    files.set(relPath, { absPath, relPath, content: freshContent });
  }

  status('done');
}

// ---------------------------------------------------------------------------
// Help & Welcome
// ---------------------------------------------------------------------------

function printWelcome(workspaceRoot: string, isVSCode: boolean): void {
  process.stderr.write('\nvcopilot code — interactive coding agent\n');
  process.stderr.write(`workspace: ${workspaceRoot}\n`);
  if (isVSCode) {
    process.stderr.write('terminal:  VSCode (detected)\n');
  }
  process.stderr.write('\nAdd files with @file, then type your coding query.\n');
  process.stderr.write('Type /help for commands.\n\n');
}

function printHelp(): void {
  process.stderr.write(`
Commands:
  /add @file        Add file(s) to context (fuzzy matching)
  /files            List files in context
  /remove @file     Remove file from context
  /clear            Clear all context
  /grep <pattern>   Search workspace for pattern
  /help             Show this help
  /quit             Exit session

Usage:
  Add files, then type any coding query to modify them.
  Use @file inline to add files on the fly.

Examples:
  /add @src/cli.ts
  /grep handleCommand
  add error handling to the main function
  @src/code.ts @src/cli.ts refactor the status function
\n`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function startCodeSession(options: CodeSessionOptions): Promise<void> {
  const workspaceRoot = detectWorkspaceRoot();
  const files: Map<string, FileContext> = new Map();
  const isVSCode = process.env.TERM_PROGRAM === 'vscode';

  printWelcome(workspaceRoot, isVSCode);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: 'vcopilot> ',
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Pause readline during async operations to prevent interleaved input
    rl.pause();

    try {
      if (trimmed.startsWith('/')) {
        await handleCommand(trimmed, workspaceRoot, files, rl);
      } else {
        await handleQuery(trimmed, workspaceRoot, files, options);
      }
    } catch (err: any) {
      status(`error: ${err.message}`);
      if (options.debug && err.stack) {
        process.stderr.write(err.stack + '\n');
      }
    }

    rl.resume();
    rl.prompt();
  });

  rl.on('close', () => {
    status('session ended');
    process.exit(0);
  });
}
