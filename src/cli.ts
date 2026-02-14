#!/usr/bin/env node

import { CopilotClient, CopilotAuth } from './index';
import * as fs from 'fs';
import * as readline from 'readline';

/**
 * CLI interface for Copilot
 * Usage: copilot [command] [options]
 */

class CopilotCLI {
  private copilot: CopilotClient | null = null;
  private auth: CopilotAuth;

  constructor() {
    this.auth = new CopilotAuth(process.env.DEBUG === 'true');
  }

  async initialize(): Promise<void> {
    const token = await this.auth.getToken();
    if (!token) {
      throw new Error('Authentication failed. Please set GITHUB_TOKEN or COPILOT_TOKEN.');
    }

    this.copilot = new CopilotClient({
      token,
      debug: process.env.DEBUG === 'true',
    });
  }

  /**
   * Interactive chat mode
   */
  async chat(initialPrompt?: string): Promise<void> {
    await this.initialize();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    const askQuestion = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer);
        });
      });
    };

    console.log('💬 Copilot Chat Mode (type "exit" to quit)\n');

    if (initialPrompt) {
      console.log(`You: ${initialPrompt}`);
      messages.push({ role: 'user', content: initialPrompt });

      try {
        const response = await this.copilot!.chat({ messages });
        const assistantMessage = response.choices[0]?.message.content;
        console.log(`\nAssistant: ${assistantMessage}\n`);
        messages.push({ role: 'assistant', content: assistantMessage });
      } catch (error) {
        console.error('Error:', error);
      }
    }

    while (true) {
      const userInput = await askQuestion('You: ');

      if (userInput.toLowerCase() === 'exit') {
        console.log('Goodbye!');
        rl.close();
        break;
      }

      messages.push({ role: 'user', content: userInput });

      try {
        const response = await this.copilot!.chat({ messages });
        const assistantMessage = response.choices[0]?.message.content;
        console.log(`\nAssistant: ${assistantMessage}\n`);
        messages.push({ role: 'assistant', content: assistantMessage });
      } catch (error) {
        console.error('Error:', error);
        messages.pop(); // Remove failed message
      }
    }
  }

  /**
   * Complete a code snippet
   */
  async complete(prompt: string): Promise<void> {
    await this.initialize();

    try {
      const response = await this.copilot!.complete({
        prompt,
        max_tokens: 200,
        temperature: 0.1,
      });

      console.log('Completions:\n');
      response.choices.forEach((choice, index) => {
        console.log(`[${index}]: ${choice.text}`);
        console.log('---');
      });
    } catch (error) {
      console.error('Error:', error);
    }
  }

  /**
   * Explain code
   */
  async explain(codeFile: string): Promise<void> {
    await this.initialize();

    try {
      const code = fs.readFileSync(codeFile, 'utf-8');
      console.log('📖 Explaining code...\n');
      const explanation = await this.copilot!.explain(code);
      console.log(explanation);
    } catch (error) {
      console.error('Error:', error);
    }
  }

  /**
   * Refactor code
   */
  async refactor(codeFile: string, language: string = 'javascript'): Promise<void> {
    await this.initialize();

    try {
      const code = fs.readFileSync(codeFile, 'utf-8');
      console.log('🔧 Refactoring code...\n');
      const refactored = await this.copilot!.refactor(code, language);
      console.log(refactored);
    } catch (error) {
      console.error('Error:', error);
    }
  }

  /**
   * Generate tests
   */
  async generateTests(codeFile: string, language: string = 'javascript'): Promise<void> {
    await this.initialize();

    try {
      const code = fs.readFileSync(codeFile, 'utf-8');
      console.log('🧪 Generating tests...\n');
      const tests = await this.copilot!.generateTests(code, language);
      console.log(tests);
    } catch (error) {
      console.error('Error:', error);
    }
  }

  /**
   * Debug error
   */
  async debug(error: string, context?: string): Promise<void> {
    await this.initialize();

    try {
      console.log('🐛 Debugging error...\n');
      const solution = await this.copilot!.debugError(error, context);
      console.log(solution);
    } catch (error) {
      console.error('Error:', error);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const cli = new CopilotCLI();

  switch (command) {
    case 'chat':
      await cli.chat(args.slice(1).join(' '));
      break;

    case 'complete':
      if (args.length < 2) {
        console.error('Usage: copilot complete <prompt>');
        process.exit(1);
      }
      await cli.complete(args.slice(1).join(' '));
      break;

    case 'explain':
      if (args.length < 2) {
        console.error('Usage: copilot explain <file>');
        process.exit(1);
      }
      await cli.explain(args[1]);
      break;

    case 'refactor':
      if (args.length < 2) {
        console.error('Usage: copilot refactor <file> [language]');
        process.exit(1);
      }
      await cli.refactor(args[1], args[2] || 'javascript');
      break;

    case 'test':
      if (args.length < 2) {
        console.error('Usage: copilot test <file> [language]');
        process.exit(1);
      }
      await cli.generateTests(args[1], args[2] || 'javascript');
      break;

    case 'debug':
      if (args.length < 2) {
        console.error('Usage: copilot debug <error> [context]');
        process.exit(1);
      }
      await cli.debug(args[1], args[2]);
      break;

    default:
      console.log(`GitHub Copilot CLI
      
Usage: copilot <command> [options]

Commands:
  chat [prompt]        Interactive chat with Copilot
  complete <prompt>    Complete code from prompt
  explain <file>       Explain code in file
  refactor <file>      Refactor code in file
  test <file>          Generate tests for code
  debug <error>        Debug an error

Examples:
  copilot chat
  copilot chat "How do I read a file in Node.js?"
  copilot explain index.ts
  copilot refactor index.ts typescript
  copilot test index.ts javascript

Environment variables:
  GITHUB_TOKEN         GitHub personal access token
  COPILOT_TOKEN        Copilot-specific token
  DEBUG                Enable debug logging
      `);
      break;
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
