import { CopilotClient, CopilotAuth } from '../src/index';
import dotenv from 'dotenv';

/**
 * Example: Using Copilot for chat
 */

dotenv.config();

async function main() {
  // Initialize auth
  const auth = new CopilotAuth(true);
  
  // Get token (from env, cache, or VSCode)
  let token = await auth.getToken();

  if (!token) {
    console.log('No token found. Please set GITHUB_TOKEN or COPILOT_TOKEN environment variable.');
    return;
  }

  // Create client
  const copilot = new CopilotClient({
    token,
    debug: true,
  });

  console.log('✓ Authenticated with Copilot\n');

  // Example 1: Simple chat
  console.log('=== Example 1: Simple Chat ===\n');
  try {
    const response = await copilot.chat({
      messages: [
        {
          role: 'user',
          content: 'What is the capital of France?',
        },
      ],
    });

    console.log('Assistant:', response.choices[0]?.message.content);
    console.log('Tokens used:', response.usage?.total_tokens);
  } catch (error) {
    console.error('Chat failed:', error);
  }

  // Example 2: Multi-turn conversation
  console.log('\n=== Example 2: Multi-Turn Conversation ===\n');
  try {
    const messages = [
      {
        role: 'user' as const,
        content: 'Write a function that calculates the factorial of a number.',
      },
    ];

    const response1 = await copilot.chat({ messages });
    const assistantReply = response1.choices[0]?.message.content || '';
    console.log('Assistant:', assistantReply);

    // Continue conversation
    messages.push({
      role: 'assistant' as const,
      content: assistantReply,
    });

    messages.push({
      role: 'user' as const,
      content: 'Now add error handling to handle negative numbers.',
    });

    const response2 = await copilot.chat({ messages });
    console.log('\nAssistant:', response2.choices[0]?.message.content);
  } catch (error) {
    console.error('Conversation failed:', error);
  }

  // Example 3: Streaming response
  console.log('\n=== Example 3: Streaming Chat ===\n');
  try {
    let fullResponse = '';

    await copilot.chatStream(
      {
        messages: [
          {
            role: 'user',
            content: 'Explain quantum computing in 3 paragraphs.',
          },
        ],
      },
      (chunk) => {
        process.stdout.write(chunk);
        fullResponse += chunk;
      }
    );

    console.log('\n\n[Stream completed]');
  } catch (error) {
    console.error('Streaming failed:', error);
  }

  // Example 4: Code explanation
  console.log('\n=== Example 4: Code Explanation ===\n');
  try {
    const codeToExplain = `
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
    `.trim();

    const explanation = await copilot.explain(codeToExplain);
    console.log('Code:\n', codeToExplain);
    console.log('\nExplanation:\n', explanation);
  } catch (error) {
    console.error('Explanation failed:', error);
  }

  // Example 5: Code refactoring
  console.log('\n=== Example 5: Code Refactoring ===\n');
  try {
    const codeToRefactor = `
var x = 1;
function foo(y) {
  var z = x + y;
  for (var i = 0; i < 10; i++) {
    z = z + i;
  }
  return z;
}
    `.trim();

    const refactored = await copilot.refactor(codeToRefactor, 'javascript');
    console.log('Original:\n', codeToRefactor);
    console.log('\nRefactored:\n', refactored);
  } catch (error) {
    console.error('Refactoring failed:', error);
  }

  // Example 6: Error debugging
  console.log('\n=== Example 6: Error Debugging ===\n');
  try {
    const errorMessage = 'TypeError: Cannot read property "map" of undefined';
    const context = `
const data = fetchData();
const items = data.items.map(item => item.name);
    `.trim();

    const solution = await copilot.debugError(errorMessage, context);
    console.log('Error:', errorMessage);
    console.log('\nSuggested solution:\n', solution);
  } catch (error) {
    console.error('Debug failed:', error);
  }
}

main().catch(console.error);
