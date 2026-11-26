#!/usr/bin/env node
'use strict';

const path = require('path');
const E = require('./engine');
const { LIMITS } = E;

function parseArgs(argv) {
  const args = {
    keyword: null, max: 3, do: 'like,comment', dryRun: false,
    headless: false, comment: null, allowBrand: false, maxScan: 40,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keyword') args.keyword = argv[++i];
    else if (a === '--max') args.max = parseInt(argv[++i], 10) || 3;
    else if (a === '--do') args.do = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--headless') args.headless = true;
    else if (a === '--comment') args.comment = argv[++i];
    else if (a === '--allow-brand') args.allowBrand = true;
    else if (a === '--max-scan') args.maxScan = parseInt(argv[++i], 10) || 40;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`
头条养号交互工具（toutiao-growth-kit）

用法:
  node scripts/interact/src/cli.js --keyword "<关键词>" [选项]

选项:
  --keyword <kw>     搜索关键词（必填）
  --max <n>          本次最多处理几条作品（默认 3）
  --do <list>        动作，逗号分隔: like,comment,collect,follow（默认 like,comment）
  --comment <text>   指定评论文案，多候选用 | 分隔；不填则从 data/comments.txt 随机取
  --dry-run          只打印计划，不实际点击
  --headless         无头模式（默认有头）
  --allow-brand      允许评论出现品牌词（默认禁止）
  --max-scan <n>     搜索页最多扫描条数（默认 40）

子命令:
  node scripts/interact/src/cli.js --check     检查登录态与账号权益
  node scripts/interact/src/cli.js --login     打开浏览器扫码登录（持久化）
`);
}

async function cmdLogin(args) {
  const ctx = await E.launch(false);
  const page = await ctx.newPage();
  await page.goto('https://www.toutiao.com/', { waitUntil: 'domcontentloaded' });
  E.log('浏览器已打开。请扫码登录头条号，登录完成后回到终端按 Enter 结束。');
  await new Promise((r) => {
    process.stdin.resume();
    process.stdin.once('data', () => r());
  });
  E.log('登录态已保存到', E.PROFILE_DIR);
  await ctx.close();
}

async function cmdCheck(args) {
  const ctx = await E.launch(args.headless);
  const state = await E.checkLogin(ctx);
  E.log('登录态检查:', JSON.stringify(state));
  try {
    const acct = await E.checkAccountStatus(ctx);
    E.log('账号权益:', JSON.stringify(acct));
    if (!acct.ready) {
      E.log('→ 发布/互动权益未解锁：请到今日头条App完成账号资料（我的 → 设置 → 扫一扫），再回到这里复测。');
    }
  } catch (e) {
    E.log('账号权益检查失败:', e.message);
  }
  await ctx.close();
  return state;
}

async function cmdInteract(args) {
  const acts = args.do.split(',').map((s) => s.trim()).filter(Boolean);
  const valid = ['like', 'comment', 'collect', 'follow'];
  for (const a of acts) {
    if (!valid.includes(a)) {
      console.error(`未知动作: ${a}（可选: ${valid.join(', ')}）`);
      process.exit(2);
    }
  }

  const counters = { like: 0, comment: 0, collect: 0, follow: 0 };
  const deadline = Date.now() + LIMITS.maxRunMinutes * 60 * 1000;
  const ctx = await E.launch(args.headless);
  const page = await ctx.newPage();

  try {
    // 1) 登录态
    const loginState = await E.checkLogin(ctx);
    E.log('登录态:', JSON.stringify(loginState));

    // 2) 搜索站内作品
    E.log(`搜索「${args.keyword}」…`);
    const items = await E.searchSiteArticles(page, args.keyword, args.maxScan);
    E.log(`筛出站内作品 ${items.length} 条（站外源已过滤）`);
    if (!items.length) {
      E.log('无可处理作品，退出。');
      return;
    }

    // 3) 逐条处理
    let processed = 0;
    for (const item of items) {
      if (processed >= args.max) break;
      if (Date.now() > deadline) { E.log('已达单次运行时长上限，提前收工。'); break; }

      // 内容筛选
      const verdict = E.judgeTarget(item);
      if (verdict.skip) {
        E.log(`跳过「${item.title.slice(0, 28)}…」 — ${verdict.reason}`);
        continue;
      }

      processed++;
      E.log(`\n── [${processed}/${args.max}] ${item.title.slice(0, 40)}`);

      if (args.dryRun) {
        E.log(`  (dry-run) 将访问 ${item.url}`);
        E.log(`  (dry-run) 计划动作: ${acts.join(', ')}`);
        continue;
      }

      const rec = {
        time: new Date().toISOString(),
        articleId: item.articleId,
        title: item.title,
        url: item.url,
        actions: [],
      };

      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(E.rand([1800, 3000]));

        const block = await E.detectBlock(page);
        if (block.blocked) {
          E.log(`  熔断：${block.type} (${block.keyword})`);
          rec.actions.push({ action: 'blocked', type: block.type });
          E.writeLog(rec);
          if (block.type === 'captcha' || block.type === 'rateLimit') {
            E.log('触发风控，立即停止本次运行。');
            break;
          }
          continue;
        }

        for (const act of acts) {
          if (Date.now() > deadline) { E.log('  已到时长上限，停止后续动作。'); break; }
          if (act !== 'comment' && counters[act] >= LIMITS[`max${act[0].toUpperCase()}${act.slice(1)}`]) {
            E.log(`  ${act} 达到单次上限（${LIMITS[`max${act[0].toUpperCase()}${act.slice(1)}`]}），跳过`);
            continue;
          }
          if (act === 'comment' && counters.comment >= LIMITS.maxComment) {
            E.log(`  comment 达到单次上限（${LIMITS.maxComment}），跳过`);
            continue;
          }

          // 动作间强制间隔
          await E.sleep(E.rand(LIMITS.gapBetweenActions) * 1000);

          let res;
          try {
            if (act === 'like') res = await E.doLike(page);
            else if (act === 'collect') res = await E.doCollect(page);
            else if (act === 'follow') res = await E.doFollow(page);
            else if (act === 'comment') {
              let text = args.comment;
              if (!text) {
                const lib = E.loadComments();
                const pool = lib.length ? lib : [['']];
                text = pool[Math.floor(Math.random() * pool.length)].join(' | ');
                if (text.includes(' | ')) text = text.split(' | ')[Math.floor(Math.random() * 2)];
              }
              const chk = E.checkComment(text, { allowBrand: args.allowBrand });
              if (!chk.ok) {
                E.log(`  comment 合规未过，跳过：${chk.reasons.join('、')}`);
                rec.actions.push({ action: 'comment', ok: false, reason: '合规未过', reasons: chk.reasons });
                continue;
              }
              res = await E.doComment(page, text);
            }
          } catch (e) {
            res = { action: act, ok: false, reason: e.message };
          }

          rec.actions.push(res);
          if (res.ok) counters[act]++;
          E.log(`  ${act}: ${res.ok ? '✓' : '✗'} ${res.reason || (res.changed === false ? '状态未变化' : '')}`);

          // 评论后立刻复查风控
          if (act === 'comment') {
            const b2 = await E.detectBlock(page);
            if (b2.blocked) {
              E.log(`  熔断：${b2.type}`);
              rec.actions.push({ action: 'blocked', type: b2.type });
              break;
            }
          }
        }

        E.writeLog(rec);
        E.log(`  → 台账已记录`);

        // 条目间长间隔
        if (processed < args.max) {
          const gap = E.rand(LIMITS.gapBetweenItems) * 1000;
          E.log(`  等待 ${Math.round(gap / 1000)}s 后处理下一条…`);
          await E.sleep(gap);
        }
      } catch (e) {
        E.log(`  处理失败: ${e.message}`);
        rec.actions.push({ action: 'error', reason: e.message });
        E.writeLog(rec);
      }
    }

    E.log('\n本次统计:', JSON.stringify(counters));
  } finally {
    await ctx.close();
  }
}

(async () => {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || (!args.keyword && !argv.includes('--check') && !argv.includes('--login'))) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  try {
    if (argv.includes('--login')) await cmdLogin(args);
    else if (argv.includes('--check')) await cmdCheck(args);
    else await cmdInteract(args);
  } catch (e) {
    console.error('运行失败:', e.message);
    process.exit(1);
  }
})();
