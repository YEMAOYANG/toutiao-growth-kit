'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { SEARCH, SITE_HOST_ALLOW, ARTICLE, SIGNALS } = require('./selectors');
const { checkComment, judgeTarget } = require('./compliance');

const ROOT = path.resolve(__dirname, '..');
// 浏览器 profile：默认放在技能目录内，一处登录处处通用。
// 可用环境变量 TOUTIAO_PROFILE 覆盖（例如复用已有 profile）。
const PROFILE_DIR = process.env.TOUTIAO_PROFILE || path.join(ROOT, '.profile');
const LOG_DIR = path.join(ROOT, 'logs');
const COMMENT_LIB = path.join(ROOT, 'data', 'comments.txt');

// ---------- 限流配置（低频是头条养号的正确姿势，不是缺陷）----------
const LIMITS = {
  maxLike: 5,
  maxComment: 3,
  maxCollect: 3,
  maxFollow: 2,
  // 单条作品处理间隔（秒）
  gapBetweenItems: [40, 90],
  // 同一动作之间间隔（秒）
  gapBetweenActions: [8, 15],
  // 单次运行总时长上限（分钟）
  maxRunMinutes: 8,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// rand 既接受 [min,max] 区间，也接受单个数字（表示 min==max 的固定值）
const rand = (range) => {
  if (Array.isArray(range)) {
    const [a, b] = range;
    return a + Math.floor(Math.random() * (b - a + 1));
  }
  return range;
};

function log(...args) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}]`, ...args);
}

function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

// ---------- 登录态 ----------
async function launch(headless = false) {
  ensureDirs();
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    channel: 'chrome',           // 用系统 Chrome，指纹更接近真实用户
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return ctx;
}

async function checkLogin(ctx) {
  const page = await ctx.newPage();
  await page.goto('https://www.toutiao.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    return {
      hasLoginText: /登录/.test(txt.slice(0, 3000)),
      cookieLen: document.cookie.length,
    };
  });
  await page.close();
  return state;
}

/**
 * 检查头条号后台权益状态。
 * 2026-11-26 实测：绑定手机号后，评论提交按钮仍恒为 disable，
 * 真正原因是后台提示「请完善账号信息，解锁发布文章、视频等权益功能」。
 * 解法是用户本人在 今日头条App → 我的 → 设置 → 扫一扫 完成个人账号资料。
 */
async function checkAccountStatus(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto('https://mp.toutiao.com/profile_v4/index', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const state = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const m = txt.match(/欢迎来到你的创作中心\s*\n?\s*([^\n]{1,30})/);
      return {
        account: m ? m[1].trim() : null,
        incomplete: /请完善账号信息|完善账号信息/.test(txt),
        bindMobile: /bind_mobile|绑定手机/.test(location.href + txt),
        url: location.href,
      };
    });
    state.ready = !state.incomplete && !state.bindMobile;
    return state;
  } finally {
    await page.close();
  }
}

// ---------- 风控信号检测 ----------
async function detectBlock(page) {
  const body = await page.evaluate(() => document.body.innerText || '');
  for (const kw of SIGNALS.captcha) {
    if (body.includes(kw)) return { blocked: true, type: 'captcha', keyword: kw };
  }
  for (const kw of SIGNALS.rateLimit) {
    if (body.includes(kw)) return { blocked: true, type: 'rateLimit', keyword: kw };
  }
  for (const kw of SIGNALS.login) {
    if (body.includes(kw)) return { blocked: true, type: 'loginRequired', keyword: kw };
  }
  return { blocked: false };
}

// ---------- 搜索解析 ----------
/**
 * 从搜索页提取站内作品列表。
 * 链接是 sou.toutiao.com/search/jump?url=<真实URL> 包装，必须解出 url 再按域名过滤。
 */
async function searchSiteArticles(page, keyword, maxScan = 40) {
  let out = await scrapeSearch(page, SEARCH.url(keyword), maxScan);
  // 资讯页空 → 回退综合页
  if (!out.length) {
    out = await scrapeSearch(page, SEARCH.urlAll(keyword), maxScan);
  }
  return out;
}

async function scrapeSearch(page, url, maxScan) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // 滚动触发懒加载（头条搜索结果分批渲染，需多次滚动才够扫）
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 1100);
    await page.waitForTimeout(750);
  }

  const raw = await page.evaluate(() => {
    // 注意：搜索页里混着三类链接，必须全页扫描再按规则过滤
    //   1) 站内文章  www.toutiao.com/article/<id>   ← 目标
    //   2) 站内热榜  www.toutiao.com/trending/<id>  ← 不是作品，跳过
    //   3) 站外源    wandoujia / 18183 / douyin 等  ← 对其互动等于给外站导流，跳过
    // 所以不能只扫 .cs-card（那是热榜卡容器），必须扫全部 a[href*="/search/jump"]
    const links = [...document.querySelectorAll('a[href*="/search/jump"], a[href*="toutiao.com/article"]')];
    const out = [];
    const seen = new Set();

    for (const a of links) {
      let real = a.href;
      // 头条的跳转链接可能多层嵌套包装：
      //   未登录: jump?url=<真实URL>
      //   已登录: jump?url=jump%3Furl%3D<真实URL>   ← 会解出第二层
      // 需要循环解包，最多 4 层
      for (let i = 0; i < 4; i++) {
        try {
          const u = new URL(real);
          const enc = u.searchParams.get('url');
          if (!enc) break;
          const decoded = decodeURIComponent(enc);
          if (!decoded || decoded === real) break;
          real = decoded;
        } catch (_) { break; }
      }

      let host = '', pathname = '';
      try {
        const u = new URL(real);
        host = u.host;
        pathname = u.pathname;
      } catch (_) { continue; }

      // 站内作品路径有两种形态（随登录态/版本变化）：
      //   /article/<id>/   经典长链
      //   /a<id>/          新版短链
      const m = pathname.match(/\/(?:article|a)(\d+)/);
      if (!m) continue;                    // 排除 /trending/ 等非作品路径
      const articleId = m[1];
      if (seen.has(articleId)) continue;
      seen.add(articleId);

      // 从卡片容器里取摘要与作者
      const card = a.closest('.cs-card') || a.closest('.result-content') || a.parentElement;
      let snippet = '';
      let author = '';
      let title = (a.innerText || '').trim();
      let isVideoCard = false;
      if (card) {
        const cardText = (card.innerText || '');
        // 视频网格卡片特征：含「次观看」或「-视频」标记，或含时长 00:47
        isVideoCard = /次观看|-视频|\d{2}:\d{2}/.test(cardText) &&
                     /次观看|-视频/.test(cardText);

        const texts = [...card.querySelectorAll('div')]
          .map((d) => (d.innerText || '').trim())
          .filter((t) => t.length > 40 && t.length < 320);
        snippet = texts.sort((x, y) => y.length - x.length)[0] || '';
        author = (card.querySelector('[class*=author], .cs-text')?.innerText || '').trim().slice(0, 20);

        // 真实文章标题元素：.text-xl 优先（.cs-header 在视频卡里是「XX-视频」）
        const h = card.querySelector('.text-xl') || card.querySelector('h3, h4');
        if (h) {
          const ht = (h.innerText || '').trim();
          if (ht && ht.length >= 8 && !/^\d{1,2}[:：]\d{2}$/.test(ht)) title = ht;
        }
      }
      // 标题兜底：若仍像时间戳或带 -视频 后缀，从摘要首句取
      if (!title || /^[\d:：\s]+$/.test(title) || /-视频$/.test(title)) {
        const fromSnippet = (snippet || '').split(/[。！？\n]/)[0].trim();
        if (fromSnippet.length >= 6) title = fromSnippet.slice(0, 60);
      }

      out.push({
        articleId,
        url: `https://www.toutiao.com/article/${articleId}/`,
        title: title.slice(0, 120),
        snippet,
        author,
        isVideoCard,
      });
    }
    return out;
  });

  const out = [];
  for (const item of raw) {
    let host = '';
    try { host = new URL(item.url).host; } catch (_) { continue; }
    const isSite = SITE_HOST_ALLOW.some((h) => host === h || host.endsWith('.' + h));
    if (!isSite) continue;
    if (!item.title) continue;
    out.push(item);
    if (out.length >= maxScan) break;
  }
  return out;
}

// ---------- 真人行为模拟 ----------
async function humanPause(page, ms = 800) {
  // 随机移动鼠标 + 小幅滚动，避免"瞬移点击"的机器特征
  const x = rand([200, 1100]);
  const y = rand([200, 700]);
  await page.mouse.move(x, y, { steps: rand([8, 20]) });
  await page.mouse.wheel(0, rand([80, 260]));
  await page.waitForTimeout(ms);
}

async function clickHuman(page, selector, { optional = true } = {}) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) {
    if (optional) return false;
    throw new Error(`必需元素未找到: ${selector}`);
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(rand([400, 900]));
  await el.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(rand([900, 1800]));
  return true;
}

// ---------- 动作执行 ----------
async function doLike(page) {
  const before = await page.locator(ARTICLE.like).first().getAttribute('aria-label').catch(() => null);
  const ok = await clickHuman(page, ARTICLE.like);
  if (!ok) return { action: 'like', ok: false, reason: '按钮不存在' };
  const after = await page.locator(ARTICLE.like).first().getAttribute('aria-label').catch(() => null);
  const liked = after && /点赞\d+/.test(after) && before === after ? true : (after !== before);
  return { action: 'like', ok: true, before, after, changed: liked };
}

async function doCollect(page) {
  const before = await page.locator(ARTICLE.collect).first().getAttribute('aria-label').catch(() => null);
  const ok = await clickHuman(page, ARTICLE.collect);
  if (!ok) return { action: 'collect', ok: false, reason: '按钮不存在' };
  const after = await page.locator(ARTICLE.collect).first().getAttribute('aria-label').catch(() => null);
  return { action: 'collect', ok: true, before, after, changed: before !== after };
}

async function doFollow(page) {
  const btn = page.locator(ARTICLE.followBtn).first();
  if ((await btn.count()) === 0) return { action: 'follow', ok: false, reason: '无关注按钮' };
  const txt = (await btn.innerText().catch(() => '')).trim();
  if (!/关注/.test(txt)) return { action: 'follow', ok: false, reason: `按钮态异常:${txt}` };
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(rand([400, 900]));
  await btn.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(rand([1200, 2000]));
  const after = (await btn.innerText().catch(() => '')).trim();
  return { action: 'follow', ok: true, changed: /已关注|取消/.test(after) || after !== txt, after };
}

/**
 * 评论：打开抽屉 → 定位输入框 → 填入 → 发布
 * 登录后才有输入框，这里做多候选探测。
 */
async function doComment(page, text) {
  const gate = await detectBlock(page);
  if (gate.blocked && gate.type === 'loginRequired') {
    return { action: 'comment', ok: false, reason: '未登录，评论框未渲染' };
  }

  await clickHuman(page, ARTICLE.commentBtn);
  await page.waitForTimeout(rand([1200, 2200]));

  const drawer = page.locator(ARTICLE.drawer).first();
  if ((await drawer.count()) === 0) {
    return { action: 'comment', ok: false, reason: '评论抽屉未打开' };
  }

  let box = null;
  let usedSel = null;
  for (const sel of ARTICLE.commentBox) {
    const loc = drawer.locator(sel).first();
    if ((await loc.count()) > 0) {
      const visible = await loc.isVisible().catch(() => false);
      if (visible) { box = loc; usedSel = sel; break; }
    }
  }
  if (!box) {
    return { action: 'comment', ok: false, reason: '未找到评论输入框（可能未登录或选择器已变）' };
  }

  await box.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(rand([300, 700]));
  try {
    await box.click({ timeout: 5000 });
    await page.waitForTimeout(rand(200, 500));
    // contenteditable 用 type 逐字输入更稳（fill 对某些富文本无效）
    await page.keyboard.type(text, { delay: rand(40, 110) });
  } catch (e) {
    try {
      await box.click({ timeout: 4000 });
      await box.fill(text, { timeout: 5000 });
    } catch (e2) {
      return { action: 'comment', ok: false, reason: `填入失败: ${e2.message}` };
    }
  }
  await page.waitForTimeout(rand([900, 1600]));

  // 校验文本确实进去了
  const filled = await box.innerText().catch(() => '');
  if (!filled || filled.trim().length < 4) {
    return { action: 'comment', ok: false, reason: `文本未落入输入框(当前:${JSON.stringify(filled.slice(0, 20))})` };
  }

  // ---- 前置检查：账号是否具备发布/互动权益 ----
  // 未绑手机号、账号资料未完善、信用分不足时，提交按钮恒为 .disable，
  // 表现为「文本填进去了但评论发不出去」。必须在点击前识别并明确上报。
  const bindGate = await page.evaluate(() => {
    const btn = document.querySelector('.ttp-drawer .submit-btn');
    // 抽屉内任意 contenteditable 即为评论输入框
    const ta = document.querySelector('.ttp-drawer [contenteditable="true"]');
    return {
      hasText: !!(ta && (ta.innerText || '').trim().length > 0),
      disabled: !!(btn && /disable/.test(btn.className || '')),
      btnClass: btn ? btn.className : null,
      taLen: ta ? (ta.innerText || '').trim().length : -1,
    };
  });
  if (bindGate.hasText && bindGate.disabled) {
    return {
      action: 'comment',
      ok: false,
      reason: '文本已填入但提交按钮仍为 disable：账号发布/互动权益未解锁。请到 mp.toutiao.com 检查是否提示「完善账号信息」，按提示在今日头条App完成账号类型选择与实名；同时确认手机号已绑定、信用分正常。',
      text,
    };
  }

  // 发布按钮：内容有效后应由 React 自动解除 disable
  const submit = page.locator(ARTICLE.commentSubmit.join(', ')).first();
  if ((await submit.count()) === 0) {
    return { action: 'comment', ok: false, reason: '未找到发布按钮' };
  }
  await submit.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(rand([300, 700]));

  await submit.click({ timeout: 8000 }).catch((e) => {
    throw new Error(`点击发布失败: ${e.message}`);
  });
  await page.waitForTimeout(rand([2000, 3000]));

  // ---- 落地验证：不能只看点击成功，必须确认评论真的出现在列表里 ----
  const landed = await page.evaluate((t) => {
    const dr = document.querySelector('.ttp-drawer');
    if (!dr) return { ok: true, how: 'drawer-closed' };
    const txt = dr.innerText || '';

    // 只认评论区列表项里的文本，不能匹配输入框里的残留
    const items = [...dr.querySelectorAll('[class*=comment-item], [class*=item-], .reply-item')];
    for (const it of items) {
      const s = (it.innerText || '').trim();
      if (s.length > 8 && s.includes(t.slice(0, 12))) return { ok: true, how: 'in-list' };
    }
    // 评论数量已从 0 变正
    const countEl = dr.querySelector('.ttp-comment-wrapper .title span, [class*=count]');
    const n = parseInt((countEl?.textContent || '0').trim(), 10);
    if (!Number.isNaN(n) && n > 0) return { ok: true, how: `count=${n}` };

    if (/暂无评论/.test(txt)) return { ok: false, how: 'still-empty', sample: txt.slice(0, 120) };
    return { ok: false, how: 'unknown', sample: txt.slice(0, 160) };
  }, text);

  if (!landed.ok) {
    const b2 = await detectBlock(page);
    return {
      action: 'comment',
      ok: false,
      reason: `未落地(${landed.how})${b2.blocked ? ' 触发:' + b2.type : ''} ${landed.sample || ''}`,
      text,
    };
  }

  const after = await detectBlock(page);
  return {
    action: 'comment',
    ok: !after.blocked,
    reason: after.blocked ? `提交后触发:${after.type}` : undefined,
    usedSel,
    text,
    verified: landed.how,
  };
}

// ---------- 评论库 ----------
function loadComments() {
  if (!fs.existsSync(COMMENT_LIB)) return [];
  return fs
    .readFileSync(COMMENT_LIB, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((line) => line.split('|').map((s) => s.trim()).filter(Boolean));
}

// ---------- 台账 ----------
function writeLog(record) {
  ensureDirs();
  const day = new Date().toISOString().slice(0, 10);
  const f = path.join(LOG_DIR, `interact-${day}.jsonl`);
  fs.appendFileSync(f, JSON.stringify(record) + '\n');
}

module.exports = {
  LIMITS, sleep, rand, log, ensureDirs,
  launch, checkLogin, checkAccountStatus, detectBlock,
  searchSiteArticles, humanPause, clickHuman,
  doLike, doCollect, doFollow, doComment,
  loadComments, writeLog,
  checkComment, judgeTarget,
  PROFILE_DIR, LOG_DIR,
};
