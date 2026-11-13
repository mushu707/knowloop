import { describe, expect, it } from 'vitest';
import {
  JudgeError,
  QuestionStrict,
  deriveMistakes,
  isAnswerCorrect,
  judgeAnswer,
  nextReviewState,
  qualityOf,
} from '../index';
import type { Attempt, ErrorTag, Question } from '../index';

const base = {
  bankId: 'b_test',
  kpIds: ['kp_test'],
  origin: 'manual' as const,
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
};

const single = QuestionStrict.parse({
  ...base,
  id: 'q_single',
  type: 'single',
  stem: '这是一道单选题的题干',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
  ],
  answer: { optionId: 'b' },
}) as Question;

const multiple = QuestionStrict.parse({
  ...base,
  id: 'q_multiple',
  type: 'multiple',
  stem: '这是一道多选题的题干',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
  ],
  answer: { optionIds: ['a', 'c'] },
}) as Question;

const boolean = QuestionStrict.parse({
  ...base,
  id: 'q_boolean',
  type: 'boolean',
  stem: '这是一道判断题的题干',
  answer: { value: true },
}) as Question;

describe('判分', () => {
  it('单选：选中正确答案', () => {
    expect(isAnswerCorrect(single, { kind: 'choice', optionIds: ['b'] })).toBe(true);
  });

  it('单选：选错', () => {
    expect(isAnswerCorrect(single, { kind: 'choice', optionIds: ['a'] })).toBe(false);
    expect(isAnswerCorrect(single, { kind: 'choice', optionIds: ['a', 'b'] })).toBe(false);
  });

  it('多选：集合完全相等才算对（子集算错）', () => {
    expect(isAnswerCorrect(multiple, { kind: 'choice', optionIds: ['a', 'c'] })).toBe(true);
    expect(isAnswerCorrect(multiple, { kind: 'choice', optionIds: ['c', 'a'] })).toBe(true);
    expect(isAnswerCorrect(multiple, { kind: 'choice', optionIds: ['a'] })).toBe(false);
    expect(isAnswerCorrect(multiple, { kind: 'choice', optionIds: ['a', 'b', 'c'] })).toBe(false);
    expect(isAnswerCorrect(multiple, { kind: 'choice', optionIds: ['a', 'b'] })).toBe(false);
  });

  it('判断题', () => {
    expect(isAnswerCorrect(boolean, { kind: 'boolean', value: true })).toBe(true);
    expect(isAnswerCorrect(boolean, { kind: 'boolean', value: false })).toBe(false);
  });

  it('跳过的题不进入判分', () => {
    expect(() => judgeAnswer({ question: single, response: { kind: 'skip' } })).toThrow(JudgeError);
  });

  it('答对且自评「没底」时，判分器自身置信度下降', () => {
    const lucky = judgeAnswer({
      question: single,
      response: { kind: 'choice', optionIds: ['b'] },
      selfConfidence: 1,
    });
    expect(lucky.correct).toBe(true);
    expect(lucky.confidence).toBe(0.3);
    expect(lucky.errorTags).toEqual([]);
  });

  it('判分不猜测错因（错因由用户选）', () => {
    const wrong = judgeAnswer({ question: single, response: { kind: 'choice', optionIds: ['a'] } });
    expect(wrong.correct).toBe(false);
    expect(wrong.errorTags).toEqual([]);
    expect(wrong.gradedBy).toBe('core');
  });
});

let seq = 0;
const DAY_A = '2026-11-05T04:00:00.000Z';
const DAY_B = '2026-11-06T04:00:00.000Z';
const DAY_B_LATER = '2026-11-06T06:00:00.000Z';

function attempt(
  questionId: string,
  correct: boolean,
  opts: { at?: string; selfConfidence?: 1 | 2 | 3; errorTags?: ErrorTag[] } = {},
): Attempt {
  seq += 1;
  const at = opts.at ?? `2026-11-05T10:00:${String(seq).padStart(2, '0')}.000Z`;
  return {
    id: `a_${seq}`,
    questionId,
    bankId: 'b_test',
    sessionId: 's_1',
    mode: 'practice',
    startedAt: at,
    answeredAt: at,
    durationMs: 3000,
    response: { kind: 'choice', optionIds: ['a'] },
    grade: { correct, errorTags: opts.errorTags ?? [], gradedBy: 'core' },
    ...(opts.selfConfidence ? { selfConfidence: opts.selfConfidence } : {}),
    schemaVersion: 1,
  };
}

describe('错题派生', () => {
  it('从没答错的题不进错题本', () => {
    expect(deriveMistakes([attempt('q1', true)])).toHaveLength(0);
  });

  it('答错一次就进错题本，且未消错', () => {
    const [view] = deriveMistakes([attempt('q1', false, { errorTags: ['concept_gap'] })]);
    expect(view?.questionId).toBe('q1');
    expect(view?.wrongCount).toBe(1);
    expect(view?.resolved).toBe(false);
    expect(view?.remainingToResolve).toBe(2);
    expect(view?.topErrorTags).toEqual(['concept_gap']);
  });

  it('答对一次还不够 —— S3 起要求「隔天再答对」', () => {
    const [view] = deriveMistakes([
      attempt('q1', false, { at: DAY_A }),
      attempt('q1', true, { at: DAY_B, selfConfidence: 3 }),
    ]);
    expect(view?.resolved).toBe(false);
    expect(view?.remainingToResolve).toBe(1);
  });

  it('同一自然日连刷两次不算消错', () => {
    const [view] = deriveMistakes([
      attempt('q1', false, { at: DAY_A }),
      attempt('q1', true, { at: DAY_B, selfConfidence: 3 }),
      attempt('q1', true, { at: DAY_B_LATER, selfConfidence: 3 }),
    ]);
    expect(view?.resolved).toBe(false);
    expect(view?.remainingToResolve).toBe(1);
  });

  it('隔天再答对一次才消错', () => {
    const [view] = deriveMistakes([
      attempt('q1', false, { at: DAY_A }),
      attempt('q1', true, { at: DAY_A, selfConfidence: 3 }),
      attempt('q1', true, { at: DAY_B, selfConfidence: 3 }),
    ]);
    expect(view?.resolved).toBe(true);
    expect(view?.remainingToResolve).toBe(0);
  });

  it('蒙对既不算连击，也会打断连击 —— D5 的核心用例', () => {
    const [view] = deriveMistakes([
      attempt('q1', false, { at: DAY_A }),
      attempt('q1', true, { at: DAY_A, selfConfidence: 3 }),
      attempt('q1', true, { at: DAY_B, selfConfidence: 1 }),
      attempt('q1', true, { at: DAY_B_LATER, selfConfidence: 3 }),
    ]);
    expect(view?.resolved).toBe(false);
    expect(view?.remainingToResolve).toBe(1);
  });

  it('答对但不自评，视为有把握', () => {
    const [view] = deriveMistakes([
      attempt('q1', false, { at: DAY_A }),
      attempt('q1', true, { at: DAY_A }),
      attempt('q1', true, { at: DAY_B }),
    ]);
    expect(view?.resolved).toBe(true);
  });

  it('消错后再次答错，重新变成未消错', () => {
    const [view] = deriveMistakes([
      attempt('q1', false, { at: DAY_A }),
      attempt('q1', true, { at: DAY_A }),
      attempt('q1', true, { at: DAY_B }),
      attempt('q1', false, { at: DAY_B_LATER }),
    ]);
    expect(view?.resolved).toBe(false);
    expect(view?.wrongCount).toBe(2);
    expect(view?.remainingToResolve).toBe(2);
  });

  it('错因按出现次数排序，最多三个', () => {
    const [view] = deriveMistakes([
      attempt('q1', false, { errorTags: ['misread'] }),
      attempt('q1', false, { errorTags: ['concept_gap', 'misread'] }),
      attempt('q1', false, { errorTags: ['forgotten'] }),
    ]);
    expect(view?.wrongCount).toBe(3);
    expect(view?.topErrorTags[0]).toBe('misread');
    expect(view?.topErrorTags).toHaveLength(3);
  });

  it('未消错的排在已消错的前面', () => {
    const views = deriveMistakes([
      attempt('q_done', false, { at: DAY_A }),
      attempt('q_done', true, { at: DAY_A }),
      attempt('q_done', true, { at: DAY_B }),
      attempt('q_open', false, { at: DAY_B_LATER }),
    ]);
    expect(views.map((v) => v.questionId)).toEqual(['q_open', 'q_done']);
  });
});

describe('SM-2', () => {
  const now = new Date('2026-11-05T12:00:00.000Z');
  const gradeOf = (correct: boolean) => ({ correct, errorTags: [], gradedBy: 'core' });

  it('质量分映射', () => {
    expect(qualityOf(gradeOf(false))).toBe(1);
    expect(qualityOf(gradeOf(true), 1)).toBe(3);
    expect(qualityOf(gradeOf(true), 2)).toBe(4);
    expect(qualityOf(gradeOf(true), 3)).toBe(5);
    expect(qualityOf(gradeOf(true))).toBe(5);
  });

  it('首次答对：间隔 1 天', () => {
    const s = nextReviewState(null, {
      questionId: 'q1',
      bankId: 'b_test',
      grade: gradeOf(true),
      now,
    });
    expect(s.intervalDays).toBe(1);
    expect(s.repetitions).toBe(1);
    expect(s.dueAt).toBe('2026-11-06T12:00:00.000Z');
  });

  it('第二次答对：间隔 6 天', () => {
    const first = nextReviewState(null, { questionId: 'q1', bankId: 'b_test', grade: gradeOf(true), now });
    const second = nextReviewState(first, { questionId: 'q1', bankId: 'b_test', grade: gradeOf(true), now });
    expect(second.intervalDays).toBe(6);
    expect(second.repetitions).toBe(2);
  });

  it('第三次答对：间隔按 EF 增长', () => {
    const first = nextReviewState(null, { questionId: 'q1', bankId: 'b_test', grade: gradeOf(true), now });
    const second = nextReviewState(first, { questionId: 'q1', bankId: 'b_test', grade: gradeOf(true), now });
    const third = nextReviewState(second, { questionId: 'q1', bankId: 'b_test', grade: gradeOf(true), now });
    expect(third.intervalDays).toBe(Math.round(6 * second.ef));
    expect(third.repetitions).toBe(3);
  });

  it('答错：重置连击，记录 lapse，间隔回到 1 天', () => {
    const first = nextReviewState(null, { questionId: 'q1', bankId: 'b_test', grade: gradeOf(true), now });
    const second = nextReviewState(first, { questionId: 'q1', bankId: 'b_test', grade: gradeOf(false), now });
    expect(second.repetitions).toBe(0);
    expect(second.lapses).toBe(1);
    expect(second.intervalDays).toBe(1);
  });

  it('EF 有下限 1.3（连续答错也不会突破）', () => {
    let state = null as ReturnType<typeof nextReviewState> | null;
    for (let i = 0; i < 12; i += 1)
      state = nextReviewState(state, { questionId: 'q1', bankId: 'b_test', grade: gradeOf(false), now });
    expect(state?.ef).toBe(1.3);
  });
});
