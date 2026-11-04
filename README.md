# knowloop

把你的面经文档变成带出处的题目，并盯住你错在哪个环节。

纯静态、本地优先、零后端的前端面试刷题工具。数据只存在你的浏览器里。

---

## 状态：S1 完成（S0 文档已固化）

S0 = 三份文档定稿。S1 = 能导入题库、在列表里看到、点开一道题——**已通过自动化验收**。

```bash
pnpm install
pnpm fixture        # 生成 fixtures/questions.seed.json（20 道示例题）
pnpm dev            # http://localhost:5173
pnpm test           # 契约单测（15 条）
node scripts/verify-s1.mjs   # 无头浏览器跑一遍 S1 验收（需先 pnpm dev）
```

## 文档

| 文件 | 作用 | 什么时候读 |
|---|---|---|
| [`docs/STACK.md`](docs/STACK.md) | 每个依赖干什么、怎么用、踩过什么坑 | 看不懂某个库 / 想换掉它之前 |
| [`docs/STRUCTURE.md`](docs/STRUCTURE.md) | 每个文件干什么、边界规则、要改 X 该动哪 | 第一次打开代码 / 加新文件之前 |
| [`docs/PRD.md`](docs/PRD.md) | 范围契约：做什么、不做什么、怎么算做完 | 每次想加功能之前 |
| [`docs/DATA-CONTRACT.md`](docs/DATA-CONTRACT.md) | 数据模型 + Zod schema + 不变量 | 写任何一行涉及数据的代码之前 |
| [`docs/EVAL.md`](docs/EVAL.md) | RAG 质量怎么量化 | S5 之前，以及每次改 prompt 之后 |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 10 条关键决策 + 各自的推翻条件 | 想推翻某个决定时 |
| [`docs/research/`](docs/research/) | 立项期的调研原文（DeepSeek 对话存档） | 想知道某条结论从哪来的 |

## 技术栈（一句话版）

Vite + React + TypeScript · Dexie(IndexedDB) · Zod · Transformers.js(bge-small-zh) · SM-2 自研 · vite-plugin-pwa

**没有后端，没有 Python，没有 LangChain。**

详见 `docs/DECISIONS.md` D1 / D2 / D8。

## 节拍

```
S0 文档 ✅ → S1 壳与导入 ✅ → S2 刷题闭环 → S3 错题与调度
       → S4 文档导入 + RAG → S5 评估 → S6 PWA → S7 dogfood 2 周
```

每个切片的出口是"能点、能跑、手动验收"，不是"代码写完"。

## 三条禁令

1. **不许"先把基础设施搭好再写功能"**——没有 Turborepo，没有 monorepo 脚手架，两个包用 pnpm workspace 就够。
2. **不许改 `Question` 的形状**而不走 `DATA-CONTRACT.md` §15 的四步变更流程。
3. **不许在 S5 之前用"看起来像题"宣告 RAG 完成。**

## 许可

AGPL-3.0
