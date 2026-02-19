import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * GitHub Copilot Authentication Handler
 * 
 * Supports multiple authentication methods:
 * 1. GitHub token (PAT)
 * 2. Device flow (browser-based)
 * 3. VSCode extension session (if available)
 */

export interface AuthToken {
  token: string;
  type: 'github' | 'copilot' | 'vscode';
  expiresAt?: number;
  scopes?: string[];
}

export interface DeviceFlowResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export class CopilotAuth {
  private client: AxiosInstance;
  private tokenPath: string;
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
    this.tokenPath = path.join(os.homedir(), '.copilot', 'token.json');

    this.client = axios.create({
      timeout: 10000,
      headers: {
        'User-Agent': 'GitHub-Copilot-CLI/1.0.0',
      },
    });
  }

  /**
   * Get token from environment or cache
   */
  public async getToken(): Promise<string | null> {
    // 1. Check environment variables
    const envToken = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN;
    if (envToken) {
      if (this.debug) console.log('[Auth] Token from environment');
      return envToken;
    }

    // 2. Check cached token
    const cachedToken = this.getCachedToken();
    if (cachedToken) {
      if (this.debug) console.log('[Auth] Token from cache');
      return cachedToken;
    }

    return null;
  }

  /**
   * Get cached token from disk
   */
  private getCachedToken(): string | null {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const data = fs.readFileSync(this.tokenPath, 'utf-8');
        const parsed = JSON.parse(data);

        // Check if expired
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
          if (this.debug) console.log('[Auth] Cached token expired');
          fs.unlinkSync(this.tokenPath);
          return null;
        }

        return parsed.token;
      }
    } catch (e) {
      if (this.debug) console.log('[Auth] Failed to read cached token:', e);
    }
    return null;
  }

  /**
   * Save token to cache
   */
  private saveToken(token: string, expiresAt?: number): void {
    try {
      const dir = path.dirname(this.tokenPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        token,
        expiresAt: expiresAt || Date.now() + 8 * 3600 * 1000, // 8 hours default
        timestamp: new Date().toISOString(),
      };

      fs.writeFileSync(this.tokenPath, JSON.stringify(data, null, 2));
      if (this.debug) console.log('[Auth] Token saved to cache');
    } catch (e) {
      console.error('[Auth] Failed to save token:', e);
    }
  }

  /**
   * Authenticate with GitHub token (Personal Access Token)
   */
  public async authenticateWithGitHub(token: string): Promise<AuthToken> {
    try {
      // Verify token by making a request to GitHub API
      const response = await this.client.get('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (this.debug) console.log('[Auth] GitHub authentication successful:', response.data.login);

      this.saveToken(token);

      return {
        token,
        type: 'github',
        scopes: response.headers['x-oauth-scopes']?.split(',').map((s: string) => s.trim()),
      };
    } catch (error) {
      throw new Error(`GitHub authentication failed: ${this.formatError(error)}`);
    }
  }

  /**
   * Authenticate with VSCode extension session
   * Reads from VSCode's cached token location
   */
  public async authenticateWithVSCode(): Promise<AuthToken | null> {
    try {
      const vscodeTokenPath = path.join(
        os.homedir(),
        '.vscode-server',
        'data',
        'User',
        'globalStorage',
        'github.copilot',
        'token.json'
      );

      if (fs.existsSync(vscodeTokenPath)) {
        const data = fs.readFileSync(vscodeTokenPath, 'utf-8');
        const parsed = JSON.parse(data);

        if (this.debug) console.log('[Auth] VSCode token found');

        return {
          token: parsed.token || parsed.access_token,
          type: 'vscode',
          expiresAt: parsed.expiresAt,
        };
      }
    } catch (e) {
      if (this.debug) console.log('[Auth] VSCode token not available:', e);
    }

    return null;
  }

  /**
   * Device flow authentication (browser-based)
   * User authenticates in browser, code polls for completion
   */
  public async initiateDeviceFlow(): Promise<DeviceFlowResponse> {
    try {
      const response = await this.client.post(
        'https://github.com/login/device/code',
        {
          client_id: 'Iv1.b507a08c87ecfe98', // VSCode GitHub Copilot OAuth app
          scope: 'read:user',
        },
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      const data = response.data as DeviceFlowResponse;
      if (this.debug) {
        console.log('[Auth] Device flow initiated');
        console.log('  User code:', data.user_code);
        console.log('  Verification URL:', data.verification_uri);
      }

      return data;
    } catch (error) {
      throw new Error(`Device flow initiation failed: ${this.formatError(error)}`);
    }
  }

  /**
   * Poll for device flow completion
   */
  public async pollDeviceFlow(deviceCode: string): Promise<AuthToken> {
    const maxAttempts = 120; // 20 minutes with 10 second interval
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await this.client.post(
          'https://github.com/login/oauth/access_token',
          {
            client_id: 'Iv1.b507a08c87ecfe98',
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          },
          {
            headers: {
              'Accept': 'application/json',
            },
          }
        );

        const data = response.data;

        if (data.error === 'authorization_pending') {
          attempts++;
          await this.sleep(10000); // Wait 10 seconds before polling again
          continue;
        }

        if (data.error) {
          throw new Error(`Device flow error: ${data.error_description}`);
        }

        if (data.access_token) {
          if (this.debug) console.log('[Auth] Device flow completed successfully');
          this.saveToken(data.access_token);

          return {
            token: data.access_token,
            type: 'github',
            expiresAt: Date.now() + (data.expires_in || 8 * 3600) * 1000,
          };
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 400) {
          // Expected for authorization_pending
          attempts++;
          await this.sleep(10000);
          continue;
        }
        throw error;
      }
    }

    throw new Error('Device flow polling timeout');
  }

  /**
   * Clear cached token
   */
  public clearCache(): void {
    try {
      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
        if (this.debug) console.log('[Auth] Token cache cleared');
      }
    } catch (e) {
      console.error('[Auth] Failed to clear cache:', e);
    }
  }

  /**
   * Helper: sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Helper: format error messages
   */
  private formatError(error: any): string {
    if (axios.isAxiosError(error)) {
      return error.response?.data?.message || error.message;
    }
    return error?.message || String(error);
  }
}
