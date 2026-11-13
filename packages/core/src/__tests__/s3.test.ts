import { describe, expect, it } from 'vitest';
import { QuestionStrict, buildTodayQueue, computeKpStats, rankWeakKps } from '../index';
import type { Attempt, KpNode, Question, ReviewState } from '../index';

const NOW = new Date('2026-11-10T12:00:00.000Z');

function question(id: string, kpIds: string[]): Question {
  return QuestionStrict.parse({
    id,
    bankId: 'b_test',
    type: 'boolean',
    stem: `题目 ${id} 的题干`,
    kpIds,
    origin: 'manual',
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    answer: { value: true },
  }) as Question;
}

let seq = 0;
function attempt(questionId: string, correct: boolean): Attempt {
  seq += 1;
  const at = `2026-11-09T10:00:${String(seq).padStart(2, '0')}.000Z`;
  return {
    id: `a_${seq}`,
    questionId,
    bankId: 'b_test',
    sessionId: 's_1',
    mode: 'practice',
    startedAt: at,
    answeredAt: at,
    durationMs: 1000,
    response: { kind: 'boolean', value: true },
    grade: { correct, errorTags: [], gradedBy: 'core' },
    schemaVersion: 1,
  };
}

function reviewState(questionId: string, dueAt: string, repetitions = 1): ReviewState {
  return {
    questionId,
    bankId: 'b_test',
    ef: 2.5,
    intervalDays: 1,
    repetitions,
    lapses: 0,
    dueAt,
    lastReviewedAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-09T10:00:00.000Z',
  };
}

const KP_NODES: KpNode[] = [
  { id: 'kp_root', bankId: 'b_test', parentId: null, name: '前端面试', order: 0, aliases: [] },
  { id: 'kp_js', bankId: 'b_test', parentId: 'kp_root', name: 'JavaScript', order: 1, aliases: [] },
  { id: 'kp_loop', bankId: 'b_test', parentId: 'kp_js', name: '事件循环', order: 2, aliases: [] },
  { id: 'kp_proto', bankId: 'b_test', parentId: 'kp_js', name: '原型链', order: 3, aliases: [] },
];

describe('知识点统计', () => {
  const questions = [question('q_loop', ['kp_loop']), question('q_proto', ['kp_proto'])];
  const attempts = [
    attempt('q_loop', false),
    attempt('q_loop', false),
    attempt('q_loop', false),
    attempt('q_proto', true),
  ];

  const stats = computeKpStats({ attempts, questions, kpNodes: KP_NODES });

  it('叶子节点只统计自己的作答', () => {
    const loop = stats.get('kp_loop');
    expect(loop?.attempts).toBe(3);
    expect(loop?.wrong).toBe(3);
    expect(loop?.rawRate).toBe(1);
    expect(loop?.eligible).toBe(true);
  });

  it('父节点是分子分母分别累加，不是比率平均', () => {
    const js = stats.get('kp_js');
    expect(js?.attempts).toBe(4);
    expect(js?.wrong).toBe(3);
    // 比率平均会得到 (1 + 0) / 2 = 0.5，累加才是 0.75
    expect(js?.rawRate).toBeCloseTo(0.75, 5);
  });

  it('根节点等于全部累加', () => {
    const root = stats.get('kp_root');
    expect(root?.attempts).toBe(4);
    expect(root?.wrong).toBe(3);
  });

  it('平滑错误率把少样本向 50% 收缩', () => {
    const loop = stats.get('kp_loop'); // 3 次全错
    const proto = stats.get('kp_proto'); // 1 次全对
    expect(loop?.smoothedRate).toBeCloseTo(4 / 5, 5);
    expect(proto?.smoothedRate).toBeCloseTo(1 / 3, 5);
  });

  it('从没做过题的知识点平滑后是 50%，不是 0%', () => {
    const idle = computeKpStats({
      attempts,
      questions: [...questions, question('q_idle', ['kp_idle'])],
      kpNodes: [...KP_NODES, { id: 'kp_idle', bankId: 'b_test', parentId: 'kp_js', name: '闭包', order: 4, aliases: [] }],
    });
    expect(idle.get('kp_idle')?.attempts).toBe(0);
    expect(idle.get('kp_idle')?.smoothedRate).toBe(0.5);
  });

  it('榜单只收叶子节点，父节点不进榜', () => {
    const ranked = rankWeakKps(stats, KP_NODES);
    expect(ranked.map((r) => r.kpId)).toEqual(['kp_loop']);
    expect(ranked.some((r) => r.kpId === 'kp_js' || r.kpId === 'kp_root')).toBe(false);
  });

  it('样本不足的知识点进不了榜', () => {
    const ranked = rankWeakKps(stats, KP_NODES);
    expect(ranked.some((r) => r.kpId === 'kp_proto')).toBe(false);
  });

  it('一题挂多个知识点时各计一次，不做分摊', () => {
    const multi = computeKpStats({
      attempts: [attempt('q_multi', false)],
      questions: [question('q_multi', ['kp_loop', 'kp_proto'])],
      kpNodes: KP_NODES,
    });
    expect(multi.get('kp_loop')?.attempts).toBe(1);
    expect(multi.get('kp_proto')?.attempts).toBe(1);
    // 父节点收到两次（两个子节点各一次），这是"不分摊"的直接后果
    expect(multi.get('kp_js')?.attempts).toBe(2);
  });
});

describe('今日队列', () => {
  const many = Array.from({ length: 25 }, (_, i) => question(`q_${String(i).padStart(2, '0')}`, ['kp_loop']));

  it('全新题库也能开练：全走新题配额', () => {
    const q = buildTodayQueue({ questions: many, reviewStates: [], now: NOW });
    expect(q.dueTotal).toBe(0);
    expect(q.newTotal).toBe(25);
    expect(q.items).toHaveLength(20);
    expect(q.newCount).toBe(20);
    expect(q.reviewCount).toBe(0);
    expect(q.truncated).toBe(true);
  });

  it('到期题优先，剩余名额补新题', () => {
    const due = many.slice(0, 3).map((item) => reviewState(item.id, '2026-11-09T00:00:00.000Z'));
    const q = buildTodayQueue({ questions: many, reviewStates: due, now: NOW });
    expect(q.dueTotal).toBe(3);
    expect(q.reviewCount).toBe(3);
    expect(q.newCount).toBe(17);
    expect(q.items.filter((i) => i.kind === 'review')).toHaveLength(3);
  });

  it('未到期的题不进队列，也不算新题', () => {
    const future = many.slice(0, 5).map((item) => reviewState(item.id, '2026-12-01T00:00:00.000Z'));
    const q = buildTodayQueue({ questions: many, reviewStates: future, now: NOW });
    expect(q.dueTotal).toBe(0);
    expect(q.newTotal).toBe(20);
  });

  it('还没学会的题（repetitions 0）立刻回到队列，不看 dueAt', () => {
    const relearn = many.slice(0, 4).map((item) => reviewState(item.id, '2026-12-01T00:00:00.000Z', 0));
    const q = buildTodayQueue({ questions: many, reviewStates: relearn, now: NOW });
    expect(q.dueTotal).toBe(4);
    expect(q.reviewCount).toBe(4);
  });

  it('名额够时全部给出，不截断', () => {
    const few = many.slice(0, 8);
    const q = buildTodayQueue({ questions: few, reviewStates: [], now: NOW });
    expect(q.items).toHaveLength(8);
    expect(q.truncated).toBe(false);
  });

  it('每日上限可配置', () => {
    const q = buildTodayQueue({
      questions: many,
      reviewStates: [],
      now: NOW,
      limits: { dailyMax: 5, newRatio: 0.3 },
    });
    expect(q.items).toHaveLength(5);
  });
});
