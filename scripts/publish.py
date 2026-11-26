#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
头条图文发布器 — 读取发布包 JSON，自动填标题/正文/声明/插图/封面并发布。

设计原则：
  1. 发布包驱动：所有内容、图片、声明都写在 JSON 里，脚本只负责执行。
  2. 登录后持久化：复用 persist profile，一次扫码长期免登录。
  3. 不误报成功：发布后必须去作品管理页核实标题存在，才判定成功。
  4. 合规硬要求：发布包声明的项（如「引用AI」）必须真实勾选。

用法:
  python3 publish.py --article <发布包.json> [--commit] [--no-verify]

发布包格式见 assets/article-package.example.json。
"""
import asyncio, json, os, sys, argparse
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.environ.get("TOUTIAO_PROFILE") or os.path.join(BASE, "..", "interact", ".profile")
PROFILE = os.path.abspath(PROFILE)
PUBLISH_URL = "https://mp.toutiao.com/profile_v4/graphic/publish"
VERIFY_URL = "https://mp.toutiao.com/profile_v4/manage/content/all?enter_from=left_menu"
STOP_FILE = os.path.join(BASE, ".stop")


def rec(log, who, msg):
    line = f"[{who}] {msg}"
    print(line)
    log.append(line)


async def dismiss_popups(page):
    for sel in ["text=我知道了", 'button:has-text("确定")']:
        try:
            loc = page.locator(sel).first
            if await loc.count() and await loc.is_visible():
                await loc.click()
                await page.wait_for_timeout(400)
        except Exception:
            pass


async def fill_body(page, html):
    """填正文：头条是 ProseMirror，用 innerHTML + input 事件同步状态。"""
    for sel in ["div.ProseMirror", "div.ql-editor", "div[contenteditable='true']"]:
        try:
            el = await page.wait_for_selector(sel, timeout=5000)
            if not el:
                continue
            await el.click()
            ok = await page.evaluate("""(html) => {
                const sels = ['div.ProseMirror','div.ql-editor',"div[contenteditable='true']"];
                const e = sels.map(x=>document.querySelector(x)).find(Boolean);
                if (!e) return false;
                e.innerHTML = html;
                e.dispatchEvent(new InputEvent('input', {bubbles:true}));
                e.dispatchEvent(new Event('change', {bubbles:true}));
                return true;
            }""", html)
            await page.wait_for_timeout(1200)
            if ok:
                return True
        except Exception:
            continue
    return False


async def set_declarations(page, declarations):
    """勾选作品声明（如「引用AI」）。实测 DOM：span.byte-checkbox-inner-text。"""
    results = []
    if not declarations:
        return results
    await page.wait_for_timeout(600)
    for name, want in declarations.items():
        if not want:
            results.append(f"{name}:跳过")
            continue
        try:
            ok = await page.evaluate("""(name) => {
                const spans = Array.from(document.querySelectorAll('span.byte-checkbox-inner-text'));
                const sp = spans.find(s => (s.innerText||'').trim() === name);
                if (!sp) return false;
                const label = sp.closest('label.byte-checkbox') || sp.closest('label');
                const input = label && label.querySelector('input[type=checkbox]');
                if (!input) return false;
                if (!input.checked) label.click();
                return input.checked === true;
            }""", name)
            results.append(f"{name}:{'✓' if ok else '✗未勾上'}")
            await page.wait_for_timeout(400)
        except Exception as e:
            results.append(f"{name}:✗{e}")
    return results


async def insert_illustrations(page, illustrations):
    """在锚点段落后插图。illustrations: [{after, path, caption}]。"""
    results = []
    if not illustrations:
        return results
    ed = None
    for sel in ["div.ProseMirror", "div[contenteditable='true']"]:
        try:
            ed = await page.wait_for_selector(sel, timeout=4000)
            if ed:
                break
        except Exception:
            pass
    if not ed:
        return ["插图失败:未找到编辑器"]

    for idx, item in enumerate(illustrations):
        after, path, caption = item.get("after", ""), item.get("path", ""), item.get("caption", "")
        try:
            if path and not os.path.isabs(path):
                path = os.path.join(BASE, "..", "..", path)
            path = os.path.abspath(path)
            if not os.path.isfile(path):
                results.append(f"图{idx+1}:✗文件不存在 {path}")
                continue
            before = await ed.evaluate("e => e.querySelectorAll('img').length")

            if after:
                await page.evaluate("""(anchor) => {
                    const ed = document.querySelector('div.ProseMirror');
                    if (!ed) return;
                    const ps = Array.from(ed.querySelectorAll('p,div'));
                    const p = ps.find(x => (x.innerText||'').includes(anchor) && x.children.length===0);
                    if (!p) return;
                    const r = document.createRange();
                    r.selectNodeContents(p); r.collapse(false);
                    const s = window.getSelection();
                    s.removeAllRanges(); s.addRange(r);
                    p.scrollIntoView({block:'center'});
                }""", after)
            else:
                await ed.click()
                await page.keyboard.press("End")

            btn = page.locator(".syl-toolbar-tool.image button").first
            if await btn.count() == 0:
                results.append(f"图{idx+1}:✗无图片工具按钮")
                continue
            await btn.click(force=True)
            await page.wait_for_timeout(1200)
            local = page.locator("text=本地上传").first
            if await local.count():
                await local.click()
                await page.wait_for_timeout(800)

            uploaded = False
            for _ in range(3):
                fi = page.locator("input[type=file][accept*='image']").first
                if await fi.count() == 0:
                    await page.wait_for_timeout(1000)
                    continue
                try:
                    await fi.set_input_files(path)
                    uploaded = True
                    break
                except Exception:
                    await page.wait_for_timeout(1000)
            if not uploaded:
                results.append(f"图{idx+1}:✗无法设置文件")
                continue

            for _ in range(10):
                await page.wait_for_timeout(2000)
                if await ed.evaluate("e => e.querySelectorAll('img').length") > before:
                    break
            ok = page.locator("button:has-text('确定')").last
            if await ok.count() and await ok.is_visible():
                try:
                    await ok.click(force=True)
                    await page.wait_for_timeout(1200)
                except Exception:
                    pass

            if await ed.evaluate("e => e.querySelectorAll('img').length") > before:
                if caption:
                    try:
                        cap = page.locator("textarea.pgc-img-caption-ipt").last
                        if await cap.count():
                            await cap.fill(caption)
                    except Exception:
                        pass
                results.append(f"图{idx+1}:✓已插入")
            else:
                results.append(f"图{idx+1}:✗上传后未进编辑器")
        except Exception as e:
            results.append(f"图{idx+1}:✗{str(e)[:60]}")
    return results


async def try_cover(page, cover_path):
    if not cover_path or not os.path.isfile(cover_path):
        return False, "无封面文件"
    # 找封面上传入口（likely "上传封面" / "添加封面" 按钮）
    for label in ["text=上传封面", "text=添加封面", "text=本地上传"]:
        try:
            loc = page.locator(label).first
            if await loc.count() and await loc.is_visible():
                await loc.click()
                await page.wait_for_timeout(800)
                break
        except Exception:
            pass
    fi = page.locator("input[type=file][accept*='image']").first
    try:
        if await fi.count():
            await fi.set_input_files(cover_path)
            await page.wait_for_timeout(2500)
            return True, "封面已上传"
    except Exception as e:
        return False, str(e)
    return False, "未找到封面上传控件"


async def verify_published(page, title):
    """发布后去作品管理页核实标题存在，避免假阳性。"""
    await page.goto(VERIFY_URL, wait_until="domcontentloaded")
    await page.wait_for_timeout(4500)
    await dismiss_popups(page)
    text = await page.evaluate("() => document.body.innerText || ''")
    return title in text or title[:15] in text


async def run(article, commit, no_verify, log):
    title = article.get("title", "")
    body = article.get("html", "") or article.get("content", "")
    cover = article.get("cover", "")
    if cover and not os.path.isabs(cover):
        cover = os.path.abspath(os.path.join(BASE, "..", "..", cover))
    decls = (article.get("compliance") or {}).get("declarations") or {}
    ills = article.get("illustrations", [])

    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            PROFILE, headless=False, channel="chrome",
            args=["--start-maximized"],
            viewport={"width": 1440, "height": 950})
        page = await ctx.new_page()
        try:
            rec(log, "系统", f"打开发文页: {PUBLISH_URL}")
            await page.goto(PUBLISH_URL, wait_until="domcontentloaded")
            await page.wait_for_timeout(4000)
            await dismiss_popups(page)
            if "/auth/page/login" in page.url:
                rec(log, "系统", "未登录：请在浏览器扫码登录后重试")
                return False
            rec(log, "系统", f"登录OK: {page.url}")

            # 标题
            try:
                ta = page.locator("textarea").first
                await ta.fill(title)
                rec(log, "系统", "标题✓")
            except Exception as e:
                rec(log, "系统", f"标题✗ {e}")

            # 正文
            ok = await fill_body(page, body)
            rec(log, "系统", f"正文 {'✓' if ok else '✗'}")

            # 声明
            dres = await set_declarations(page, decls)
            for d in dres:
                rec(log, "声明", d)

            # 插图
            ires = await insert_illustrations(page, ills)
            for i in ires:
                rec(log, "插图", i)

            # 封面
            if cover:
                cok, cmsg = await try_cover(page, cover)
                rec(log, "封面", f"{'✓' if cok else '✗'} {cmsg}")

            if not commit:
                rec(log, "系统", "观察模式（未加 --commit），不提交。")
                await ctx.close()
                return False

            # 发布
            btn = page.locator("button:has-text('预览并发布')").last
            if await btn.count() == 0:
                btn = page.locator("button:has-text('发布')").last
            if await btn.count() == 0:
                rec(log, "系统", "未找到发布按钮")
                return False
            await btn.click(force=True)
            await page.wait_for_timeout(3500)
            # 处理「确定发布」二次确认
            for label in ["button:has-text('确定发布')", "button:has-text('确认发布')"]:
                b = page.locator(label).first
                if await b.count() and await b.is_visible():
                    await b.click(force=True)
                    await page.wait_for_timeout(2500)
                    break
            rec(log, "系统", "已点击发布，等待核实…")
            await page.wait_for_timeout(3000)

            # 作品同步授权弹窗：点取消，只发头条
            cancel = page.locator("button:has-text('取消')").last
            if await cancel.count() and await cancel.is_visible():
                await cancel.click(force=True)
                await page.wait_for_timeout(800)

            if no_verify:
                rec(log, "系统", "按 --no-verify 跳过核实")
                return True

            landed = await verify_published(page, title)
            rec(log, "核实", "✓ 作品列表已命中标题，发布成功" if landed else "✗ 作品列表未命中，请人工核实")
            return landed
        finally:
            try:
                await ctx.close()
            except Exception:
                pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--article", required=True, help="发布包 JSON 路径")
    ap.add_argument("--commit", action="store_true", help="真正提交（默认只观察）")
    ap.add_argument("--no-verify", action="store_true", help="跳过发布后核实")
    args = ap.parse_args()

    if not os.path.isfile(args.article):
        print(f"发布包不存在: {args.article}")
        sys.exit(2)
    article = json.load(open(args.article, encoding="utf-8"))
    log = []
    ok = asyncio.run(run(article, args.commit, args.no_verify, log))
    print("\n===== 执行记录 =====")
    for line in log:
        print(line)
    print("===== 结果:", "成功" if ok else "未完成/失败", "=====")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
