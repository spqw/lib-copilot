import { CopilotClient } from '../client';
import { CopilotAuth } from '../auth';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function doRequest(client: CopilotClient, i: number): Promise<{ i: number; ms: number; ok: boolean; output: string }> {
  const start = Date.now();
  try {
    let output = '';
    await client.chatStream(
      { messages: [{ role: 'user', content: `What is ${i} + ${i}?` }], max_tokens: 10 },
      (chunk) => { output += chunk; },
    );
    return { i, ms: Date.now() - start, ok: true, output: output.trim().slice(0, 30) };
  } catch (e: any) {
    return { i, ms: Date.now() - start, ok: false, output: e.message.slice(0, 50) };
  }
}

async function main() {
  const auth = new CopilotAuth();
  const token = await auth.getToken();
  if (!token) throw new Error('No token');
  const client = new CopilotClient({ token, model: 'gpt-5-mini' });

  // Test 1: 3 batches of 10, 2s gap between batches (30 total in ~10s)
  console.log('=== Test 1: 3 x 10 batches, 2s gap ===\n');
  const t0 = Date.now();
  for (let batch = 0; batch < 3; batch++) {
    const batchStart = Date.now();
    console.log(`Batch ${batch + 1} at +${Date.now() - t0}ms`);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, j) => doRequest(client, batch * 10 + j + 1))
    );
    let ok = 0, fail = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.ok) ok++; else fail++;
        console.log(`  [${String(r.value.i).padStart(2)}] ${r.value.ok ? 'OK' : 'FAIL'} ${String(r.value.ms).padStart(5)}ms  ${r.value.output}`);
      }
    }
    console.log(`  → ${ok} ok, ${fail} fail (batch took ${Date.now() - batchStart}ms)\n`);
    if (batch < 2) await sleep(2000);
  }
  console.log(`Total: ${Date.now() - t0}ms\n`);

  // Test 2: wait 60s then fire 10 more to confirm reset
  console.log('=== Test 2: waiting 30s then 10 more ===\n');
  await sleep(30000);
  const t1 = Date.now();
  const results2 = await Promise.allSettled(
    Array.from({ length: 10 }, (_, j) => doRequest(client, 40 + j + 1))
  );
  let ok2 = 0, fail2 = 0;
  for (const r of results2) {
    if (r.status === 'fulfilled') {
      if (r.value.ok) ok2++; else fail2++;
      console.log(`  [${String(r.value.i).padStart(2)}] ${r.value.ok ? 'OK' : 'FAIL'} ${String(r.value.ms).padStart(5)}ms  ${r.value.output}`);
    }
  }
  console.log(`  → ${ok2} ok, ${fail2} fail (${Date.now() - t1}ms)\n`);
}

main().catch(console.error);
