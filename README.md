# lib-copilot

**Direct Copilot API client library** — Programmatic access to GitHub Copilot, mimicking VSCode extension behavior.

Make requests directly to Copilot without needing VSCode. Perfect for CLI tools, build systems, bots, and AI agents.

## Features

✅ **Chat API** — Conversational interaction with Copilot  
✅ **Code Completion** — Intelligent code suggestions  
✅ **Streaming** — Real-time response streaming  
✅ **Code Tasks** — Explain, refactor, test, debug  
✅ **Multiple Auth** — GitHub token, device flow, VSCode sessions  
✅ **CLI Tool** — Command-line interface (like Goose CLI)  
✅ **Type-safe** — Full TypeScript support  
✅ **Debug Mode** — Detailed logging for development  

## Installation

```bash
npm install lib-copilot
```

## Quick Start

### Programmatic Usage

```typescript
import { CopilotClient, CopilotAuth } from 'lib-copilot';

// Authenticate
const auth = new CopilotAuth();
const token = await auth.getToken(); // From env, cache, or VSCode

// Create client
const copilot = new CopilotClient({ token, debug: true });

// Chat
const response = await copilot.chat({
  messages: [
    { role: 'user', content: 'How do I read a file in Node.js?' }
  ],
});

console.log(response.choices[0].message.content);
```

### CLI Usage

```bash
# Interactive chat
copilot chat

# With initial prompt
copilot chat "Explain React hooks"

# Code explanation
copilot explain index.ts

# Refactoring
copilot refactor index.ts typescript

# Generate tests
copilot test index.ts javascript

# Debug an error
copilot debug "TypeError: Cannot read property 'map' of undefined"
```

## Authentication

### 1. GitHub Token (PAT)

```typescript
import { CopilotClient } from 'lib-copilot';

const copilot = new CopilotClient({
  token: process.env.GITHUB_TOKEN,
});
```

**Environment:**
```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
copilot chat
```

### 2. Auto-detect Token

Let the library find your token automatically:

```typescript
import { CopilotAuth } from 'lib-copilot';

const auth = new CopilotAuth();
const token = await auth.getToken();
// Checks: env vars → ~/.copilot/token.json → VSCode session
```

**Priority:**
1. `GITHUB_TOKEN` environment variable
2. `COPILOT_TOKEN` environment variable
3. Cached token (`~/.copilot/token.json`)
4. VSCode extension token (if available)

### 3. Device Flow (Browser Auth)

```typescript
import { CopilotAuth } from 'lib-copilot';

const auth = new CopilotAuth();
const deviceFlow = await auth.initiateDeviceFlow();

console.log(`Visit: ${deviceFlow.verification_uri}`);
console.log(`Enter code: ${deviceFlow.user_code}`);

const authToken = await auth.pollDeviceFlow(deviceFlow.device_code);
console.log(`Token: ${authToken.token}`);
```

## API Reference

### CopilotClient

#### `chat(request: ChatRequest): Promise<ChatResponse>`

Send a chat message and get a response.

```typescript
const response = await copilot.chat({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ],
  temperature: 0.7,
  max_tokens: 500,
});
```

#### `chatStream(request: ChatRequest, onChunk, onError?): Promise<void>`

Stream chat responses in real-time.

```typescript
let fullResponse = '';

await copilot.chatStream(
  {
    messages: [{ role: 'user', content: 'Explain quantum computing' }],
  },
  (chunk) => {
    process.stdout.write(chunk);
    fullResponse += chunk;
  },
  (error) => console.error('Stream error:', error)
);
```

#### `complete(request: CompletionRequest): Promise<CompletionResponse>`

Get code completions.

```typescript
const response = await copilot.complete({
  prompt: 'function fibonacci(n) {',
  max_tokens: 100,
  temperature: 0.1,
});

console.log(response.choices[0].text);
```

#### `completeCode(request: CodeCompletionRequest): Promise<CodeCompletionResponse>`

Code-aware completion with language context.

```typescript
const suggestions = await copilot.completeCode({
  filepath: 'main.ts',
  language: 'typescript',
  prefix: 'async function fetchUser(id: string) {',
  max_tokens: 100,
});

suggestions.completions.forEach(c => console.log(c));
```

#### `explain(code: string): Promise<string>`

Explain what code does.

```typescript
const explanation = await copilot.explain(`
  const fibonacci = (n) => n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2);
`);
console.log(explanation);
```

#### `refactor(code: string, language?: string): Promise<string>`

Refactor code for better style/performance.

```typescript
const improved = await copilot.refactor(
  'var x = 1; function foo(y) { return x + y; }',
  'javascript'
);
console.log(improved);
```

#### `generateTests(code: string, language?: string): Promise<string>`

Generate unit tests.

```typescript
const tests = await copilot.generateTests(
  'function add(a, b) { return a + b; }',
  'javascript'
);
console.log(tests);
```

#### `debugError(error: string, context?: string): Promise<string>`

Get debugging suggestions for an error.

```typescript
const solution = await copilot.debugError(
  'TypeError: Cannot read property "map" of undefined',
  'const data = fetchData(); const items = data.items.map(..);'
);
console.log(solution);
```

### CopilotAuth

#### `getToken(): Promise<string | null>`

Get authentication token from any available source.

```typescript
const token = await auth.getToken();
if (!token) {
  console.log('No token available');
}
```

#### `authenticateWithGitHub(token: string): Promise<AuthToken>`

Verify and cache a GitHub token.

```typescript
const authToken = await auth.authenticateWithGitHub(process.env.GITHUB_TOKEN);
console.log(authToken.type); // 'github'
```

#### `authenticateWithVSCode(): Promise<AuthToken | null>`

Use VSCode's cached token.

```typescript
const authToken = await auth.authenticateWithVSCode();
if (authToken) {
  copilot.setToken(authToken.token);
}
```

#### `initiateDeviceFlow(): Promise<DeviceFlowResponse>`

Start browser-based authentication.

```typescript
const { user_code, verification_uri } = await auth.initiateDeviceFlow();
console.log(`Visit: ${verification_uri}`);
console.log(`Code: ${user_code}`);
```

#### `pollDeviceFlow(deviceCode: string): Promise<AuthToken>`

Poll for device flow completion.

```typescript
const authToken = await auth.pollDeviceFlow(deviceCode);
```

#### `clearCache(): void`

Clear cached authentication token.

```typescript
auth.clearCache();
```

## Examples

### Example 1: Build System Integration

```typescript
import { CopilotClient, CopilotAuth } from 'lib-copilot';
import * as fs from 'fs';

const auth = new CopilotAuth();
const token = await auth.getToken();
const copilot = new CopilotClient({ token });

// Auto-generate tests during build
const srcCode = fs.readFileSync('src/math.ts', 'utf-8');
const tests = await copilot.generateTests(srcCode, 'typescript');
fs.writeFileSync('src/math.test.ts', tests);

console.log('✓ Tests generated automatically');
```

### Example 2: AI Agent / Bot

```typescript
import { CopilotClient, CopilotAuth } from 'lib-copilot';

const copilot = new CopilotClient({
  token: process.env.GITHUB_TOKEN,
  debug: process.env.DEBUG === 'true',
});

const messages = [];

async function askCopilot(userQuery) {
  messages.push({ role: 'user', content: userQuery });
  
  const response = await copilot.chat({ messages });
  const reply = response.choices[0].message.content;
  
  messages.push({ role: 'assistant', content: reply });
  
  return reply;
}

// Use in agent loop
const answer1 = await askCopilot('How do I use async/await?');
console.log(answer1);

const answer2 = await askCopilot('Give me a practical example');
console.log(answer2);
```

### Example 3: Code Quality Tool

```typescript
import { CopilotClient, CopilotAuth } from 'lib-copilot';
import * as fs from 'fs';
import * as glob from 'glob';

const copilot = new CopilotClient({ token: await new CopilotAuth().getToken() });

// Analyze and refactor all TypeScript files
const files = glob.sync('src/**/*.ts');

for (const file of files) {
  const code = fs.readFileSync(file, 'utf-8');
  const refactored = await copilot.refactor(code, 'typescript');
  
  if (refactored !== code) {
    console.log(`📝 ${file} has suggestions`);
    // Save suggestions or create PR
  }
}
```

### Example 4: Documentation Generator

```typescript
import { CopilotClient, CopilotAuth } from 'lib-copilot';
import * as fs from 'fs';

const copilot = new CopilotClient({ token: await new CopilotAuth().getToken() });

async function documentCode(filepath) {
  const code = fs.readFileSync(filepath, 'utf-8');
  const explanation = await copilot.explain(code);
  
  const doc = `# ${filepath}

${explanation}

## Code

\`\`\`typescript
${code}
\`\`\`
  `;
  
  fs.writeFileSync(filepath.replace('.ts', '.md'), doc);
}

await documentCode('src/utils.ts');
```

## Configuration

### Client Options

```typescript
interface CopilotOptions {
  token?: string;           // Auth token
  endpoint?: string;        // API endpoint (default: GitHub API)
  model?: string;           // Model to use (default: gpt-4)
  timeout?: number;         // Request timeout in ms
  debug?: boolean;          // Enable debug logging
}
```

### Auth Options

```typescript
const auth = new CopilotAuth(debug = false);
```

## Environment Variables

```bash
GITHUB_TOKEN          # GitHub personal access token
COPILOT_TOKEN         # Copilot-specific token
DEBUG                 # Enable debug mode (true/false)
```

## Comparison with VSCode Extension

| Feature | VSCode Extension | lib-copilot |
|---------|-----------------|------------|
| **Chat** | ✅ In editor | ✅ API/CLI |
| **Completions** | ✅ Inline | ✅ API |
| **Streaming** | ✅ | ✅ |
| **Code tasks** | Limited | ✅ Full |
| **Programmatic** | ❌ | ✅ |
| **CLI** | ❌ | ✅ |
| **Auth** | Built-in | ✅ Multiple methods |
| **Offline** | ❌ | ❌ |
| **Self-hosted** | ❌ | ❌ |

## Troubleshooting

### "Not authenticated"

**Problem:** `Error: Not authenticated. Please set a token first.`

**Solution:**
```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
# or
export COPILOT_TOKEN="your_token_here"
```

### "Token expired"

The library caches tokens for 8 hours. Clear the cache:

```typescript
const auth = new CopilotAuth();
auth.clearCache();
const token = await auth.getToken(); // Will re-authenticate
```

### Slow responses

Enable debug mode to see what's happening:

```typescript
const copilot = new CopilotClient({
  token,
  debug: true,
});
```

### Streaming not working

Check that your token has the required scopes:

```bash
gh auth status
# Should show: Token scopes: 'read:user', 'repo'
```

## Advanced Usage

### Custom Headers

```typescript
const client = axios.create({
  headers: {
    'X-Custom-Header': 'value',
  },
});

// Extend CopilotClient if needed
```

### Retry Logic

```typescript
import axiosRetry from 'axios-retry';

// Add automatic retries
axiosRetry(httpClient, { retries: 3 });
```

### Rate Limiting

Copilot has rate limits. Implement backoff:

```typescript
async function withRetry(fn, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxAttempts - 1) throw error;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
}

const response = await withRetry(() => copilot.chat(request));
```

## License

MIT

## Related

- [GitHub Copilot](https://github.com/features/copilot)
- [Goose CLI](https://github.com/block/goose) — Inspiration for CLI design
- [OpenAI API](https://openai.com/api/) — Similar API structure
