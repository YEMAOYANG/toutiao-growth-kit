#!/usr/bin/env node
'use strict';

/**
 * 页面侦察脚本 —— 头条改版后重新确认选择器用。
 * 输出：搜索页卡片结构、站内外分布、文章页互动按钮属性。
 *
 * 用法: node src/probe.js [--keyword "游戏延迟高怎么办"]
 */

const E = require('./engine');
const { SEARCH, ARTICLE } = require('./selectors');

(async () => {
  const kwIdx = process.argv.indexOf('--keyword');
  const kw = kwIdx > -1 ? process.argv[kwIdx + 1] : '游戏延迟高怎么办';

  const ctx = await E.launch(false);
  const page = await ctx.newPage();

  try {
    // ---- 搜索页 ----
    console.log(`\n========== 搜索页: ${kw} ==========`);
    await page.goto(SEARCH.url(kw), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(700); }

    const search = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.cs-card')];
      const hosts = {};
      const samples = [];
      for (const c of cards) {
        const a = c.querySelector('a[href*="/search/jump"], a[href*="toutiao.com/article"]');
        if (!a) continue;
        let real = a.href;
        try {
          const u = new URL(a.href);
          const enc = u.searchParams.get('url');
          if (enc) real = decodeURIComponent(enc);
        } catch (_) {}
        let host = '?';
        try { host = new URL(real).host; } catch (_) {}
        hosts[host] = (hosts[host] || 0) + 1;
        if (samples.length < 3) samples.push({ title: (c.querySelector('.cs-header')?.innerText || '').slice(0, 40), real: real.slice(0, 100) });
      }
      return { cardCount: cards.length, hosts, samples };
    });
    console.log('卡片总数:', search.cardCount);
    console.log('域名分布:', JSON.stringify(search.hosts, null, 1));
    console.log('样本:', JSON.stringify(search.samples, null, 1));

    // ---- 文章页 ----
    const items = await E.searchSiteArticles(page, kw, 5);
    console.log(`\n站内可处理作品: ${items.length}`);
    items.forEach((i, n) => console.log(`  ${n + 1}. ${i.title.slice(0, 40)}  ${i.articleId}`));

    if (items.length) {
      console.log(`\n========== 文章页: ${items[0].title.slice(0, 40)} ==========`);
      await page.goto(items[0].url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);

      const art = await page.evaluate((A) => {
        const probe = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return { sel, found: false };
          return {
            sel, found: true,
            aria: el.getAttribute('aria-label') || '',
            cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
            visible: !!el.offsetParent,
          };
        };
        return {
          selectors: [A.like, A.commentBtn, A.collect, A.share, A.followBtn, A.drawer].map(probe),
          commentInputs: [...document.querySelectorAll('textarea,[contenteditable=true]')].map(t => ({
            tag: t.tagName,
            cls: (typeof t.className === 'string' ? t.className : '').slice(0, 50),
            ph: t.placeholder || '',
            visible: !!t.offsetParent,
          })),
          block: (document.body.innerText || '').slice(0, 200),
        };
      }, ARTICLE);
      console.log(JSON.stringify(art, null, 1));

      const block = await E.detectBlock(page);
      console.log('\n风控信号:', JSON.stringify(block));
    }
  } catch (e) {
    console.error('探测失败:', e.message);
  } finally {
    await ctx.close();
  }
})();
