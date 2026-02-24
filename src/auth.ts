import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * GitHub Copilot Authentication Handler
 *
 * Supports multiple authentication methods:
 * 1. Device flow (browser-based OAuth)
 * 2. VSCode extension session (if available)
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
  private sessionPath: string;
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
    const configDir = path.join(os.homedir(), '.copilot');
    this.tokenPath = path.join(configDir, 'token.json');
    this.sessionPath = path.join(configDir, 'session.json');

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
   * Get cached GitHub OAuth token from disk.
   * OAuth tokens from device flow don't expire — they persist until revoked.
   */
  private getCachedToken(): string | null {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const data = fs.readFileSync(this.tokenPath, 'utf-8');
        const parsed = JSON.parse(data);
        return parsed.token || null;
      }
    } catch (e) {
      if (this.debug) console.log('[Auth] Failed to read cached token:', e);
    }
    return null;
  }

  /**
   * Get cached token with metadata (token + timestamp).
   */
  public getCachedTokenInfo(): { token: string; timestamp?: string } | null {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const data = fs.readFileSync(this.tokenPath, 'utf-8');
        const parsed = JSON.parse(data);
        if (parsed.token) {
          return { token: parsed.token, timestamp: parsed.timestamp };
        }
      }
    } catch (e) {
      if (this.debug) console.log('[Auth] Failed to read cached token info:', e);
    }
    return null;
  }

  /**
   * Save GitHub OAuth token to disk (no expiry — device flow tokens don't expire).
   */
  private saveToken(token: string): void {
    try {
      const dir = path.dirname(this.tokenPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        token,
        timestamp: new Date().toISOString(),
      };

      fs.writeFileSync(this.tokenPath, JSON.stringify(data, null, 2));
      if (this.debug) console.log('[Auth] Token saved to cache');
    } catch (e) {
      console.error('[Auth] Failed to save token:', e);
    }
  }

  /**
   * Get cached Copilot session token from disk.
   * Returns null if expired or not found.
   */
  public getCachedSession(): { token: string; expiresAt: number; endpoint?: string } | null {
    try {
      if (fs.existsSync(this.sessionPath)) {
        const data = fs.readFileSync(this.sessionPath, 'utf-8');
        const parsed = JSON.parse(data);

        // Check if expired (with 5-minute buffer)
        if (parsed.expiresAt && Date.now() > parsed.expiresAt - 5 * 60 * 1000) {
          if (this.debug) console.log('[Auth] Cached session token expired');
          return null;
        }

        return parsed;
      }
    } catch (e) {
      if (this.debug) console.log('[Auth] Failed to read cached session:', e);
    }
    return null;
  }

  /**
   * Save Copilot session token to disk.
   */
  public saveSession(token: string, expiresAt: number, endpoint?: string): void {
    try {
      const dir = path.dirname(this.sessionPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = { token, expiresAt, endpoint, timestamp: new Date().toISOString() };
      fs.writeFileSync(this.sessionPath, JSON.stringify(data, null, 2));
      if (this.debug) console.log('[Auth] Session token saved to cache');
    } catch (e) {
      if (this.debug) console.error('[Auth] Failed to save session:', e);
    }
  }

  /**
   * Authenticate with VSCode extension session
   * Reads from VSCode's cached token location (checks macOS, Linux, and remote paths)
   */
  public async authenticateWithVSCode(): Promise<AuthToken | null> {
    const home = os.homedir();
    const candidatePaths = [
      // macOS: VSCode desktop
      path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'github.copilot', 'hosts.json'),
      path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'github.copilot', 'token.json'),
      // Linux: VSCode desktop
      path.join(home, '.config', 'Code', 'User', 'globalStorage', 'github.copilot', 'hosts.json'),
      path.join(home, '.config', 'Code', 'User', 'globalStorage', 'github.copilot', 'token.json'),
      // Linux: VSCode remote server
      path.join(home, '.vscode-server', 'data', 'User', 'globalStorage', 'github.copilot', 'hosts.json'),
      path.join(home, '.vscode-server', 'data', 'User', 'globalStorage', 'github.copilot', 'token.json'),
    ];

    for (const tokenPath of candidatePaths) {
      try {
        if (!fs.existsSync(tokenPath)) continue;

        const data = fs.readFileSync(tokenPath, 'utf-8');
        const parsed = JSON.parse(data);

        // hosts.json format: { "github.com": "gho_..." }
        if (tokenPath.endsWith('hosts.json')) {
          const hostToken = parsed['github.com'];
          if (hostToken) {
            if (this.debug) console.log(`[Auth] VSCode token found in ${tokenPath}`);
            return { token: hostToken, type: 'vscode' };
          }
          continue;
        }

        // token.json format: { "token": "...", "access_token": "..." }
        const token = parsed.token || parsed.access_token;
        if (token) {
          if (this.debug) console.log(`[Auth] VSCode token found in ${tokenPath}`);
          return { token, type: 'vscode', expiresAt: parsed.expiresAt };
        }
      } catch (e) {
        if (this.debug) console.log(`[Auth] Failed to read ${tokenPath}:`, e);
      }
    }

    if (this.debug) console.log('[Auth] No VSCode token found in any known location');
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
      if (fs.existsSync(this.sessionPath)) {
        fs.unlinkSync(this.sessionPath);
        if (this.debug) console.log('[Auth] Session cache cleared');
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
