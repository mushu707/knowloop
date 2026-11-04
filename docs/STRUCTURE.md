# 目录导览

> 每个文件是干什么的、为什么放在这里、边界在哪。
> 配套阅读：[`STACK.md`](STACK.md)（依赖怎么用）、[`DATA-CONTRACT.md`](DATA-CONTRACT.md)（数据长什么样）。

---

## 1. 全树

```
knowloop/
├── apps/
│   └── web/                        ← 唯一的应用（浏览器端）
│       ├── index.html              入口 HTML
│       ├── vite.config.ts          构建配置（只有两行有效内容）
│       ├── tsconfig.json
│       ├── public/                 原样复制到产物根目录，不参与打包
│       │   ├── favicon.svg
│       │   └── seed.json           ← 生成物，供「载入内置示例」fetch
│       └── src/
│           ├── main.tsx            挂载 React + HashRouter
│           ├── App.tsx             路由表 + 页面骨架（顶栏/页脚）
│           ├── styles.css          全部样式，主题在 :root 的 CSS 变量里
│           ├── pages/              一个文件 = 一个路由
│           │   ├── BanksPage.tsx   题库列表（空状态也在这）
│           │   ├── BankPage.tsx    某题库的题目列表
│           │   ├── QuestionPage.tsx 题目详情
│           │   └── ImportPage.tsx  导入 + 导入报告
│           ├── components/
│           │   └── Markdown.tsx    题干/解析渲染（唯一能渲染用户内容的地方）
│           ├── db/
│           │   ├── index.ts        ★ Dexie 实例 + 表结构声明
│           │   └── repo.ts         ★ 唯一写库入口（导入、知识树索引）
│           └── lib/
│               └── labels.ts       纯函数：题型中文名、题干摘要、日期格式
│
├── packages/
│   └── core/                       ← 不含 React 的领域层
│       ├── package.json            exports 直接指向 src/index.ts（不产出 dist）
│       └── src/
│           ├── index.ts            对外唯一出口（barrel）
│           ├── canonical.ts        ★ 内容哈希：normalizeText / questionContentId
│           ├── schema/             ★ 数据契约的 Zod 实现，一个实体一个文件
│           │   ├── common.ts       Iso / Id / Semver 等基础类型
│           │   ├── question.ts     题目（三种题型的判别联合）+ QuestionStrict
│           │   ├── kp.ts           知识点节点
│           │   ├── pack.ts         题库包（导入/导出/未来市场的分发单元）
│           │   ├── attempt.ts      作答记录（只追加）
│           │   ├── grade.ts        判分结果 + 错因受控词表
│           │   ├── review.ts       SM-2 调度状态
│           │   ├── rag.ts          文档 / 分块 / 向量 / 生成任务
│           │   ├── provider.ts     BYO 模型配置 + ModelProvider 接口
│           │   └── plugin.ts       插件 manifest（v0.2 插槽，已定形状）
│           ├── lint/
│           │   └── question.ts     质量提示（≠ 结构校验）
│           └── __tests__/
│               └── contract.test.ts  15 条契约测试
│
├── fixtures/                       ← 测试夹具，不是产品内容
│   ├── questions.seed.json         20 道示例题（生成物）
│   └── README.md                   哪 5 道题在试探契约边界
│
├── scripts/                        ← 不进 src，不参与打包
│   ├── gen-fixture.mjs             零依赖生成器（也是 canonical 规则的可执行参考）
│   └── verify-s1.mjs               无头浏览器验收脚本
│
├── docs/
│   ├── PRD.md                      范围契约（做什么/不做什么）
│   ├── DATA-CONTRACT.md            ★ 数据模型与不变量
│   ├── EVAL.md                     RAG 质量怎么量化
│   ├── DECISIONS.md                12 条 ADR，每条带"推翻条件"
│   ├── STACK.md                    依赖怎么用
│   ├── STRUCTURE.md                本文件
│   └── research/                   立项期调研存档 + 验收截图
│
├── package.json                    根脚本（dev/build/test/verify:s1/fixture）
├── pnpm-workspace.yaml             包列表 + onlyBuiltDependencies
├── tsconfig.base.json              两端共享的编译选项
└── .gitignore
```

带 ★ 的四个文件是真正需要你读懂的：`canonical.ts`、`schema/*`、`db/repo.ts`、`db/index.ts`。其余都是围绕它们的脚手架。

---

## 2. 三条边界规则

这三条不是风格偏好，破了会立刻出事。

### 规则一：`packages/core` 里不许出现 React，也不许碰数据库

core 是**纯领域层**：类型、校验、哈希、将来的 SM-2 调度和错题派生。它必须能在 Node 里跑（现在 vitest 就是这么跑的）。

判断标准：如果一段逻辑"换个 UI 框架也成立"，它属于 core；如果它需要 `useState` 或 `db.questions`，它属于 web。

**为什么这么做**：S4 的 RAG 管线要和 UI 解耦，S3 的错题派生要能被单测。一旦 core 里混进 React，这些都不可能。

### 规则二：只有 `db/repo.ts` 可以写库

页面**读**库可以直接 `db.questions.get()`（读是安全的），但**写**必须走 repo。

原因：写入伴随一整套规则——重算内容 id、去重、事务、知识树完整性。散落在页面里写，三个月后你会有一个"为什么导入后 id 对不上"的悬案。

**判断标准**：`db.xxx.put / add / bulkPut / delete` 只应该出现在 `repo.ts` 里（S2 的作答记录会新增 `db/attempts.ts`，同样遵守这条）。

### 规则三：`Markdown.tsx` 是唯一渲染外部文本的地方

题干、解析、将来 RAG 的引用片段，全部经过 `<Markdown source={...} />`。

原因：这是防 XSS 的唯一闸门。将来题库包来自社区，属于不可信输入。**禁止**在别处用 `dangerouslySetInnerHTML`。

---

## 3. 数据流

### 导入（写）

```
用户拖入 JSON / 点「载入内置示例」
   ↓
ImportPage.run(raw)                      拿到 unknown 类型的数据
   ↓
repo.importPack(raw)
   ├─ ① BankPack.safeParse               包级结构校验（失败直接 fatal）
   ├─ ② 知识树完整性                      父节点必须存在
   ├─ ③ 逐题 QuestionStrict.safeParse     跨字段校验（失败的收集，不阻塞）
   ├─ ④ questionContentId()              ★ 重算 id，不信包里的值
   ├─ ⑤ seenInBatch + bulkGet            批内去重 + 跨题库去重
   └─ ⑥ db.transaction(bulkPut)          一次性写入
   ↓
ImportReport { accepted, rejected[], duplicates, rewrittenIds, notices[] }
   ↓
ImportPage 渲染统计与逐条被拒原因
```

**关键点**：第 ③ 步失败**不中断**导入——一道题不合格不该让整个题库进不来。这是"收集错误"而不是"快速失败"的场景，所以用 `safeParse` 而不是 `parse`。

### 查询（读）

```
useLiveQuery(() => db.questions.where('bankId').equals(id).toArray())
   ↓  dexie 追踪到 questions 表
   ↓  任何写入 questions 的事务提交后自动重跑
组件拿到 Question[]
   ↓
plainStem() 取第一行散文做列表摘要      ← 跳过代码块，代码块开头的题加〔代码〕前缀
```

---

## 4. 每个文件一句话

| 文件 | 职责 | 改动频率 |
|---|---|---|
| `packages/core/src/canonical.ts` | 内容哈希。改它 = 全库 id 失效 | 几乎不动 |
| `packages/core/src/schema/question.ts` | 题目结构。**改它要走四步流程** | 低 |
| `packages/core/src/schema/grade.ts` | 错因词表。加错因要考虑统计口径 | 低 |
| `apps/web/src/db/index.ts` | 表与索引。加表要同步改契约 §12 | 中（S2 起） |
| `apps/web/src/db/repo.ts` | 导入规则 | 中 |
| `apps/web/src/pages/ImportPage.tsx` | 导入交互 + 报告呈现 | 中 |
| `apps/web/src/lib/labels.ts` | 纯展示函数 | 高（UI 迭代就改它） |
| `apps/web/src/styles.css` | 全部样式 | 高 |
| `scripts/gen-fixture.mjs` | 种子题库内容 | 高（想加题就改这里） |

---

## 5. 命名与组织约定

| 约定 | 说明 |
|---|---|
| 页面组件 `XxxPage.tsx` | 一个文件对应 `App.tsx` 里的一条 `<Route>` |
| 组件不加文件夹 | 只有一个组件文件时不建 `Markdown/` 目录，直接 `components/Markdown.tsx` |
| 纯函数放 `lib/` | 不依赖 React、不依赖 db |
| schema 一实体一文件 | 避免 `schemas.ts` 长到 800 行 |
| 中文注释写"为什么" | 英文标识符 + 中文解释取舍，不用中文命名变量 |
| `★` 注释标记关键决策 | 文件里出现 `★` 或「不变量」的地方，改动前先看契约 |

---

## 6. 没有的东西（以及为什么）

| 没有 | 为什么 |
|---|---|
| `src/utils/` | 会变成垃圾抽屉。`lib/labels.ts` 这种有明确职责的小文件更好 |
| `src/hooks/` | 目前只有 `useLiveQuery` 一个来源，没有自建 hook。S2 出现 `useSession()` 再建 |
| 全局状态目录 | 见 `STACK.md` §2.4 |
| `index.ts` barrel（web 侧） | 会让 import 路径看不出文件来源，且易造成循环依赖。core 侧保留一个（对外接口就该收敛） |
| `.idea/` | **是 IDE 自动生成的，应该删掉并加进 `.gitignore`**（当前漏了） |

---

## 7. 扩展点：S2 / S4 会往哪加文件

**S2（刷题闭环）**

```
packages/core/src/
  ├── derive/mistake.ts        deriveMistakes()：attempts → 错题视图（纯函数）
  ├── scheduler/sm2.ts         SM-2 纯函数，S3 用
  └── grade/judge.ts           判分：Question + Response → GradeResult

apps/web/src/
  ├── db/attempts.ts           唯一的作答写入入口（遵守规则二）
  └── pages/PracticePage.tsx   刷题界面
```

**S4（文档导入 + RAG）**

```
packages/core/src/rag/
  ├── chunk.ts                 段落感知分块
  ├── embed.ts                 Transformers.js 封装（唯一的重依赖）
  ├── retrieve.ts              暴力余弦 + topK
  └── generate.ts              出题 prompt + Zod 校验 + 重试

apps/web/src/pages/
  └── PastePage.tsx            粘贴正文 → 出题（D12 的"第一等输入"）
```

新增依赖都放 `packages/core`，因为它们是纯逻辑、需要单测；UI 只负责调用。
