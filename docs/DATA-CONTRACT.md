# knowloop · 数据契约 v1

> 状态：S0 冻结 · 2026-11-03
> **这份文件是项目里唯一不许 Agent 自由发挥的东西。** S1 起，Agent 只能实现它，不能改它的形状；改形状必须走 §13 的迁移流程。
> 落地位置：`packages/core/src/schema/*.ts`，依赖 `zod@^4`。

---

## 0. 三条元规则

1. **一份 schema 三个用途**：TS 类型、导入 JSON 校验、LLM 输出校验。所以它必须是 Zod，不许手写 interface。
2. **不可逆的字段先定，可逆的后定**。题目标识、错因词表、作答记录结构属于前者。
3. **凡是能算出来的，不存**。错题、错题率、掌握度全部从尝试记录推导，不落库。这条决定了后面所有统计口径能不能统一。

---

## 1. 基础类型

```ts
// packages/core/src/schema/common.ts
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

/** 统一 UTC ISO8601，展示层再转本地时区 */
export const Iso = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
  '必须是 UTC ISO8601，形如 2026-11-03T08:00:00.000Z',
);

export const Id = z.string().min(1).max(64);
export const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
export const Semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i);
```

**ID 生成规则**（不是随便的 UUID，各有理由）：

| 实体 | 格式 | 理由 |
|---|---|---|
| `Question` | `q_` + `sha256(canonical)` 前 16 位 | 同内容必然同 id → 跨题库去重、市场 fork 合并、重复生成自动拦截 |
| `Attempt` | `a_` + base36 时间戳 + 4 位随机 | 必须唯一，无需确定性 |
| `Document` | `d_` + `sha256(文件字节)` 前 12 位 | 同一个文件重复导入直接命中已有文档 |
| `Chunk` | `c_` + `sha256(docId + ':' + index)` 前 12 位 | 重解析同一文档得到同一批 chunk id，embedding 可复用 |
| `KpNode` | `kp_` + `sha256(bankId + '/' + 名称路径)` 前 12 位 | 路径稳定 → 重命名检测、导入合并 |
| `BankPack` | `b_` + `sha256(author + ':' + name)` 前 12 位 | 作者+名稳定 |

**题目 canonical 化规则**（决定 contentHash，必须精确）：

```
对 stem 与每个 option.text 依次做：
1. 换行统一：\r\n / \r → \n
2. 逐行处理：行首行尾空白去掉，行内连续空格与 Tab 压成单个空格
3. 连续 3 个以上换行折叠成 2 个（保留段落，但不让空行影响哈希）
4. 整体再去一次首尾空白

然后组装 payload：
5. options 保持原顺序（顺序影响作答体验，视为内容的一部分）
6. boolean 题的 options 记为 null
7. payload 只含 {type, stem, options[].text, answer}
   —— 不含 id / bankId / tags / kpIds / source / extensions / explanation
8. JSON.stringify 时所有层级的 key 按字典序递归排序
9. UTF-8 编码后 sha256，取前 16 位十六进制，加前缀 q_
```

> 可执行版本：`scripts/gen-fixture.mjs` 的 `norm()` / `sortKeys()` / `questionId()`。
> **两者不一致时以本文档为准，并修脚本。** 第 3 步（保留段落而非拍平）是刻意的——题干里的代码块必须保持行结构，否则改一个缩进就换 id。

> 第 4 条是关键取舍：改了标签或知识点，题目 id 不变，避免已有作答记录变成孤儿。改题干或答案才产生新题。

---

## 2. 知识树

知识点不复用标签系统，单独建树。**标签是平的，知识点是树，错题率要能沿着树向上聚合。**

```ts
// packages/core/src/schema/kp.ts
export const KpNode = z.object({
  id: Id,
  bankId: Id,
  parentId: Id.nullable(),        // 根节点为 null
  name: z.string().min(1).max(60),
  order: z.number().int().nonnegative().default(0),
  aliases: z.array(z.string().min(1)).max(8).default([]),  // 供 RAG 出题时匹配原文
});

export type KpNode = z.infer<typeof KpNode>;
```

**约束**：同一 `bankId` 内 `name` 在同层级唯一；最多 4 层（超过说明你在用它当标签）。

---

## 3. 题目

```ts
// packages/core/src/schema/question.ts
export const QuestionType = z.enum(['single', 'multiple', 'boolean']);
export type QuestionType = z.infer<typeof QuestionType>;

export const Option = z.object({
  id: Id,                       // 'a' | 'b' | ... 小写单字母
  text: z.string().min(1),
});

export const SourceRef = z.object({
  docId: Id,
  chunkIds: z.array(Id).min(1),   // 至少一个出处，禁止无源题（AI 生成时强制）
  page: z.number().int().positive().optional(),
  charStart: z.number().int().nonnegative().optional(),
  charEnd: z.number().int().nonnegative().optional(),
});

const QuestionBase = z.object({
  id: Id,
  bankId: Id,
  stem: z.string().min(4).max(2000),          // Markdown 允许
  explanation: z.string().max(4000).optional(),
  kpIds: z.array(Id).min(1).max(6),           // 一题最多挂 6 个知识点
  difficulty: z.number().int().min(1).max(5).default(3),
  tags: z.array(z.string().min(1).max(24)).max(12).default([]),
  source: SourceRef.optional(),               // manual 题可以没有
  origin: z.enum(['manual', 'import', 'ai']),
  extensions: z.record(z.string(), z.unknown()).default({}),  // 行业扩展插槽，v0.2
  createdAt: Iso,
  updatedAt: Iso,
  schemaVersion: z.number().int().positive().default(SCHEMA_VERSION),
});

export const Question = z.discriminatedUnion('type', [
  QuestionBase.extend({
    type: z.literal('single'),
    options: z.array(Option).min(2).max(8),
    answer: z.object({ optionId: Id }),
  }),
  QuestionBase.extend({
    type: z.literal('multiple'),
    options: z.array(Option).min(2).max(8),
    answer: z.object({ optionIds: z.array(Id).min(2) }),   // 多选至少 2 个正确项，否则应降级为单选
  }),
  QuestionBase.extend({
    type: z.literal('boolean'),
    answer: z.object({ value: z.boolean() }),              // 无 options，UI 固定渲染 对/错
  }),
]);

export type Question = z.infer<typeof Question>;
```

**跨字段校验**（union 之上必须补，Zod 不会替你做）：

```ts
export const QuestionStrict = Question.superRefine((q, ctx) => {
  if (q.type === 'single') {
    if (!q.options.some((o) => o.id === q.answer.optionId))
      ctx.addIssue({ code: 'custom', message: 'answer.optionId 不在 options 中', path: ['answer'] });
  }
  if (q.type === 'multiple') {
    const ids = new Set(q.options.map((o) => o.id));
    for (const a of q.answer.optionIds)
      if (!ids.has(a))
        ctx.addIssue({ code: 'custom', message: `answer.optionIds 含未知 id: ${a}`, path: ['answer'] });
    if (new Set(q.answer.optionIds).size !== q.answer.optionIds.length)
      ctx.addIssue({ code: 'custom', message: 'answer.optionIds 有重复', path: ['answer'] });
  }
  if (q.options && new Set(q.options.map((o) => o.id)).size !== q.options.length)
    ctx.addIssue({ code: 'custom', message: 'options.id 有重复', path: ['options'] });
  if (q.origin === 'ai' && !q.source)
    ctx.addIssue({ code: 'custom', message: 'AI 生成的题必须带 source', path: ['source'] });
});
```

---

## 4. 题库包（导入 / 导出 / 未来市场的最小分发单元）

```ts
// packages/core/src/schema/pack.ts
export const BankPack = z.object({
  schemaVersion: z.number().int().positive(),
  id: Id,
  name: z.string().min(1).max(80),
  version: Semver,
  author: z.string().max(80).optional(),
  license: z.string().max(40).default('AGPL-3.0'),
  description: z.string().max(500).optional(),
  createdAt: Iso,
  kpTree: z.array(KpNode),
  questions: z.array(Question).min(1),
  checksum: Sha256Hex.optional(),   // 对 canonical 化后的 {kpTree, questions} 求 sha256
});
```

**导入器必须做的四件事**（写成代码就是 import 的唯一入口）：

1. 逐题 `QuestionStrict.safeParse`，失败的题收集到 `rejected[]` 并报告，不阻塞整体导入。
2. **重写 `bankId` 与内部所有引用**（kpIds 要按名称路径重新映射到本地知识树，不能直接信任包内 id）。
3. 用 canonical hash **重算 `id`**，与库内已有题撞 id 的按"内容相同"处理（提示合并，不覆盖作答记录）。
4. 记录 `origin = 'import'`，保留原 `author` 到 `extensions.__importMeta`。

---

## 5. 判分结果与错因

判分器的输出必须是这一个结构，**插件、核心、LLM 判分共用**。

```ts
// packages/core/src/schema/grade.ts
export const ErrorTag = z.enum([
  'concept_gap',      // 概念不清：完全不知道考点
  'confusion',        // 概念混淆：知道但和另一个搞混了
  'misread',          // 审题失误：题看错了
  'forgotten',        // 记忆衰退：以前会，现在忘了
  'lucky_guess',      // 蒙对：答案对但自评没把握
  'time_pressure',    // 时间压力：会但来不及
  'careless',         // 手滑
  'other',
]);
export type ErrorTag = z.infer<typeof ErrorTag>;

export const GradeResult = z.object({
  correct: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),   // 判分器自身的置信度
  errorTags: z.array(ErrorTag).max(3).default([]),
  gradedBy: z.string().min(1),                        // 'core' | 'plugin:<id>' | 'llm'
});
```

**为什么错因是受控词表而不是自由文本**：同一个错误换个说法就统计不到一起。八种足够，宁可粗也不要散。`lucky_guess` 单独存在是因为**蒙对会污染掌握度**——它必须依赖用户自评"这题我有没有把握"，UI 上答对后追问一次。

**`correct` 与 `errorTags` 的约束**：`correct === true` 时，`errorTags` 只允许 `['lucky_guess']` 或空。

---

## 6. 作答记录（唯一真相源，只追加）

```ts
// packages/core/src/schema/attempt.ts
export const AnswerResponse = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), optionIds: z.array(Id) }),  // single 也是长度 1 的数组
  z.object({ kind: z.literal('boolean'), value: z.boolean() }),
  z.object({ kind: z.literal('skip') }),
]);

export const Attempt = z.object({
  id: Id,
  questionId: Id,
  bankId: Id,
  sessionId: Id,
  mode: z.enum(['practice', 'review', 'exam']),
  startedAt: Iso,
  answeredAt: Iso,
  durationMs: z.number().int().nonnegative(),
  response: AnswerResponse,
  grade: GradeResult,
  selfConfidence: z.number().int().min(1).max(3).optional(),  // 1 没底 2 一般 3 很确定
  schemaVersion: z.number().int().positive().default(SCHEMA_VERSION),
});
```

**硬约束**：

- `attempts` 表**只 INSERT，永不 UPDATE / DELETE**。改判（比如发现答案录错了）也必须追加一条 `mode` 相同、`grade.gradedBy='correction'` 的纠正记录。
- 删除题库不物理删除 attempts，只把 bank 标记 `archived`，否则历史统计会凭空蒸发。
- `sessionId` 用于把一次连续刷题归组，同时支撑"连续使用 N 天"这个成功指标。

---

## 7. 错题 = 派生视图，不落库

**这是全项目最重要的一个决定。** 一旦建 `mistakes` 表，就会出现"错题表"和"尝试表"两份数据不一致，而错题率是你的核心指标。

```ts
// packages/core/src/derive/mistake.ts  —— 纯函数，无 IO，可单测
export interface MistakeView {
  questionId: string;
  wrongCount: number;      // 历史错误次数
  lastWrongAt: string;
  resolved: boolean;       // 最近一次作答已正确
  topErrorTags: ErrorTag[];
}

/** 错题本 = 按 questionId 折叠 attempts */
export function deriveMistakes(attempts: Attempt[]): MistakeView[] {
  const byQ = new Map<string, Attempt[]>();
  for (const a of attempts) (byQ.get(a.questionId) ?? byQ.set(a.questionId, []).get(a.questionId)!).push(a);

  const out: MistakeView[] = [];
  for (const [questionId, list] of byQ) {
    const sorted = [...list].sort((x, y) => x.answeredAt.localeCompare(y.answeredAt));
    const wrong = sorted.filter((a) => !a.grade.correct);
    if (wrong.length === 0) continue;
    const last = sorted.at(-1)!;
    out.push({
      questionId,
      wrongCount: wrong.length,
      lastWrongAt: wrong.at(-1)!.answeredAt,
      resolved: last.grade.correct,
      topErrorTags: topN(wrong.flatMap((a) => a.grade.errorTags), 3),
    });
  }
  return out;
}
```

**错题率的口径（写死，不许各页面自己算）**：

```
kpWrongRate(kpId, window?) =
  count(attempt 满足 grade.correct = false 且其 question 的 kpIds 包含 kpId)
  ────────────────────────────────────────────────────────────────
  count(attempt 满足其 question 的 kpIds 包含 kpId)

分母是「作答次数」，不是「题目数」。
一题挂多个知识点时，该次作答对每个知识点各计一次（不做 1/N 分摊）。
```

多知识点不分摊的理由：分摊会让"挂了 5 个知识点的题"对每个知识点的贡献只有 0.2，薄弱项永远浮不上来。宁可让统计略偏高，也要让排序可信。

父节点聚合：自底向上加权求和（子节点分母相加做分子分母分别累加，不是比率平均）。

---

## 8. 复习调度状态

SM-2 的状态可以完整重建，但仍落库——因为它是**算法状态**不是**派生物**，重建要靠跑完整历史调度，没必要。

```ts
// packages/core/src/schema/review.ts
export const ReviewState = z.object({
  questionId: Id,           // 主键（单用户本地，无需 userId）
  bankId: Id,
  ef: z.number().min(1.3).max(2.8),        // easiness factor，SM-2 初始 2.5
  intervalDays: z.number().int().nonnegative(),
  repetitions: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),  // 从「已掌握」跌落的次数
  dueAt: Iso,
  lastReviewedAt: Iso.nullable(),
  updatedAt: Iso,
});
```

调度规则集中在 `packages/core/src/scheduler/sm2.ts`，纯函数：`(state, grade) => state`。**不许在 UI 层写调度逻辑。**

---

## 9. RAG 侧

```ts
// packages/core/src/schema/rag.ts
/** v0.1 只吃纯文本与 Markdown。PDF 是 v0.2（DECISIONS D11） */
export const Document = z.object({
  id: Id,
  name: z.string().min(1),
  title: z.string().max(200).optional(),
  mime: z.enum(['text/plain', 'text/markdown']),
  bytes: z.number().int().positive(),
  sha256: Sha256Hex,
  sourceUrl: z.string().max(2000).optional(),   // 只存字符串，绝不去抓
  importedAt: Iso,
  status: z.enum(['parsing', 'ready', 'failed']),
  error: z.string().optional(),
});

export const Chunk = z.object({
  id: Id,
  docId: Id,
  index: z.number().int().nonnegative(),
  text: z.string().min(1),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  page: z.number().int().positive().optional(),
  headingPath: z.array(z.string()).default([]),   // 段落感知分块时记录所属标题路径
});

/** embedding 单独表，只有 blob 和元信息 */
export const EmbeddingRow = z.object({
  chunkId: Id,
  modelId: z.string().min(1),        // 例如 'bge-small-zh-v1.5'
  dim: z.number().int().positive(),  // 512
  vector: z.instanceof(ArrayBuffer),
});

export const GenerationParams = z.object({
  count: z.number().int().min(1).max(30).default(10),
  types: z.array(QuestionType).min(1).default(['single']),
  difficulty: z.number().int().min(1).max(5).default(3),
  language: z.enum(['zh', 'en']).default('zh'),
  strictMode: z.boolean().default(true),   // true = 只依据库内原文，禁止模型自身知识
});

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
```

> `stats` 里的四个 rejected 计数不是装饰。S5 评估时，**"生成 10 道题丢弃 6 道"和"生成 10 道题全接受"是两种完全不同的产品**，你需要知道丢在哪一步。

---

## 10. 模型 Provider 契约（v0.1 就要有）

```ts
// packages/core/src/schema/provider.ts
export const ProviderConfig = z.object({
  id: Id,
  label: z.string().min(1).max(40),
  kind: z.enum(['openai-compatible', 'ollama']),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().optional(),      // ⚠️ 明文存 IndexedDB，UI 必须声明
  capabilities: z.object({
    chat: z.boolean().default(true),
    jsonMode: z.boolean().default(false),   // 不支持时走「提示词约束 + Zod 重试」
    streaming: z.boolean().default(true),
  }),
});

export interface ModelProvider {
  readonly config: ProviderConfig;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
```

**embedding 不走这个接口**——它是本地固定实现（Transformers.js + bge-small-zh），没有第二个实现就不做抽象。这是有意的：**抽象只在有 ≥2 个实现时才值钱。**

---

## 11. 插件 manifest（v0.2 插槽，v0.1 只留形状）

v0.1 不实现插件运行时，但 `extensions` 字段和这个类型定义现在就写进契约，避免 v0.2 改 schema。

```ts
// packages/core/src/schema/plugin.ts
export const PluginManifest = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  version: Semver,
  apiVersion: z.literal('0.1'),
  inject: z.array(z.string()).default([]),        // ['rag', 'wrongbook', 'scheduler']
  extends: z.object({
    questionFields: z.record(z.string(), z.unknown()).optional(),  // JSON Schema 片段
    errorTags: z.array(z.object({ id: Id, label: z.string() })).default([]),
    kpTreeUrl: z.string().url().optional(),
  }).default({ errorTags: [] }),
  graders: z.array(z.object({
    type: z.string(),          // 扩展题型名
    entry: z.string(),         // 模块路径，在 Worker 内加载
  })).default([]),
});
```

**安全边界（v0.2 实施时的前提，先记下）**：插件代码只在 Web Worker 中运行，通过 RPC 暴露受限 API，拿不到 DOM、拿不到 IndexedDB 直连、拿不到用户文档原文。它只能调宿主给的函数。

---

## 12. IndexedDB 表结构

```ts
// packages/app/src/db/index.ts
db.version(1).stores({
  banks:        'id, name, archived, updatedAt',
  kpNodes:      'id, bankId, parentId, [bankId+parentId]',
  questions:    'id, bankId, type, *kpIds, updatedAt, [bankId+type]',
  attempts:     'id, questionId, bankId, sessionId, answeredAt, [questionId+answeredAt], [bankId+answeredAt]',
  reviewStates: 'questionId, bankId, dueAt',
  documents:    'id, sha256, importedAt, status',
  chunks:       'id, docId, [docId+index]',
  embeddings:   'chunkId, modelId',
  jobs:         'id, createdAt, status',
  providers:    'id, kind',
  settings:     'key',
});
```

**注意没有 `mistakes` 表。** 第一次看到会觉得性能有问题——十万条 attempts 做全表折叠确实慢。解法是内存缓存 + 按 `bankId` 分片重算，不是加一张会漂移的表。

---

## 13. 不变量（写进 CI 的 checklist）

1. `attempts` 只追加，无 UPDATE/DELETE 路径。
2. 任何错题率、掌握度、薄弱排序，必须调用 `derive/*` 里的函数，不许在组件内现算。
3. `question.id` 必须等于 canonical contentHash，导入/生成时重算校验。
4. 所有时间戳为 UTC ISO8601，展示层才转本地。
5. `origin === 'ai'` 的题必须带 `source.chunkIds`，且 chunk 必须存在。
6. LLM 返回必须过 `QuestionStrict`；失败重试 ≤2 次，仍失败则计入 `rejectedBySchema` 并丢弃，**不许"修正一下凑合用"**。
7. `extensions` 不得改变核心字段语义，只做加法。
8. API key 不上传、不写日志、不进 trace。
9. schema 任何变更必须 `SCHEMA_VERSION + 1` 并附迁移。
10. 删除 = 归档。物理删除只在用户显式"清空全部数据"时发生。

---

## 14. 迁移策略

- `settings['schemaVersion']` 存当前值，boot 时对比。
- `packages/core/src/migration/` 下每个版本一个函数，顺序执行，带幂等标记。
- 单用户本地应用不需要零停机迁移，但**必须支持"迁移失败回滚到迁移前的快照"**——迁移前把整个库 `export` 成一个 JSON 落到 OPFS，失败就让用户下载这个文件。

---

## 15. 变更流程

1. 改契约 → 先在本文档写 diff 和理由（为什么非改不可）。
2. 升 `SCHEMA_VERSION`。
3. 写迁移函数 + 一个用旧数据跑新代码的测试。
4. 才允许 Agent 改 `schema/*.ts`。

**没走完这四步就动 schema 的提交，直接回退。**
