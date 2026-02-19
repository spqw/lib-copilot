import { CopilotClient } from '../client';
import { CopilotAuth } from '../auth';

const PROMPTS = [
  'What is 2+2?',
  'Name a planet.',
  'What color is the sky?',
  'Capital of France?',
  'Largest ocean?',
  'Who wrote Hamlet?',
  'What is DNA?',
  'Fastest land animal?',
  'Boiling point of water in Celsius?',
  'How many continents?',
  'Square root of 144?',
  'Chemical symbol for gold?',
  'Tallest mountain?',
  'Smallest prime number?',
  'What year did WW2 end?',
  'What is pi to 2 decimals?',
  'Opposite of hot?',
  'How many legs does a spider have?',
  'What language is spoken in Brazil?',
  'Name a programming language.',
];

async function main() {
  const auth = new CopilotAuth();
  const token = await auth.getToken();
  if (!token) throw new Error('No token');

  const client = new CopilotClient({ token, model: 'gpt-4.1' });

  console.log(`Launching ${PROMPTS.length} parallel requests...\n`);
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

  for (const r of results) {
    if (r.status === 'fulfilled') {
      ok++;
      const { i, prompt, output, ms } = r.value;
      const short = output.slice(0, 60).replace(/\n/g, ' ');
      console.log(`[${String(i + 1).padStart(2)}] ${ms}ms  ${prompt.padEnd(42)} → ${short}`);
    } else {
      fail++;
      console.log(`[FAIL] ${r.reason?.message || r.reason}`);
    }
  }

  console.log(`\n--- Results ---`);
  console.log(`Total:    ${total}ms`);
  console.log(`Success:  ${ok}/${PROMPTS.length}`);
  console.log(`Failed:   ${fail}/${PROMPTS.length}`);
  console.log(`Avg:      ${Math.round(total / PROMPTS.length)}ms per request (wall) | ${Math.round(results.filter(r => r.status === 'fulfilled').reduce((s, r) => s + (r as any).value.ms, 0) / ok)}ms avg latency`);
}

main().catch(console.error);
