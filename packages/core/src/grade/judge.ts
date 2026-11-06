import type { AnswerResponse } from '../schema/attempt';
import type { GradeResult } from '../schema/grade';
import type { Question } from '../schema/question';

export class JudgeError extends Error {}

/**
 * 判分。纯函数，无 IO —— 这是核心指标可信度的来源。
 *
 * 多选采用「集合完全相等」：少选、多选、错选都为错。
 * 不引入部分得分（见 docs/DECISIONS.md D13）——错题率只有在二值判分时才可信。
 */
export function isAnswerCorrect(question: Question, response: AnswerResponse): boolean {
  if (response.kind === 'skip') return false;

  switch (question.type) {
    case 'single':
      return (
        response.kind === 'choice' &&
        response.optionIds.length === 1 &&
        response.optionIds[0] === question.answer.optionId
      );

    case 'multiple': {
      if (response.kind !== 'choice') return false;
      const picked = new Set(response.optionIds);
      const expected = new Set(question.answer.optionIds);
      if (picked.size !== expected.size) return false;
      for (const id of expected) if (!picked.has(id)) return false;
      return true;
    }

    case 'boolean':
      return response.kind === 'boolean' && response.value === question.answer.value;
  }
}

export interface JudgeInput {
  question: Question;
  response: AnswerResponse;
  selfConfidence?: 1 | 2 | 3;
}

/**
 * 判分并生成 GradeResult。
 * 错因不在这里推断——它是用户看完解析后自己选的，由调用方在落库前补进去。
 */
export function judgeAnswer({ question, response, selfConfidence }: JudgeInput): GradeResult {
  if (response.kind === 'skip') throw new JudgeError('跳过的题不写作答记录，不应进入判分');

  const correct = isAnswerCorrect(question, response);
  const result: GradeResult = { correct, errorTags: [], gradedBy: 'core' };

  // 答对但自评"没底" → 判分器对这次"正确"本身也不信
  if (correct && selfConfidence === 1) result.confidence = 0.3;

  return result;
}
