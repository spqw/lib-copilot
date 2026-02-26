import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { chatGPT } from './chatgpt';
import { CopilotClient } from './client';
import { CopilotAuth } from './auth';

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
const RELEVANCE_THRESHOLD = 50;
const RELEVANCE_FALLBACK_THRESHOLD = 20;
const MAX_FALLBACK_FILES = 3;

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

const GREP_INCLUDES = [
  '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx',
  '--include=*.json', '--include=*.md', '--include=*.py', '--include=*.go',
  '--include=*.rs', '--include=*.rb', '--include=*.swift', '--include=*.kt',
  '--include=*.java', '--include=*.c', '--include=*.cpp', '--include=*.h',
  '--include=*.css', '--include=*.scss', '--include=*.html',
  '--include=*.yaml', '--include=*.yml', '--include=*.toml',
].join(' ');

const GREP_EXCLUDES = [
  '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist',
  '--exclude-dir=build', '--exclude-dir=.next', '--exclude-dir=__pycache__',
  '--exclude-dir=coverage',
].join(' ');

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
    status(`  loaded: ${relPath} (${lines} lines)`);
  } catch (err: any) {
    status(`  failed to read: ${relPath} (${err.message})`);
  }
}

function refreshFiles(workspaceRoot: string, files: Map<string, FileContext>): void {
  for (const [relPath, ctx] of files) {
    try {
      const fresh = fs.readFileSync(ctx.absPath, 'utf-8');
      if (fresh !== ctx.content) {
        ctx.content = fresh;
        status(`  refreshed: ${relPath}`);
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
// AI-powered file discovery (GPT-4.1 via VSCode Copilot extension)
// ---------------------------------------------------------------------------

async function askCopilotForGrepPatterns(
  client: CopilotClient,
  query: string,
  fileList: string[],
): Promise<string[]> {
  status('  asking GPT-4.1 for grep regex patterns...');

  // Show a sample of the project structure
  const sampleFiles = fileList.slice(0, 100).join('\n');

  const response = await client.chat({
    messages: [
      {
        role: 'system',
        content: [
          'You are a code search assistant.',
          'Given a coding task and a project file listing, suggest grep-compatible regex patterns to find source files that would need to be edited.',
          'Return ONLY the regex patterns, one per line.',
          'No explanations, no bullet points, no backticks, just raw grep-compatible patterns.',
          'Keep patterns simple. Aim for 2-6 patterns that together cover the relevant code.',
        ].join(' '),
      },
      {
        role: 'user',
        content: `Task: ${query}\n\nProject files (${fileList.length} total, showing first 100):\n${sampleFiles}`,
      },
    ],
    model: 'gpt-4.1',
    max_tokens: 300,
  });

  const content = response.choices[0]?.message.content || '';
  const patterns = content
    .split('\n')
    .map(l => l.trim().replace(/^[-*]\s*/, '').replace(/^`|`$/g, ''))
    .filter(l => l && l.length > 1 && !l.startsWith('#') && !l.startsWith('//'));

  status(`  GPT-4.1 suggested ${patterns.length} pattern(s):`);
  for (const p of patterns) {
    status(`    -> ${p}`);
  }

  return patterns;
}

async function scoreFileRelevance(
  client: CopilotClient,
  filePath: string,
  fileContent: string,
  query: string,
): Promise<number> {
  // Truncate large files to keep requests fast
  const maxChars = 4000;
  const truncated = fileContent.length > maxChars
    ? fileContent.slice(0, maxChars) + '\n...(truncated)'
    : fileContent;

  try {
    const response = await client.chat({
      messages: [
        {
          role: 'system',
          content:
            'You are a code relevance scorer. Given a task and a source file, respond with ONLY a single integer 0-100 indicating how likely this file needs editing for the task. 0=irrelevant, 100=definitely needs changes. Reply with just the number, nothing else.',
        },
        {
          role: 'user',
          content: `Task: ${query}\n\nFile: ${filePath}\n\`\`\`\n${truncated}\n\`\`\``,
        },
      ],
      model: 'gpt-4.1',
      max_tokens: 10,
    });

    const raw = (response.choices[0]?.message.content || '0').trim();
    const score = parseInt(raw.replace(/[^0-9]/g, ''), 10);
    return isNaN(score) ? 0 : Math.min(100, Math.max(0, score));
  } catch (err: any) {
    status(`    scoring error for ${filePath}: ${err.message}`);
    return 0;
  }
}

/**
 * AI-powered file discovery pipeline:
 * 1. Ask GPT-4.1 (via VS Code Copilot) for grep regex patterns
 * 2. Grep workspace to find candidate files
 * 3. Score each candidate with GPT-4.1 for relevance (0-100)
 * 4. Select files above threshold
 */
async function discoverRelevantFiles(
  client: CopilotClient,
  query: string,
  workspaceRoot: string,
  files: Map<string, FileContext>,
): Promise<void> {
  const allFiles = listProjectFiles(workspaceRoot);
  status(`workspace indexed: ${allFiles.length} files`);

  // ---- Step 1: Get grep patterns from GPT-4.1 ----
  status('STEP 1/3: Getting grep patterns from GPT-4.1...');
  let patterns: string[];
  try {
    patterns = await askCopilotForGrepPatterns(client, query, allFiles);
  } catch (err: any) {
    status(`  FAILED: ${err.message}`);
    status('  tip: ensure VSCode Copilot extension is installed and authenticated');
    return;
  }

  if (patterns.length === 0) {
    status('  no patterns suggested — cannot auto-discover files');
    status('  tip: add files manually with /add @file or @file inline');
    return;
  }

  // ---- Step 2: Grep workspace ----
  status('STEP 2/3: Grepping workspace for candidate files...');
  const candidateFiles = new Set<string>();

  for (const pattern of patterns) {
    try {
      const cmd = `grep -rln ${GREP_INCLUDES} ${GREP_EXCLUDES} -- ${escapeShellArg(pattern)} .`;
      const result = execSync(cmd, {
        encoding: 'utf-8',
        cwd: workspaceRoot,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const matched = result.trim().split('\n').filter(Boolean);
      for (const f of matched) {
        candidateFiles.add(f.replace(/^\.\//, ''));
      }
      status(`    "${pattern}" -> ${matched.length} file(s)`);
    } catch {
      status(`    "${pattern}" -> no matches`);
    }
  }

  if (candidateFiles.size === 0) {
    status('  no files matched any grep pattern');
    status('  tip: add files manually with /add @file');
    return;
  }

  status(`  ${candidateFiles.size} candidate file(s) found`);

  // ---- Step 3: Score relevance with GPT-4.1 ----
  status('STEP 3/3: Scoring file relevance with GPT-4.1...');
  const scored: Array<{ file: string; score: number }> = [];
  let idx = 0;
  const total = candidateFiles.size;

  for (const file of candidateFiles) {
    idx++;
    const absPath = path.resolve(workspaceRoot, file);
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const score = await scoreFileRelevance(client, file, content, query);
      scored.push({ file, score });
      const icon = score >= RELEVANCE_THRESHOLD ? '+' : '-';
      status(`  [${idx}/${total}] ${icon} ${file}: ${score}/100`);
    } catch (err: any) {
      status(`  [${idx}/${total}] x ${file}: read error (${err.message})`);
    }
  }

  // ---- Select relevant files ----
  const relevant = scored
    .filter(s => s.score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (relevant.length === 0) {
    // Fallback: use top N if any scored above a lower threshold
    const top = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FALLBACK_FILES);

    if (top.length > 0 && top[0].score >= RELEVANCE_FALLBACK_THRESHOLD) {
      status(`no files scored >= ${RELEVANCE_THRESHOLD}, using top ${top.length} as fallback:`);
      for (const t of top) {
        loadFile(t.file, workspaceRoot, files);
      }
    } else {
      status('no files deemed relevant enough');
      status('tip: add files manually with /add @file');
    }
    return;
  }

  status(`${relevant.length} relevant file(s) selected for editing:`);
  for (const r of relevant) {
    loadFile(r.file, workspaceRoot, files);
  }
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
- MUST return each modified file wrapped in a markdown code block (triple backticks)
- MUST use the file path as the code block language tag, like: \`\`\`path/to/file.ts
- MUST output the COMPLETE file contents, not just changed portions
- MUST NOT omit any part of the file — include everything, even unchanged sections
- MUST NOT include explanations, commentary, or any text outside the code blocks
- MUST NOT include intro or conclusion text
- If a file was not modified, do NOT include it in the output
- Each file block MUST start with \`\`\` followed immediately by the file path and end with \`\`\`
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
  } else {
    const kb = Math.round(totalChars / 1024);
    status(`context size: ${kb}KB`);
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

/**
 * Parse response with multiple fallback strategies:
 * 1. Code blocks with file path labels (preferred)
 * 2. Single file: any code block treated as that file
 * 3. Single file: bare content (no code fences) treated as file content
 */
function parseResponseWithFallback(
  response: string,
  contextFiles: Map<string, FileContext>,
): ParsedFile[] {
  // Strategy 1: code blocks with file paths
  const parsed = parseResponseFiles(response);
  if (parsed.length > 0) {
    status(`parsed ${parsed.length} file(s) from code blocks with file paths`);
    return parsed;
  }

  // Strategy 2: single file, any code block
  if (contextFiles.size === 1) {
    const regex = /```\w*\n([\s\S]*?)```/g;
    const match = regex.exec(response);
    if (match) {
      const [relPath] = contextFiles.keys();
      const content = match[1];
      status(`parsed 1 file from generic code block (single-file fallback)`);
      return [{
        filePath: relPath,
        content: content.endsWith('\n') ? content.slice(0, -1) : content,
      }];
    }
  }

  // Strategy 3: single file, bare content (no code fences at all)
  if (contextFiles.size === 1) {
    const trimmed = response.trim();
    if (trimmed.length > 0) {
      const [relPath] = contextFiles.keys();
      status(`no code blocks found — treating entire response as file content for ${relPath}`);
      return [{
        filePath: relPath,
        content: trimmed,
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
    const cmd = `grep -rn ${GREP_INCLUDES} ${GREP_EXCLUDES} -- ${escapeShellArg(pattern)} .`;
    const result = execSync(cmd, {
      encoding: 'utf-8',
      cwd: workspaceRoot,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

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
  copilotClient: CopilotClient | null,
): Promise<void> {
  const startTime = Date.now();

  // 1. Extract and resolve inline @mentions
  const mentions = extractMentions(input);
  if (mentions.length > 0) {
    status(`resolving ${mentions.length} @mention(s)...`);
  }
  for (const mention of mentions) {
    const resolved = resolveFileReference(mention, workspaceRoot);
    for (const rel of resolved) {
      loadFile(rel, workspaceRoot, files);
    }
  }

  // 2. Clean query (remove @mentions since files are in context)
  const cleanQuery = input.replace(/@\S+/g, '').trim();

  if (!cleanQuery) {
    status('empty query after removing @mentions. Type your coding request.');
    return;
  }

  // 3. Auto-discover files if none in context and Copilot client available
  if (files.size === 0 && copilotClient) {
    status('');
    status('=== AI-Powered File Discovery ===');
    status(`query: "${cleanQuery}"`);
    status('');
    await discoverRelevantFiles(copilotClient, cleanQuery, workspaceRoot, files);
    status('=================================');
    status('');
  }

  if (files.size === 0) {
    status('no files in context.');
    if (copilotClient) {
      status('AI discovery found no relevant files.');
    }
    status('tip: add files with @file or /add @file first');
    return;
  }

  // 4. Refresh files from disk
  status('refreshing files from disk...');
  refreshFiles(workspaceRoot, files);

  // 5. Size check
  validateContextSize(files);

  // 6. Compose prompt and send to ChatGPT
  const prompt = composePrompt(cleanQuery, files);
  status(`sending ${files.size} file(s) + query to ChatGPT browser (${prompt.length} chars)...`);

  const response = await chatGPT(prompt, { debug: options.debug, sync: options.sync });
  status(`ChatGPT response received (${response.length} chars)`);

  // 7. Parse response into file blocks
  status('parsing response for file blocks...');
  const parsedFiles = parseResponseWithFallback(response, files);

  if (parsedFiles.length === 0) {
    status('WARNING: no file blocks detected in response');
    status('showing raw response:');
    process.stderr.write('\n--- RAW RESPONSE START ---\n');
    process.stderr.write(response);
    process.stderr.write('\n--- RAW RESPONSE END ---\n\n');
    return;
  }

  // 8. Write files to disk
  status(`writing ${parsedFiles.length} file(s) to disk...`);
  let filesWritten = 0;

  for (const pf of parsedFiles) {
    const relPath = pf.filePath;
    const existing = files.get(relPath);
    const absPath = path.resolve(workspaceRoot, relPath);

    // Diff summary
    if (existing) {
      const diff = computeDiffSummary(existing.content, pf.content);
      status(`  ${relPath}: +${diff.added} -${diff.removed} ~${diff.changed} lines`);
    } else {
      const lines = pf.content.split('\n').length;
      status(`  ${relPath}: NEW file (${lines} lines)`);
    }

    // Write
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, pf.content.endsWith('\n') ? pf.content : pf.content + '\n');
    status(`  written: ${relPath}`);
    filesWritten++;

    // Update context
    const freshContent = fs.readFileSync(absPath, 'utf-8');
    files.set(relPath, { absPath, relPath, content: freshContent });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  status(`done: ${filesWritten} file(s) written in ${elapsed}s`);
}

// ---------------------------------------------------------------------------
// Help & Welcome
// ---------------------------------------------------------------------------

function printWelcome(workspaceRoot: string, isVSCode: boolean, hasAI: boolean): void {
  process.stderr.write('\nvcopilot code — interactive coding agent\n');
  process.stderr.write(`workspace: ${workspaceRoot}\n`);
  if (isVSCode) {
    process.stderr.write('terminal:  VSCode (detected)\n');
  }
  if (hasAI) {
    process.stderr.write('discovery: AI-powered (GPT-4.1 via Copilot)\n');
  } else {
    process.stderr.write('discovery: manual (use @file or /add)\n');
  }
  process.stderr.write('\nAdd files with @file, then type your coding query.\n');
  if (hasAI) {
    process.stderr.write('Or just type a query — AI will find relevant files automatically.\n');
  }
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
  If no files are in context and AI discovery is enabled,
  files will be discovered automatically based on your query.

Flow:
  1. GPT-4.1 (Copilot) suggests grep patterns for your query
  2. Workspace is grepped for candidate files
  3. GPT-4.1 scores each candidate's relevance (0-100)
  4. Relevant files are sent to ChatGPT with your query
  5. ChatGPT returns modified files, which are written to disk

Examples:
  /add @src/cli.ts
  /grep handleCommand
  add error handling to the main function
  @src/code.ts @src/cli.ts refactor the status function
  refactor the auth module to use async/await
\n`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function startCodeSession(options: CodeSessionOptions): Promise<void> {
  const workspaceRoot = detectWorkspaceRoot();
  const files: Map<string, FileContext> = new Map();
  const isVSCode = process.env.TERM_PROGRAM === 'vscode';

  // Authenticate with VSCode Copilot extension for AI-powered file discovery
  let copilotClient: CopilotClient | null = null;
  status('initializing...');
  try {
    status('looking for VSCode Copilot extension token...');
    const auth = new CopilotAuth(options.debug);
    const vscodeToken = await auth.authenticateWithVSCode();

    if (vscodeToken) {
      status('VSCode Copilot token found, creating client...');
      copilotClient = new CopilotClient({
        token: vscodeToken.token,
        model: 'gpt-4.1',
        debug: options.debug,
        auth,
      });
      status('AI-powered file discovery enabled (GPT-4.1 via Copilot)');
    } else {
      status('VSCode Copilot extension not found');
      status('tip: install GitHub Copilot in VSCode for automatic file discovery');
      status('falling back to manual file selection (/add @file)');
    }
  } catch (err: any) {
    status(`VSCode Copilot auth failed: ${err.message}`);
    status('continuing with manual file selection');
  }

  printWelcome(workspaceRoot, isVSCode, copilotClient !== null);

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
        await handleQuery(trimmed, workspaceRoot, files, options, copilotClient);
      }
    } catch (err: any) {
      status(`ERROR: ${err.message}`);
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
