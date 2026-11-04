// scripts/verify-s1.mjs
// S1 验收脚本：用无头浏览器真实走一遍「导入 → 列表 → 打开题目」。
// 用法：先 pnpm dev，再 node scripts/verify-s1.mjs [baseUrl]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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
const first = seed.questions[0];
if (!first) throw new Error('fixture 为空');

const steps = [];
const ok = (name, detail = '') => steps.push({ pass: true, name, detail });
const fail = (name, detail = '') => steps.push({ pass: false, name, detail });

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
await page.setViewport({ width: 1100, height: 900 });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const url = m.location()?.url ?? '';
  consoleErrors.push(`${m.text()}${url ? ` @ ${url}` : ''}`);
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const text = () => page.evaluate(() => document.body.innerText);

try {
  // 1. 空状态
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('还没有题库'), { timeout: 10000 });
  ok('首页空状态', '显示「还没有题库」');

  // 2. 进导入页
  await page.click('a[href="#/import"]').catch(async () => {
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('导入'));
      if (link instanceof HTMLElement) link.click();
    });
  });
  await page.waitForFunction(() => document.body.innerText.includes('把 JSON 拖到这里'), { timeout: 10000 });
  ok('进入导入页');

  // 3. 点「载入内置示例」
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('载入内置示例'));
    if (!(btn instanceof HTMLElement)) throw new Error('找不到示例按钮');
    btn.click();
  });
  await page.waitForSelector('.report', { timeout: 20000 });

  const report = await page.evaluate(() => {
    const values = [...document.querySelectorAll('.stat-value')].map((n) => n.textContent?.trim());
    const labels = [...document.querySelectorAll('.stat-label')].map((n) => n.textContent?.trim());
    const badge = document.querySelector('.badge')?.textContent?.trim();
    const rejected = [...document.querySelectorAll('.issues li')].map((n) => n.textContent?.trim());
    return { values, labels, badge, rejected };
  });

  await page.screenshot({ path: resolve(ROOT, 'docs/research/s1-import.png'), fullPage: true });

  const accepted = Number(report.values[0]);
  const rejectedCount = Number(report.values[1]);

  if (report.badge === '导入完成' && accepted === seed.questions.length && rejectedCount === 0)
    ok('导入完成', `${accepted}/${seed.questions.length} 道入库，0 道拒绝`);
  else fail('导入完成', JSON.stringify(report));

  // 4. 进题库列表
  await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('查看题库'));
    if (!(link instanceof HTMLElement)) throw new Error('找不到查看题库');
    link.click();
  });
  await page.waitForSelector('.question-row', { timeout: 10000 });
  await page.screenshot({ path: resolve(ROOT, 'docs/research/s1-bank.png'), fullPage: true });
  const rowCount = await page.evaluate(() => document.querySelectorAll('.question-row').length);
  if (rowCount === seed.questions.length) ok('题目列表', `${rowCount} 行`);
  else fail('题目列表', `期望 ${seed.questions.length}，实际 ${rowCount}`);

  // 5. 打开第 1 题（带 ```js 代码块的那道）
  await page.goto(`${BASE}/#/q/${first.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.question-detail .md', { timeout: 10000 });

  const detail = await page.evaluate(() => ({
    preBlocks: document.querySelectorAll('.md pre code').length,
    codeText: document.querySelector('.md pre code')?.textContent ?? '',
    options: document.querySelectorAll('.option').length,
    correct: document.querySelectorAll('.option.is-correct').length,
    id: document.querySelector('.meta-grid dd.mono')?.textContent ?? '',
    kp: document.querySelector('.meta-grid dd')?.textContent ?? '',
  }));

  if (detail.preBlocks >= 1 && detail.codeText.includes('setTimeout'))
    ok('代码块渲染', `<pre><code> 正常，含 ${detail.preBlocks} 个代码块`);
  else fail('代码块渲染', JSON.stringify(detail));

  if (detail.options === 4 && detail.correct === 1) ok('选项渲染', '4 个选项，1 个正确答案');
  else fail('选项渲染', JSON.stringify(detail));

  if (detail.id === first.id) ok('id 一致', detail.id);
  else fail('id 一致', `期望 ${first.id}，实际 ${detail.id}`);

  if (detail.kp.includes('事件循环')) ok('知识点路径', detail.kp);
  else fail('知识点路径', detail.kp);

  // 6. 控制台无错误
  const fatal = consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('Download the React DevTools'));
  if (fatal.length === 0) ok('控制台干净');
  else fail('控制台干净', fatal.slice(0, 3).join(' | '));

  await page.screenshot({ path: resolve(ROOT, 'docs/research/s1-question.png'), fullPage: true });
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
