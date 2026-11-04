import { z } from 'zod';
import { Id, Iso, Sha256Hex } from './common';
import { QuestionType } from './question';

/**
 * v0.1 只支持纯文本与 Markdown。PDF 在 v0.2 扩展（见 docs/DECISIONS.md D11）。
 * 网址类材料不直接抓取（纯前端受 CORS 限制），统一走「粘贴正文 + 选填来源 URL」。
 */
export const DocumentMime = z.enum(['text/plain', 'text/markdown']);
export type DocumentMime = z.infer<typeof DocumentMime>;

export const Document = z.object({
  id: Id,
  name: z.string().min(1),
  title: z.string().max(200).optional(),
  mime: DocumentMime,
  bytes: z.number().int().positive(),
  sha256: Sha256Hex,
  sourceUrl: z.string().max(2000).optional(),
  importedAt: Iso,
  status: z.enum(['parsing', 'ready', 'failed']),
  error: z.string().optional(),
});
export type Document = z.infer<typeof Document>;

export const Chunk = z.object({
  id: Id,
  docId: Id,
  index: z.number().int().nonnegative(),
  text: z.string().min(1),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  headingPath: z.array(z.string()).default([]),
});
export type Chunk = z.infer<typeof Chunk>;

export const EmbeddingRow = z.object({
  chunkId: Id,
  modelId: z.string().min(1),
  dim: z.number().int().positive(),
  vector: z.instanceof(ArrayBuffer),
});
export type EmbeddingRow = z.infer<typeof EmbeddingRow>;

export const GenerationParams = z.object({
  count: z.number().int().min(1).max(30).default(10),
  types: z.array(QuestionType).min(1).default(['single']),
  difficulty: z.number().int().min(1).max(5).default(3),
  language: z.enum(['zh', 'en']).default('zh'),
  strictMode: z.boolean().default(true),
});
export type GenerationParams = z.infer<typeof GenerationParams>;

export const GenerationJob = z.object({
  id: Id,
  documentIds: z.array(Id).min(1),
  params: GenerationParams,
  providerId: Id,
  status: z.enum(['queued', 'running', 'done', 'partial', 'failed']),
  createdAt: Iso,
  finishedAt: Iso.optional(),
  producedQuestionIds: z.array(Id).default([]),
  stats: z.object({
    attempted: z.number().int().nonnegative().default(0),
    accepted: z.number().int().nonnegative().default(0),
    rejectedBySchema: z.number().int().nonnegative().default(0),
    rejectedAsDuplicate: z.number().int().nonnegative().default(0),
    rejectedNoSource: z.number().int().nonnegative().default(0),
  }),
  error: z.string().optional(),
});
export type GenerationJob = z.infer<typeof GenerationJob>;
