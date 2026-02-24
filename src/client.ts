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
  private githubToken: string | null = null; // The GitHub OAuth token
  private token: string | null = null;       // The Copilot session token
  private tokenExpiresAt: number = 0;
  private endpoint: string;
  private model: string;
  private debug: boolean;
  private local: boolean;
  private auth: any; // CopilotAuth instance for session disk caching

  private extensionInfo: VSCodeExtensionInfo = {
    version: '1.200.0', // Copilot version
    userAgent: 'GitHub-Copilot/1.200.0 VSCode/1.95.0',
  };

  constructor(options: CopilotOptions = {}) {
    this.local = options.local || false;
    this.endpoint = options.endpoint || (this.local ? 'http://localhost:1234/v1' : 'https://api.githubcopilot.com');
    this.model = options.model || (this.local ? 'default' : 'gpt-4');
    this.debug = options.debug || false;
    this.githubToken = options.token || null;
    this.auth = options.auth || null;

    // Try to restore Copilot session token from disk cache
    if (!this.local && this.auth) {
      const cached = this.auth.getCachedSession();
      if (cached) {
        this.token = cached.token;
        this.tokenExpiresAt = cached.expiresAt;
        if (this.debug) console.log('[Copilot Client] Restored session token from disk cache, expires:', new Date(this.tokenExpiresAt).toISOString());
      }
    }

    this.client = axios.create({
      baseURL: this.endpoint,
      timeout: options.timeout || 30000,
    });

    this.client.defaults.headers.common = this.getHeaders() as any;

    if (this.debug) {
      console.log(`[${this.local ? 'Local' : 'Copilot'} Client] Initialized`, {
        endpoint: this.endpoint,
        model: this.model,
        local: this.local,
        authenticated: this.local || !!this.githubToken,
      });
    }
  }

  /**
   * Exchange GitHub PAT for a short-lived Copilot session token.
   * Uses disk-cached session token when available (like Goose/VSCode).
   * Refreshes with retry when expired.
   */
  private async ensureAuthenticated(): Promise<void> {
    // Local mode: no auth needed
    if (this.local) return;

    // If we already have a valid copilot token (5-min buffer), skip
    if (this.token && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return;
    }

    if (!this.githubToken) {
      throw new Error('Not authenticated. Please set a token first.');
    }

    // Retry up to 3 times (like Goose)
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (this.debug) console.log(`[Copilot Client] Exchanging GitHub token for Copilot session token (attempt ${attempt + 1})...`);

        const response = await axios.get('https://api.github.com/copilot_internal/v2/token', {
          headers: {
            'Authorization': `token ${this.githubToken}`,
            'User-Agent': 'GithubCopilot/1.200.0',
            'Accept': 'application/json',
            'Editor-Version': 'vscode/1.95.0',
            'Editor-Plugin-Version': 'copilot/1.200.0',
          },
        });

        this.token = response.data.token;
        // Use refresh_in if available (like Goose), fall back to expires_at, then 30 min
        if (response.data.refresh_in) {
          this.tokenExpiresAt = Date.now() + response.data.refresh_in * 1000;
        } else if (response.data.expires_at) {
          this.tokenExpiresAt = response.data.expires_at * 1000;
        } else {
          this.tokenExpiresAt = Date.now() + 30 * 60 * 1000;
        }

        // Update client headers with the copilot token
        this.client.defaults.headers.common = this.getHeaders() as any;

        // Persist session token to disk so subsequent invocations reuse it
        if (this.auth) {
          this.auth.saveSession(this.token, this.tokenExpiresAt);
        }

        if (this.debug) {
          console.log('[Copilot Client] Session token obtained, expires:', new Date(this.tokenExpiresAt).toISOString());
        }
        return;
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 404) {
          throw new Error(
            'Copilot session token exchange failed (404). This usually means:\n' +
            '  - Your GitHub account does not have an active Copilot subscription\n' +
            '  - Your token does not have Copilot access\n' +
            'Check your subscription at https://github.com/settings/copilot'
          );
        }
        if (attempt < maxAttempts - 1) {
          if (this.debug) console.log(`[Copilot Client] Token exchange failed, retrying... (${this.formatError(error)})`);
          continue;
        }
        throw new Error(`Failed to get Copilot session token: ${this.formatError(error)}`);
      }
    }
  }

  /**
   * Get standard headers that mimic VSCode extension
   */
  private getHeaders(): Record<string, string> {
    if (this.local) {
      return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
    }

    const headers: Record<string, string> = {
      'User-Agent': 'GithubCopilot/1.200.0',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Editor-Version': 'vscode/1.95.0',
      'Editor-Plugin-Version': 'copilot/1.200.0',
      'Copilot-Integration-Id': 'vscode-chat',
      'Openai-Organization': 'github-copilot',
      'Openai-Intent': 'conversation-panel',
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
    return !!(this.githubToken || this.getToken());
  }

  /**
   * Chat completion (conversational)
   */
  public async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.ensureAuthenticated();

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
    await this.ensureAuthenticated();

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
    await this.ensureAuthenticated();

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
    await this.ensureAuthenticated();

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
   * Get available models (IDs only)
   */
  public async getModels(): Promise<string[]> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.get('/models');
      const models = response.data.data || response.data;
      return (Array.isArray(models) ? models : []).map((m: any) => m.id);
    } catch (error) {
      throw new Error(`Failed to get models: ${this.formatError(error)}`);
    }
  }

  /**
   * Get available models with full metadata
   */
  public async getModelsDetailed(): Promise<any[]> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.get('/models');
      const models = response.data.data || response.data;
      return Array.isArray(models) ? models : [];
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
    await this.ensureAuthenticated();

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
      if (this.debug && error.response?.data) {
        console.log('[Copilot] Error response:', JSON.stringify(error.response.data, null, 2));
      }
      return error.response?.data?.message || error.response?.data?.error || error.message;
    }
    return error?.message || String(error);
  }
}
