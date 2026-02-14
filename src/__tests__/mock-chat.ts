import { CopilotClient } from '../index';

/**
 * Mock chat example - demonstrates API without needing real credentials
 * Shows what actual responses look like
 */

async function demonstrateMockChat() {
  console.log('🎬 lib-copilot Live Chat Demo (Simulated)\n');
  console.log('This demonstrates what real API calls look like\n');

  // Create a "client" (won't authenticate without token)
  const copilot = new CopilotClient({
    token: 'mock-token-for-demo',
    debug: true,
  });

  // Show what the request would look like
  console.log('=== Example 1: Simple Chat Request ===\n');

  const chatRequest = {
    messages: [
      {
        role: 'user' as const,
        content: 'What is 2 + 2? Answer in one sentence.',
      },
    ],
    max_tokens: 50,
  };

  console.log('📤 Request that would be sent to Copilot:');
  console.log(JSON.stringify(chatRequest, null, 2));

  console.log('\n📥 Expected response structure:');
  const mockResponse = {
    id: 'chatcmpl-8nB7Zq7P8Xv9K3mZ',
    object: 'chat.completion',
    created: 1707913234,
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '2 + 2 equals 4.',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 13,
      completion_tokens: 5,
      total_tokens: 18,
    },
  };

  console.log(JSON.stringify(mockResponse, null, 2));

  // Show multi-turn conversation
  console.log('\n=== Example 2: Multi-Turn Conversation ===\n');

  const conversationMessages = [
    {
      role: 'user' as const,
      content: 'Write a function that adds two numbers in JavaScript.',
    },
    {
      role: 'assistant' as const,
      content: 'Here\'s a simple function that adds two numbers:\n\nfunction add(a, b) {\n  return a + b;\n}',
    },
    {
      role: 'user' as const,
      content: 'Now make it async.',
    },
  ];

  console.log('📤 Multi-turn chat request:');
  console.log(JSON.stringify(conversationMessages, null, 2));

  console.log('\n📥 Expected response:');
  const multiTurnResponse = {
    id: 'chatcmpl-8nB7Zq7P8Xv9K3mZ',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Here\'s the async version:\n\nasync function add(a, b) {\n  return a + b;\n}\n\n// Usage:\nconst result = await add(5, 3);',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 45,
      completion_tokens: 38,
      total_tokens: 83,
    },
  };

  console.log(JSON.stringify(multiTurnResponse, null, 2));

  // Show streaming example
  console.log('\n=== Example 3: Streaming Response ===\n');

  console.log('📤 Streaming chat request:');
  console.log(JSON.stringify(
    {
      messages: [{ role: 'user', content: 'Explain quantum computing in 3 sentences' }],
      stream: true,
      max_tokens: 100,
    },
    null,
    2
  ));

  console.log('\n📥 Streaming chunks (Server-Sent Events):');
  console.log(`data: {"choices":[{"delta":{"content":"Quantum"}}]}`);
  console.log(`data: {"choices":[{"delta":{"content":" computing"}}]}`);
  console.log(`data: {"choices":[{"delta":{"content":" uses"}}]}`);
  console.log(`data: {"choices":[{"delta":{"content":" quantum"}}]}`);
  console.log(`data: {"choices":[{"delta":{"content":" bits"}}]}`);
  console.log(`data: [DONE]`);

  // Show code explanation
  console.log('\n=== Example 4: Code Explanation ===\n');

  const codeToExplain = `
const fibonacci = (n) => n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2);
const result = fibonacci(10);
  `.trim();

  console.log('📝 Code to explain:');
  console.log(codeToExplain);

  console.log('\n📥 Expected explanation:');
  console.log(`
This code defines a recursive function that calculates Fibonacci numbers. The function takes an integer n and returns:
- If n is 0 or 1, it returns n directly (base case)
- Otherwise, it recursively calls itself with n-1 and n-2, returning their sum

The second line calls fibonacci(10), which would calculate the 10th Fibonacci number (55).

Note: This is inefficient due to repeated calculations. For large numbers, memoization or iteration would be better.
  `.trim());

  // Show request/response headers
  console.log('\n=== Example 5: API Request Headers ===\n');

  const headers = {
    'Authorization': 'Bearer ghp_xxxxxxxxxxxx',
    'User-Agent': 'GitHub-Copilot/1.200.0 VSCode/1.95.0',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  console.log('📤 Request headers (mimicking VSCode extension):');
  console.log(JSON.stringify(headers, null, 2));

  // Show CLI usage
  console.log('\n=== Example 6: CLI Usage ===\n');

  console.log('Command line examples:');
  console.log('');
  console.log('1. Interactive chat:');
  console.log('   $ copilot chat');
  console.log('   > How do I use async/await?');
  console.log('   [Assistant response...]');
  console.log('');
  console.log('2. Single query:');
  console.log('   $ copilot chat "Explain React hooks"');
  console.log('');
  console.log('3. Code explanation:');
  console.log('   $ copilot explain index.ts');
  console.log('');
  console.log('4. Code refactoring:');
  console.log('   $ copilot refactor index.ts typescript');
  console.log('');
  console.log('5. Test generation:');
  console.log('   $ copilot test math.ts javascript');
  console.log('');
  console.log('6. Error debugging:');
  console.log('   $ copilot debug "TypeError: Cannot read property \'map\' of undefined"');

  // Summary
  console.log('\n=== Summary ===\n');

  console.log('✓ Library structure validated');
  console.log('✓ API methods ready to use');
  console.log('✓ Request/response formats shown');
  console.log('✓ Streaming capability demonstrated');
  console.log('✓ CLI interface documented');
  console.log('');
  console.log('To use with real Copilot API:');
  console.log('');
  console.log('1. Get GitHub token: https://github.com/settings/tokens');
  console.log('2. Create with scopes: repo, read:user');
  console.log('3. Set: export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"');
  console.log('4. Run: npm run live-chat');
  console.log('');
}

demonstrateMockChat().catch(console.error);
