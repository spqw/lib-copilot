import { CopilotClient, CopilotAuth } from '../index';

async function main() {
  console.log('GitHub Copilot - Device Flow Auth\n');

  const auth = new CopilotAuth(true);

  // Step 1: Initiate device flow
  console.log('Initiating device flow...\n');
  const deviceFlow = await auth.initiateDeviceFlow();

  console.log(`\n  1. Open:  ${deviceFlow.verification_uri}`);
  console.log(`  2. Enter: ${deviceFlow.user_code}\n`);
  console.log('Waiting for authorization...\n');

  // Step 2: Poll for completion
  const authToken = await auth.pollDeviceFlow(deviceFlow.device_code);
  console.log('\nAuthorized! Token type:', authToken.type);

  // Step 3: Use the OAuth token with CopilotClient
  const copilot = new CopilotClient({
    token: authToken.token,
    debug: true,
  });

  // Step 4: Test a chat request
  console.log('\n=== Test Chat ===\n');
  const response = await copilot.chat({
    messages: [
      { role: 'user', content: 'What is 2 + 2? Answer in one sentence.' },
    ],
    max_tokens: 50,
  });

  console.log('\nResponse:', response.choices[0]?.message.content);
}

main().catch(console.error);
