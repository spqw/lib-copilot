import { chromium } from 'playwright-core';
import {
  startPlayWriterCDPRelayServer,
  getCdpUrl,
} from 'playwriter';
import * as net from 'node:net';

type Page = Awaited<ReturnType<typeof connectBrowser>>['page'];

let debug = false;
function log(...args: unknown[]) {
  if (debug) process.stderr.write(args.map(String).join(' ') + '\n');
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
    log('  Waiting for browser extension to connect...');
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
    log(`  CDP relay already running on :${CDP_PORT}`);
  } else {
    server = await startPlayWriterCDPRelayServer();
    log('  Started CDP relay server');
  }

  const extensionId = await resolveExtensionId(CDP_HOST, CDP_PORT);
  if (extensionId) {
    log(`  Extension: ${extensionId}`);
  }
  const cdpUrl = getCdpUrl({ extensionId });
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  return { browser, context, page, server };
}

async function navigateToChatGPT(page: Page) {
  log('  Navigating to chatgpt.com...');
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const currentUrl = page.url();
  log('  Landed on:', currentUrl);

  const needsAuth =
    currentUrl.includes('/auth/login') ||
    currentUrl.includes('auth0.openai.com') ||
    currentUrl.includes('login.microsoftonline.com');

  if (needsAuth) {
    process.stderr.write('ChatGPT: not logged in — please sign in manually in the browser.\n');
    await page.waitForURL('https://chatgpt.com/**', { timeout: 120_000 });
    await page.waitForTimeout(3000);
    log('  Login detected');
  } else {
    log('  Already authenticated');
  }

  await page.waitForSelector('[id="prompt-textarea"]', { timeout: 30_000 });
  log('  Chat composer ready');
}

async function sendMessage(page: Page, message: string) {
  log(`  Sending message (${message.length} chars)`);
  const composer = page.locator('[id="prompt-textarea"]');
  await composer.click();
  await composer.fill(message);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  log('  Message sent');
}

async function waitForResponse(page: Page): Promise<string> {
  log('  Waiting for response...');
  await page
    .locator('[data-testid="stop-button"]')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => log('  (response may have been instant)'));
  await page
    .locator('[data-testid="stop-button"]')
    .waitFor({ state: 'hidden', timeout: 120_000 })
    .catch(() => log('  (response may still be streaming)'));

  const messages = page.locator('[data-message-author-role="assistant"]');
  const lastMessage = messages.last();
  const responseText = (await lastMessage.textContent()) ?? '';
  log('  Response received');
  return responseText;
}

export async function chatGPT(prompt: string, debugMode: boolean): Promise<string> {
  debug = debugMode;
  process.stderr.write('[chatgpt] connecting to browser...\n');

  const { browser, page, server } = await connectBrowser();

  try {
    await navigateToChatGPT(page);
    await sendMessage(page, prompt);
    const response = await waitForResponse(page);
    return response;
  } finally {
    await browser.close();
    server?.close();
  }
}
