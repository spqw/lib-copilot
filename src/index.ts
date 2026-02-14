/**
 * lib-copilot - Direct Copilot API access library
 * 
 * A comprehensive library for interacting with GitHub Copilot programmatically,
 * mimicking the VSCode extension behavior.
 * 
 * @example
 * ```typescript
 * import { CopilotClient, CopilotAuth } from 'lib-copilot';
 * 
 * // Authenticate
 * const auth = new CopilotAuth();
 * const token = await auth.getToken();
 * 
 * // Create client
 * const copilot = new CopilotClient({ token, debug: true });
 * 
 * // Chat
 * const response = await copilot.chat({
 *   messages: [{ role: 'user', content: 'Hello' }],
 * });
 * console.log(response.choices[0].message.content);
 * ```
 */

export { CopilotClient } from './client';
export { CopilotAuth } from './auth';
export * from './types';
