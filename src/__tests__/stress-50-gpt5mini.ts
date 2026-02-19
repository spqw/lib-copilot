import { CopilotClient } from '../client';
import { CopilotAuth } from '../auth';

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

async function main() {
  const auth = new CopilotAuth();
  const token = await auth.getToken();
  if (!token) throw new Error('No token');

  const client = new CopilotClient({ token, model: 'gpt-5-mini' });

  console.log(`Launching ${PROMPTS.length} parallel requests (gpt-5-mini)...\n`);
  const t0 = Date.now();

  const results = await Promise.allSettled(
    PROMPTS.map(async (prompt, i) => {
      const start = Date.now();
      let output = '';
      await client.chatStream(
        { messages: [{ role: 'user', content: prompt }], max_tokens: 30 },
        (chunk) => { output += chunk; },
      );
      const ms = Date.now() - start;
      return { i, prompt, output: output.trim(), ms };
    })
  );

  const total = Date.now() - t0;
  let ok = 0;
  let fail = 0;
  let sumMs = 0;

  for (const r of results) {
    if (r.status === 'fulfilled') {
      ok++;
      const { i, prompt, output, ms } = r.value;
      sumMs += ms;
      const short = output.slice(0, 50).replace(/\n/g, ' ');
      console.log(`[${String(i + 1).padStart(2)}] ${String(ms).padStart(5)}ms  ${prompt.padEnd(50)} → ${short}`);
    } else {
      fail++;
      console.log(`[FAIL] ${r.reason?.message || r.reason}`);
    }
  }

  console.log(`\n--- Results ---`);
  console.log(`Total wall time: ${total}ms`);
  console.log(`Success:         ${ok}/${PROMPTS.length}`);
  console.log(`Failed:          ${fail}/${PROMPTS.length}`);
  if (ok > 0) {
    console.log(`Avg latency:     ${Math.round(sumMs / ok)}ms`);
    console.log(`Throughput:      ${(ok / (total / 1000)).toFixed(1)} req/s`);
  }
}

main().catch(console.error);
