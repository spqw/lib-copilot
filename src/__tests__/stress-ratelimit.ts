import { CopilotClient } from '../client';
import { CopilotAuth } from '../auth';

const RATE_PER_SEC = 12;
const MAX_RETRIES = 4;
const BASE_BACKOFF = 1000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly rate: number;
  private queue: Array<() => void> = [];

  constructor(ratePerSec: number) {
    this.rate = ratePerSec;
    this.tokens = ratePerSec;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.rate, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Wait until a token is available
    const waitMs = ((1 - this.tokens) / this.rate) * 1000;
    await sleep(waitMs);
    this.refill();
    this.tokens -= 1;
  }
}

const PROMPTS = Array.from({ length: 50 }, (_, i) => {
  const questions = [
    `What is ${i + 1} * ${i + 2}?`,
    `Name word #${i + 1} in the alphabet.`,
    `What is the ${i + 1}th prime number?`,
    `Give a one-word synonym for "${['fast', 'slow', 'big', 'small', 'happy'][i % 5]}".`,
    `Spell the number ${i + 100}.`,
  ];
  return questions[i % questions.length];
});

async function doRequest(
  client: CopilotClient,
  limiter: RateLimiter,
  prompt: string,
  i: number,
) {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = BASE_BACKOFF * Math.pow(2, attempt - 1);
      await sleep(backoff);
    }
    await limiter.acquire();
    try {
      const start = Date.now();
      let output = '';
      await client.chatStream(
        { messages: [{ role: 'user', content: prompt }], max_tokens: 30 },
        (chunk) => { output += chunk; },
      );
      return { i, prompt, output: output.trim(), ms: Date.now() - start, ok: true as const, retries: attempt };
    } catch (e: any) {
      lastErr = e;
    }
  }
  return { i, prompt, output: lastErr!.message, ms: 0, ok: false as const, retries: MAX_RETRIES };
}

async function main() {
  const auth = new CopilotAuth();
  const token = await auth.getToken();
  if (!token) throw new Error('No token');

  const model = process.argv[2] || 'gpt-4.1';
  const client = new CopilotClient({ token, model });
  const limiter = new RateLimiter(RATE_PER_SEC);

  console.log(`Launching ${PROMPTS.length} requests (${model}, ${RATE_PER_SEC} req/s rate limit, exponential backoff)...\n`);
  const t0 = Date.now();

  // Fire all at once — rate limiter gates them
  const results = await Promise.all(
    PROMPTS.map((prompt, i) => doRequest(client, limiter, prompt, i))
  );

  const total = Date.now() - t0;
  let ok = 0, fail = 0, sumMs = 0, totalRetries = 0;

  for (const r of results) {
    totalRetries += r.retries;
    if (r.ok) {
      ok++;
      sumMs += r.ms;
      const retry = r.retries > 0 ? ` (retry x${r.retries})` : '';
      const short = r.output.slice(0, 45).replace(/\n/g, ' ');
      console.log(`[${String(r.i + 1).padStart(2)}] ${String(r.ms).padStart(5)}ms  ${r.prompt.padEnd(50)} → ${short}${retry}`);
    } else {
      fail++;
      console.log(`[${String(r.i + 1).padStart(2)}] FAIL  ${r.output.slice(0, 70)}`);
    }
  }

  console.log(`\n--- Results ---`);
  console.log(`Total wall time: ${total}ms`);
  console.log(`Success:         ${ok}/${PROMPTS.length}`);
  console.log(`Failed:          ${fail}/${PROMPTS.length}`);
  console.log(`Total retries:   ${totalRetries}`);
  if (ok > 0) {
    console.log(`Avg latency:     ${Math.round(sumMs / ok)}ms`);
    console.log(`Throughput:      ${(ok / (total / 1000)).toFixed(1)} req/s`);
  }
}

main().catch(console.error);
