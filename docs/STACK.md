# 技术栈导览

> 写给「JS 很熟、但这些库没用过」的你。
> 每个依赖只讲三件事：**它替我省了什么活 / 项目里具体在哪用 / 我踩过的那个坑**。
> 不写通用教程，网上到处都有；这份文档只记录本项目特有的部分。

---

## 0. 怎么读这份文档

- 想**改功能** → 跳到 §3 的对照表，或看 [`STRUCTURE.md`](STRUCTURE.md) 的「我要改 X」。
- 想**搞懂某个库** → §1 挑那一节，每节不超过 40 行。
- 想**知道为什么不用 LangChain / Tailwind / Next.js** → §4。

---

## 1. 全景

| 依赖 | 一句话职责 | 装在哪 |
|---|---|---|
| `zod` | 定义数据结构，同时产出 TS 类型和运行时校验 | core |
| `dexie` | IndexedDB 的 Promise 封装，声明式表结构 | web |
| `dexie-react-hooks` | 让 IndexedDB 查询变成响应式的 React hook | web |
| `react` 19 | UI | web |
| `react-router-dom` 7 | 路由（hash 模式） | web |
| `react-markdown` + `remark-gfm` | 安全渲染题干里的 Markdown | web |
| `vite` 8 | 开发服务器 + 打包 | web (dev) |
| `typescript` 7 | 类型检查（原生编译器） | 两边 (dev) |
| `vitest` 5 | 契约单测 | core (dev) |
| `pnpm` workspace | 两个包的依赖隔离与互引 | 根 |
| `puppeteer-core` | 无头浏览器跑 S1 验收 | 根 (dev) |

**三条选型原则**（后面每个决定都能回溯到这三条）：

1. **能自己写 200 行解决的事，不装库。** 所以没有 UI 框架、没有状态管理库、没有 RAG 编排框架。
2. **抽象只在有 ≥2 个实现时才做。** 所以 `ModelProvider` 有接口（将来会有 OpenAI 兼容 + Ollama），embedding 没有接口（只有一个本地实现）。
3. **每个依赖都要能回答"什么时候该换掉它"。** 见 §4。

---

## 2. 逐个讲

### 2.1 zod —— 这个项目的地基

**替我省了什么**：手写 TypeScript `interface` + 手写校验函数 + 手写文档，三份东西会漂移。zod 让**一份 schema 变成三个产物**：编译期类型、运行时校验器、可读的结构说明。

**项目里在哪用**：`packages/core/src/schema/*.ts` 全部。三个真实用途：

```ts
// ① 产出类型（不是手写 interface）
export type Question = z.infer<typeof Question>;

// ② 校验外部 JSON（导入题库包 / 将来校验 LLM 输出）
const parsed = BankPack.safeParse(raw);
if (!parsed.success) return { ok: false, fatal: formatIssues(parsed.error) };

// ③ 跨字段规则（Zod 管不到「答案必须在选项里」这种）
export const QuestionStrict = Question.superRefine((q, ctx) => { ... });
```

**你只需要掌握的 6 个 API**：

| API | 用在哪 | 记住什么 |
|---|---|---|
| `z.object` / `z.enum` / `z.literal` | 到处 | 组合积木 |
| `z.discriminatedUnion('type', [...])` | `question.ts` | 按某个字段分岔，**比 `z.union` 报错信息好得多**，且 TS 能正确收窄 |
| `.superRefine(fn)` | `question.ts` / `grade.ts` | 跨字段校验。**它不改变类型**，所以要把结果单独导出成 `QuestionStrict` |
| `.default(x)` | 大量使用 | 影响的是 **输出** 类型：`z.infer` 里字段是必填的，输入时才可以省略 |
| `.safeParse` vs `.parse` | 导入用 safeParse | `parse` 抛异常，`safeParse` 返回 `{success}`，后者才能逐题收集错误而不是整体失败 |
| `.extend()` | `question.ts` | 在基础对象上加字段，用来拼三种题型 |

**坑（真踩过）**：

1. **`.default()` 让"输入可选、输出必填"。** 所以 `Question` 类型里 `tags: string[]` 一定有值，但你在写测试数据时可以不给。想反过来的场景（输出可选）要用 `.optional()`。
2. **`superRefine` 之后的 schema 类型不是"新的对象类型"**，别试图拿它去 `.extend()`。
3. **v4 里 `z.string().url()` 已废弃**，改用 `z.url()`。本项目刻意没用 URL 类型——`sourceUrl` 用普通 string + 长度限制，因为用户手粘的链接经常带空格或缺少协议，硬校验 URL 只会让人导入失败。
4. `z.record(z.string(), z.unknown())` 必须两个参数，单参数写法在 v4 里语义不同。

**换掉会怎样**：换成手写 interface + 自己写 `isQuestion()`，你会立刻失去"导入时逐题报错定位到字段路径"的能力，而且 `packages/core` 和 `apps/web` 之间那层契约就没法在运行时守住。**不要换。**

---

### 2.2 dexie —— 数据层

**替我省了什么**：原生 IndexedDB 是回调式 API，写一个"按 bankId 查题目并排序"要 30 行样板。dexie 把它变成 Promise + 链式查询，而且**表结构是声明式的**。

**项目里在哪用**：`apps/web/src/db/index.ts`

```ts
this.version(1).stores({
  banks: 'id, name, updatedAt',
  questions: 'id, bankId, type, *kpIds, updatedAt, [bankId+type]',
  // ...
});
```

那串字符串是 IndexedDB 的索引 DSL，不是装饰：

| 写法 | 含义 |
|---|---|
| `id` | 主键（第一个字段） |
| `bankId` | 普通索引，可以 `.where('bankId').equals(x)` |
| `*kpIds` | **多值索引**：一个数组字段里每个元素都能被索引，所以"查某个知识点下的所有题"是一次索引查询 |
| `[bankId+type]` | 复合索引，用于同时按两个条件过滤 |

**你只需要掌握的 5 个 API**：`get` / `put` / `bulkPut` / `where(...).equals(...)` / `transaction`。

**坑（这个最要命）**：

> **Dexie 事务里不能 `await` 一个非 Dexie 的 Promise。** 一旦你在 `db.transaction(async () => { await fetch(...) })` 里等外部 Promise，事务会在等待期间被浏览器自动提交，后面的写入就跑到事务外面去了，而且**不报错**。

这正是 `apps/web/src/db/repo.ts` 里那个结构的由来——先在外面把所有异步哈希算完，再一次性开事务写入：

```ts
// ✅ 先做异步计算（重算内容 id 需要 await crypto.subtle）
const id = await questionContentId(parsedQuestion);

// ✅ 再开事务，事务里只放同步的 Dexie 操作
await db.transaction('rw', db.banks, db.kpNodes, db.questions, async () => {
  await db.questions.bulkPut(keep);
});
```

**为什么要用 IndexedDB 而不是 localStorage**：localStorage 同步阻塞主线程、只有约 5MB、只能存字符串。S4 要存文档原文 + 向量（Float32Array），localStorage 直接出局。

**为什么没有 `mistakes` 表**：这是全项目最重要的决定（`DECISIONS.md` D4）。错题是 `attempts` 的**派生视图**，建表就会双写、双写就会漂移，而错题率是核心指标。代价是十万条记录做折叠会慢，解法是内存缓存，不是加一张会漂移的表。

---

### 2.3 dexie-react-hooks —— 把数据库变成响应式数据源

**替我省了什么**：不用手写 `useEffect + useState + 手动 reload`。`useLiveQuery` 会自动追踪查询里碰到的表，表一变就重跑。

```tsx
const banks = useLiveQuery(() => db.banks.orderBy('updatedAt').reverse().toArray(), []);
```

**坑（已经在代码里体现）**：

> `useLiveQuery` 用 `undefined` 表示"**还在加载**"，用 `null`（或你自己的空值）表示"**确实没有**"。

所以每个页面都必须是这个三段式，不能写成 `if (!bank)`：

```tsx
if (bank === undefined) return <p>读取中…</p>;   // 加载中
if (!bank) return <p>题库不存在</p>;             // 查完了，真没有
```

写反了会先闪一下"不存在"再出现内容。

第二个依赖数组参数是**重订阅的开关**：`[bankId]` 变了才重跑查询。别把每次渲染都变的对象塞进去。

---

### 2.4 react 19

**项目里只用到 5 个东西**：`useState`、`useRef`、`useEffect`（还没用）、JSX、`<StrictMode>`。

**坑（S2 会咬你）**：

> `<StrictMode>` 在**开发模式**下会把每个 effect 执行两次：挂载 → 卸载 → 再挂载。

这不是 bug，是故意用来看你的清理函数写没写对。S2 做刷题时如果你在 `useEffect` 里写 `attempts`，会看到重复记录——因为开发模式多跑了一次。**不要为此去掉 StrictMode**，那是把报警器拆了。

**没用状态管理库的原因**：现在的状态全是"数据库里的数据的投影"，dexie 已经是真相源了，再加一层 Zustand/Redux 只会多一份要同步的东西。等到出现"跨页面的纯 UI 状态"（比如刷题会话的临时计时）再说。

---

### 2.5 react-router-dom 7

**项目里在哪用**：`App.tsx` 的 `<Routes>`，`main.tsx` 的 `<HashRouter>`。

**关键取舍：用 `HashRouter` 不用 `BrowserRouter`。**

| | URL | 刷新时 |
|---|---|---|
| `BrowserRouter` | `/bank/b_xxx` | 会向服务器请求 `/bank/b_xxx`，静态托管返回 404 |
| `HashRouter` | `/#/bank/b_xxx` | `#` 后面不发给服务器，永远拿到 `index.html` |

我们是纯静态部署，没有服务端 rewrite 规则，所以必须用 hash。**如果哪天上了 Vercel/Cloudflare 配了 `/* → /index.html` 的 rewrite，可以换回 BrowserRouter 拿到更干净的 URL**——这是可逆的，S6 再决定。

**坑**：不要在组件里 `import { useNavigate }` 然后立刻在 render 里调用，那是思维惯性错误（本项目的跳转全部用 `<Link>`）。

---

### 2.6 react-markdown + remark-gfm

**替我省了什么**：题干里有 ```js 代码块和表格，需要渲染成 HTML。

**为什么不用 `dangerouslySetInnerHTML` + `marked`**：

> 将来题目来自「社区题库包」，那是一份**不可信的外部数据**。`marked` 会把内容里的 `<img onerror=...>` 原样塞进 DOM，等于给任意题库包执行脚本的权限。

`react-markdown` 默认**不渲染原始 HTML**，只处理 Markdown 语法树，这条默认值就是这个库的全部价值。

**你只需要知道**：`<ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>`。`remark-gfm` 提供表格、删除线、任务列表这些 GitHub 扩展语法。

**坑**：没有加代码高亮（`rehype-highlight`）。这是有意的——bundle 已经 195KB gzip，高亮插件会再吃几十 KB，而题干里的代码块本来就短。**S6 做 PWA 离线包时再权衡。**

---

### 2.7 vite 8

**替我省了什么**：不用配 webpack。开箱支持 TS/JSX、HMR、生产打包。

**项目里配的东西只有两行**（`apps/web/vite.config.ts`）：react 插件 + 端口。

**坑（真踩过）**：

1. **pnpm 10+ 默认拦截依赖的 `postinstall` 脚本。** esbuild 需要跑 postinstall 下载平台二进制，被拦了会导致构建莫名其妙失败。解法是 `pnpm-workspace.yaml` 里显式放行：

   ```yaml
   onlyBuiltDependencies:
     - esbuild
   ```

   以后装任何带原生二进制的包（如 onnxruntime），都要记得加到这里。

2. **环境变量必须 `VITE_` 前缀**，且只能拿到打包时注入的值。项目里用的是 `import.meta.env.BASE_URL`（子路径部署时自动带前缀），见 `ImportPage.tsx` 里 fetch 示例题那一行。

3. **`public/` 下的文件不参与打包**，原样复制到产物根目录。所以 `seed.json` 和 `favicon.svg` 放那里，用 `/seed.json` 访问。

---

### 2.8 typescript 7

**要特别说明**：这里装的是 **7.x，Go 移植的原生编译器**，不是你可能熟悉的 5.x。

- **好处**：`tsc --noEmit` 快一个数量级（这项目全量检查约 1 秒）。
- **风险**：个别边界行为与 5.x 有差异，生态（ESLint 插件、某些 babel 预设）适配还在追赶。
- **对本项目无影响**：我们只把 `tsc` 当类型检查器用，不做 `tsc` 编译产出（打包交给 Vite/esbuild）。真遇到不兼容，把 `typescript` 锁回 `^5` 就行，代码一行不用改。

**`tsconfig.base.json` 里三个要紧的开关**：

| 开关 | 作用 | 为什么开 |
|---|---|---|
| `strict` | 全套严格检查 | 基础 |
| `noUncheckedIndexedAccess` | `arr[0]` 的类型是 `T \| undefined` | 逼你处理"数组可能为空"。导入题库时这就是真 bug 来源 |
| `verbatimModuleSyntax` | 类型导入必须写 `import type` | 保证编译产物不留无用 import，且避免循环依赖 |

**坑**：`noUncheckedIndexedAccess` 会让你写很多 `if (!x) continue`。**这是好事**——`repo.ts` 里那些 `if (!question) continue` 就是这么来的，它们不是噪音，是"这个下标可能越界"的显式声明。

---

### 2.9 vitest 5

**替我省了什么**：不用配 jest 的 ts-jest / babel 那一套。vitest 和 vite 共用转换管线，所以 `packages/core` 的单测可以直接 `import '../index'`，不用编译。

**跑法**：`pnpm test`。目前 15 条，全部在 `packages/core/src/__tests__/contract.test.ts`。

**这些测试在守什么**（不是"覆盖率"，是**不变量**）：

| 断言 | 守的是 |
|---|---|
| fixture 每题 id == 重算哈希 | 不变量 #3：id 就是内容哈希 |
| 空白差异不影响 id / 改内容改变 id | canonical 化规则的稳定性 |
| 畸形题被拒（答案指向不存在选项、AI 题无 source） | 导入闸门真的在拦 |
| 答对时不能标"概念混淆" | 错因词表的语义约束 |

**为什么不在 web 里也写单测**：S1 阶段的 UI 用 `scripts/verify-s1.mjs` 走真实浏览器更划算（见 2.11）。等 S2 出现"判分逻辑"这类纯函数，它会进 `core` 而不是 web，测试也就自然落在 core。

---

### 2.10 pnpm workspace

**替我省了什么**：两个包各自独立的 `node_modules`，`@knowloop/core` 用 `workspace:*` 直接引用。

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

**为什么 core 的 `exports` 指向 `.ts` 源码而不是 `dist`**：

```json
{ "exports": { ".": "./src/index.ts" } }
```

因为只有一个消费方（apps/web）且都由 Vite 转译。**省掉了一个 build 步骤和一套 watch**。哪天要发布到 npm，再加 `tsup` 产出 `dist`——现在加就是纯粹的浪费。

**坑**：`workspace:*` 不是版本号占位符，是协议。写成 `"^0.1.0"` 会在本地解析失败。

---

### 2.11 puppeteer-core

**替我省了什么**：不用手点。`scripts/verify-s1.mjs` 启动无头 Chromium，真实点击"载入内置示例"，断言导入报告、列表行数、代码块渲染、id 一致。

**为什么是 `core` 版**：`puppeteer` 会下载一整个 Chromium（~150MB）。`puppeteer-core` 只装协议客户端，复用本机已有的浏览器（脚本里指向 Playwright 缓存的那个 chrome.exe）。

**这种测试的价值**：它验证的是**用户路径**，不是函数返回值。S1 里我靠它抓出了两个 UI 缺陷（代码块开头的题在列表里显示成 `for (var i = 0; ...`、列表顺序被哈希打乱）——这两个纯逻辑单测永远发现不了。

---

## 3. 我要改 X，去动哪里

| 想做的事 | 落点 |
|---|---|
| 加一种题型（填空） | `packages/core/src/schema/question.ts` → **先走契约变更流程** |
| 改导入规则（去重/重算 id） | `apps/web/src/db/repo.ts` 的 `importPack()` |
| 加一张表 | `apps/web/src/db/index.ts` 的 `stores()` + **`DATA-CONTRACT.md` §12** |
| 加一个页面 | `apps/web/src/pages/` + `App.tsx` 的 `<Routes>` |
| 改样式 | `apps/web/src/styles.css`（全部在 CSS 变量里，改 `:root` 就能换主题） |
| 改种子题库内容 | `scripts/gen-fixture.mjs` 的 `RAW` 数组，然后 `pnpm fixture` |
| 改契约 | `docs/DATA-CONTRACT.md` §15 的四步流程 |

---

## 4. 明确**不**装的（以及什么条件下才装）

| 没装 | 理由 | 什么条件下装 |
|---|---|---|
| **LangChain / LangGraph** | 这项目的难点在"调参和评估"，不在"编排"；框架的价值恰恰是把细节藏起来（`DECISIONS.md` D8） | 出现有环、需要中断续跑的工作流（v0.3 AI 学习教练），且你能先手写一版 |
| **Next.js** | 纯静态本地优先，没有服务端，SSR/SEO 全用不上（D1） | 永远不装。除非产品变成 SaaS |
| **Tailwind / shadcn** | S1 只有 5 个页面，一份 CSS 变量就够；引入等于先学一套工具再干活 | 页面超过 15 个，或要做设计系统 |
| **Zustand / Redux** | 状态全是数据库的投影，dexie 已是真相源 | 出现跨页面的纯 UI 状态（刷题会话计时、临时草稿） |
| **ESLint / Prettier** | TS strict + 无团队协作，前期收益低于配置成本 | **多人协作时第一件要补的事**；一个人可以放到 v0.2 |
| **sqlite-vec / 向量库** | 十万 chunk 的暴力余弦在 Worker 里几十毫秒，不需要库 | 单库超过 30 万 chunk |
| **PDF 解析（pdfjs-dist）** | 目标用户材料里没有 PDF（D11） | 真实用户明确弃用，且 > 3 人 |

---

## 5. S4 会装的东西（现在不用学，先知道它是什么）

| 库 | 干什么 | 为什么是它 |
|---|---|---|
| `@huggingface/transformers`（Transformers.js v3） | 在浏览器里跑 ONNX 模型，做**本地 embedding** | 唯一成熟的"浏览器内跑 transformer"方案，底层是 `onnxruntime-web` |
| `bge-small-zh-v1.5`（模型，~25MB int8） | 把中文段落编码成 512 维向量 | 中文检索效果/体积比最好的小模型之一 |
| `onnxruntime-web` | Transformers.js 的推理后端（WASM/WebGPU） | 由 Transformers.js 间接依赖，通常不用直接碰 |
| `pdfjs-dist` | PDF 文字层提取 | v0.2，现在不用管 |

**这几个的共同特点**：都是"重、慢、第一次要下载模型"。所以 S4 的实现顺序是：**先用云端 embedding 把链路跑通，再换成本地模型**——否则你会在调 RAG 质量之前先被模型加载卡三天。

---

## 6. 依赖治理的三条规矩

1. **加依赖前先回答：我自己写要几行？** 200 行以内且没有生态依赖 → 自己写（SM-2 调度就是这么决定的）。
2. **抽象只在有第二个实现时才做。** 现在 `ModelProvider` 有接口是因为已经规划了 Ollama；`embedding` 没有接口是因为只有一个实现。
3. **每个依赖都要写"推翻条件"。** 没有推翻条件的依赖会永久留在项目里，包括那些你早就忘了为什么装的。
