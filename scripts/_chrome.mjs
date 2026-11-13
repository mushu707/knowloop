// scripts/_chrome.mjs
// 动态定位可用的 Chromium。
// 不要在这里写死版本号：Playwright 更新时会删掉旧目录（chromium-1179 → 1254 就踩过）。

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RELATIVE_BINARIES = [
  'chrome-win/chrome.exe',
  'chrome-linux/chrome',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
];

const SYSTEM_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findChrome() {
  const fromEnv = process.env.KNOWLOOP_CHROME;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const roots = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : '',
    join(homedir(), '.cache/ms-playwright'),
    join(homedir(), 'AppData/Local/ms-playwright'),
  ].filter(Boolean);

  for (const root of roots) {
    if (!existsSync(root)) continue;

    const builds = readdirSync(root)
      .filter((name) => name.startsWith('chromium-'))
      .sort((a, b) => Number(b.split('-')[1] ?? 0) - Number(a.split('-')[1] ?? 0));

    for (const build of builds) {
      for (const rel of RELATIVE_BINARIES) {
        const candidate = join(root, build, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  for (const candidate of SYSTEM_CANDIDATES) if (existsSync(candidate)) return candidate;

  throw new Error(
    '找不到可用的 Chromium。请安装 Chrome，或设置 KNOWLOOP_CHROME 指向可执行文件。',
  );
}
