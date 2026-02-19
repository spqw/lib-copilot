#!/usr/bin/env node

import { CopilotClient } from './client';
import { CopilotAuth } from './auth';
import axios from 'axios';

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
  debug: boolean;
  login: boolean;
  models: boolean;
  usage: boolean;
  positional: string[];
} {
  const result = {
    model: DEFAULT_MODEL,
    system: undefined as string | undefined,
    debug: false,
    login: false,
    models: false,
    usage: false,
    positional: [] as string[],
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--model' && i + 1 < argv.length) {
      result.model = argv[++i];
    } else if (arg === '--system' && i + 1 < argv.length) {
      result.system = argv[++i];
    } else if (arg === '--debug') {
      result.debug = true;
    } else if (arg === '--login') {
      result.login = true;
    } else if (arg === '--models') {
      result.models = true;
    } else if (arg === '--usage') {
      result.usage = true;
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
  vcopilot --login                            Force re-authentication

Options:
  --model <name>    Model to use (default: ${DEFAULT_MODEL})
  --system <text>   System prompt
  --debug           Enable debug logging
  --login           Force device flow re-auth
  --models          List available models
  --usage           Show premium quota remaining
  -h, --help        Show this help

Examples:
  echo "what is 2+2" | vcopilot
  cat PROMPT.md | vcopilot --model grok-code-fast-1 > output.md
  vcopilot "explain quicksort"
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

async function authenticate(auth: CopilotAuth, debug: boolean): Promise<string> {
  // 1. Try cached token
  const cached = auth['getCachedToken']();
  if (cached) {
    if (debug) process.stderr.write('[auth] using cached token\n');
    return cached;
  }

  // 2. Try env vars
  const envToken = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN;
  if (envToken) {
    if (debug) process.stderr.write('[auth] using env token\n');
    return envToken;
  }

  // 3. Auto device flow
  process.stderr.write('No token found. Starting device flow authentication...\n');
  const flow = await auth.initiateDeviceFlow();
  process.stderr.write(`\nOpen: ${flow.verification_uri}\nEnter code: ${flow.user_code}\n\nWaiting for authorization...\n`);
  const result = await auth.pollDeviceFlow(flow.device_code);
  process.stderr.write('Authenticated successfully.\n');
  return result.token;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const auth = new CopilotAuth(args.debug);

  // --login: force re-auth
  if (args.login) {
    auth.clearCache();
    process.stderr.write('Cleared cached token. Starting device flow...\n');
    const flow = await auth.initiateDeviceFlow();
    process.stderr.write(`\nOpen: ${flow.verification_uri}\nEnter code: ${flow.user_code}\n\nWaiting for authorization...\n`);
    const result = await auth.pollDeviceFlow(flow.device_code);
    process.stderr.write(`Authenticated successfully. Token saved.\n`);
    return;
  }

  const token = await authenticate(auth, args.debug);
  const client = new CopilotClient({ token, model: args.model, debug: args.debug });

  // --models: list models with multipliers and context window, sorted by premium cost
  if (args.models) {
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
  process.stderr.write(`model: ${args.model}\n`);

  await client.chatStream(
    { messages, model: args.model },
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
