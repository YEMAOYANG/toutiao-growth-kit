---
name: toutiao-growth-kit
display_name: 头条增长工具包
display_name_en: Toutiao Growth Kit
description: "今日头条内容运营全链路工具包：低频合规互动、图文自动发布、数据复盘、正文配图。当用户要求头条日常运营、发布头条文章、抓取头条作品数据、复盘头条内容或生成头条正文配图时使用。"
description_zh: "头条内容运营一条龙：合规互动、图文发布、数据复盘、正文配图，内建合规与异常保护。"
description_en: "All-in-one Toutiao content operations: low-frequency engagement, article publishing, stats review, and infographics, with built-in compliance and risk circuit-breakers."
examples_zh:
  - "帮我用头条日常运营，搜索游戏延迟高的作品点赞评论"
  - "把这篇稿子发布到头条，自动插图并勾选引用AI声明"
  - "抓取头条作品数据，生成今天的复盘报告"
examples_en:
  - "Do a low-frequency engagement round on Toutiao for game-lag posts"
  - "Publish this article to Toutiao with illustrations and AI declaration"
  - "Fetch Toutiao post stats and generate today's review report"
version: "1.0.0"
author: "toutiao-growth-kit contributors"
agent_created: true
allowed-tools: "Bash, Read, Write, Edit"
---

# 今日头条增长工具包

头条内容运营的一条龙工具：合规互动 → 内容发布 → 数据复盘 → 配图生成。所有选择器来自真实 DOM 侦察，所有动作内建低频限速与异常保护。

> **合规第一**：头条把自动化互动列为扣分项。本工具按低频、高质量设计，不追求量。遵守平台规则、不高频批量操作、不诱导、不站外导流是使用者自己的责任。详见 `@references/compliance.md`。

## 一、环境准备（首次必做）

1. **依赖**：Node.js 18+、Python 3.8+、系统 Chrome、Python 包 `playwright` 与 `Pillow`。
   ```bash
   npm install                       # 装 playwright（Node 版）
   pip install playwright Pillow
   python3 -m playwright install     # 若 Python 版缺浏览器（本工具用系统 Chrome，通常无需）
   ```
2. **登录**：所有脚本共用一份持久化浏览器 profile。
   ```bash
   node scripts/cli.js --login
   ```
   打开浏览器扫码登录。登录态保存在 `scripts/.profile/`，后续免登录。
   - 可用环境变量 `TOUTIAO_PROFILE` 指向别处。
   - **重要**：profile 必须始终用系统 Chrome（脚本已设 `channel: 'chrome'`）。不要用 Python Playwright 自带的 Chromium 打开同一 profile，会破坏 cookies 导致登录失效。

3. **账号权益检查**：
   ```bash
   node scripts/cli.js --check
   ```
   若输出 `ready: false`，说明账号资料未完善或未绑手机号，需到今日头条 App 完成实名与账号类型选择后才能发布/互动。

## 二、四大能力

### A. 合规互动

```bash
# 搜索关键词，筛站内作品，点赞+评论（低频）
node scripts/cli.js --keyword "游戏延迟高怎么办" --max 3 --do like,comment

# 只看不点（演练）
node scripts/cli.js --keyword "打游戏460" --dry-run

# 指定评论文案 / 允许品牌词 / 无头模式
node scripts/cli.js --keyword "..." --comment "技术补充文案" --allow-brand --headless
```

- 单次上限：点赞≤5、评论≤3、收藏≤3、关注≤2；动作间隔 8-15 秒，条目间隔 40-90 秒。
- 关键词池轮换，避免账号级模板指纹。文案库在 `scripts/comments.txt`，可自行扩充。
- 每条评论发出前自动过 `compliance.js`：联系方式、绝对化词、品牌词、纯中文校验。
- 命中验证码/操作频繁 → 立即保护性中止退出。
- 每次动作写台账 `scripts/logs/interact-<date>.jsonl`，评论落地需验证出现在列表（不认假阳性）。
- 头条改版后先跑 `node scripts/probe.js --keyword "..."` 重新侦察选择器，再改 `scripts/selectors.js`。

### B. 图文发布

发布包是一个 JSON（模板见 `templates/article-package.example.json`），字段：`title` / `content` / `cover` / `illustrations` / `compliance.declarations` 等。

```bash
# 先观察（不提交，检查填充是否正确）
python3 scripts/publish.py --article ./my-article.json

# 确认无误后真正发布
python3 scripts/publish.py --article ./my-article.json --commit
```

- 脚本用发布包驱动：标题、正文、声明、插图、封面全从 JSON 读。
- 声明（如「引用AI」）按发布包要求自动勾选，这是平台合规硬要求。
- **发布后默认去作品列表页核实标题存在**，避免"点了发布但没发出去"的假阳性。
- 若发布后弹出"作品同步授权"，脚本点取消，只发头条。

### C. 数据复盘

```bash
node scripts/fetch_stats.js          # 抓后台作品数据，写 reviews/stats.jsonl
node scripts/fetch_stats.js --dry    # 只打印
python3 scripts/analyze.py            # 出日报
python3 scripts/analyze.py --weekly   # 出周报
```

- 报告写入 `reviews/review-latest.md` / `review-weekly.md`。
- 分析含新发布冷启动保护：展现<50 且无历史快照时只提示观察，不误判为失败。
- 诊断维度：展现、点击率、点赞率、评论率、收藏率、数据停滞，逐篇给调整建议。
- 建议配合定时任务每日/每周跑，用数据驱动选题调整。

### D. 正文信息图

```bash
python3 scripts/make_infographic.py
```

- 生成深色卡片风格的信息图（排查步骤、类型对比、实测数据等），中文用系统字体排版，字形可靠。
- 图是"信息图"不是装饰图：每张只讲一件事，配正文插入点使用。
- 生成后把图片路径写进发布包的 `illustrations` 数组，发布脚本会自动插图。
- 字体路径在脚本顶部 `FONT` / `FONT_L`，非 macOS 系统需改成机器上已有的中文字体。

## 三、发布节奏建议

- 日常运营：每天早点赞 2-3 条、午评论 1 条、晚收藏关注各 1 条，关键词轮换，周日复盘。
- 发文：每天 1 篇，晚 19:30 前后；每 4 篇最多 1 篇带品牌词，其余纯干货。
- 复盘：每日看数据异常，每周从选题/标题/封面/配图/时段归因调整。

详细方法论见 `@references/content-playbook.md`；踩坑记录见 `@references/pitfalls.md`；DOM 选择器实测记录见 `@references/dom-anchors.md`。

## 四、自定义

- 品牌黑名单：在技能根目录 `config.json` 写 `{"brand_denylist": ["你的品牌词"]}`，评论会自动避开这些词。
- 竞品/软文过滤名单：`scripts/compliance.js` 的 `judgeTarget()`，按你的行业改。
- 评论文案库：`scripts/comments.txt`。
