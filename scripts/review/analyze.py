#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
头条复盘分析器 — 读取 stats.jsonl 台账，对比快照，计算互动率，输出诊断建议。

用法:
  python3 analyze.py              # 生成最新复盘报告并打印
  python3 analyze.py --weekly     # 周报（汇总7天）
"""
import json, os, argparse
from datetime import datetime, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(BASE, "reviews", "stats.jsonl")
REPORT_DIR = os.path.join(BASE, "reviews")


def load():
    if not os.path.isfile(LEDGER):
        return []
    out = []
    with open(LEDGER, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
    return out


def rate(part, whole):
    if not whole or whole <= 0:
        return 0.0
    return round(part / whole * 100, 2)


def diagnose(w, prev):
    """根据数据给出诊断。prev 为上一次快照中的同名作品，可能为空。"""
    imp = w.get("impressions") or 0
    reads = w.get("reads") or 0
    likes = w.get("likes") or 0
    comments = w.get("comments") or 0
    favs = w.get("favorites") or 0
    notes = []

    # 新发布保护期：展现<50 且无历史快照，说明刚发出去还在冷启动，
    # 此时低展现是正常现象，不报"展现偏低"避免误导改稿。
    is_new = prev is None and imp < 50
    if is_new:
        notes.append("新发布冷启动期（展现<50）：数据尚未起量属正常，观察24小时再判断，暂不改稿")
        return notes

    if imp < 100:
        notes.append("展现偏低：标题或选题可能没踩中搜索/推荐，建议换更具体的痛点词或蹭热点")
    elif imp < 500:
        notes.append("展现一般：可观察24小时，若仍不涨考虑改标题重发同题材")
    if imp > 0 and reads / imp < 0.1:
        notes.append("点击率低：标题吸引人但封面或正文开头没接住，建议换封面")
    if reads > 0 and rate(likes, reads) < 1:
        notes.append("点赞率低：内容价值感不足，建议加干货密度或信息图")
    if reads > 0 and rate(comments, reads) >= 1:
        notes.append("评论互动好：这个题材方向有效，建议同类型加量")
    if reads > 0 and rate(favs, reads) >= 2:
        notes.append("收藏率高：干货被认可，可做成系列")
    if prev:
        d_reads = reads - (prev.get("reads") or 0)
        d_likes = likes - (prev.get("likes") or 0)
        if d_reads <= 0 and d_likes <= 0:
            notes.append("数据停滞：可能已过推荐期，考虑下一篇换题材")
    return notes or ["数据平稳，暂无异常，继续按计划发布"]


def build_report(snaps, weekly=False):
    if not snaps:
        return "暂无数据，请先运行 fetch_stats.py"
    latest = snaps[-1]
    prev = snaps[-2] if len(snaps) >= 2 else None
    prev_map = {w["title"]: w for w in (prev or {}).get("works", [])}

    lines = []
    lines.append(f"# 头条复盘报告 · {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")
    lines.append(f"- 抓取时间：{latest.get('time', '未知')}")
    lines.append(f"- 作品总数：{latest.get('count', 0)}")
    lines.append(f"- 报告类型：{'周报' if weekly else '日报'}")
    lines.append("")
    lines.append("## 作品数据明细")
    lines.append("")
    lines.append("| 标题 | 展现 | 阅读 | 点赞 | 评论 | 收藏 | 点赞率 | 评论率 |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    for w in latest.get("works", []):
        imp, rd = w.get("impressions") or 0, w.get("reads") or 0
        lk, cm, fv = w.get("likes") or 0, w.get("comments") or 0, w.get("favorites") or 0
        lines.append(f"| {w['title'][:32]} | {imp} | {rd} | {lk} | {cm} | {fv} | "
                     f"{rate(lk, rd)}% | {rate(cm, rd)}% |")
    lines.append("")
    lines.append("## 诊断与调整建议")
    lines.append("")
    for w in latest.get("works", []):
        notes = diagnose(w, prev_map.get(w["title"]))
        lines.append(f"**{w['title'][:32]}**")
        for n in notes:
            lines.append(f"- {n}")
        lines.append("")

    if weekly:
        lines.append("## 一周趋势")
        lines.append("")
        for s in snaps[-7:]:
            works = s.get("works", [])
            total_rd = sum((w.get("reads") or 0) for w in works)
            total_lk = sum((w.get("likes") or 0) for w in works)
            lines.append(f"- {s.get('time', '?')[:10]}：{len(works)} 篇，累计阅读 {total_rd}，点赞 {total_lk}")

    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weekly", action="store_true")
    args = ap.parse_args()
    snaps = load()
    report = build_report(snaps, args.weekly)
    print(report)
    os.makedirs(REPORT_DIR, exist_ok=True)
    name = "review-weekly" if args.weekly else "review-latest"
    path = os.path.join(REPORT_DIR, f"{name}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(report + "\n")
    print(f"\n报告已写入: {path}")


if __name__ == "__main__":
    main()
