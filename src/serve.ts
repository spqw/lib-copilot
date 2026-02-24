import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CopilotClient } from './client';
import { CopilotAuth } from './auth';
import { chatGPT } from './chatgpt';

const PID_FILE = path.join(os.homedir(), '.copilot', 'serve.pid');

interface ServeOptions {
  port: number;
  debug: boolean;
  vscode: boolean;
  detached: boolean;
}

function log(msg: string) {
  process.stderr.write(`[serve] ${msg}\n`);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown
) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

function sseChunk(res: http.ServerResponse, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function generateId(): string {
  return 'chatcmpl-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// Default model always available — routed through ChatGPT browser automation
const CHATGPT_MODEL = {
  id: 'chatgpt',
  object: 'model' as const,
  created: 1700000000,
  owned_by: 'vcopilot',
  permission: [],
  root: 'chatgpt',
  parent: null,
};

async function authenticate(
  auth: CopilotAuth,
  debug: boolean,
  forceVSCode: boolean
): Promise<string> {
  if (forceVSCode) {
    const vscode = await auth.authenticateWithVSCode();
    if (vscode) return vscode.token;
    throw new Error('VSCode Copilot session not found');
  }

  const envToken = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN;
  if (envToken) return envToken;

  const cached = (auth as any).getCachedToken();
  if (cached) return cached;

  throw new Error(
    'No GitHub token found. Set GITHUB_TOKEN env var or run vcopilot --login first.'
  );
}

function printInstructions(port: number, backend: string, models: string[]) {
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const modelList = models.join(', ');

  log('');
  log('=== OpenAI-compatible API server ===');
  log('');
  log(`  Base URL:  ${baseUrl}`);
  log(`  API Key:   sk-vcopilot (any value works)`);
  log(`  Models:    ${modelList}`);
  log(`  Backend:   ${backend}`);
  log('');
  log('Endpoints:');
  log(`  GET  ${baseUrl}/models`);
  log(`  POST ${baseUrl}/chat/completions`);
  log(`  GET  http://127.0.0.1:${port}/health`);
  log('');
  log('=== Setup for coding agents ===');
  log('');
  log('Kilo Code / Roo Code (VSCode):');
  log('  Provider:  OpenAI Compatible');
  log(`  Base URL:  ${baseUrl}`);
  log('  API Key:   sk-vcopilot');
  log('  Model:     chatgpt');
  log('');
  log('Claude Code:');
  log(`  OPENAI_API_KEY=sk-vcopilot OPENAI_BASE_URL=${baseUrl} claude`);
  log('');
  log('Cursor:');
  log('  Settings > Models > OpenAI API Key: sk-vcopilot');
  log(`  Override OpenAI Base URL: ${baseUrl}`);
  log('');
  log('Aider:');
  log(`  aider --openai-api-key sk-vcopilot --openai-api-base ${baseUrl} --model openai/chatgpt`);
  log('');
  log('Continue:');
  log('  In config.json, add provider with:');
  log(`    "apiBase": "${baseUrl}"`);
  log('    "apiKey": "sk-vcopilot"');
  log('    "model": "chatgpt"');
  log('');
  log('cURL:');
  log(`  curl ${baseUrl}/chat/completions \\`);
  log('    -H "Content-Type: application/json" \\');
  log('    -H "Authorization: Bearer sk-vcopilot" \\');
  log('    -d \'{"model":"chatgpt","messages":[{"role":"user","content":"hello"}]}\'');
  log('');
  log('=================================');
  log('');
}

export async function startServer(options: ServeOptions): Promise<void> {
  const { port, debug, vscode, detached } = options;

  // If --detached, fork as daemon
  if (detached) {
    const { spawn } = await import('child_process');
    const args = process.argv.slice(1).filter((a) => a !== '--detached');
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, VCOPILOT_SERVE_CHILD: '1' },
    });
    child.unref();

    // Write PID file
    const pidDir = path.dirname(PID_FILE);
    if (!fs.existsSync(pidDir)) fs.mkdirSync(pidDir, { recursive: true });
    fs.writeFileSync(PID_FILE, String(child.pid));

    log(`server started in background (pid ${child.pid})`);
    log(`listening on http://127.0.0.1:${port}/v1`);
    log(`pid file: ${PID_FILE}`);
    log(`stop with: kill $(cat ${PID_FILE})`);
    process.exit(0);
  }

  // Set up auth + client for Copilot API mode
  const auth = new CopilotAuth(debug);
  let client: CopilotClient | undefined;

  // Cached models list (fetched once on first /v1/models call)
  let cachedModels: any[] | null = null;

  try {
    const token = await authenticate(auth, debug, vscode);
    client = new CopilotClient({ token, debug, auth });
    log('authenticated with GitHub Copilot');
  } catch (err: any) {
    log(`copilot auth skipped: ${err.message}`);
    log('using ChatGPT browser mode');
  }

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (debug) log(`${req.method} ${pathname}`);

    try {
      // GET /v1/models
      if (pathname === '/v1/models' && req.method === 'GET') {
        const models = await getModels();
        jsonResponse(res, 200, { object: 'list', data: models });
        return;
      }

      // GET /v1/models/:id
      if (pathname.startsWith('/v1/models/') && req.method === 'GET') {
        const modelId = pathname.slice('/v1/models/'.length);
        const models = await getModels();
        const model = models.find((m: any) => m.id === modelId);
        if (model) {
          jsonResponse(res, 200, model);
        } else {
          jsonResponse(res, 404, {
            error: { message: `Model '${modelId}' not found`, type: 'invalid_request_error' },
          });
        }
        return;
      }

      // POST /v1/chat/completions
      if (pathname === '/v1/chat/completions' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const messages = body.messages || [];
        const model = body.model || 'chatgpt';
        const stream = body.stream === true;
        const requestId = generateId();
        const timestamp = Math.floor(Date.now() / 1000);

        if (debug) {
          log(`model=${model} messages=${messages.length} stream=${stream}`);
        }

        // Route: "chatgpt" model or no copilot client → browser automation
        const useChatGPT = model === 'chatgpt' || !client;

        if (useChatGPT) {
          // Combine messages into a single prompt for ChatGPT browser mode
          const prompt = messages
            .map((m: any) => {
              if (m.role === 'system') return `[System] ${m.content}`;
              if (m.role === 'assistant') return `[Assistant] ${m.content}`;
              return m.content;
            })
            .join('\n\n');

          log(`chatgpt: sending ${prompt.length} chars...`);
          const response = await chatGPT(prompt, { debug });
          log(`chatgpt: received ${response.length} chars`);

          if (stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            });

            // Send role chunk first, then content, then stop
            sseChunk(res, {
              id: requestId,
              object: 'chat.completion.chunk',
              created: timestamp,
              model: 'chatgpt',
              choices: [{
                index: 0,
                delta: { role: 'assistant' },
                finish_reason: null,
              }],
            });

            sseChunk(res, {
              id: requestId,
              object: 'chat.completion.chunk',
              created: timestamp,
              model: 'chatgpt',
              choices: [{
                index: 0,
                delta: { content: response },
                finish_reason: null,
              }],
            });

            sseChunk(res, {
              id: requestId,
              object: 'chat.completion.chunk',
              created: timestamp,
              model: 'chatgpt',
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop',
              }],
            });

            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            jsonResponse(res, 200, {
              id: requestId,
              object: 'chat.completion',
              created: timestamp,
              model: 'chatgpt',
              choices: [{
                index: 0,
                message: { role: 'assistant', content: response },
                finish_reason: 'stop',
              }],
              usage: {
                prompt_tokens: Math.ceil(prompt.length / 4),
                completion_tokens: Math.ceil(response.length / 4),
                total_tokens: Math.ceil((prompt.length + response.length) / 4),
              },
            });
          }
          return;
        }

        // Copilot API backend
        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });

          await client!.chatStream(
            { messages, model },
            (chunk) => {
              sseChunk(res, {
                id: requestId,
                object: 'chat.completion.chunk',
                created: timestamp,
                model,
                choices: [{
                  index: 0,
                  delta: { content: chunk },
                  finish_reason: null,
                }],
              });
            },
            (error) => {
              log(`stream error: ${error.message}`);
            }
          );

          sseChunk(res, {
            id: requestId,
            object: 'chat.completion.chunk',
            created: timestamp,
            model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: 'stop',
            }],
          });

          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          const chatRes = await client!.chat({ messages, model });
          jsonResponse(res, 200, {
            id: chatRes.id || requestId,
            object: 'chat.completion',
            created: chatRes.created || timestamp,
            model: chatRes.model || model,
            choices: chatRes.choices,
            usage: chatRes.usage || {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
          });
        }
        return;
      }

      // Health check
      if (pathname === '/health' || pathname === '/') {
        jsonResponse(res, 200, {
          status: 'ok',
          backend: client ? 'copilot' : 'chatgpt-browser',
          models: (await getModels()).map((m: any) => m.id),
        });
        return;
      }

      jsonResponse(res, 404, {
        error: { message: 'Not found', type: 'invalid_request_error' },
      });
    } catch (err: any) {
      log(`error: ${err.message}`);
      if (debug) log(err.stack || '');
      jsonResponse(res, 500, {
        error: { message: err.message, type: 'server_error' },
      });
    }
  });

  // Helper: get models list (chatgpt always first, then copilot models if available)
  async function getModels(): Promise<any[]> {
    if (cachedModels) return cachedModels;

    const models: any[] = [CHATGPT_MODEL];

    if (client) {
      try {
        const copilotModels = await client.getModelsDetailed();
        for (const m of copilotModels) {
          // Don't duplicate if copilot also has a "chatgpt" model
          if (m.id !== 'chatgpt') {
            models.push({
              id: m.id,
              object: 'model',
              created: m.created || 1700000000,
              owned_by: m.owned_by || 'github-copilot',
              permission: m.permission || [],
              root: m.root || m.id,
              parent: m.parent || null,
            });
          }
        }
      } catch (err: any) {
        if (debug) log(`failed to fetch copilot models: ${err.message}`);
      }
    }

    cachedModels = models;
    return models;
  }

  server.listen(port, '127.0.0.1', async () => {
    const models = await getModels();
    const modelIds = models.map((m: any) => m.id);
    const backend = client ? 'GitHub Copilot API + ChatGPT browser' : 'ChatGPT (browser automation)';

    printInstructions(port, backend, modelIds);

    // Write PID file
    const pidDir = path.dirname(PID_FILE);
    if (!fs.existsSync(pidDir)) fs.mkdirSync(pidDir, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
  });

  // Cleanup PID file on exit
  const cleanup = () => {
    try {
      if (fs.existsSync(PID_FILE)) {
        const pid = fs.readFileSync(PID_FILE, 'utf-8').trim();
        if (pid === String(process.pid)) {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch {}
  };
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}
