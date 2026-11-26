#!/usr/bin/env node
/**
 * 头条作品数据抓取器（Node 版）— 复用 toutiao-interact 引擎，登录态稳定。
 * 抓后台作品管理页的展现/阅读/点赞/评论数据，写入 reviews/stats.jsonl。
 *
 * 用法:
 *   node fetch_stats.js          # 抓取并落盘
 *   node fetch_stats.js --dry    # 只打印不写盘
 */
const fs = require('fs');
const path = require('path');
const E = require('./engine');

const BASE = __dirname;
const LEDGER = path.join(BASE, 'reviews', 'stats.jsonl');
const URL = 'https://mp.toutiao.com/profile_v4/manage/content/all?enter_from=left_menu';

function parseNum(s) {
  if (!s) return 0;
  s = String(s).trim().replace(/,/g, '');
  let m = s.match(/([\d.]+)\s*万/);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  m = s.match(/([\d.]+)\s*亿/);
  if (m) return Math.round(parseFloat(m[1]) * 100000000);
  m = s.match(/[\d.]+/);
  return m ? Math.round(parseFloat(m[0])) : 0;
}

function grab(text, ...names) {
  for (const n of names) {
    const re = new RegExp(n + '\\s*([\\d,.万亿]+)');
    const m = text.match(re);
    if (m) return parseNum(m[1]);
  }
  return null;
}

function extract(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  let title = '';
  for (const l of lines) {
    const clean = l.replace(/^(置顶|首发|原创|审核中|已发布|草稿)\s*/, '');
    if (clean.length >= 8 && !/^\d/.test(clean) &&
        !/展现|阅读|点赞|评论|收藏|粉丝|\d{1,2}-\d{1,2}/.test(clean)) {
      title = clean;
      break;
    }
  }
  return {
    title,
    impressions: grab(text, '展现', '曝光'),
    reads: grab(text, '阅读', '播放'),
    likes: grab(text, '点赞'),
    comments: grab(text, '评论'),
    favorites: grab(text, '收藏', '喜欢'),
    shares: grab(text, '分享', '转发'),
    raw: text.slice(0, 300),
  };
}

(async () => {
  const dry = process.argv.includes('--dry');
  const ctx = await E.launch(false);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  // 关弹窗
  for (const sel of ['text=我知道了', 'button:has-text("确定")']) {
    try {
      const l = page.locator(sel).first();
      if (await l.count() && await l.isVisible()) {
        await l.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    } catch (e) { /* ignore */ }
  }

  // 若被跳到登录页，明确报错
  if (page.url().includes('/auth/page/login')) {
    console.error('登录态失效：请在浏览器扫码登录后重试');
    await ctx.close();
    process.exit(2);
  }

  // 结构化抓卡片
  const cards = await page.evaluate(() => {
    const sels = ['[class*=article-item]', '[class*=content-item]', '[class*=list-item]',
      '[class*=article-card]', '[class*=content-card]', '[class*=manage-item]'];
    let found = [];
    for (const s of sels) {
      const arr = Array.from(document.querySelectorAll(s))
        .filter(e => (e.innerText || '').length > 20 && e.offsetParent);
      if (arr.length > found.length) found = arr;
    }
    if (!found.length) {
      found = Array.from(document.querySelectorAll('div'))
        .filter(e => /展现/.test(e.innerText || '') && (e.innerText || '').length < 600 && e.offsetParent)
        .slice(0, 20);
    }
    return found.slice(0, 30).map(e => (e.innerText || '').trim().slice(0, 500));
  });

  const fullText = await page.evaluate(() => (document.body.innerText || '').slice(0, 3000));
  await ctx.close();

  let works = cards.map(extract).filter(w => w.title);
  // 去重
  const seen = new Set();
  works = works.filter(w => {
    if (seen.has(w.title)) return false;
    seen.add(w.title);
    return true;
  });

  const snapshot = {
    time: new Date().toISOString().slice(0, 19),
    count: works.length,
    works,
  };
  console.log('抓取时间:', snapshot.time);
  console.log('识别作品数:', works.length);
  for (const w of works) {
    console.log(`  - ${w.title.slice(0, 30)} | 展现${w.impressions} 阅读${w.reads} 点赞${w.likes} 评论${w.comments} 收藏${w.favorites}`);
  }

  if (!dry) {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify(snapshot) + '\n', 'utf8');
    console.log('台账已写入:', LEDGER);
  } else {
    console.log('=== 页面文本片段 ===');
    console.log(fullText.slice(0, 1200));
  }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
