import { chromium } from 'playwright-core';
import { getCdpUrl } from 'playwriter';
import {
  readJob,
  updateJobStatus,
} from './chatgpt-job';
import { extractMarkdownFromPage } from './html-to-markdown';

type Browser = Awaited<ReturnType<typeof chromium.connectOverCDP>>;
type BrowserContext = Awaited<ReturnType<Browser['newContext']>>;
type Page = Awaited<ReturnType<Browser['newPage']>>;

let debug = false;

function status(msg: string) {
  process.stderr.write(`[watcher] ${msg}\n`);
}

function log(...args: unknown[]) {
  if (debug) process.stderr.write('[watcher:debug] ' + args.map(String).join(' ') + '\n');
}

function findChatGPTPage(pages: Page[], preferredUrl: string): Page | null {
  // Exact URL match
  const exact = pages.find((p) => p.url() === preferredUrl);
  if (exact) return exact;

  // Match by pathname (e.g. /c/abc123)
  try {
    const urlPath = new URL(preferredUrl).pathname;
    if (urlPath !== '/') {
      const byPath = pages.find((p) => {
        try {
          return new URL(p.url()).pathname === urlPath;
        } catch {
          return false;
        }
      });
      if (byPath) return byPath;
    }
  } catch {
    // invalid URL, skip path matching
  }

  // Any chatgpt.com page
  const anyChatGPT = pages.find((p) => p.url().startsWith('https://chatgpt.com'));
  return anyChatGPT || null;
}

export async function watchChatGPTJob(
  jobId: string,
  debugMode: boolean
): Promise<string> {
  debug = debugMode;

  // 1. Read job file
  const job = readJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== 'dispatched') {
    throw new Error(`Job ${jobId} has unexpected status: ${job.status}`);
  }

  // 2. Update status to watching
  updateJobStatus(jobId, {
    status: 'watching',
    watcherPid: process.pid,
    lastHeartbeat: new Date().toISOString(),
  });

  // 3. Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    updateJobStatus(jobId, { lastHeartbeat: new Date().toISOString() });
  }, 5000);

  try {
    // 4. Reconnect to browser via CDP relay
    status('reconnecting to browser...');
    const cdpUrl = getCdpUrl({
      host: job.cdpHost,
      port: job.cdpPort,
      extensionId: job.extensionId || undefined,
    });
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];

    if (!context) {
      throw new Error('No browser context found after reconnecting');
    }

    // 5. Find the ChatGPT page
    status('looking for ChatGPT page...');
    let page = findChatGPTPage(context.pages(), job.pageUrl);

    if (!page) {
      // Pages might still be attaching — wait briefly and retry
      await new Promise((r) => setTimeout(r, 2000));
      page = findChatGPTPage(context.pages(), job.pageUrl);
    }

    if (!page) {
      throw new Error(
        `Could not find ChatGPT page after reconnecting. ` +
          `Expected URL: ${job.pageUrl}. ` +
          `Available pages: ${context.pages().map((p) => p.url()).join(', ') || '(none)'}`
      );
    }

    status(`found page: ${page.url()}`);
    log('page URL match for job pageUrl:', job.pageUrl);

    // 6. Wait for generation to finish
    const stopButton = page.locator('[data-testid="stop-button"]');
    const isVisible = await stopButton.isVisible().catch(() => false);

    if (isVisible) {
      status('ChatGPT still generating, waiting...');
      await stopButton.waitFor({ state: 'hidden', timeout: 300_000 });
      // Let DOM settle
      await page.waitForTimeout(1000);
    } else {
      status('ChatGPT already finished generating');
      await page.waitForTimeout(500);
    }

    // 7. Extract response as markdown (walking DOM tree)
    status('extracting response...');
    const responseText = await page.evaluate(extractMarkdownFromPage);

    // 8. Write completion to job file
    updateJobStatus(jobId, {
      status: 'completed',
      response: responseText,
      responseLength: responseText.length,
      completedAt: new Date().toISOString(),
    });

    status(`response extracted (${responseText.length} chars)`);

    // 9. Disconnect
    await browser.close();

    return responseText;
  } catch (err: any) {
    // Write error to job file so CLI can report it
    updateJobStatus(jobId, {
      status: 'error',
      error: err.message || String(err),
      completedAt: new Date().toISOString(),
    });
    throw err;
  } finally {
    clearInterval(heartbeatInterval);
  }
}

// Standalone entry point for detached child process
if (require.main === module) {
  const jobId = process.argv[2];
  const debugMode = process.argv.includes('--debug');
  if (!jobId) {
    process.stderr.write('Usage: chatgpt-watcher <jobId> [--debug]\n');
    process.exit(1);
  }
  watchChatGPTJob(jobId, debugMode)
    .then(() => process.exit(0))
    .catch((err) => {
      process.stderr.write(`[watcher] error: ${err.message}\n`);
      process.exit(1);
    });
}
