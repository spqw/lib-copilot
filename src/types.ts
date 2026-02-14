/**
 * Type definitions for Copilot API
 */

export interface CopilotAuthToken {
  token: string;
  expiresAt: number;
}

export interface CompletionRequest {
  prompt: string;
  suffix?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stop?: string[];
  presencePenalty?: number;
  frequencyPenalty?: number;
}

export interface CompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: CompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface CompletionChoice {
  text: string;
  index: number;
  logprobs: null;
  finish_reason: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface CodeCompletionRequest {
  filepath: string;
  language: string;
  prefix: string;
  suffix?: string;
  indent?: string;
  max_tokens?: number;
}

export interface CodeCompletionResponse {
  completions: string[];
  indices: number[];
}

export interface StreamChunk {
  type: 'content' | 'done' | 'error';
  data: string;
}

export interface CopilotOptions {
  token?: string;
  endpoint?: string;
  model?: string;
  timeout?: number;
  debug?: boolean;
}

export interface VSCodeExtensionInfo {
  version: string;
  userAgent: string;
}
