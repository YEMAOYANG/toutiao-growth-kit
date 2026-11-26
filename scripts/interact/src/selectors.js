'use strict';

/**
 * 选择器常量 —— 全部来自 2026-11-26 对头条线上页面的真实 DOM 侦察。
 * 不要凭印象改这里；改之前先跑 `npm run probe` 重新侦察。
 */

// 搜索结果页
const SEARCH = {
  // 资讯子页（纯文章结果，无视频网格干扰）。必须登录才有内容。
  url: (kw) =>
    `https://so.toutiao.com/search?keyword=${encodeURIComponent(kw)}` +
    `&dvpf=pc&source=search_subtab_switch&pd=information&action_type=search_subtab_switch` +
    `&page_num=0&search_id=&from=news&cur_tab_title=news`,
  // 综合页（兜底，含热榜与视频网格）
  urlAll: (kw) =>
    `https://so.toutiao.com/search?dvpf=pc&source=input&traffic_source=&original_source=&keyword=${encodeURIComponent(kw)}`,
  card: '.cs-card',
  header: '.cs-header',
  title: '.text-xl',
  // 卡片内所有可能承载跳转的链接
  link: 'a[href*="/search/jump"], a[href*="toutiao.com/article"]',
};

// 站内作品域名白名单 —— 只有这些才允许点赞/评论
const SITE_HOST_ALLOW = [
  'www.toutiao.com',
  'toutiao.com',
  'm.toutiao.com',
];

// 文章详情页
const ARTICLE = {
  like: '.detail-like',
  likeAria: /^点赞/,
  commentBtn: '.detail-interaction-comment',
  collect: '.detail-interaction-collect',
  share: '.share-btn',
  commentLike: '.ttp-comment-like',
  followBtn: '.user-subscribe-wrapper',
  drawer: '.ttp-drawer',
  // 登录后评论输入框（2026-11-26 登录态实测确认）
  commentBox: [
    '.ttp-drawer .ttp-comment-input .comment-textarea',
    '.ttp-drawer .comment-textarea',
    '.ttp-comment-input .comment-textarea',
    '.ttp-drawer textarea',
    '.ttp-drawer [contenteditable="true"]',
  ],
  commentSubmit: [
    '.ttp-drawer .submit-btn',
    '.ttp-drawer .action .submit-btn',
  ],
};

// 登录/风控信号
const SIGNALS = {
  login: [
    '请先 登录 后发表评论',
    '请先登录后发表评论',
    '登录后发表评论',
  ],
  captcha: [
    '验证码',
    '安全验证',
    '请完成验证',
    '滑动验证',
  ],
  rateLimit: [
    '操作频繁',
    '请稍后再试',
    '操作太频繁',
    '稍后重试',
    '今日操作次数过多',
  ],
};

module.exports = { SEARCH, SITE_HOST_ALLOW, ARTICLE, SIGNALS };
