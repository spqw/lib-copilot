# lib-copilot

**Use GitHub Copilot from code.** You already pay for it — now use it in scripts, bots, CI pipelines, and CLI workflows.

One subscription. 20+ models. Claude, GPT, Gemini, Grok — all accessible programmatically.

## 30-Second Demo

```bash
npm install -g lib-copilot

# First run authenticates via browser (saved for next time)
vcopilot "Explain the difference between async and parallel"

# Pipe anything through Copilot
git diff | vcopilot --system "Review this diff for bugs"
cat src/utils.ts | vcopilot "Write unit tests for this" > tests.ts
echo "SELECT * FROM users WHERE 1=1" | vcopilot "Is this SQL injection?"
```

## Why This Exists

GitHub Copilot gives you access to GPT-4.1, Claude Sonnet, Gemini Pro, and more for $10/month — but locks it behind VSCode. This library unlocks that access for any tool, script, or workflow you build.

| | VSCode Extension | lib-copilot |
|---|---|---|
| **Chat** | In editor only | API + CLI + scripts |
| **Programmatic** | No | Full TypeScript API |
| **CI/CD** | No | Pipe, batch, automate |
| **Model selection** | Limited | 20+ models, your choice |
| **Streaming** | Yes | Yes |

## Install

```bash
npm install lib-copilot        # Library
npm install -g lib-copilot     # CLI (installs `vcopilot`)
```

Or via Homebrew:
```bash
brew install spqw/tap/vcopilot
```

## CLI Usage

```bash
vcopilot "prompt"                              # Direct prompt
cat file.ts | vcopilot                         # Pipe stdin
vcopilot --model claude-sonnet-4.6 "prompt"    # Pick a model
vcopilot --system "You are a code reviewer" "prompt"  # System prompt
vcopilot --local "prompt"                      # Use local LM Studio
vcopilot --models                              # List all available models
vcopilot --usage                               # Check premium quota
vcopilot --status                              # Show auth state
vcopilot --login                               # Re-authenticate
```

## Programmatic Usage

```typescript
import { CopilotClient, CopilotAuth } from 'lib-copilot';

const auth = new CopilotAuth();
const token = await auth.getToken();
const copilot = new CopilotClient({ token });

// Chat
const response = await copilot.chat({
  messages: [{ role: 'user', content: 'How do I read a file in Node.js?' }],
});
console.log(response.choices[0].message.content);

// Stream
await copilot.chatStream(
  { messages: [{ role: 'user', content: 'Explain quantum computing' }] },
  (chunk) => process.stdout.write(chunk),
);

// Convenience methods
const explanation = await copilot.explain(code);
const refactored = await copilot.refactor(code, 'typescript');
const tests = await copilot.generateTests(code, 'typescript');
const fix = await copilot.debugError('TypeError: Cannot read property "map" of undefined', context);
```

## Available Models

Your Copilot subscription includes access to these models:

| Model | Premium Cost | Notes |
|-------|-------------|-------|
| `gpt-4.1` | Free | Default model |
| `gpt-4o`, `gpt-4o-mini` | Free | Fast, capable |
| `gpt-5-mini` | Free | |
| `gemini-3-flash` | 0.33x | Cheap and fast |
| `grok-code-fast-1` | 0.25x | Cheapest premium |
| `claude-haiku-4.5` | 0.33x | Fast Claude |
| `claude-sonnet-4.6` | 1x | Balanced |
| `gemini-2.5-pro` | 1x | |
| `gpt-5` | 1x | |
| `claude-opus-4.5` | 3x | Most capable Claude |
| `claude-opus-4.6` | 3x | Latest Opus |

Use `vcopilot --models` for the full list with current pricing.

## Authentication

Auth is resolved automatically in this order:

1. `GITHUB_TOKEN` env var
2. `COPILOT_TOKEN` env var
3. Cached token at `~/.copilot/token.json`
4. VSCode extension session
5. Device flow (browser-based OAuth — opens automatically on first use)

```bash
# Simplest: set your GitHub PAT
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
vcopilot "hello"
```

## API Reference

| Method | Purpose |
|--------|---------|
| `chat(request)` | Single or multi-turn chat |
| `chatStream(request, onChunk)` | Streaming chat |
| `complete(request)` | Code completion |
| `completeCode(request)` | Language-aware completion with prefix/suffix |
| `explain(code)` | Explain code |
| `refactor(code, lang)` | Refactor code |
| `generateTests(code, lang)` | Generate unit tests |
| `debugError(error, context)` | Debug an error |
| `getModels()` | List available models |
| `getModelsDetailed()` | Models with metadata (context window, capabilities) |
| `getUsage()` | Check premium quota usage |

## Use Cases

**CI/CD — Auto-review PRs:**
```bash
git diff main...HEAD | vcopilot --system "Review for bugs, security issues, and style" > review.md
```

**Build system — Generate tests:**
```typescript
const tests = await copilot.generateTests(fs.readFileSync('src/math.ts', 'utf-8'), 'typescript');
fs.writeFileSync('src/math.test.ts', tests);
```

**Agent loop — Multi-turn conversation:**
```typescript
const messages = [];
async function ask(query) {
  messages.push({ role: 'user', content: query });
  const res = await copilot.chat({ messages });
  const reply = res.choices[0].message.content;
  messages.push({ role: 'assistant', content: reply });
  return reply;
}
```

## License

MIT
