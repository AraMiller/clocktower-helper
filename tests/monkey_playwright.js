/**
 * 简易“猴子测试”脚本（Playwright）
 * 作用：随机点击页面可交互元素，并检测 UI 死锁（10s 内 50 次点击无状态变化）
 *
 * 运行前置：
 *   npm i -D playwright
 *
 * 运行：
 *   node tests/monkey_playwright.js
 *
 * 默认访问：http://localhost:3000
 */

const { chromium } = require('playwright');

// 配置
const TARGET_URL = process.env.MONKEY_URL || 'http://localhost:3000';
const MAX_ACTIONS = 300;          // 最大点击次数
const DEADLOCK_CLICK_THRESHOLD = 50;
const DEADLOCK_TIME_WINDOW_MS = 10_000;
const VIEWPORT = { width: 1280, height: 720 };

// 获取页面状态指纹：URL + body 文本长度 + 打开弹窗数量
async function getStateFingerprint(page) {
  const url = page.url();
  const { textLength, dialogCount } = await page.evaluate(() => {
    const bodyText = document.body ? document.body.innerText || '' : '';
    const dialogs = document.querySelectorAll('[role="dialog"], .modal, .dialog, .popup');
    return { textLength: bodyText.length, dialogCount: dialogs.length };
  });
  return `${url}|${textLength}|${dialogCount}`;
}

// 获取可点击元素列表
async function getClickableElements(page) {
  const selectors = [
    'button',
    '[role="button"]',
    'a[href]',
    'input[type="button"]',
    'input[type="submit"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])'
  ];
  const handles = await page.$$(selectors.join(','));
  const visibles = [];
  for (const h of handles) {
    if (await h.isVisible()) visibles.push(h);
  }
  return visibles;
}

async function randomClick(page) {
  const elements = await getClickableElements(page);
  if (!elements.length) return false;
  const target = elements[Math.floor(Math.random() * elements.length)];
  await target.click({ timeout: 2000 });
  return true;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  let lastFingerprint = await getStateFingerprint(page);
  let lastChangeTime = Date.now();
  let clicksSinceChange = 0;

  for (let i = 0; i < MAX_ACTIONS; i++) {
    await randomClick(page);
    clicksSinceChange += 1;

    // 轻微等待，避免过快
    await page.waitForTimeout(80 + Math.random() * 120);

    const currentFingerprint = await getStateFingerprint(page);
    if (currentFingerprint !== lastFingerprint) {
      lastFingerprint = currentFingerprint;
      lastChangeTime = Date.now();
      clicksSinceChange = 0;
    }

    const stuckTime = Date.now() - lastChangeTime;
    if (clicksSinceChange >= DEADLOCK_CLICK_THRESHOLD && stuckTime >= DEADLOCK_TIME_WINDOW_MS) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = `monkey-deadlock-${ts}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(`发现 UI 卡死，停留在界面：${page.url()}（指纹：${currentFingerprint}）`);
      console.error(`已截图：${screenshotPath}`);
      break;
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Monkey test 出错：', err);
  process.exit(1);
});

