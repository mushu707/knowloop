// scripts/verify-s2.mjs
// S2 验收：真实点完一轮题，验证 attempts 落库、错题本派生、"蒙对不消错"、刷新不丢。
// 用法：先 pnpm dev，再 node scripts/verify-s2.mjs [baseUrl]

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'http://localhost:5173';

const CHROME_CANDIDATES = [
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1179/chrome-win/chrome.exe',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const seed = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/questions.seed.json'), 'utf8'));
const byId = new Map(seed.questions.map((q) => [q.id, q]));

const steps = [];
const ok = (name, detail = '') => steps.push({ pass: true, name, detail });
const fail = (name, detail = '') => steps.push({ pass: false, name, detail });
const check = (cond, name, detail = '') => (cond ? ok(name, detail) : fail(name, detail));

const browser = await puppeteer.launch({
  executablePath: CHROME_CANDIDATES.find((p) => {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  }),
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 950 });

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
    const el = [...document.querySelectorAll('button, a')].find((n) =>
      (n.textContent ?? '').includes(needle),
    );
    if (!(el instanceof HTMLElement)) return false;
    el.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`找不到可点击元素：${label}`);
}

/** 故意选一个错误答案，返回要点击的索引 */
function wrongIndex(question) {
  if (question.type === 'boolean') return question.answer.value === true ? 1 : 0;
  if (question.type === 'single')
    return question.options.findIndex((o) => o.id !== question.answer.optionId);

  // 多选：优先点一个非正确项；若所有选项都正确（第 12 题那种题），只点一个 = 子集，仍然算错
  const outside = question.options.findIndex((o) => !question.answer.optionIds.includes(o.id));
  return outside === -1 ? 0 : outside;
}

function rightIndex(question) {
  if (question.type === 'boolean') return question.answer.value === true ? 0 : 1;
  if (question.type === 'single')
    return question.options.findIndex((o) => o.id === question.answer.optionId);
  throw new Error('rightIndex 只支持单选与判断');
}

async function currentQuestion() {
  const id = await page.evaluate(
    () => document.querySelector('.practice')?.getAttribute('data-question-id') ?? null,
  );
  if (!id) throw new Error('当前页没有正在作答的题目');
  const question = byId.get(id);
  if (!question) throw new Error(`题目不在 fixture 里：${id}`);
  return question;
}

async function answerAndAdvance({ correct, lucky = false, tag = false }) {
  const question = await currentQuestion();
  const index = correct ? rightIndex(question) : wrongIndex(question);
  await page.evaluate((i) => {
    const options = document.querySelectorAll('.practice .option');
    const el = options[i];
    if (!(el instanceof HTMLElement)) throw new Error(`没有第 ${i} 个选项`);
    el.click();
  }, index);

  await clickByText('提交');
  await page.waitForSelector('.verdict', { timeout: 10000 });

  const verdictText = await page.evaluate(() => document.querySelector('.verdict')?.textContent ?? '');
  const wasCorrect = verdictText.includes('答对');

  if (tag) {
    await page.evaluate(() => {
      const chip = document.querySelector('.tag-picker .chip');
      if (chip instanceof HTMLElement) chip.click();
    });
  }
  if (lucky) {
    await page.evaluate(() => {
      const btn = document.querySelector('.lucky-toggle');
      if (btn instanceof HTMLElement) btn.click();
    });
  }

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /下一题|查看结果/.test(b.textContent ?? ''),
    );
    if (!(btn instanceof HTMLElement)) throw new Error('找不到「下一题」');
    btn.click();
  });

  await page.waitForFunction(
    () =>
      Boolean(document.querySelector('.summary')) ||
      document.querySelector('.practice')?.getAttribute('data-phase') === 'answering',
    { timeout: 15000 },
  );

  return { question, wasCorrect };
}

async function mistakeCounts() {
  const body = await text();
  const m = body.match(/未消错\s*(\d+)\s*·\s*已消错\s*(\d+)/);
  return m ? { open: Number(m[1]), resolved: Number(m[2]) } : null;
}

try {
  // 0. 准备数据
  await page.goto(`${BASE}/#/import`, { waitUntil: 'networkidle2' });
  await clickByText('载入内置示例');
  await page.waitForSelector('.report', { timeout: 20000 });

  const bankHref = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) =>
      (a.textContent ?? '').includes('查看题库'),
    );
    return link instanceof HTMLAnchorElement ? link.getAttribute('href') : null;
  });
  if (!bankHref) throw new Error('导入后没有「查看题库」链接');
  const bankId = bankHref.split('/').pop();

  // 1. 错题本初始为空
  await page.goto(`${BASE}/#/bank/${bankId}/mistakes`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.empty', { timeout: 10000 });
  check((await text()).includes('还没有错题'), '错题本初始为空');

  // 2. 完整练一轮，全部故意答错
  await page.goto(`${BASE}/#/practice/${bankId}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.practice', { timeout: 10000 });

  const totalText = await page.evaluate(
    () => document.querySelector('.practice-head .mono')?.textContent ?? '',
  );
  const total = Number(totalText.split('/')[1]?.trim() ?? '0');
  check(total === seed.questions.length, '练习队列覆盖全部题目', `${total} 题`);

  let sawWrong = 0;
  for (let i = 0; i < total; i += 1) {
    const { wasCorrect } = await answerAndAdvance({ correct: false, tag: i === 0 });
    if (!wasCorrect) sawWrong += 1;
  }
  check(sawWrong === total, '故意答错时全部判为错', `${sawWrong}/${total}`);

  await page.waitForSelector('.summary', { timeout: 10000 });
  const summary = await page.evaluate(() => ({
    correct: document.querySelectorAll('.stat-value')[0]?.textContent,
    wrong: document.querySelectorAll('.stat-value')[1]?.textContent,
  }));
  check(summary.correct === '0' && summary.wrong === String(total), '本局统计正确', JSON.stringify(summary));

  // 3. 错题本应当每题都在、且都未消错
  await page.goto(`${BASE}/#/bank/${bankId}/mistakes`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.mistake-row', { timeout: 10000 });
  const counts1 = await mistakeCounts();
  check(counts1?.open === total && counts1?.resolved === 0, '全部进入错题本且未消错', JSON.stringify(counts1));

  const tagged = await page.evaluate(
    () => document.querySelector('.mistake-row .chips .chip')?.textContent ?? '',
  );
  check(tagged.length > 0, '首题选的错因被保存下来', tagged);

  const dirtyStems = await page.evaluate(
    () =>
      [...document.querySelectorAll('.mistake-stem')].filter((n) =>
        (n.textContent ?? '').includes('`'),
      ).length,
  );
  check(dirtyStems === 0, '列表摘要不残留 Markdown 标记', `含反引号 ${dirtyStems} 行`);

  // 4. 蒙对不算消错
  const singleQuestions = seed.questions.filter((q) => q.type === 'single');
  const luckyQ = singleQuestions[0];
  await page.goto(`${BASE}/#/practice/${bankId}?only=${luckyQ.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.practice', { timeout: 10000 });
  const luckyResult = await answerAndAdvance({ correct: true, lucky: true });
  check(luckyResult.wasCorrect, '单题练习可答对');
  await page.waitForSelector('.summary', { timeout: 10000 });

  await page.goto(`${BASE}/#/bank/${bankId}/mistakes`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.mistake-row', { timeout: 10000 });
  const counts2 = await mistakeCounts();
  check(
    counts2?.open === total && counts2?.resolved === 0,
    '答对但标记「蒙的」→ 仍然未消错',
    JSON.stringify(counts2),
  );

  // 5. 正常答对 → 消错
  const normalQ = singleQuestions[1];
  await page.goto(`${BASE}/#/practice/${bankId}?only=${normalQ.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.practice', { timeout: 10000 });
  await answerAndAdvance({ correct: true });
  await page.waitForSelector('.summary', { timeout: 10000 });

  await page.goto(`${BASE}/#/bank/${bankId}/mistakes`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.mistake-row', { timeout: 10000 });
  const counts3 = await mistakeCounts();
  check(
    counts3?.open === total - 1 && counts3?.resolved === 1,
    '有把握地答对 → 消错',
    JSON.stringify(counts3),
  );

  await page.screenshot({ path: resolve(ROOT, 'docs/research/s2-mistakes.png'), fullPage: true });

  // 6. 刷新不丢
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.mistake-row', { timeout: 10000 });
  const counts4 = await mistakeCounts();
  check(
    counts4?.open === counts3?.open && counts4?.resolved === counts3?.resolved,
    '刷新后数据仍在',
    JSON.stringify(counts4),
  );

  // 7. 练习页截图
  await page.goto(`${BASE}/#/practice/${bankId}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.practice', { timeout: 10000 });
  await page.evaluate(() => {
    const option = document.querySelector('.practice .option');
    if (option instanceof HTMLElement) option.click();
  });
  await clickByText('提交');
  await page.waitForSelector('.verdict', { timeout: 10000 });
  await page.screenshot({ path: resolve(ROOT, 'docs/research/s2-practice.png'), fullPage: true });

  const fatal = consoleErrors.filter(
    (e) => !e.includes('favicon') && !e.includes('React DevTools'),
  );
  check(fatal.length === 0, '控制台干净', fatal.slice(0, 3).join(' | '));
} catch (e) {
  fail('脚本中断', e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}

const passed = steps.filter((s) => s.pass).length;
console.log('');
for (const s of steps) console.log(`${s.pass ? '✓' : '✗'} ${s.name}${s.detail ? `  — ${s.detail}` : ''}`);
console.log(`\n${passed}/${steps.length} 通过`);
process.exit(passed === steps.length ? 0 : 1);
