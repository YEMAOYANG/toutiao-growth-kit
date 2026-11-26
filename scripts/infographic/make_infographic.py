# -*- coding: utf-8 -*-
"""
头条正文信息图生成器 — 把排查步骤/对比数据做成图，缓解纯文字疲劳、提高收藏率。
设计原则：
  - 深色卡片 + 高对比文字，信息流里醒目
  - 中文标题用 Pillow 排版（不用 AI 生图，字形可靠）
  - 每张图只讲 1 件事，配合正文插入点使用

用法: python3 make_infographic.py
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_L = "/System/Library/Fonts/STHeiti Light.ttc"

# 配色：深蓝底 + 青色强调 + 白字
BG = "#12212E"
CARD = "#1B3040"
ACCENT = "#3FC8C8"
WHITE = "#F5F7F8"
MUTED = "#9FB3C0"
RED = "#FF6B6B"
GREEN = "#5FD3A0"

W = 1000


def font(size, light=False):
    return ImageFont.truetype(FONT_L if light else FONT, size)


def new_canvas(h):
    img = Image.new("RGB", (W, h), BG)
    return img, ImageDraw.Draw(img)


def text_center(d, y, s, size, color, light=False):
    f = font(size, light)
    bbox = d.textbbox((0, 0), s, font=f)
    x = (W - (bbox[2] - bbox[0])) / 2
    d.text((x, y), s, fill=color, font=f)
    return y + size + 12


def header(d, title, subtitle=None):
    y = text_center(d, 44, title, 46, WHITE)
    if subtitle:
        y = text_center(d, y + 6, subtitle, 24, MUTED, light=True)
    return y + 26


def step_card(d, y, num, title, desc, h=118):
    d.rounded_rectangle([60, y, W - 60, y + h], radius=14, fill=CARD)
    d.rounded_rectangle([78, y + 20, 78 + 60, y + 80], radius=30, fill=ACCENT)
    nb = d.textbbox((0, 0), num, font=font(32))
    d.text((78 + 30 - (nb[2] - nb[0]) / 2, y + 26), num, fill=BG, font=font(32))
    d.text((160, y + 22), title, fill=WHITE, font=font(30))
    d.text((160, y + 66), desc, fill=MUTED, font=font(22, light=True))
    return y + h + 16


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, quality=92)
    print("生成:", path)


def make_steps():
    """排查3步骤流程图"""
    img, d = new_canvas(660)
    y = header(d, "延迟飙升，按这3步查", "游戏卡顿 · 通用排查流程示例")
    y = step_card(d, y, "1", "查域名解析", "改成本地运营商节点，成本0元")
    y = step_card(d, y, "2", "查后台占网", "关掉下载、云同步、系统更新")
    y = step_card(d, y, "3", "查用网时段", "晚高峰共享带宽拥塞，避开或换线")
    d.text((60, y + 4), "顺序别反：先定位，再花钱", fill=ACCENT, font=font(24))
    save(img, "diagnose-3steps.jpg")


def make_compare():
    """延迟/丢包/抖动对比图"""
    img, d = new_canvas(720)
    y = header(d, "打游戏卡，到底是哪种卡？", "3种情况 · 3种解法，别一律怪宽带")
    rows = [
        ("延迟高", "操作有拖沓感，画面还在动", "看线路，跨网要换", RED),
        ("丢包", "突然顿住、人物瞬移、报460", "查设备、查网线", ACCENT),
        ("抖动", "延迟忽高忽低，走位发飘", "避开晚高峰拥塞", GREEN),
    ]
    for title, symptom, fix, color in rows:
        d.rounded_rectangle([60, y, W - 60, y + 150], radius=14, fill=CARD)
        d.rectangle([60, y, 68, y + 150], fill=color)
        d.text((92, y + 18), title, fill=color, font=font(32))
        d.text((92, y + 62), "现象：" + symptom, fill=WHITE, font=font(23))
        d.text((92, y + 102), "对策：" + fix, fill=MUTED, font=font(23, light=True))
        y += 166
    save(img, "lag-types-compare.jpg")


def make_test():
    """3组实测数据卡"""
    img, d = new_canvas(600)
    y = header(d, "同一个游戏，3种网络差多少？", "实测延迟对比 · 数字越低越流畅")
    data = [
        ("家里网 · 晚高峰", "110 ms", RED, "偶尔跳到200以上"),
        ("手机热点", "60 ms", GREEN, "稳定但费流量"),
        ("家里网 · 改解析后", "70 ms", ACCENT, "本地节点，成本0元"),
    ]
    for label, val, color, note in data:
        d.rounded_rectangle([60, y, W - 60, y + 120], radius=14, fill=CARD)
        d.text((92, y + 20), label, fill=WHITE, font=font(28))
        d.text((92, y + 66), note, fill=MUTED, font=font(22, light=True))
        vb = d.textbbox((0, 0), val, font=font(42))
        d.text((W - 100 - (vb[2] - vb[0]), y + 34), val, fill=color, font=font(42))
        y += 136
    save(img, "network-test-data.jpg")


def make_peak():
    """晚高峰vs凌晨延迟对比"""
    img, d = new_canvas(560)
    y = header(d, "晚高峰和凌晨，差的不止一点", "同一设备 · 同一游戏 · 只差时间点")
    data = [
        ("晚8点", "110 ms", RED, "共享带宽被摊薄"),
        ("凌晨1点", "45 ms", GREEN, "通道空闲，自己跑"),
        ("相差", "65 ms", ACCENT, "设备没换，套餐没动"),
    ]
    for label, val, color, note in data:
        d.rounded_rectangle([60, y, W - 60, y + 110], radius=14, fill=CARD)
        d.text((92, y + 18), label, fill=WHITE, font=font(28))
        d.text((92, y + 62), note, fill=MUTED, font=font(21, light=True))
        vb = d.textbbox((0, 0), val, font=font(40))
        d.text((W - 100 - (vb[2] - vb[0]), y + 32), val, fill=color, font=font(40))
        y += 126
    save(img, "peak-hour-compare.jpg")


def make_accel_limits():
    """加速器3种无效场景"""
    img, d = new_canvas(700)
    y = header(d, "这3种情况，开了也白开", "加速器不是万能的 · 先看清能力边界")
    rows = [
        ("服务器崩了", "几万人一起掉线，等官方修", RED),
        ("无线信号差", "隔墙丢包，挪位置或插网线", ACCENT),
        ("设备过热", "降频卡顿，散热歇一会儿", GREEN),
    ]
    for title, desc, color in rows:
        d.rounded_rectangle([60, y, W - 60, y + 130], radius=14, fill=CARD)
        d.rectangle([60, y, 68, y + 130], fill=color)
        d.text((92, y + 22), title, fill=color, font=font(30))
        d.text((92, y + 72), desc, fill=WHITE, font=font(23))
        y += 146
    save(img, "accelerator-limits.jpg")


def make_router():
    """路由器摆位对比"""
    img, d = new_canvas(600)
    y = header(d, "路由器摆哪，延迟差一半", "同一个路由器 · 只挪了个位置")
    data = [
        ("塞在弱电箱里", "95 ms", RED, "金属遮挡，偶尔丢包"),
        ("放到客厅柜上", "50 ms", GREEN, "开阔居中，丢包没了"),
    ]
    for label, val, color, note in data:
        d.rounded_rectangle([60, y, W - 60, y + 120], radius=14, fill=CARD)
        d.text((92, y + 20), label, fill=WHITE, font=font(28))
        d.text((92, y + 66), note, fill=MUTED, font=font(21, light=True))
        vb = d.textbbox((0, 0), val, font=font(40))
        d.text((W - 100 - (vb[2] - vb[0]), y + 34), val, fill=color, font=font(40))
        y += 136
    d.text((60, y + 4), "居中 · 开阔 · 高处 · 远离微波炉", fill=ACCENT, font=font(23))
    save(img, "router-placement.jpg")


def make_settings():
    """射击游戏2个设置"""
    img, d = new_canvas(580)
    y = header(d, "刚枪慢半拍？先改这2处", "不花钱 · 几分钟调好")
    rows = [
        ("1", "放开帧数上限", "特效调低1档，操作反馈更快"),
        ("2", "关掉录像回放", "后台写硬盘，帧数忽高忽低"),
    ]
    for num, title, desc in rows:
        d.rounded_rectangle([60, y, W - 60, y + 130], radius=14, fill=CARD)
        d.rounded_rectangle([82, y + 32, 82 + 58, y + 90], radius=28, fill=ACCENT)
        nb = d.textbbox((0, 0), num, font=font(30))
        d.text((82 + 29 - (nb[2] - nb[0]) / 2, y + 38), num, fill=BG, font=font(30))
        d.text((168, y + 30), title, fill=WHITE, font=font(30))
        d.text((168, y + 76), desc, fill=MUTED, font=font(21, light=True))
        y += 146
    save(img, "shooter-2settings.jpg")


if __name__ == "__main__":
    make_steps()
    make_compare()
    make_test()
    make_peak()
    make_accel_limits()
    make_router()
    make_settings()
