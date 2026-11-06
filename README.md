# knowloop

把你的面经文档变成带出处的题目，并盯住你错在哪个环节。

纯静态、本地优先、零后端的前端面试刷题工具。数据只存在你的浏览器里。

---

## 状态：S2 完成（刷题闭环跑通）

```bash
pnpm install
pnpm fixture        # 生成 fixtures/questions.seed.json（20 道示例题）
pnpm dev            # http://localhost:5173
pnpm test           # 契约与判分单测（36 条）
pnpm verify:s1      # 无头浏览器跑 S1 验收（需先 pnpm dev）
pnpm verify:s2      # 无头浏览器跑 S2 验收：答完一轮 + 错题本 + 蒙对不消错
```

**已能做的事**：导入题库 → 随机开练 → 即时判分 → 标错因 → 错题本自动出现 → 答对（且不是蒙的）才消错 → 刷新不丢。

**还不能做**：按知识点 / 薄弱项组卷（S3）、文档导入与 RAG 出题（S4）、离线与安装（S6）。

## 文档

| 文件 | 作用 | 什么时候读 |
|---|---|---|
| [`docs/STACK.md`](docs/STACK.md) | 每个依赖干什么、怎么用、踩过什么坑 | 看不懂某个库 / 想换掉它之前 |
| [`docs/STRUCTURE.md`](docs/STRUCTURE.md) | 每个文件干什么、边界规则、要改 X 该动哪 | 第一次打开代码 / 加新文件之前 |
| [`docs/PRD.md`](docs/PRD.md) | 范围契约：做什么、不做什么、怎么算做完 | 每次想加功能之前 |
| [`docs/DATA-CONTRACT.md`](docs/DATA-CONTRACT.md) | 数据模型 + Zod schema + 不变量 | 写任何一行涉及数据的代码之前 |
| [`docs/EVAL.md`](docs/EVAL.md) | RAG 质量怎么量化 | S5 之前，以及每次改 prompt 之后 |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 13 条关键决策 + 各自的推翻条件 | 想推翻某个决定时 |
| [`docs/research/`](docs/research/) | 立项期的调研原文（DeepSeek 对话存档） | 想知道某条结论从哪来的 |

## 技术栈（一句话版）

Vite + React + TypeScript · Dexie(IndexedDB) · Zod · Transformers.js(bge-small-zh) · SM-2 自研 · vite-plugin-pwa

**没有后端，没有 Python，没有 LangChain。**

详见 `docs/DECISIONS.md` D1 / D2 / D8。

## 节拍

```
S0 文档 ✅ → S1 壳与导入 ✅ → S2 刷题闭环 ✅ → S3 错题与调度
       → S4 文档导入 + RAG → S5 评估 → S6 PWA → S7 dogfood 2 周
```

每个切片的出口是"能点、能跑、手动验收"，不是"代码写完"。

## 提交约定

- **一次迭代收敛到一个目标**，落库按层拆：契约（`DATA-CONTRACT.md` / `DECISIONS.md` / `schema/*.ts`）、
  core 逻辑（纯函数 + 单测）、表现层（`apps/web` + 验收脚本 + README）各成一个 commit。
  三层都能独立通过门禁，二分定位才是干净的；同一层的文档跟着该层走。
- 每个 commit 前 `pnpm typecheck` + `pnpm test` 必须全绿；动了哪个切片就跑哪个验收：
  S1（导入 / 列表 / 详情）→ `pnpm verify:s1`，S2（练习 / 错题本）→ `pnpm verify:s2`。
- **格式**：Conventional Commits，`type(scope): 中文摘要`，
  scope 只用 `web` / `core` / `docs` / `repo`。标题写"做了什么"，
  正文 3–6 行写**为什么**和**验收方式**。
- 直推 `main`，每个 S 出口打 tag（`s1-done`、`s2-done`……）。

## 三条禁令

1. **不许"先把基础设施搭好再写功能"**——没有 Turborepo，没有 monorepo 脚手架，两个包用 pnpm workspace 就够。
2. **不许改 `Question` 的形状**而不走 `DATA-CONTRACT.md` §15 的四步变更流程。
3. **不许在 S5 之前用"看起来像题"宣告 RAG 完成。**

## 许可

[AGPL-3.0](LICENSE)
