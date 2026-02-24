#!/usr/bin/env node

import { CopilotClient } from './client';
import { CopilotAuth } from './auth';
import axios from 'axios';
import { execSync, spawn, spawnSync } from 'child_process';
import { chatGPT } from './chatgpt';
import { startServer } from './serve';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_MODEL = 'gpt-4.1';

/** Always-on status logging to stderr (visible progress for the user) */
function status(tag: string, msg: string) {
  process.stderr.write(`[${tag}] ${msg}\n`);
}

// Premium request multipliers per model (paid plans)
// Source: https://docs.github.com/en/copilot/reference/ai-models/supported-models
const MULTIPLIERS: Record<string, number> = {
  'claude-haiku-4.5': 0.33,
  'claude-opus-4.1': 10,
  'claude-opus-4.5': 3,
  'claude-opus-4.6': 3,
  'claude-sonnet-4': 1,
  'claude-sonnet-4.5': 1,
  'claude-sonnet-4.6': 1,
  'gemini-2.5-pro': 1,
  'gemini-3-flash': 0.33,
  'gemini-3-pro': 1,
  'gpt-4.1': 0,
  'gpt-4.1-2025-04-14': 0,
  'gpt-4o': 0,
  'gpt-4o-mini': 0,
  'gpt-5': 1,
  'gpt-5-mini': 0,
  'gpt-5-codex': 1,
  'gpt-5.1': 1,
  'gpt-5.1-codex': 1,
  'gpt-5.1-codex-mini': 0.33,
  'gpt-5.1-codex-max': 1,
  'gpt-5.2': 1,
  'gpt-5.2-codex': 1,
  'gpt-5.3-codex': 1,
  'grok-code-fast-1': 0.25,
};

function parseArgs(argv: string[]): {
  model: string;
  system?: string;
  debug: boolean;
  login: boolean;
  status: boolean;
  models: boolean;
  usage: boolean;
  local: boolean;
  vscode: boolean;
  chatgpt: boolean;
  copilot: boolean;
  version: boolean;
  update: boolean;
  sync: boolean;
  serve: boolean;
  detached: boolean;
  endpoint?: string;
  outputFilePath?: string;
  positional: string[];
} {
  const result = {
    model: DEFAULT_MODEL,
    system: undefined as string | undefined,
    debug: false,
    login: false,
    status: false,
    models: false,
    usage: false,
    local: false,
    vscode: false,
    chatgpt: true,
    copilot: false,
    version: false,
    update: false,
    sync: false,
    serve: false,
    detached: false,
    endpoint: undefined as string | undefined,
    outputFilePath: undefined as string | undefined,
    positional: [] as string[],
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--model' && i + 1 < argv.length) {
      result.model = argv[++i];
    } else if (arg === '--system' && i + 1 < argv.length) {
      result.system = argv[++i];
    } else if (arg === '--endpoint' && i + 1 < argv.length) {
      result.endpoint = argv[++i];
    } else if (arg === '--debug') {
      result.debug = true;
    } else if (arg === '--login') {
      result.login = true;
    } else if (arg === '--status') {
      result.status = true;
    } else if (arg === '--models') {
      result.models = true;
    } else if (arg === '--usage') {
      result.usage = true;
    } else if (arg === '--local') {
      result.local = true;
    } else if (arg === '--vscode') {
      result.vscode = true;
    } else if (arg === '--chatgpt') {
      result.chatgpt = true;
      result.copilot = false;
    } else if (arg === '--copilot') {
      result.copilot = true;
      result.chatgpt = false;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg === '--update') {
      result.update = true;
    } else if (arg === '--sync') {
      result.sync = true;
    } else if (arg === '--serve') {
      result.serve = true;
    } else if (arg === '--detached') {
      result.detached = true;
    } else if (arg === '--output-file-path' && i + 1 < argv.length) {
      result.outputFilePath = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      result.positional.push(arg);
    }
    i++;
  }

  return result;
}

function printHelp(): void {
  process.stderr.write(`vcopilot - GitHub Copilot CLI

Usage:
  vcopilot code                               Interactive coding agent (REPL)
  cat PROMPT.md | vcopilot [options]          Pipe stdin as prompt
  vcopilot [options] "your prompt here"       Positional prompt
  vcopilot --login                            Authenticate via device flow
  vcopilot --status                           Show auth state
  vcopilot --models                           List available models
  vcopilot --usage                            Show premium quota

Options:
  --model <name>            Model to use (default: ${DEFAULT_MODEL})
  --system <text>           System prompt
  --output-file-path <path> Write response as Markdown to a file
  --sync                    Synchronous mode (no sender/watcher split)
  --debug                   Enable debug logging
  -v, --version             Show version
  --update                  Update to latest version
  -h, --help                Show this help

Server mode:
  --serve                   Start an OpenAI-compatible API server
  --serve --detached        Start server in background (daemon mode)

Authentication:
  --login             Authenticate via browser-based device flow
  --vscode            Use VSCode Copilot extension's cached token
  --status            Show github token, vscode session, and copilot session

  Token priority:
    1. --vscode                   VSCode extension session
    2. GITHUB_TOKEN env var       Environment variable
    3. ~/.copilot/token.json      Cached from previous --login
    4. Device flow (automatic)    Browser-based OAuth fallback

Processor (default: ChatGPT):
  --chatgpt           Use ChatGPT via browser automation (default)
  --copilot           Use GitHub Copilot API instead of ChatGPT

Local models (LM Studio / OpenAI-compatible):
  --local             Use local LM Studio server (localhost:1234)
  --endpoint <url>    Custom API base URL

Examples:
  echo "what is 2+2" | vcopilot
  cat PROMPT.md | vcopilot --model grok-code-fast-1 > output.md
  vcopilot "explain quicksort"
  vcopilot "explain quicksort" --output-file-path response.md
  vcopilot --vscode "hello"
  vcopilot --local "what is 2+2"
  vcopilot --local --model openai/gpt-oss-20b "explain quicksort"
  vcopilot --endpoint http://192.168.1.10:1234/v1 "hello"
  vcopilot --chatgpt "explain quicksort"
  vcopilot --serve                     # foreground server on :8787
  vcopilot --serve --detached          # background daemon
  VCOPILOT_PORT=9000 vcopilot --serve  # custom port
`);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function ensureLocalModel(model: string, debug: boolean): void {
  // Check if lms CLI is available
  const which = spawnSync('which', ['lms'], { encoding: 'utf-8' });
  if (which.status !== 0) {
    if (debug) process.stderr.write('[local] lms CLI not found, skipping model preload\n');
    return;
  }

  // Check if model is already loaded
  const ps = spawnSync('lms', ['ps'], { encoding: 'utf-8' });
  if (ps.status === 0 && ps.stdout.includes(model)) {
    if (debug) process.stderr.write(`[local] model "${model}" already loaded\n`);
    return;
  }

  // Ensure server is running
  const status = spawnSync('lms', ['status'], { encoding: 'utf-8' });
  if (status.status !== 0 || (status.stdout && status.stdout.includes('NOT'))) {
    process.stderr.write('[local] starting lms server...\n');
    spawnSync('lms', ['server', 'start'], { encoding: 'utf-8', timeout: 15000 });
  }

  // Load the model
  process.stderr.write(`[local] loading model "${model}"...\n`);
  const load = spawnSync('lms', ['load', model], { encoding: 'utf-8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (load.status !== 0) {
    const err = (load.stderr || '').trim();
    process.stderr.write(`[local] failed to load model: ${err || 'unknown error'}\n`);
    process.stderr.write(`[local] continuing anyway — the server may already have a model loaded\n`);
  } else {
    process.stderr.write(`[local] model loaded\n`);
  }
}

async function authenticate(auth: CopilotAuth, debug: boolean, forceVSCode: boolean = false): Promise<string> {
  // 1. --vscode flag (highest priority)
  if (forceVSCode) {
    status('auth', 'looking for VSCode session...');
    const vscode = await auth.authenticateWithVSCode();
    if (vscode) {
      status('auth', 'using VSCode session token');
      return vscode.token;
    }
    throw new Error(
      'VSCode Copilot session not found. Make sure:\n' +
      '  1. VSCode is installed and has been opened\n' +
      '  2. GitHub Copilot extension is installed and signed in\n' +
      '  3. You have used Copilot at least once in VSCode'
    );
  }

  // 2. Try env vars
  const envToken = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN;
  if (envToken) {
    const envName = process.env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : 'COPILOT_TOKEN';
    status('auth', `using ${envName} env var`);
    return envToken;
  }

  // 3. Try cached token
  const cached = auth['getCachedToken']();
  if (cached) {
    status('auth', 'using cached token (~/.copilot/token.json)');
    return cached;
  }

  // 4. Auto device flow (last resort)
  status('auth', 'no token found, starting device flow authentication...');
  const flow = await auth.initiateDeviceFlow();
  process.stderr.write(`\nOpen: ${flow.verification_uri}\nEnter code: ${flow.user_code}\n\nWaiting for authorization...\n`);
  const result = await auth.pollDeviceFlow(flow.device_code);
  status('auth', 'authenticated successfully');
  return result.token;
}

const UPDATE_CHECK_FILE = path.join(os.homedir(), '.copilot', 'update-check.json');
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

function detectInstallMethod(): 'homebrew' | 'mise' | 'npm' {
  try {
    execSync('brew list spqw/homebrew-tap/vcopilot 2>/dev/null', { stdio: 'ignore' });
    return 'homebrew';
  } catch {}

  try {
    const miseResult = spawnSync('mise', ['which', 'vcopilot'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (miseResult.status === 0 && miseResult.stdout.includes('mise')) {
      return 'mise';
    }
  } catch {}

  return 'npm';
}

function backgroundAutoUpdate(currentVersion: string): void {
  // Check if we should skip (rate-limit to once per hour)
  try {
    if (fs.existsSync(UPDATE_CHECK_FILE)) {
      const data = JSON.parse(fs.readFileSync(UPDATE_CHECK_FILE, 'utf-8'));
      if (Date.now() - data.lastCheck < UPDATE_CHECK_INTERVAL) {
        return;
      }
    }
  } catch {}

  // Save check timestamp immediately to prevent parallel checks
  try {
    const dir = path.dirname(UPDATE_CHECK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify({ lastCheck: Date.now() }));
  } catch {}

  // Fire-and-forget: spawn a detached child process to check and update
  const script = `
    const https = require('https');
    const { execSync } = require('child_process');

    const options = {
      hostname: 'api.github.com',
      path: '/repos/spqw/lib-copilot/releases/latest',
      headers: { 'User-Agent': 'vcopilot', 'Accept': 'application/vnd.github+json' },
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const latest = JSON.parse(data).tag_name.replace(/^v/, '');
          if (latest === '${currentVersion}') process.exit(0);

          // Detect install method and update
          let method = 'npm';
          try { execSync('brew list spqw/homebrew-tap/vcopilot 2>/dev/null', { stdio: 'ignore' }); method = 'homebrew'; } catch {}
          if (method === 'npm') {
            try {
              const r = execSync('mise which vcopilot 2>/dev/null', { encoding: 'utf-8' });
              if (r.includes('mise')) method = 'mise';
            } catch {}
          }

          if (method === 'homebrew') {
            execSync('brew upgrade spqw/homebrew-tap/vcopilot 2>/dev/null', { stdio: 'ignore' });
          } else if (method === 'mise') {
            execSync('mise upgrade vcopilot 2>/dev/null', { stdio: 'ignore' });
          } else {
            execSync('npm update -g @spqw/vcopilot 2>/dev/null', { stdio: 'ignore' });
          }
        } catch {}
      });
    }).on('error', () => {});
  `;

  const child = spawn(process.execPath, ['-e', script], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pkgVersion: string = require('../package.json').version;

  // Background auto-update check on every run
  backgroundAutoUpdate(pkgVersion);

  // --version: print version and exit
  if (args.version) {
    process.stdout.write(`vcopilot ${pkgVersion}\n`);
    return;
  }

  // --update: check for updates and self-update
  if (args.update) {
    process.stderr.write('Checking for updates...\n');
    try {
      const res = await axios.get('https://api.github.com/repos/spqw/lib-copilot/releases/latest', {
        headers: { 'Accept': 'application/vnd.github+json' },
      });
      const latest = (res.data.tag_name as string).replace(/^v/, '');

      if (latest === pkgVersion) {
        process.stdout.write(`vcopilot is up to date (v${pkgVersion})\n`);
        return;
      }

      process.stderr.write(`Update available: v${pkgVersion} → v${latest}\n`);

      const method = detectInstallMethod();
      if (method === 'homebrew') {
        process.stderr.write('Updating via Homebrew...\n');
        execSync('brew upgrade spqw/homebrew-tap/vcopilot', { stdio: 'inherit' });
      } else if (method === 'mise') {
        process.stderr.write('Updating via mise...\n');
        execSync('mise upgrade vcopilot', { stdio: 'inherit' });
      } else {
        process.stderr.write('Updating via npm...\n');
        execSync('npm update -g @spqw/vcopilot', { stdio: 'inherit' });
      }

      process.stdout.write(`Updated vcopilot from v${pkgVersion} to v${latest}\n`);
    } catch (err: any) {
      process.stderr.write(`Update failed: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // --serve: start OpenAI-compatible API server
  if (args.serve) {
    const port = parseInt(process.env.VCOPILOT_PORT || '8787', 10);
    await startServer({
      port,
      debug: args.debug,
      vscode: args.vscode,
      detached: args.detached,
    });
    return;
  }

  // vcopilot code: interactive coding agent
  if (args.positional[0] === 'code') {
    const { startCodeSession } = require('./code');
    await startCodeSession({ debug: args.debug, sync: args.sync });
    return;
  }

  const auth = new CopilotAuth(args.debug);

  // --login: force re-auth via device flow
  if (args.login) {
    auth.clearCache();
    process.stderr.write('Cleared cached token. Starting device flow...\n');
    const flow = await auth.initiateDeviceFlow();
    process.stderr.write(`\nOpen: ${flow.verification_uri}\nEnter code: ${flow.user_code}\n\nWaiting for authorization...\n`);
    await auth.pollDeviceFlow(flow.device_code);
    process.stderr.write(`Authenticated successfully. Token saved.\n`);
    return;
  }

  // --status: show token state
  if (args.status) {
    const envToken = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN;
    const envName = process.env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : process.env.COPILOT_TOKEN ? 'COPILOT_TOKEN' : null;
    const cachedInfo = auth.getCachedTokenInfo();
    const vscode = await auth.authenticateWithVSCode();
    const session = auth.getCachedSession();

    process.stdout.write('github token:\n');
    if (envToken) {
      process.stdout.write(`  source:  ${envName} env var\n`);
      process.stdout.write(`  value:   ${envToken.slice(0, 8)}...${envToken.slice(-4)}\n`);
      process.stdout.write(`  expires: never (valid until revoked)\n`);
    } else if (cachedInfo) {
      process.stdout.write(`  source:  ~/.copilot/token.json\n`);
      process.stdout.write(`  value:   ${cachedInfo.token.slice(0, 8)}...${cachedInfo.token.slice(-4)}\n`);
      process.stdout.write(`  expires: never (valid until revoked)\n`);
      if (cachedInfo.timestamp) {
        process.stdout.write(`  saved:   ${cachedInfo.timestamp}\n`);
      }
    } else {
      process.stdout.write('  (none) — run vcopilot --login to authenticate\n');
    }

    process.stdout.write('\nvscode session:\n');
    if (vscode) {
      process.stdout.write(`  status:  found\n`);
      process.stdout.write(`  value:   ${vscode.token.slice(0, 8)}...${vscode.token.slice(-4)}\n`);
    } else {
      process.stdout.write('  (none) — VSCode Copilot extension not detected\n');
    }

    process.stdout.write('\ncopilot session:\n');
    if (session) {
      const remaining = session.expiresAt - Date.now();
      const mins = Math.floor(remaining / 60000);
      const expired = remaining <= 0;
      process.stdout.write(`  source:  ~/.copilot/session.json\n`);
      process.stdout.write(`  value:   ${session.token.slice(0, 8)}...${session.token.slice(-4)}\n`);
      process.stdout.write(`  expires: ${new Date(session.expiresAt).toISOString()}`);
      if (expired) {
        process.stdout.write(' (expired)\n');
      } else {
        process.stdout.write(` (${mins}m remaining)\n`);
      }
    } else {
      process.stdout.write('  (none) — will be obtained on next request\n');
    }

    return;
  }

  // chatgpt: browser automation mode (default unless --copilot, --local, or --endpoint)
  if (args.chatgpt && !args.copilot && !args.local && !args.endpoint) {
    // Determine prompt: positional args prepended to stdin if both present
    let prompt: string;
    if (!process.stdin.isTTY) {
      const stdinContent = await readStdin();
      if (args.positional.length > 0) {
        prompt = args.positional.join(' ') + '\n\n' + stdinContent;
      } else {
        prompt = stdinContent;
      }
    } else if (args.positional.length > 0) {
      prompt = args.positional.join(' ');
    } else {
      printHelp();
      process.exit(1);
      return;
    }

    prompt = prompt.trim();
    if (!prompt) {
      process.stderr.write('Error: empty prompt\n');
      process.exit(1);
    }

    if (args.system) {
      prompt = `${args.system}\n\n${prompt}`;
    }

    status('chatgpt', 'model: ChatGPT (browser)');
    status('chatgpt', `prompt: ${prompt.length} chars`);
    const response = await chatGPT(prompt, { debug: args.debug, sync: args.sync });
    status('chatgpt', `done (${response.length} chars received)`);
    if (args.outputFilePath) {
      fs.writeFileSync(args.outputFilePath, response + '\n');
      status('chatgpt', `written to ${args.outputFilePath}`);
    } else {
      process.stdout.write(response);
      process.stdout.write('\n');
    }
    return;
  }

  // Determine if using local mode (--local or --endpoint implies local)
  const isLocal = args.local || !!args.endpoint;

  // Ensure local model is loaded via lms CLI
  if (args.local && args.model !== DEFAULT_MODEL) {
    ensureLocalModel(args.model, args.debug);
  }

  let token: string | undefined;
  let client: CopilotClient;
  if (isLocal) {
    client = new CopilotClient({
      local: true,
      endpoint: args.endpoint,
      model: args.model === DEFAULT_MODEL ? undefined : args.model,
      debug: args.debug,
    });
  } else {
    token = await authenticate(auth, args.debug, args.vscode);
    client = new CopilotClient({ token, model: args.model, debug: args.debug, auth });
  }

  // --models: list models with multipliers and context window, sorted by premium cost
  if (args.models) {
    if (isLocal) {
      // Local server: just list model IDs
      const models = await client.getModelsDetailed();
      for (const m of models) {
        process.stdout.write(`${m.id}\n`);
      }
      return;
    }

    const models = await client.getModelsDetailed();

    // Build display rows
    const rows = models.map((m: any) => {
      const id: string = m.id;
      const mult = MULTIPLIERS[id.toLowerCase()];
      const ctx = m.capabilities?.limits?.max_context_window_tokens;
      return { id, mult, ctx };
    });

    // Sort: highest multiplier first, unknown at the end
    rows.sort((a, b) => {
      const am = a.mult ?? -1;
      const bm = b.mult ?? -1;
      return bm - am;
    });

    const maxId = Math.max(...rows.map(r => r.id.length));

    for (const r of rows) {
      const multStr = r.mult === undefined ? '    ' :
                      `${r.mult}x`.padEnd(4);
      const ctxStr = r.ctx ? `${Math.round(r.ctx / 1000)}k ctx` : '';
      process.stdout.write(`${r.id.padEnd(maxId)}  ${multStr}  ${ctxStr}\n`);
    }
    return;
  }

  // --usage: show premium quota
  if (args.usage) {
    if (isLocal) {
      process.stderr.write('--usage is not available for local models\n');
      return;
    }
    const res = await axios.get('https://api.github.com/copilot_internal/user', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/json',
      },
    });
    const data = res.data;

    process.stdout.write(`plan: ${data.copilot_plan || 'unknown'}\n`);
    process.stdout.write(`sku:  ${data.access_type_sku || 'unknown'}\n`);
    if (data.quota_reset_date) {
      process.stdout.write(`reset: ${data.quota_reset_date}\n`);
    }

    if (data.quota_snapshots) {
      process.stdout.write('\n');
      for (const [key, val] of Object.entries(data.quota_snapshots) as [string, any][]) {
        if (val.unlimited) {
          process.stdout.write(`[${key}] unlimited\n\n`);
          continue;
        }
        const used = val.entitlement - (val.quota_remaining ?? 0);
        process.stdout.write(`[${key}]\n`);
        process.stdout.write(`  ${val.remaining}/${val.entitlement} remaining (${val.percent_remaining.toFixed(1)}%)\n`);
        process.stdout.write(`  used: ${used.toFixed(1)} premium requests\n`);
        if (val.overage_count > 0) {
          process.stdout.write(`  overage: ${val.overage_count}\n`);
        }
        process.stdout.write('\n');
      }
    }
    return;
  }

  // Determine prompt: positional args prepended to stdin if both present
  let prompt: string;
  if (!process.stdin.isTTY) {
    const stdinContent = await readStdin();
    if (args.positional.length > 0) {
      prompt = args.positional.join(' ') + '\n\n' + stdinContent;
    } else {
      prompt = stdinContent;
    }
  } else if (args.positional.length > 0) {
    prompt = args.positional.join(' ');
  } else {
    printHelp();
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  prompt = prompt.trim();
  if (!prompt) {
    process.stderr.write('Error: empty prompt\n');
    process.exit(1);
  }

  // Build messages
  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  if (args.system) {
    messages.push({ role: 'system', content: args.system });
  }
  messages.push({ role: 'user', content: prompt });

  const tag = isLocal ? 'local' : 'copilot';
  const modelLabel = args.model === DEFAULT_MODEL && isLocal ? 'default' : args.model;
  status(tag, `model: ${modelLabel}`);
  status(tag, `prompt: ${prompt.length} chars`);

  if (args.debug) {
    process.stderr.write(`[debug] model=${args.model} prompt_length=${prompt.length}\n`);
  }

  // Stream response: content to stdout, status to stderr
  status(tag, 'streaming response...');
  let totalChars = 0;
  let collected = '';
  const requestModel = (args.model === DEFAULT_MODEL && isLocal) ? undefined : args.model;
  await client.chatStream(
    { messages, model: requestModel },
    (chunk) => {
      totalChars += chunk.length;
      if (args.outputFilePath) {
        collected += chunk;
      } else {
        process.stdout.write(chunk);
      }
    },
    (error) => {
      process.stderr.write(`\nStream error: ${error.message}\n`);
    }
  );

  if (args.outputFilePath) {
    fs.writeFileSync(args.outputFilePath, collected + '\n');
    status(tag, `written to ${args.outputFilePath}`);
  } else {
    // Ensure trailing newline
    process.stdout.write('\n');
  }
  status(tag, `done (${totalChars} chars received)`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
});
