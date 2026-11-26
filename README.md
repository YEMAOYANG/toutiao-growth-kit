# toutiao-growth-kit

今日头条内容运营全链路工具包：**合规互动 → 图文发布 → 数据复盘 → 配图生成**，一个技能打通。

选择器来自真实 DOM 侦察（非抄旧仓库），所有动作内建低频限速与异常保护。以 WorkBuddy Skill 形式分发，也可作为独立脚本库使用。

> ⚠️ **合规声明**：头条把自动化互动列为扣分项。本工具按低频、高质量设计，不追求量。请遵守平台规则，不要用于高频批量操作、诱导、站外导流。使用者自行承担合规责任，详见 [references/compliance.md](references/compliance.md)。

## 功能

| 模块 | 能力 |
|---|---|
| `scripts/cli.js` / `engine.js` 等 | 按关键词搜站内作品，点赞/评论/收藏/关注，合规校验 + 异常保护 + 落地验证 + 台账 |
| `scripts/publish.py` | 发布包驱动的图文发布：标题/正文/声明/插图/封面自动填充，发布后核实落地 |
| `scripts/fetch_stats.js` / `analyze.py` | 抓后台作品数据，日报/周报分析，数据驱动调整建议 |
| `scripts/make_infographic.py` | Pillow 生成中文信息图，配正文使用 |

## 安装

作为 WorkBuddy Skill 使用：把整个目录放到 `~/.workbuddy/skills/toutiao-growth-kit/`，重启 WorkBuddy 即可。

作为脚本库使用：

```bash
git clone <your-repo-url> toutiao-growth-kit
cd toutiao-growth-kit
npm install                 # Node: playwright
pip install playwright Pillow
```

需要系统 Chrome（脚本用 `channel: 'chrome'`，兼容系统浏览器）。

## 快速开始

### 1. 登录（一次扫码，长期免登录）

```bash
node scripts/cli.js --login
node scripts/cli.js --check    # 确认 ready: true
```

### 2. 合规互动

```bash
node scripts/cli.js --keyword "游戏延迟高怎么办" --max 3 --do like,comment
node scripts/cli.js --keyword "打游戏460" --dry-run   # 演练
```

### 3. 发布文章

先复制 `templates/article-package.example.json` 改成自己的发布包，填好标题、正文、封面、声明：

```bash
python3 scripts/publish.py --article ./my-article.json           # 观察模式
python3 scripts/publish.py --article ./my-article.json --commit  # 真正发布
```

### 4. 数据复盘

```bash
node scripts/fetch_stats.js
python3 scripts/analyze.py
python3 scripts/analyze.py --weekly
```

### 5. 生成正文配图

```bash
python3 scripts/make_infographic.py
```

非 macOS 系统需把脚本顶部 `FONT` / `FONT_L` 改成机器上已有的中文字体路径。

## 配置

- 品牌黑名单（互动时自动避开自己的品牌词）：复制 `config.json.example` 为 `config.json`，填入 `brand_denylist`。
- 竞品/软文过滤名单：`scripts/compliance.js` 的 `judgeTarget()`。
- 评论文案库：`scripts/comments.txt`。
- profile 路径：默认 `scripts/.profile/`，可用环境变量 `TOUTIAO_PROFILE` 覆盖。

## 重要提示

1. **profile 只用系统 Chrome 打开**。不要用 Python Playwright 自带 Chromium 打开同一 profile，会破坏 cookies。
2. **发布后必核实**：脚本默认去作品管理页查标题存在，别只看"点了发布"。
3. **新文章冷启动**：展现个位数正常，观察 24 小时再判断，分析器已内置保护。
4. 头条改版后用 `node scripts/probe.js --keyword "..."` 重新侦察选择器。

详细文档见 `references/`：`dom-anchors.md`（选择器实测）、`pitfalls.md`（踩坑记录）、`compliance.md`（合规规则）、`content-playbook.md`（运营方法论）。

## 许可

MIT — 详见 [LICENSE](LICENSE)。
