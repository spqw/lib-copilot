import { CopilotClient, CopilotAuth } from '../index';

/**
 * Live chat example - makes a real request to Copilot API
 */

async function main() {
  console.log('🚀 lib-copilot Live Chat Test\n');

  // Try to get token
  const auth = new CopilotAuth(true);
  const token = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN || (await auth.getToken());

  if (!token) {
    console.log('❌ No authentication token found');
    console.log('\nTo test with Copilot API, you need a GitHub Personal Access Token:');
    console.log('');
    console.log('1. Go to: https://github.com/settings/tokens');
    console.log('2. Create a new token with scopes: repo, read:user');
    console.log('3. Set it:');
    console.log('   export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"');
    console.log('');
    console.log('4. Run again:');
    console.log('   npm run live-chat');
    console.log('');
    process.exit(1);
  }

  console.log('✓ Token found, connecting to Copilot API...\n');

  const copilot = new CopilotClient({
    token,
    debug: true,
  });

  // Test 1: Simple chat
  console.log('=== Query 1: Simple Question ===\n');
  try {
    const response = await copilot.chat({
      messages: [
        {
          role: 'user',
          content: 'What is 2 + 2? Answer in one sentence.',
        },
      ],
      max_tokens: 50,
    });

    console.log('✓ Response received!\n');
    console.log('ID:', response.id);
    console.log('Model:', response.model);
    console.log('Tokens:', response.usage?.total_tokens);
    console.log('\n💬 Assistant:');
    console.log(response.choices[0]?.message.content);
    console.log('');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response?.status === 401) {
      console.log('\n⚠️  Authentication failed - token may be invalid');
      console.log('Make sure your GITHUB_TOKEN has the correct scopes.');
    }
  }

  // Test 2: Multi-turn conversation
  console.log('\n=== Query 2: Multi-turn Conversation ===\n');
  try {
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      {
        role: 'user',
        content: 'Write a function that adds two numbers in JavaScript.',
      },
    ];

    const response1 = await copilot.chat({ messages });
    const reply1 = response1.choices[0]?.message.content || '';
    
    console.log('You: Write a function that adds two numbers in JavaScript.');
    console.log('\nAssistant:', reply1.substring(0, 200) + '...\n');

    // Continue conversation
    messages.push({
      role: 'assistant',
      content: reply1,
    });

    messages.push({
      role: 'user',
      content: 'Now make it async.',
    });

    const response2 = await copilot.chat({ messages });
    console.log('You: Now make it async.');
    console.log('\nAssistant:', response2.choices[0]?.message.content);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }

  // Test 3: Code explanation
  console.log('\n=== Query 3: Explain Code ===\n');
  try {
    const code = `
const fibonacci = (n) => n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2);
const result = fibonacci(10);
    `.trim();

    console.log('Code to explain:');
    console.log(code);
    console.log('');

    const explanation = await copilot.explain(code);
    console.log('Explanation:');
    console.log(explanation);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);
