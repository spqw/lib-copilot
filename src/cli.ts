#!/usr/bin/env node

import { CopilotClient } from './client';
import { CopilotAuth } from './auth';
import axios from 'axios';
import { execSync } from 'child_process';

const DEFAULT_MODEL = 'gpt-4.1';

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
  token?: string;
  debug: boolean;
  login: boolean;
  status: boolean;
  models: boolean;
  usage: boolean;
  local: boolean;
  version: boolean;
  update: boolean;
  endpoint?: string;
  positional: string[];
} {
  const result = {
    model: DEFAULT_MODEL,
    system: undefined as string | undefined,
    token: undefined as string | undefined,
    debug: false,
    login: false,
    status: false,
    models: false,
    usage: false,
    local: false,
    version: false,
    update: false,
    endpoint: undefined as string | undefined,
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
    } else if (arg === '--token' && i + 1 < argv.length) {
      result.token = argv[++i];
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
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg === '--update') {
      result.update = true;
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
  cat PROMPT.md | vcopilot [options]          Pipe stdin as prompt
  vcopilot [options] "your prompt here"       Positional prompt
  vcopilot --models                           List available models
  vcopilot --usage                            Show premium quota
  vcopilot --status                           Show token/auth state
  vcopilot --login                            Force re-authentication
  vcopilot --login --token <pat>              Save a GitHub PAT

Options:
  --model <name>      Model to use (default: ${DEFAULT_MODEL})
  --system <text>     System prompt
  --token <pat>       GitHub Personal Access Token (skips device flow)
  --local             Use local LM Studio server (localhost:1234)
  --endpoint <url>    Custom API base URL (e.g. http://localhost:1234/v1)
  --debug             Enable debug logging
  --login             Force re-auth (device flow, or save --token)
  --status            Show token and session state
  --models            List available models
  --usage             Show premium quota remaining
  -v, --version       Show version
  --update            Update to latest version
  -h, --help          Show this help

Authentication (in priority order):
  1. --token <pat>              CLI flag (highest priority)
  2. GITHUB_TOKEN env var       Environment variable
  3. ~/.copilot/token.json      Cached from previous login
  4. Device flow (interactive)  Browser-based OAuth (fallback)

  To use a PAT permanently, save it with:
    vcopilot --login --token ghp_YourTokenHere

  Or export it:
    export GITHUB_TOKEN=ghp_YourTokenHere

Examples:
  echo "what is 2+2" | vcopilot
  cat PROMPT.md | vcopilot --model grok-code-fast-1 > output.md
  vcopilot "explain quicksort"
  vcopilot --token ghp_abc123 "hello"

Local models (LM Studio):
  1. Install LM Studio from https://lmstudio.ai
  2. Download a model (e.g. openai/gpt-oss-20b MLX)
  3. Start the local server (Developer tab → Start Server)
  4. Use with vcopilot:

  vcopilot --local "what is 2+2"
  vcopilot --local --model openai/gpt-oss-20b "explain quicksort"
  vcopilot --local --models
  echo "refactor this" | vcopilot --local --system "You are a code expert"

  Custom endpoint:
  vcopilot --endpoint http://192.168.1.10:1234/v1 "hello"
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

async function authenticate(auth: CopilotAuth, debug: boolean, cliToken?: string): Promise<string> {
  // 1. --token flag (highest priority)
  if (cliToken) {
    if (debug) process.stderr.write('[auth] using --token flag\n');
    return cliToken;
  }

  // 2. Try env vars
  const envToken = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN;
  if (envToken) {
    if (debug) process.stderr.write('[auth] using env token\n');
    return envToken;
  }

  // 3. Try cached token
  const cached = auth['getCachedToken']();
  if (cached) {
    if (debug) process.stderr.write('[auth] using cached token\n');
    return cached;
  }

  // 4. Auto device flow (last resort)
  process.stderr.write('No token found. Starting device flow authentication...\n');
  const flow = await auth.initiateDeviceFlow();
  process.stderr.write(`\nOpen: ${flow.verification_uri}\nEnter code: ${flow.user_code}\n\nWaiting for authorization...\n`);
  const result = await auth.pollDeviceFlow(flow.device_code);
  process.stderr.write('Authenticated successfully.\n');
  return result.token;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pkgVersion: string = require('../package.json').version;

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

      // Detect install method
      let isHomebrew = false;
      try {
        execSync('brew list spqw/homebrew-tap/vcopilot 2>/dev/null', { stdio: 'ignore' });
        isHomebrew = true;
      } catch {}

      if (isHomebrew) {
        process.stderr.write('Updating via Homebrew...\n');
        execSync('brew upgrade spqw/homebrew-tap/vcopilot', { stdio: 'inherit' });
      } else {
        process.stderr.write('Updating via npm...\n');
        execSync('npm update -g lib-copilot', { stdio: 'inherit' });
      }

      process.stdout.write(`Updated vcopilot from v${pkgVersion} to v${latest}\n`);
    } catch (err: any) {
      process.stderr.write(`Update failed: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  const auth = new CopilotAuth(args.debug);

  // --login: force re-auth (with PAT or device flow)
  if (args.login) {
    auth.clearCache();
    if (args.token) {
      // Validate and save the PAT
      process.stderr.write('Validating GitHub token...\n');
      const result = await auth.authenticateWithGitHub(args.token);
      process.stderr.write(`Authenticated as GitHub user. Token saved to ~/.copilot/token.json\n`);
      if (result.scopes?.length) {
        process.stderr.write(`Scopes: ${result.scopes.join(', ')}\n`);
      }
    } else {
      process.stderr.write('Cleared cached token. Starting device flow...\n');
      const flow = await auth.initiateDeviceFlow();
      process.stderr.write(`\nOpen: ${flow.verification_uri}\nEnter code: ${flow.user_code}\n\nWaiting for authorization...\n`);
      await auth.pollDeviceFlow(flow.device_code);
      process.stderr.write(`Authenticated successfully. Token saved.\n`);
    }
    return;
  }

  // --status: show token state
  if (args.status) {
    const envToken = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN;
    const envName = process.env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : process.env.COPILOT_TOKEN ? 'COPILOT_TOKEN' : null;
    const cached = auth['getCachedToken']();
    const session = auth.getCachedSession();

    process.stdout.write('github token:\n');
    if (envToken) {
      process.stdout.write(`  source:  ${envName} env var\n`);
      process.stdout.write(`  value:   ${envToken.slice(0, 8)}...${envToken.slice(-4)}\n`);
    } else if (cached) {
      process.stdout.write(`  source:  ~/.copilot/token.json\n`);
      process.stdout.write(`  value:   ${cached.slice(0, 8)}...${cached.slice(-4)}\n`);
    } else {
      process.stdout.write('  (none) — run vcopilot --login to authenticate\n');
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

  // Determine if using local mode (--local or --endpoint implies local)
  const isLocal = args.local || !!args.endpoint;

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
    token = await authenticate(auth, args.debug, args.token);
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

  // Determine prompt: stdin (piped) or positional args
  let prompt: string;
  if (!process.stdin.isTTY) {
    prompt = await readStdin();
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

  if (args.debug) {
    process.stderr.write(`[debug] model=${args.model} prompt_length=${prompt.length}\n`);
  }

  // Stream response: content to stdout, status to stderr
  const modelLabel = args.model === DEFAULT_MODEL && isLocal ? 'default' : args.model;
  process.stderr.write(`${isLocal ? '[local] ' : ''}model: ${modelLabel}\n`);

  const requestModel = (args.model === DEFAULT_MODEL && isLocal) ? undefined : args.model;
  await client.chatStream(
    { messages, model: requestModel },
    (chunk) => {
      process.stdout.write(chunk);
    },
    (error) => {
      process.stderr.write(`\nStream error: ${error.message}\n`);
    }
  );

  // Ensure trailing newline
  process.stdout.write('\n');
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
});
