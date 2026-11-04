import { z } from 'zod';
import { Id } from './common';

export const ProviderConfig = z.object({
  id: Id,
  label: z.string().min(1).max(40),
  kind: z.enum(['openai-compatible', 'ollama']),
  baseUrl: z.string().min(1).max(2000),
  model: z.string().min(1),
  /** ⚠️ 明文存于 IndexedDB，UI 必须声明这一点 */
  apiKey: z.string().optional(),
  capabilities: z.object({
    chat: z.boolean().default(true),
    jsonMode: z.boolean().default(false),
    streaming: z.boolean().default(true),
  }),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonSchema?: unknown;
}

export interface ChatResponse {
  content: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/**
 * v0.1 只有出题需要模型。embedding 是本地固定实现，不做抽象
 * （抽象只在有 ≥2 个实现时才值钱，见 docs/DECISIONS.md D9）。
 */
export interface ModelProvider {
  readonly config: ProviderConfig;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
