// scripts/verify-s3.mjs
// S3 验收：薄弱排序、今日队列、以及「消错口径升级」带来的回退。
// 用法：先 pnpm dev，再 node scripts/verify-s3.mjs [baseUrl]

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from './_chrome.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'http://localhost:5173';

const seed = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/questions.seed.json'), 'utf8'));
const byId = new Map(seed.questions.map((q) => [q.id, q]));

const steps = [];
const ok = (name, detail = '') => steps.push({ pass: true, name, detail });
const fail = (name, detail = '') => steps.push({ pass: false, name, detail });
const check = (cond, name, detail = '') => (cond ? ok(name, detail) : fail(name, detail));

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1000 });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const url = m.location()?.url ?? '';
  consoleErrors.push(`${m.text()}${url ? ` @ ${url}` : ''}`);
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const text = () => page.evaluate(() => document.body.innerText);

async function clickByText(label) {
  const clicked = await page.evaluate((needle) => {
    const el = [...document.querySelectorAll('button, a')].find((n) => (n.textContent ?? '').includes(needle));
    if (!(el instanceof HTMLElement)) return false;
    el.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`找不到可点击元素：${label}`);
}

function wrongIndex(q) {
  if (q.type === 'boolean') return q.answer.value === true ? 1 : 0;
  if (q.type === 'single') return q.options.findIndex((o) => o.id !== q.answer.optionId);
  const outside = q.options.findIndex((o) => !q.answer.optionIds.includes(o.id));
  return outside === -1 ? 0 : outside;
}

function rightIndex(q) {
  if (q.type === 'boolean') return q.answer.value === true ? 0 : 1;
  if (q.type === 'single') return q.options.findIndex((o) => o.id === q.answer.optionId);
  throw new Error('rightIndex 只支持单选与判断');
}

async function answerAndAdvance({ correct }) {
  const id = await page.evaluate(() => document.querySelector('.practice')?.getAttribute('data-question-id') ?? null);
  const question = id ? byId.get(id) : null;
  if (!question) throw new Error(`题目不在 fixture 里：${id}`);

  await page.evaluate((i) => {
    const options = document.querySelectorAll('.practice .option');
    const el = options[i];
    if (!(el instanceof HTMLElement)) throw new Error(`没有第 ${i} 个选项`);
    el.click();
  }, correct ? rightIndex(question) : wrongIndex(question));

  await clickByText('提交');
  await page.waitForSelector('.verdict', { timeout: 10000 });
  const verdict = await page.evaluate(() => document.querySelector('.verdict')?.textContent ?? '');

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /下一题|查看结果/.test(b.textContent ?? ''));
    if (!(btn instanceof HTMLElement)) throw new Error('找不到「下一题」');
    btn.click();
  });
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector('.summary')) ||
      document.querySelector('.practice')?.getAttribute('data-phase') === 'answering',
    { timeout: 15000 },
  );

  return { question, wasCorrect: verdict.includes('答对') };
}

try {
  // 0. 准备数据
  await page.goto(`${BASE}/#/import`, { waitUntil: 'networkidle2' });
  await clickByText('载入内置示例');
  await page.waitForSelector('.report', { timeout: 20000 });
  const bankHref = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) => (a.textContent ?? '').includes('查看题库'));
    return link instanceof HTMLAnchorElement ? link.getAttribute('href') : null;
  });
  if (!bankHref) throw new Error('导入后没有「查看题库」链接');
  const bankId = bankHref.split('/').pop();

  // 1. 练一轮，全部故意答错（让若干知识点达到 MIN_SAMPLE）
  await page.goto(`${BASE}/#/practice/${bankId}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.practice', { timeout: 10000 });
  const total = Number(
    (await page.evaluate(() => document.querySelector('.practice-head .mono')?.textContent ?? '')).split('/')[1]?.trim() ?? '0',
  );
  for (let i = 0; i < total; i += 1) await answerAndAdvance({ correct: false });
  await page.waitForSelector('.summary', { timeout: 10000 });

  // 2. 诊断页：薄弱排序
  await page.goto(`${BASE}/#/bank/${bankId}/progress`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.weak-row', { timeout: 10000 });

  const progress = await page.evaluate(() => ({
    attempts: document.querySelectorAll('.stat-row .stat-value')[0]?.textContent,
    weakNames: [...document.querySelectorAll('.weak-row .weak-name')].map((n) => n.textContent ?? ''),
    weakValues: [...document.querySelectorAll('.weak-row .weak-value')].map((n) => n.textContent ?? ''),
    treeRows: document.querySelectorAll('.kp-row').length,
  }));

  check(progress.attempts === String(total), '诊断页统计作答次数', `${progress.attempts} 次`);
  check(progress.weakNames.length > 0, '出现薄弱知识点', progress.weakNames.join('、'));
  check(progress.weakValues.every((v) => v === '80%'), '平滑后错误率 = 4/5 = 80%', progress.weakValues.join('、'));
  check(
    !progress.weakNames.includes('前端面试') && !progress.weakNames.includes('JavaScript'),
    '父节点不进薄弱榜',
    progress.weakNames.join('、'),
  );
  check(progress.treeRows === seed.kpTree.length, '知识点全景展示完整树', `${progress.treeRows} 行`);

  await page.screenshot({ path: resolve(ROOT, 'docs/research/s3-progress.png'), fullPage: true });

  // 3. 错题本：消错口径升级后，全部要求「再隔天答对 2 次」
  await page.goto(`${BASE}/#/bank/${bankId}/mistakes`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.mistake-row', { timeout: 10000 });
  const needTwo = await page.evaluate(
    () => [...document.querySelectorAll('.mistake-meta')].filter((n) => (n.textContent ?? '').includes('再隔天答对 2 次')).length,
  );
  const resolvedBadges = await page.evaluate(() => document.querySelectorAll('.badge-ok').length);
  check(needTwo === total && resolvedBadges === 0, '刚答错的题都显示「再隔天答对 2 次」', `${needTwo}/${total}`);

  // 4. 今日复习：还没学会的题立刻回到队列
  await page.goto(`${BASE}/#/review/${bankId}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.practice', { timeout: 10000 });
  const head1 = await page.evaluate(() => document.querySelector('.practice-head')?.textContent ?? '');
  check(new RegExp(`复习 ${total}`).test(head1), '今日复习队列收进了全部未学会的题', head1.replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: resolve(ROOT, 'docs/research/s3-review.png'), fullPage: true });

  // 5. 答对一道（当场答对），错题本变成「再隔天答对 1 次」
  const single = seed.questions.filter((q) => q.type === 'single')[0];
  await page.goto(`${BASE}/#/practice/${bankId}?only=${single.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.practice', { timeout: 10000 });
  await answerAndAdvance({ correct: true });
  await page.waitForSelector('.summary', { timeout: 10000 });

  await page.goto(`${BASE}/#/bank/${bankId}/mistakes`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.mistake-row', { timeout: 10000 });
  const afterOneCorrect = await page.evaluate(() => ({
    needOne: [...document.querySelectorAll('.mistake-meta')].filter((n) => (n.textContent ?? '').includes('再隔天答对 1 次')).length,
    needTwo: [...document.querySelectorAll('.mistake-meta')].filter((n) => (n.textContent ?? '').includes('再隔天答对 2 次')).length,
  }));
  check(
    afterOneCorrect.needOne === 1 && afterOneCorrect.needTwo === total - 1,
    '当场答对一次只推进一格，不直接消错',
    JSON.stringify(afterOneCorrect),
  );

  // 6. 该题已排到明天，今日队列少一道
  await page.goto(`${BASE}/#/review/${bankId}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.practice', { timeout: 10000 });
  const head2 = await page.evaluate(() => document.querySelector('.practice-head')?.textContent ?? '');
  check(
    new RegExp(`复习 ${total - 1}`).test(head2),
    '答对后该题排到明天，退出今日队列',
    head2.replace(/\s+/g, ' ').trim(),
  );

  const fatal = consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('React DevTools'));
  check(fatal.length === 0, '控制台干净', fatal.slice(0, 3).join(' | '));
} catch (e) {
  fail('脚本中断', `${e instanceof Error ? e.message : String(e)}${consoleErrors.length ? ` | 控制台: ${consoleErrors.slice(0, 3).join(' ; ')}` : ''}`);
} finally {
  await browser.close();
}

const passed = steps.filter((s) => s.pass).length;
console.log('');
for (const s of steps) console.log(`${s.pass ? '✓' : '✗'} ${s.name}${s.detail ? `  — ${s.detail}` : ''}`);
console.log(`\n${passed}/${steps.length} 通过`);
process.exit(passed === steps.length ? 0 : 1);
