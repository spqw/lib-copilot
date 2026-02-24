import { chromium } from 'playwright-core';
import {
  startPlayWriterCDPRelayServer,
  getCdpUrl,
} from 'playwriter';
import * as net from 'node:net';
import * as path from 'path';
import { spawn } from 'child_process';
import { sendChatGPTMessage } from './chatgpt-sender';
import { readJob, cleanupOldJobs } from './chatgpt-job';
import { extractMarkdownFromPage } from './html-to-markdown';

type Page = Awaited<ReturnType<typeof connectBrowser>>['page'];

let debug = false;

function status(msg: string) {
  process.stderr.write(`[chatgpt] ${msg}\n`);
}

function log(...args: unknown[]) {
  if (debug) process.stderr.write('[chatgpt:debug] ' + args.map(String).join(' ') + '\n');
}

export interface ChatGPTOptions {
  debug: boolean;
  sync?: boolean;
}

/**
 * Main entry point for ChatGPT browser automation.
 *
 * Default (async) mode:
 *   1. Sender dispatches prompt and confirms ChatGPT is processing (fast, ~3-8s)
 *   2. Watcher runs as background process, waits for completion, extracts response
 *   3. CLI polls job file with heartbeat until response is ready
 *
 * Sync mode (--sync):
 *   Original monolithic flow — connect, send, wait, extract, close.
 */
export async function chatGPT(
  prompt: string,
  options: ChatGPTOptions
): Promise<string> {
  debug = options.debug;

  // Opportunistic cleanup of old job files
  cleanupOldJobs();

  if (options.sync) {
    return chatGPTSync(prompt, options.debug);
  }

  // --- SENDER PHASE ---
  const { jobId } = await sendChatGPTMessage(prompt, options.debug);
  status(`request dispatched (job ${jobId}), ChatGPT is processing`);

  // --- SPAWN WATCHER ---
  const watcherScript = path.join(__dirname, 'chatgpt-watcher.js');
  const watcherArgs = [watcherScript, jobId];
  if (options.debug) watcherArgs.push('--debug');

  const watcher = spawn(process.execPath, watcherArgs, {
    detached: true,
    stdio: 'ignore',
  });
  watcher.unref();

  status(`watcher spawned (pid ${watcher.pid})`);

  // --- POLL LOOP ---
  return pollForCompletion(jobId);
}

async function pollForCompletion(
  jobId: string,
  pollIntervalMs: number = 1000,
  heartbeatIntervalMs: number = 10_000,
  timeoutMs: number = 300_000,
): Promise<string> {
  const startTime = Date.now();
  let lastHeartbeatLog = startTime;

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed > timeoutMs) {
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ChatGPT response (job ${jobId})`
      );
    }

    const job = readJob(jobId);

    if (!job) {
      throw new Error(`Job file disappeared: ${jobId}`);
    }

    if (job.status === 'completed' && job.response !== undefined) {
      status(`response ready (${job.responseLength} chars)`);
      return job.response;
    }

    if (job.status === 'error') {
      throw new Error(`ChatGPT job failed: ${job.error || 'unknown error'}`);
    }

    // Check watcher liveness via heartbeat
    if (job.status === 'watching' && job.lastHeartbeat) {
      const heartbeatAge = Date.now() - new Date(job.lastHeartbeat).getTime();
      if (heartbeatAge > 30_000) {
        throw new Error(
          `Watcher appears dead (no heartbeat for ${Math.round(heartbeatAge / 1000)}s). ` +
          `Job ${jobId} stuck at status '${job.status}'.`
        );
      }
    }

    // Print heartbeat to stderr periodically
    if (Date.now() - lastHeartbeatLog >= heartbeatIntervalMs) {
      const secs = Math.round(elapsed / 1000);
      status(`still waiting... ${secs}s elapsed (status: ${job.status})`);
      lastHeartbeatLog = Date.now();
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

// ---------------------------------------------------------------------------
// Sync mode: original monolithic flow preserved as fallback (--sync)
// ---------------------------------------------------------------------------

function isPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', (err: NodeJS.ErrnoException) => {
        resolve(err.code === 'EADDRINUSE');
      })
      .once('listening', () => {
        tester.close(() => resolve(false));
      })
      .listen(port, host);
  });
}

async function resolveExtensionId(
  host: string,
  port: number,
  maxWaitMs = 30_000
): Promise<string | undefined> {
  const poll = async () => {
    const res = await fetch(`http://${host}:${port}/extensions/status`);
    const data = (await res.json()) as {
      extensions: Array<{ extensionId: string }>;
    };
    return data.extensions;
  };

  const deadline = Date.now() + maxWaitMs;
  let extensions = await poll();

  while (extensions.length === 0 && Date.now() < deadline) {
    status('waiting for browser extension to connect...');
    await new Promise((r) => setTimeout(r, 2000));
    extensions = await poll();
  }

  if (extensions.length === 0) {
    throw new Error(
      'No browser extension connected to the CDP relay server.\n' +
        'Make sure Chrome is running with the Playwriter extension enabled and connected.'
    );
  }

  return extensions[0].extensionId;
}

async function connectBrowser() {
  const CDP_HOST = '127.0.0.1';
  const CDP_PORT = 19988;

  let server: Awaited<ReturnType<typeof startPlayWriterCDPRelayServer>> | null = null;
  const portBusy = await isPortInUse(CDP_PORT, CDP_HOST);
  if (portBusy) {
    status('CDP relay already running on :' + CDP_PORT);
  } else {
    status('starting CDP relay server...');
    server = await startPlayWriterCDPRelayServer();
    status('CDP relay server started');
  }

  status('waiting for browser extension...');
  const extensionId = await resolveExtensionId(CDP_HOST, CDP_PORT);
  if (extensionId) {
    status(`extension connected: ${extensionId}`);
  }
  const cdpUrl = getCdpUrl({ extensionId });
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  return { browser, context, page, server };
}

async function navigateToChatGPT(page: Page) {
  status('navigating to chatgpt.com...');
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const currentUrl = page.url();
  log('landed on:', currentUrl);

  const needsAuth =
    currentUrl.includes('/auth/login') ||
    currentUrl.includes('auth0.openai.com') ||
    currentUrl.includes('login.microsoftonline.com');

  if (needsAuth) {
    status('not logged in — please sign in manually in the browser');
    await page.waitForURL('https://chatgpt.com/**', { timeout: 120_000 });
    await page.waitForTimeout(3000);
    status('login detected');
  } else {
    status('already authenticated');
  }

  status('waiting for chat composer...');
  await page.waitForSelector('[id="prompt-textarea"]', { timeout: 30_000 });
  status('chat composer ready');
}

async function sendMessageSync(page: Page, message: string) {
  status(`sending message (${message.length} chars)...`);
  const composer = page.locator('[id="prompt-textarea"]');
  await composer.click();
  await composer.fill(message);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  status('message sent, waiting for response...');
}

async function waitForResponse(page: Page): Promise<string> {
  status('waiting for ChatGPT to start generating...');
  await page
    .locator('[data-testid="stop-button"]')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => status('(response may have been instant)'));
  status('ChatGPT is generating...');
  await page
    .locator('[data-testid="stop-button"]')
    .waitFor({ state: 'hidden', timeout: 120_000 })
    .catch(() => status('(response may still be streaming)'));

  status('extracting response...');
  const responseText = await page.evaluate(extractMarkdownFromPage);
  status(`response received (${responseText.length} chars)`);
  return responseText;
}

async function chatGPTSync(prompt: string, debugMode: boolean): Promise<string> {
  debug = debugMode;
  status('connecting to browser... (sync mode)');

  const { browser, page, server } = await connectBrowser();

  try {
    await navigateToChatGPT(page);
    await sendMessageSync(page, prompt);
    const response = await waitForResponse(page);
    return response;
  } finally {
    await browser.close();
    server?.close();
  }
}
