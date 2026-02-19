import { CopilotClient } from '../client';
import { CopilotAuth } from '../auth';

const MAX_CONCURRENT = 30;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const PROMPTS = Array.from({ length: 50 }, (_, i) => {
  const questions = [
    `What is ${i + 1} * ${i + 2}?`,
    `Name word #${i + 1} in the alphabet.`,
    `What is the ${i + 1}th prime number?`,
    `Give a one-word synonym for "${['fast','slow','big','small','happy'][i % 5]}".`,
    `Spell the number ${i + 100}.`,
  ];
  return questions[i % questions.length];
});

async function doRequest(client: CopilotClient, prompt: string, i: number) {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY * attempt);
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

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], max: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, tasks.length) }, () => worker()));
  return results;
}

async function main() {
  const auth = new CopilotAuth();
  const token = await auth.getToken();
  if (!token) throw new Error('No token');
  const client = new CopilotClient({ token, model: 'gpt-4.1' });

  console.log(`Launching ${PROMPTS.length} requests (gpt-4.1, max ${MAX_CONCURRENT} concurrent, ${MAX_RETRIES} retries)...\n`);
  const t0 = Date.now();

  const tasks = PROMPTS.map((prompt, i) => () => doRequest(client, prompt, i));
  const results = await runWithConcurrency(tasks, MAX_CONCURRENT);

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
