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
  let token: string | undefined;
  let client: CopilotClient | undefined;

  try {
    token = await authenticate(auth, debug, vscode);
    client = new CopilotClient({ token, debug, auth });
    log('authenticated with GitHub Copilot');
  } catch (err: any) {
    log(`copilot auth skipped: ${err.message}`);
    log('will use ChatGPT browser mode as fallback');
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
        if (client) {
          const models = await client.getModelsDetailed();
          jsonResponse(res, 200, { object: 'list', data: models });
        } else {
          jsonResponse(res, 200, {
            object: 'list',
            data: [
              {
                id: 'chatgpt',
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'chatgpt-browser',
              },
            ],
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

        // Decide backend: if model is "chatgpt" or no copilot client, use browser
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

          const response = await chatGPT(prompt, { debug });

          if (stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            });

            // Send the full response as a single chunk (ChatGPT gives us the whole thing)
            sseChunk(res, {
              id: requestId,
              object: 'chat.completion.chunk',
              created: timestamp,
              model: 'chatgpt',
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: response },
                  finish_reason: null,
                },
              ],
            });

            sseChunk(res, {
              id: requestId,
              object: 'chat.completion.chunk',
              created: timestamp,
              model: 'chatgpt',
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop',
                },
              ],
            });

            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            jsonResponse(res, 200, {
              id: requestId,
              object: 'chat.completion',
              created: timestamp,
              model: 'chatgpt',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: response },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
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
                choices: [
                  {
                    index: 0,
                    delta: { content: chunk },
                    finish_reason: null,
                  },
                ],
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
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
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

  server.listen(port, '127.0.0.1', () => {
    log(`OpenAI-compatible server listening on http://127.0.0.1:${port}/v1`);
    log(`endpoints:`);
    log(`  GET  /v1/models`);
    log(`  POST /v1/chat/completions`);
    log(`  GET  /health`);
    if (client) {
      log(`backend: GitHub Copilot API`);
    } else {
      log(`backend: ChatGPT (browser automation)`);
    }

    // Write PID file even in foreground mode
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
