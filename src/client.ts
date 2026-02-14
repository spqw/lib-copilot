import axios, { AxiosInstance } from 'axios';
import {
  CopilotAuthToken,
  CopilotOptions,
  ChatRequest,
  ChatResponse,
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  CodeCompletionRequest,
  CodeCompletionResponse,
  VSCodeExtensionInfo,
} from './types';

/**
 * GitHub Copilot API Client
 * 
 * Mimics VSCode extension behavior for direct API access
 * Supports chat, code completion, and streaming responses
 */
export class CopilotClient {
  private client: AxiosInstance;
  private token: string | null = null;
  private tokenExpiresAt: number = 0;
  private endpoint: string;
  private model: string;
  private debug: boolean;

  private extensionInfo: VSCodeExtensionInfo = {
    version: '1.200.0', // Copilot version
    userAgent: 'GitHub-Copilot/1.200.0 VSCode/1.95.0',
  };

  constructor(options: CopilotOptions = {}) {
    this.endpoint = options.endpoint || 'https://api.github.com/copilot_internal';
    this.model = options.model || 'gpt-4';
    this.debug = options.debug || false;
    this.token = options.token || null;

    this.client = axios.create({
      baseURL: this.endpoint,
      timeout: options.timeout || 30000,
    });
    
    this.client.defaults.headers.common = this.getHeaders() as any;

    if (this.debug) {
      console.log('[Copilot Client] Initialized', {
        endpoint: this.endpoint,
        model: this.model,
        authenticated: !!this.token,
      });
    }
  }

  /**
   * Get standard headers that mimic VSCode extension
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.extensionInfo.userAgent,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  /**
   * Set authentication token (from GitHub or Copilot auth flow)
   */
  public setToken(token: string, expiresAt?: number): void {
    this.token = token;
    this.tokenExpiresAt = expiresAt || Date.now() + 8 * 3600 * 1000; // 8 hours default
    this.client.defaults.headers.common = this.getHeaders() as any;

    if (this.debug) {
      console.log('[Copilot Client] Token set, expires at:', new Date(this.tokenExpiresAt));
    }
  }

  /**
   * Get current token (check if valid)
   */
  public getToken(): CopilotAuthToken | null {
    if (!this.token) return null;

    const isExpired = Date.now() > this.tokenExpiresAt;
    if (isExpired) {
      if (this.debug) console.log('[Copilot Client] Token expired');
      return null;
    }

    return {
      token: this.token,
      expiresAt: this.tokenExpiresAt,
    };
  }

  /**
   * Check if authenticated
   */
  public isAuthenticated(): boolean {
    return !!this.getToken();
  }

  /**
   * Chat completion (conversational)
   */
  public async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated. Please set a token first.');
    }

    try {
      const payload = {
        ...request,
        model: request.model || this.model,
      };

      if (this.debug) {
        console.log('[Copilot] Chat request:', {
          model: payload.model,
          messages: payload.messages.length,
          stream: payload.stream,
        });
      }

      const response = await this.client.post<ChatResponse>('/chat/completions', payload);

      if (this.debug) {
        console.log('[Copilot] Chat response:', {
          choices: response.data.choices.length,
          usage: response.data.usage,
        });
      }

      return response.data;
    } catch (error) {
      throw new Error(`Copilot chat failed: ${this.formatError(error)}`);
    }
  }

  /**
   * Chat completion with streaming response
   */
  public async chatStream(
    request: ChatRequest,
    onChunk: (content: string) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated. Please set a token first.');
    }

    try {
      const payload = {
        ...request,
        model: request.model || this.model,
        stream: true,
      };

      if (this.debug) {
        console.log('[Copilot] Chat stream started');
      }

      const response = await this.client.post('/chat/completions', payload, {
        responseType: 'stream',
      });

      return new Promise((resolve, reject) => {
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                resolve();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  onChunk(content);
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }
          }
        });

        response.data.on('error', (error: Error) => {
          if (onError) {
            onError(error);
          }
          reject(error);
        });

        response.data.on('end', () => {
          resolve();
        });
      });
    } catch (error) {
      throw new Error(`Copilot chat stream failed: ${this.formatError(error)}`);
    }
  }

  /**
   * Code completion
   */
  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated. Please set a token first.');
    }

    try {
      const payload = {
        ...request,
        model: this.model,
        prompt: request.prompt,
        max_tokens: request.max_tokens || 100,
        temperature: request.temperature ?? 0.1,
      };

      if (this.debug) {
        console.log('[Copilot] Completion request:', {
          model: payload.model,
          promptLength: payload.prompt.length,
        });
      }

      const response = await this.client.post<CompletionResponse>(
        '/completions',
        payload
      );

      if (this.debug) {
        console.log('[Copilot] Completion response:', {
          choices: response.data.choices.length,
          usage: response.data.usage,
        });
      }

      return response.data;
    } catch (error) {
      throw new Error(`Copilot completion failed: ${this.formatError(error)}`);
    }
  }

  /**
   * Code-aware completion (with language context)
   */
  public async completeCode(request: CodeCompletionRequest): Promise<CodeCompletionResponse> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated. Please set a token first.');
    }

    try {
      const prompt = request.prefix;
      const suffix = request.suffix || '';

      const payload = {
        prompt,
        suffix,
        max_tokens: request.max_tokens || 100,
        temperature: 0.1,
        top_p: 0.95,
        n: 3, // Return 3 suggestions
        stop: ['\\n\\n', '\n\n'],
        model: this.model,
      };

      if (this.debug) {
        console.log('[Copilot] Code completion:', {
          language: request.language,
          filepath: request.filepath,
          prefixLength: request.prefix.length,
          suffixLength: suffix.length,
        });
      }

      const response = await this.client.post<CompletionResponse>(
        '/completions',
        payload
      );

      return {
        completions: response.data.choices.map((c) => c.text),
        indices: response.data.choices.map((c) => c.index),
      };
    } catch (error) {
      throw new Error(`Copilot code completion failed: ${this.formatError(error)}`);
    }
  }

  /**
   * Get available models
   */
  public async getModels(): Promise<string[]> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated. Please set a token first.');
    }

    try {
      const response = await this.client.get('/models');
      return response.data.data.map((m: any) => m.id);
    } catch (error) {
      throw new Error(`Failed to get models: ${this.formatError(error)}`);
    }
  }

  /**
   * Get token usage
   */
  public async getUsage(): Promise<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated. Please set a token first.');
    }

    try {
      const response = await this.client.get('/usage');
      return {
        promptTokens: response.data.prompt_tokens,
        completionTokens: response.data.completion_tokens,
        totalTokens: response.data.total_tokens,
      };
    } catch (error) {
      throw new Error(`Failed to get usage: ${this.formatError(error)}`);
    }
  }

  /**
   * Explain code with Copilot
   */
  public async explain(code: string): Promise<string> {
    const request: ChatRequest = {
      messages: [
        {
          role: 'system',
          content: 'You are a helpful code explanation assistant. Explain the given code clearly and concisely.',
        },
        {
          role: 'user',
          content: `Explain this code:\n\`\`\`\n${code}\n\`\`\``,
        },
      ],
      max_tokens: 500,
    };

    const response = await this.chat(request);
    return response.choices[0]?.message.content || '';
  }

  /**
   * Refactor code with Copilot
   */
  public async refactor(code: string, language: string = 'javascript'): Promise<string> {
    const request: ChatRequest = {
      messages: [
        {
          role: 'system',
          content: `You are a code refactoring expert. Refactor the given ${language} code to improve readability, performance, or maintainability. Return ONLY the refactored code.`,
        },
        {
          role: 'user',
          content: `Refactor this ${language} code:\n\`\`\`${language}\n${code}\n\`\`\``,
        },
      ],
      max_tokens: 1000,
    };

    const response = await this.chat(request);
    return response.choices[0]?.message.content || '';
  }

  /**
   * Generate tests for code
   */
  public async generateTests(code: string, language: string = 'javascript'): Promise<string> {
    const request: ChatRequest = {
      messages: [
        {
          role: 'system',
          content: `You are a test generation expert. Generate comprehensive unit tests for the given ${language} code. Return ONLY the test code.`,
        },
        {
          role: 'user',
          content: `Generate tests for this ${language} code:\n\`\`\`${language}\n${code}\n\`\`\``,
        },
      ],
      max_tokens: 1000,
    };

    const response = await this.chat(request);
    return response.choices[0]?.message.content || '';
  }

  /**
   * Debug/analyze error
   */
  public async debugError(error: string, context?: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a helpful debugging assistant. Analyze the error and suggest solutions.',
      },
      {
        role: 'user',
        content: `Error: ${error}${context ? `\n\nContext:\n${context}` : ''}`,
      },
    ];

    const request: ChatRequest = {
      messages,
      max_tokens: 500,
    };

    const response = await this.chat(request);
    return response.choices[0]?.message.content || '';
  }

  /**
   * Private helper to format error messages
   */
  private formatError(error: any): string {
    if (axios.isAxiosError(error)) {
      return error.response?.data?.message || error.message;
    }
    return error?.message || String(error);
  }
}
