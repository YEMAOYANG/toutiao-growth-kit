# DOM 锚点实测记录

所有选择器来自 2026-11-26 对头条线上页面的真实 DOM 侦察。头条改版后用 `node scripts/probe.js` 重新确认，不要凭印象改。

## 搜索结果页

`https://so.toutiao.com/search?keyword=<kw>&dvpf=pc&pd=information...`（资讯子页，纯文章，需登录）

- 结果卡片容器：`.cs-card`（注意：这是热榜卡容器，不是文章列表，别用它当结果数）
- 链接形态：`sou.toutiao.com/search/jump?url=<真实URL>`，且可能**多层嵌套**（已登录时解出第二层）
  - 必须循环解包最多 4 层，再按域名过滤
  - 站内作品两种形态：`/article/<id>/` 与新版短链 `/a<id>/`
  - 站外源（wandoujia / 18183 / douyin 等）必须排除，对其互动等于给外站导流
- 真实标题元素：`.text-xl` 优先；视频网格卡的 `.cs-header` 会显示「XX-视频」或时间戳，需排除
- 摘要：卡片内长度 40-320 的文本节点；作者：`[class*=author]`

## 文章详情页

`https://www.toutiao.com/article/<id>/`

| 动作 | 选择器 | 备注 |
|---|---|---|
| 点赞 | `.detail-like` | aria-label="点赞238"，切换态 |
| 打开评论面板 | `.detail-interaction-comment` | |
| 收藏 | `.detail-interaction-collect` | 切换态 |
| 评论点赞 | `.ttp-comment-like` | 评论区内的赞 |
| 关注作者 | `.user-subscribe-wrapper` | 按钮文本「关注」 |
| 评论抽屉 | `.ttp-drawer` | 打开后出现；未登录不渲染输入框 |
| 评论输入框 | `.ttp-drawer [contenteditable="true"]` 等 5 个候选 | 见 selectors.js |
| 发布按钮 | `.ttp-drawer .submit-btn` | 内容有效后由 React 解除 disable |

**评论输入坑**：sticky header 会遮挡点击。需注入 `pointer-events:none` 到 header，再用 DOM 显式 `focus()` 后键盘输入；`fill()` 对富文本可能无效，优先 `keyboard.type`。

## 风控信号

- 验证码：验证码 / 安全验证 / 请完成验证 / 滑动验证
- 限流：操作频繁 / 请稍后再试 / 今日操作次数过多
- 未登录：请先登录后发表评论 / 登录后发表评论

命中即保护性中止退出。

## 后台发文页

`https://mp.toutiao.com/profile_v4/graphic/publish`

- 标题：`textarea` 第一个
- 正文编辑器：`div.ProseMirror`
- 图片工具：`.syl-toolbar-tool.image button` → 弹素材库 → 「本地上传」 → `input[type=file][accept*=image]`
- 图片上传后 src 落在 `image-tt-private.toutiao.com`，轮询最多 20 秒等进编辑器
- 作品声明：`span.byte-checkbox-inner-text` 文本即声明名，父 `label.byte-checkbox` 内有 checkbox
- 发布按钮：`button:has-text("预览并发布")`，之后可能有「确定发布」二次确认

## 作品管理页（核实发布）

`https://mp.toutiao.com/profile_v4/manage/content/all?enter_from=left_menu`

旧路径 `/manage/graphic` 已失效，别再用。发布后必须来这里核实标题存在，避免假阳性。
