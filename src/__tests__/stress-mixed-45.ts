import { CopilotClient } from '../client';
import { CopilotAuth } from '../auth';

const MAX_CONCURRENT = 45;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Task {
  prompt: string;
  model: string;
}

const TASKS: Task[] = [
  // 35 gpt-5-mini
  ...Array.from({ length: 35 }, (_, i): Task => ({
    prompt: `What is ${i + 1} * ${i + 2}?`,
    model: 'gpt-5-mini',
  })),
  // 10 gpt-4.1
  ...Array.from({ length: 10 }, (_, i): Task => ({
    prompt: `Name a country that starts with "${String.fromCharCode(65 + i)}".`,
    model: 'gpt-4.1',
  })),
];

async function doRequest(client: CopilotClient, task: Task, i: number) {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY * attempt);
    try {
      const start = Date.now();
      let output = '';
      await client.chatStream(
        { messages: [{ role: 'user', content: task.prompt }], model: task.model, max_tokens: 30 },
        (chunk) => { output += chunk; },
      );
      return { i, model: task.model, prompt: task.prompt, output: output.trim(), ms: Date.now() - start, ok: true as const, retries: attempt };
    } catch (e: any) {
      lastErr = e;
    }
  }
  return { i, model: task.model, prompt: task.prompt, output: lastErr!.message, ms: 0, ok: false as const, retries: MAX_RETRIES };
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
  const client = new CopilotClient({ token, debug: false });

  console.log(`Launching ${TASKS.length} requests (max ${MAX_CONCURRENT} concurrent)`);
  console.log(`  35 x gpt-5-mini + 10 x gpt-4.1\n`);
  const t0 = Date.now();

  const fns = TASKS.map((task, i) => () => doRequest(client, task, i));
  const results = await runWithConcurrency(fns, MAX_CONCURRENT);

  const total = Date.now() - t0;
  const stats: Record<string, { ok: number; fail: number; retries: number; sumMs: number }> = {};

  for (const r of results) {
    if (!stats[r.model]) stats[r.model] = { ok: 0, fail: 0, retries: 0, sumMs: 0 };
    stats[r.model].retries += r.retries;
    if (r.ok) {
      stats[r.model].ok++;
      stats[r.model].sumMs += r.ms;
      const retry = r.retries > 0 ? ` (retry x${r.retries})` : '';
      const short = r.output.slice(0, 40).replace(/\n/g, ' ');
      const tag = r.model.padEnd(10);
      console.log(`[${String(r.i + 1).padStart(2)}] ${tag} ${String(r.ms).padStart(5)}ms  ${r.prompt.padEnd(40)} → ${short}${retry}`);
    } else {
      stats[r.model].fail++;
      console.log(`[${String(r.i + 1).padStart(2)}] ${r.model.padEnd(10)} FAIL  ${r.output.slice(0, 60)}`);
    }
  }

  console.log(`\n--- Results ---`);
  console.log(`Total wall time: ${total}ms`);
  for (const [model, s] of Object.entries(stats)) {
    const avg = s.ok > 0 ? Math.round(s.sumMs / s.ok) : 0;
    console.log(`  ${model}: ${s.ok} ok, ${s.fail} fail, ${s.retries} retries, ${avg}ms avg`);
  }
  const totalOk = Object.values(stats).reduce((s, v) => s + v.ok, 0);
  const totalRetries = Object.values(stats).reduce((s, v) => s + v.retries, 0);
  console.log(`Overall: ${totalOk}/${TASKS.length} success, ${totalRetries} retries, ${(totalOk / (total / 1000)).toFixed(1)} req/s`);
}

main().catch(console.error);
