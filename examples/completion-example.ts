import { CopilotClient, CopilotAuth } from '../src/index';
import dotenv from 'dotenv';

/**
 * Example: Using Copilot for code completion
 */

dotenv.config();

async function main() {
  // Initialize auth
  const auth = new CopilotAuth(true);
  
  // Get token
  let token = await auth.getToken();

  if (!token) {
    console.log('No token found. Please set GITHUB_TOKEN or COPILOT_TOKEN environment variable.');
    return;
  }

  // Create client
  const copilot = new CopilotClient({
    token,
    model: 'gpt-4',
    debug: true,
  });

  console.log('✓ Authenticated with Copilot\n');

  // Example 1: Basic completion
  console.log('=== Example 1: Basic Code Completion ===\n');
  try {
    const prompt = 'function multiply(a, b) {';
    
    const response = await copilot.complete({
      prompt,
      max_tokens: 50,
      temperature: 0.1,
    });

    console.log('Prompt:', prompt);
    console.log('\nCompletion:');
    response.choices.forEach((choice) => {
      console.log(`  [${choice.index}]: ${choice.text}`);
    });
  } catch (error) {
    console.error('Completion failed:', error);
  }

  // Example 2: Code-aware completion with language context
  console.log('\n=== Example 2: Code-Aware Completion (TypeScript) ===\n');
  try {
    const prefix = `
interface User {
  id: string;
  name: string;
  email: string;
}

function getUser(userId: string): User {
  // Fetch user from database
  const user = db.query(`;

    const suffix = `);
  return user;
}
    `.trim();

    const response = await copilot.completeCode({
      filepath: 'user.service.ts',
      language: 'typescript',
      prefix,
      suffix,
      max_tokens: 100,
    });

    console.log('Suggestions:');
    response.completions.forEach((completion, i) => {
      console.log(`  [${i}]: ${completion.trim()}`);
    });
  } catch (error) {
    console.error('Code completion failed:', error);
  }

  // Example 3: Python completion
  console.log('\n=== Example 3: Python Function Completion ===\n');
  try {
    const prompt = `
def calculate_average(numbers):
    """Calculate the average of a list of numbers."""
    `;

    const response = await copilot.complete({
      prompt,
      max_tokens: 100,
      temperature: 0.1,
      stop: ['\n\ndef', '\n\nclass'],
    });

    console.log('Prompt:', prompt.trim());
    console.log('\nSuggested implementation:');
    console.log(response.choices[0]?.text);
  } catch (error) {
    console.error('Python completion failed:', error);
  }

  // Example 4: SQL completion
  console.log('\n=== Example 4: SQL Query Completion ===\n');
  try {
    const prompt = `
-- Get all active users with their recent orders
SELECT u.id, u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.status = 'active'`;

    const response = await copilot.complete({
      prompt,
      max_tokens: 50,
      temperature: 0.1,
      stop: [';'],
    });

    console.log('Prompt:', prompt);
    console.log('\nCompletion:');
    console.log(response.choices[0]?.text);
  } catch (error) {
    console.error('SQL completion failed:', error);
  }

  // Example 5: Generate tests
  console.log('\n=== Example 5: Generate Unit Tests ===\n');
  try {
    const codeToTest = `
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
}
    `.trim();

    const tests = await copilot.generateTests(codeToTest, 'typescript');
    console.log('Function to test:\n', codeToTest);
    console.log('\nGenerated tests:\n', tests);
  } catch (error) {
    console.error('Test generation failed:', error);
  }
}

main().catch(console.error);
