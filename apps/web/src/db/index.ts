import Dexie, { type Table } from 'dexie';
import type {
  Attempt,
  Chunk,
  Document as KnowledgeDoc,
  EmbeddingRow,
  GenerationJob,
  KpNode,
  ProviderConfig,
  Question,
  ReviewState,
} from '@knowloop/core';

export interface BankRow {
  id: string;
  name: string;
  version: string;
  author?: string;
  license: string;
  description?: string;
  questionCount: number;
  importedAt: string;
  updatedAt: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * 表结构严格对齐 docs/DATA-CONTRACT.md §12。
 * 注意：没有 mistakes 表 —— 错题是 attempts 的派生视图（D4）。
 */
class KnowloopDB extends Dexie {
  banks!: Table<BankRow, string>;
  kpNodes!: Table<KpNode, string>;
  questions!: Table<Question, string>;
  attempts!: Table<Attempt, string>;
  reviewStates!: Table<ReviewState, string>;
  documents!: Table<KnowledgeDoc, string>;
  chunks!: Table<Chunk, string>;
  embeddings!: Table<EmbeddingRow, string>;
  jobs!: Table<GenerationJob, string>;
  providers!: Table<ProviderConfig, string>;
  settings!: Table<SettingRow, string>;

  constructor() {
    super('knowloop');
    this.version(1).stores({
      banks: 'id, name, updatedAt',
      kpNodes: 'id, bankId, parentId, [bankId+parentId]',
      questions: 'id, bankId, type, *kpIds, updatedAt, [bankId+type]',
      attempts:
        'id, questionId, bankId, sessionId, answeredAt, [questionId+answeredAt], [bankId+answeredAt]',
      reviewStates: 'questionId, bankId, dueAt',
      documents: 'id, sha256, importedAt, status',
      chunks: 'id, docId, [docId+index]',
      embeddings: 'chunkId, modelId',
      jobs: 'id, createdAt, status',
      providers: 'id, kind',
      settings: 'key',
    });
  }
}

export const db = new KnowloopDB();
