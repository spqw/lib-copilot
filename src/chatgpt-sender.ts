import { chromium } from 'playwright-core';
import {
  startPlayWriterCDPRelayServer,
  getCdpUrl,
} from 'playwriter';
import * as net from 'node:net';
import {
  generateJobId,
  writeJob,
  ChatGPTJob,
} from './chatgpt-job';

type Browser = Awaited<ReturnType<typeof chromium.connectOverCDP>>;
type Page = Awaited<ReturnType<Browser['newPage']>>;

let debug = false;

function status(msg: string) {
  process.stderr.write(`[chatgpt] ${msg}\n`);
}

function log(...args: unknown[]) {
  if (debug) process.stderr.write('[chatgpt:debug] ' + args.map(String).join(' ') + '\n');
}

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

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 19988;

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
  const portBusy = await isPortInUse(CDP_PORT, CDP_HOST);
  if (portBusy) {
    status('CDP relay already running on :' + CDP_PORT);
  } else {
    status('starting CDP relay server...');
    await startPlayWriterCDPRelayServer();
    status('CDP relay server started');
    // NOTE: we intentionally do NOT store/close the server handle.
    // The relay must stay running for the watcher process to reconnect.
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

  return { browser, page, extensionId: extensionId || '' };
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

async function sendMessage(page: Page, message: string) {
  status(`sending message (${message.length} chars)...`);
  const composer = page.locator('[id="prompt-textarea"]');
  await composer.click();
  await composer.fill(message);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  status('message sent');
}

export interface SendResult {
  jobId: string;
  pageUrl: string;
  extensionId: string;
}

/**
 * Connect to browser, navigate to ChatGPT, send the prompt, confirm dispatch,
 * write a job file, and disconnect. The browser stays open for the watcher.
 */
export async function sendChatGPTMessage(
  prompt: string,
  debugMode: boolean
): Promise<SendResult> {
  debug = debugMode;
  status('connecting to browser...');

  const { browser, page, extensionId } = await connectBrowser();

  try {
    await navigateToChatGPT(page);
    await sendMessage(page, prompt);

    // Confirm ChatGPT started generating (stop-button appears)
    status('waiting for ChatGPT to start generating...');
    await page
      .locator('[data-testid="stop-button"]')
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => status('(response may have been instant)'));

    status('request confirmed dispatched');

    // Capture page URL (may now include conversation ID e.g. /c/abc123)
    const pageUrl = page.url();

    // Write job file
    const jobId = generateJobId();
    const job: ChatGPTJob = {
      id: jobId,
      createdAt: new Date().toISOString(),
      prompt,
      promptLength: prompt.length,
      cdpHost: CDP_HOST,
      cdpPort: CDP_PORT,
      extensionId,
      pageUrl,
      status: 'dispatched',
    };
    writeJob(job);
    status(`job ${jobId} written`);

    return { jobId, pageUrl, extensionId };
  } finally {
    // Disconnect Playwright client. This does NOT close Chrome or the relay —
    // it only tears down the WebSocket between this process and the relay.
    await browser.close();
  }
}
