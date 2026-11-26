'use strict';

/**
 * 合规检查 —— 每条评论发出前必过。
 *
 * 依据头条《信用分机制》2026-04-22 版：
 *   - 恶意营销（评论留微信号/二维码/外链/引导私信）属"平台不鼓励"，重则扣分
 *   - 违规推广扣 20 分；≤30 分联动禁言 7 天
 * 故评论一律走"纯技术补充、无品牌、无联系方式"路线。
 */

// 联系方式 / 导流
const CONTACT_PATTERNS = [
  { name: '微信号', re: /(微信|weixin|wx|vx|v信|加v|薇信)\s*[:：]?\s*[a-zA-Z0-9_-]{4,}/i },
  { name: 'QQ号', re: /(qq|扣扣)\s*[:：]?\s*[0-9]{5,11}/i },
  { name: '手机号', re: /1[3-9]\d{9}/ },
  { name: '邮箱', re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
  { name: '外链', re: /https?:\/\/\S+|www\.[a-zA-Z0-9.-]+\.\w+/i },
  { name: '引导私信', re: /(私信我|加我好友|扣我|滴我|联系客服|私聊)/ },
  { name: '二维码', re: /(二维码|扫码领取|扫码领)/ },
];

// 绝对化 / 违规承诺（广告法 + 头条"不实内容"扣分项）
const BANNED_WORDS = [
  '免费', '免费领', '免费领取', '永久', '最后一天', '第一', '全网最快',
  '100%', '百分百', '绝对不卡', '永不掉线', '最稳定', '最强', '国家级',
  '包治', '根治', '保证有效',
];

// 品牌词：默认不允许在他人作品下提任意品牌（硬广风险）。
// 具体品牌名单由使用者在 config.json 的 brand_denylist 里自行填写；
// 这里只保留通用词与占位符，确保公开分发不携带任何特定产品名。
let BRAND_DENY = ['加速器', '万能神器', '必看绝了'];
try {
  const cfgPath = require('path').join(__dirname, '..', 'config.json');
  if (require('fs').existsSync(cfgPath)) {
    const cfg = JSON.parse(require('fs').readFileSync(cfgPath, 'utf8'));
    if (Array.isArray(cfg.brand_denylist) && cfg.brand_denylist.length) {
      BRAND_DENY = BRAND_DENY.concat(cfg.brand_denylist);
    }
  }
} catch (_) { /* 配置缺失时用默认规则 */ }

const MIN_LEN = 12;
const MAX_LEN = 80;

/**
 * @param {string} text 评论内容
 * @param {object} opts { allowBrand: boolean }
 * @returns {{ok:boolean, reasons:string[]}}
 */
function checkComment(text, opts = {}) {
  const reasons = [];
  const t = (text || '').trim();

  if (!t) {
    return { ok: false, reasons: ['评论为空'] };
  }
  if (t.length < MIN_LEN) reasons.push(`过短（${t.length}<${MIN_LEN}字）`);
  if (t.length > MAX_LEN) reasons.push(`过长（${t.length}>${MAX_LEN}字）`);

  for (const { name, re } of CONTACT_PATTERNS) {
    if (re.test(t)) reasons.push(`含${name}`);
  }
  for (const w of BANNED_WORDS) {
    if (t.includes(w)) reasons.push(`含禁用词「${w}」`);
  }
  if (!opts.allowBrand) {
    for (const w of BRAND_DENY) {
      if (t.includes(w)) reasons.push(`含品牌词「${w}」`);
    }
  }

  // 纯中文要求：英文技术缩写用中文表述更自然，也避免机器特征
  if (!opts.allowEnglish) {
    const eng = t.match(/[A-Za-z]{2,}/g);
    if (eng) reasons.push(`含英文「${[...new Set(eng)].join(',')}」`);
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * 判断一条作品是否适合互动（跳过推广帖 / 竞品帖 / 低质内容）
 * @param {{title:string, snippet:string, author?:string}} item
 * @returns {{skip:boolean, reason?:string}}
 */
function judgeTarget(item) {
  const body = `${item.title || ''} ${item.snippet || ''} ${item.author || ''}`;

  // 站外源由调用方过滤，这里只判内容特征
  const promoPatterns = [
    { name: '含外链', re: /https?:\/\/|www\./i },
    { name: '留联系方式', re: /(微信|加v|扣v|私信|联系我|ddjsq|评论区领取|主页领取)/i },
    { name: '竞品推广', re: /(sixfast|UU加速|迅游|奇游|biubiu|网易UU|雷神|netcup|UU\s*加速器)/i },
    { name: '明显广告', re: /(优惠码|折扣|限时|下单|购买链接|福利价|自营)/i },
    // 头条搜索里大量"加速器软文"，标题特征明显：一键/首选/推荐/避坑/安利
    { name: '软文特征', re: /(一键优化网络响应|网络加速你不知道的|开加速器到底有没有用|加速器推荐|加速器怎么选|哪个加速器好)/i },
    // 一键解决 / 一键优化 + 卡顿延迟 —— 典型工具软文
    { name: '一键类软文', re: /一键(解决|优化|提升|搞定|解决.*卡顿|解决.*延迟)/ },
    // 标题带引流购买/下载动作
    { name: '含引流动作', re: /(点击下载|立即下载|马上下载|领取福利|免费试用|下载客户端)/i },
    // 通篇自夸式"方法"标题，工具软文高发
    { name: '自夸式标题', re: /(解决.*问题$|不再|告别|轻松搞定|亲测有效|终极)/ },
  ];
  for (const { name, re } of promoPatterns) {
    if (re.test(body)) return { skip: true, reason: name };
  }

  // 正文过短（纯标签/一句话），互动价值低
  const len = (item.snippet || '').trim().length;
  if (len < 40) return { skip: true, reason: '正文过短' };

  // 标题过短或疑似时间戳，无互动价值
  const t = (item.title || '').trim();
  if (t.length < 6 || /^[\d:：\s]+$/.test(t)) return { skip: true, reason: '标题无效' };

  // 视频网格卡（聚合页干扰项，标题带 -视频 或含时长）
  if (item.isVideoCard) return { skip: true, reason: '视频网格卡' };
  if (/-视频$/.test(t)) return { skip: true, reason: '视频标签项' };

  return { skip: false };
}

module.exports = { checkComment, judgeTarget, CONTACT_PATTERNS, BANNED_WORDS, BRAND_DENY };
