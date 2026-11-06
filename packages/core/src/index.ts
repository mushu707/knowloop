export { SCHEMA_VERSION, Iso, Id, Sha256Hex, Semver } from './schema/common';
export { KpNode } from './schema/kp';
export { Question, QuestionStrict, QuestionType, Option, SourceRef } from './schema/question';
export type { SingleQuestion, MultipleQuestion, BooleanQuestion } from './schema/question';
export { ErrorTag, ERROR_TAG_LABEL, GradeResult, GradeResultStrict } from './schema/grade';
export { Attempt, AnswerResponse } from './schema/attempt';
export { ReviewState } from './schema/review';
export { Document, DocumentMime, Chunk, EmbeddingRow, GenerationParams, GenerationJob } from './schema/rag';
export { ProviderConfig } from './schema/provider';
export type { ChatMessage, ChatRequest, ChatResponse, ModelProvider } from './schema/provider';
export { PluginManifest } from './schema/plugin';
export { BankPack } from './schema/pack';

export {
  normalizeText,
  sortKeysDeep,
  questionPayload,
  questionContentId,
  packChecksum,
  sha256HexUtf8,
} from './canonical';
export type { QuestionContent } from './canonical';

export { lintQuestion } from './lint/question';
export type { LintNotice } from './lint/question';

export { judgeAnswer, isAnswerCorrect, JudgeError } from './grade/judge';
export type { JudgeInput } from './grade/judge';

export { deriveMistakes, isLuckyGuess } from './derive/mistake';
export type { MistakeView } from './derive/mistake';

export { nextReviewState, qualityOf } from './scheduler/sm2';
export type { Quality, NextReviewInput } from './scheduler/sm2';
