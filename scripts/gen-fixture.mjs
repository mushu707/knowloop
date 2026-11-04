// scripts/gen-fixture.mjs
// 生成 fixtures/questions.seed.json：S1 的测试题库（20 道前端面试题）
// 零依赖，仅用 node 内置模块。用法：node scripts/gen-fixture.mjs
//
// 它同时是 DATA-CONTRACT.md §1「canonical 化规则」的可执行版本——
// 如果这里的实现和文档不一致，以文档为准并修这个脚本。

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_VERSION = 1;
const NOW = '2026-11-04T08:00:00.000Z';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** 规范化文本：统一换行 → 逐行 trim + 行内空白压缩 → 多余空行折叠 */
const norm = (s) =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** 递归按字典序排序 key，保证 JSON.stringify 稳定 */
const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
};

/** 题目内容哈希 → 稳定 id */
function questionId(q) {
  const payload = {
    type: q.type,
    stem: norm(q.stem),
    options: q.options ? q.options.map((o) => ({ text: norm(o.text) })) : null,
    answer: q.answer,
  };
  return 'q_' + sha(JSON.stringify(sortKeys(payload))).slice(0, 16);
}

// ---------------------------------------------------------------- 知识树

const KP_DEFS = [
  { key: 'root', path: ['前端面试'] },
  { key: 'js', path: ['前端面试', 'JavaScript'] },
  { key: 'eventloop', path: ['前端面试', 'JavaScript', '事件循环'] },
  { key: 'prototype', path: ['前端面试', 'JavaScript', '原型链'] },
  { key: 'closure', path: ['前端面试', 'JavaScript', '闭包'] },
  { key: 'async', path: ['前端面试', 'JavaScript', '异步与 Promise'] },
  { key: 'react', path: ['前端面试', 'React'] },
  { key: 'render', path: ['前端面试', 'React', '渲染机制'] },
  { key: 'hooks', path: ['前端面试', 'React', 'Hooks'] },
  { key: 'web', path: ['前端面试', '浏览器与网络'] },
  { key: 'httpcache', path: ['前端面试', '浏览器与网络', 'HTTP 缓存'] },
  { key: 'cors', path: ['前端面试', '浏览器与网络', '跨域与安全'] },
];

const BANK_NAME = '前端面试种子包';
const BANK_AUTHOR = 'knowloop';
const bankId = 'b_' + sha(`${BANK_AUTHOR}:${BANK_NAME}`).slice(0, 12);

const kpIdOf = (path) => 'kp_' + sha(`${bankId}/${path.join('>')}`).slice(0, 12);

const kpByPath = new Map();
const kpTree = KP_DEFS.map(({ path }, i) => {
  const node = {
    id: kpIdOf(path),
    bankId,
    parentId: path.length === 1 ? null : kpIdOf(path.slice(0, -1)),
    name: path.at(-1),
    order: i,
    aliases: [],
  };
  kpByPath.set(path.join('>'), node.id);
  return node;
});

const kp = (key) => {
  const def = KP_DEFS.find((k) => k.key === key);
  if (!def) throw new Error(`未知知识点: ${key}`);
  return kpByPath.get(def.path.join('>'));
};

// ---------------------------------------------------------------- 题目

const RAW = [
  {
    kp: 'eventloop',
    type: 'single',
    difficulty: 2,
    stem: "执行以下代码，控制台输出顺序是？\n```js\nsetTimeout(() => console.log('A'), 0)\nPromise.resolve().then(() => console.log('B'))\nconsole.log('C')\n```",
    options: ['A → B → C', 'C → B → A', 'C → A → B', 'B → A → C'],
    answer: 1,
    explanation: '同步代码先执行（C）；宏任务结束后清空微任务队列（B）；setTimeout 回调最后执行（A）。',
  },
  {
    kp: 'eventloop',
    type: 'multiple',
    difficulty: 3,
    stem: '下列哪些属于微任务（microtask）？',
    options: ['Promise.then 的回调', 'queueMicrotask 注册的回调', 'setTimeout 的回调', 'MutationObserver 的回调', 'requestAnimationFrame 的回调'],
    answer: [0, 1, 3],
    explanation: 'requestAnimationFrame 属于渲染前的回调，不在微任务队列；setTimeout 是宏任务。',
  },
  {
    kp: 'eventloop',
    type: 'boolean',
    difficulty: 2,
    stem: '每执行完一个宏任务，浏览器会先清空微任务队列，再进入下一个宏任务。',
    answer: true,
  },
  {
    kp: 'prototype',
    type: 'single',
    difficulty: 3,
    stem: '```js\nfunction F() {}\nF.prototype = { a: 1 }\nconst o = new F()\n```\n`o.constructor` 的值是？',
    options: ['F', 'Object', 'undefined', 'Function'],
    answer: 1,
    explanation: '整体替换 F.prototype 后，新对象字面量没有 constructor 属性，沿原型链找到 Object.prototype.constructor。',
  },
  {
    kp: 'prototype',
    type: 'single',
    difficulty: 2,
    stem: '使用 `Object.create(null)` 创建的对象，下列描述正确的是？',
    options: ['原型是 Object.prototype', '没有原型，无法调用 hasOwnProperty', "typeof 返回 'null'", '无法被 JSON.stringify 序列化'],
    answer: 1,
    explanation: "原型为 null，因此没有 hasOwnProperty 等方法；typeof 仍返回 'object'，JSON.stringify 也能正常工作。",
  },
  {
    kp: 'prototype',
    type: 'single',
    difficulty: 3,
    stem: '关于 `instanceof` 的判定机制，下列说法正确的是？',
    options: [
      '比较对象的 constructor 属性是否等于右侧构造函数',
      '沿对象的原型链查找，看是否存在右侧构造函数的 prototype',
      '对基本类型值（如 1 instanceof Number）也能返回 true',
      '跨 iframe 时结果与同窗口内一致',
    ],
    answer: 1,
    explanation: 'instanceof 走的是原型链查找；跨 realm 时原型对象不同，结果会变成 false。',
  },
  {
    kp: 'closure',
    type: 'single',
    difficulty: 2,
    stem: '```js\nfor (var i = 0; i < 3; i++) {\n  setTimeout(() => console.log(i), 0)\n}\n```\n输出的三个值是？',
    options: ['0 1 2', '3 3 3', '0 0 0', '1 2 3'],
    answer: 1,
    explanation: 'var 没有块级作用域，三个回调共享同一个 i，执行时循环已结束。',
  },
  {
    kp: 'closure',
    type: 'multiple',
    difficulty: 3,
    stem: '关于闭包，下列说法正确的有？',
    options: [
      '闭包一定会导致内存泄漏',
      '闭包让函数在定义作用域之外仍能访问该作用域的变量',
      'IIFE 可以用来隔离变量，避免污染全局',
      '函数返回后，其闭包捕获的变量会立即销毁',
    ],
    answer: [1, 2],
    explanation: '闭包本身不是泄漏，只有被意外长期持有才会；捕获的变量在闭包存活期间不会销毁。',
  },
  {
    kp: 'async',
    type: 'single',
    difficulty: 2,
    stem: '调用 `async function f() { return 1 }` 时，`f()` 返回什么？',
    options: ['数字 1', '一个 fulfilled 的 Promise，值为 1', 'undefined', '抛出异常'],
    answer: 1,
  },
  {
    kp: 'async',
    type: 'single',
    difficulty: 2,
    stem: '`Promise.all([p1, p2, p3])` 中 p2 变为 rejected，下列说法正确的是？',
    options: [
      '返回的 Promise 立即 rejected，但 p1、p3 仍会继续执行',
      '返回的 Promise 等全部结束后再 rejected',
      'p1、p3 会被自动取消',
      '返回的 Promise 永远保持 pending',
    ],
    answer: 0,
    explanation: 'Promise.all 是快速失败（fail-fast），但不会取消其余 Promise。',
  },
  {
    kp: 'render',
    type: 'single',
    difficulty: 3,
    stem: 'React 18 中，在 `setTimeout` 回调里连续调用两次 `setState`，会触发几次渲染？',
    options: ['2 次', '1 次（自动批处理）', '取决于是否在事件处理函数中调用', '取决于组件是否被 React.memo 包裹'],
    answer: 1,
    explanation: 'React 18 的自动批处理覆盖 setTimeout、Promise 等所有异步场景，不再局限于事件处理函数。',
  },
  {
    kp: 'render',
    type: 'multiple',
    difficulty: 2,
    stem: '下列哪些情况会导致函数组件重新渲染？',
    options: [
      '接收的 props 发生变化',
      '自身 state 更新',
      '父组件重新渲染，且该组件未被 React.memo 包裹',
      '该组件消费的 Context 值发生变化',
    ],
    answer: [0, 1, 2, 3],
  },
  {
    kp: 'render',
    type: 'boolean',
    difficulty: 3,
    stem: '`useMemo` 能保证包裹的计算在依赖不变时一定不会重复执行。',
    answer: false,
    explanation: 'useMemo 是性能优化提示，React 保留在内存压力下丢弃缓存的权利，不能当作语义保证。',
  },
  {
    kp: 'hooks',
    type: 'single',
    difficulty: 3,
    stem: 'React 18 开发模式（StrictMode）下，`useEffect(() => {...}, [])` 的 effect 函数在首次挂载后会被执行几次？',
    options: ['1 次', '2 次', '0 次', '每次渲染都执行'],
    answer: 1,
    explanation: 'StrictMode 会刻意走一遍「挂载 → 卸载 → 再挂载」，用于暴露副作用清理不干净的问题；仅开发模式生效。',
  },
  {
    kp: 'hooks',
    type: 'single',
    difficulty: 1,
    stem: '哪个 Hook 的值在多次渲染之间保持不变，且修改它不会触发重新渲染？',
    options: ['useState', 'useRef', 'useMemo', 'useReducer'],
    answer: 1,
  },
  {
    kp: 'hooks',
    type: 'multiple',
    difficulty: 2,
    stem: '关于 Hook 的使用规则，正确的有？',
    options: [
      '只能在函数组件或自定义 Hook 的顶层调用',
      '不能放在 if、for 等条件或循环语句中',
      '可以在 class 组件的 render 方法中调用',
      '自定义 Hook 的名称必须以 use 开头',
    ],
    answer: [0, 1, 3],
  },
  {
    kp: 'httpcache',
    type: 'single',
    difficulty: 3,
    stem: '`Cache-Control: no-cache` 的实际含义是？',
    options: ['完全不缓存响应', '可以缓存，但每次使用前必须向服务器验证', '表示缓存已过期，必须重新下载完整响应', '只在 HTTPS 下生效'],
    answer: 1,
    explanation: '不缓存对应的是 no-store；no-cache 是「可存但必须协商」。',
  },
  {
    kp: 'httpcache',
    type: 'single',
    difficulty: 2,
    stem: '强缓存命中时，浏览器的行为是？',
    options: [
      '向服务器发送带 If-None-Match 的请求',
      '直接使用本地副本，不发起网络请求，DevTools 中显示 from disk/memory cache',
      '直接使用本地副本，但会发一个 HEAD 请求确认是否更新',
      '必须重新下载完整响应',
    ],
    answer: 1,
  },
  {
    kp: 'httpcache',
    type: 'multiple',
    difficulty: 2,
    stem: '下列哪些属于协商缓存相关的头？',
    options: ['ETag', 'If-None-Match', 'Last-Modified', 'Cache-Control: max-age=3600', 'Expires'],
    answer: [0, 1, 2],
    explanation: 'max-age 与 Expires 属于强缓存。',
  },
  {
    kp: 'cors',
    type: 'boolean',
    difficulty: 3,
    stem: 'CORS 预检请求（OPTIONS）会携带用户的 Cookie。',
    answer: false,
    explanation: '预检请求默认不带凭证；带凭证的跨域请求需要响应显式返回 Access-Control-Allow-Credentials: true。',
  },
];

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

function buildQuestion(raw) {
  const q = {
    bankId,
    stem: raw.stem,
    explanation: raw.explanation,
    kpIds: [kp(raw.kp)],
    difficulty: raw.difficulty,
    tags: [],
    origin: 'manual',
    extensions: {},
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: SCHEMA_VERSION,
  };

  if (raw.type === 'boolean') {
    return { ...q, type: 'boolean', answer: { value: raw.answer } };
  }

  const options = raw.options.map((text, i) => ({ id: LETTERS[i], text }));
  if (raw.type === 'single') {
    return {
      ...q,
      type: 'single',
      options,
      answer: { optionId: LETTERS[raw.answer] },
    };
  }
  const optionIds = (Array.isArray(raw.answer) ? raw.answer : [raw.answer]).map((i) => LETTERS[i]);
  return { ...q, type: 'multiple', options, answer: { optionIds } };
}

const questions = RAW.map((raw) => {
  const q = buildQuestion(raw);
  return { ...q, id: questionId(q) };
});

// ---------------------------------------------------------------- 自检

const problems = [];
const seen = new Set();
for (const q of questions) {
  if (seen.has(q.id)) problems.push(`id 冲突（内容重复）: ${q.id} — ${q.stem.slice(0, 30)}`);
  seen.add(q.id);

  if (q.kpIds.length === 0) problems.push(`无知识点: ${q.id}`);
  for (const k of q.kpIds) if (!kpTree.some((n) => n.id === k)) problems.push(`知识点不存在: ${q.id} → ${k}`);

  if (q.type !== 'boolean') {
    const ids = new Set(q.options.map((o) => o.id));
    if (ids.size !== q.options.length) problems.push(`选项 id 重复: ${q.id}`);
    const answers = q.type === 'single' ? [q.answer.optionId] : q.answer.optionIds;
    for (const a of answers) if (!ids.has(a)) problems.push(`答案指向不存在的选项: ${q.id} → ${a}`);
    if (q.type === 'multiple' && new Set(q.answer.optionIds).size !== q.answer.optionIds.length)
      problems.push(`多选答案重复: ${q.id}`);
  }
}

const pack = {
  schemaVersion: SCHEMA_VERSION,
  id: bankId,
  name: BANK_NAME,
  version: '0.1.0',
  author: BANK_AUTHOR,
  license: 'AGPL-3.0',
  description: 'S1 测试用种子题库：20 道前端面试题，覆盖三种题型与 8 个知识点。用于跑通导入、列表与作答链路，不代表最终内容质量。',
  createdAt: NOW,
  kpTree,
  questions,
  checksum: sha(JSON.stringify(sortKeys({ kpTree, questions }))),
};

if (problems.length) {
  console.error('自检失败：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

const outDir = resolve(ROOT, 'fixtures');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, 'questions.seed.json');
writeFileSync(outFile, JSON.stringify(pack, null, 2) + '\n', 'utf8');

// 同时给 web 应用一份，供「载入内置示例」按钮 fetch（生成物，已 gitignore）
const publicDir = resolve(ROOT, 'apps/web/public');
mkdirSync(publicDir, { recursive: true });
writeFileSync(resolve(publicDir, 'seed.json'), JSON.stringify(pack, null, 2) + '\n', 'utf8');

const byType = questions.reduce((m, q) => ((m[q.type] = (m[q.type] ?? 0) + 1), m), {});
console.log(`已生成 ${outFile}`);
console.log(`知识点 ${kpTree.length} 个 · 题目 ${questions.length} 道 · ${JSON.stringify(byType)}`);
console.log(`bankId ${bankId} · checksum ${pack.checksum.slice(0, 12)}…`);
