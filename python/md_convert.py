#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# SIZE_OK - 自包含单文件 CLI 转换器,经用户确认保持单体
"""WorkLift 工具箱 · Markdown 转换工具(本机 Python 后端)

读取 Markdown 文本并渲染为真实 PDF(A4)。由 Node 服务(server.js)通过子进程调用,
stdout/stderr 遵循与 pdf_convert.py 一致的 JSON 契约:

  成功:stdout 恰好一行 JSON {"ok": true, "numPages": N},exit 0
  失败:stderr 一行 JSON {"error": "中文信息"},exit 1

支持常见 Markdown 语法:标题 / 加粗 / 斜体 / 行内代码 / 围栏代码块 /
项目符号与有序列表 / 引用 / 分割线 / 表格 / 图片(相对路径或 data URI) / 链接。

渲染完全离线:英文用 PyMuPDF 内置 Helvetica / Courier,中文用内置 china-s 字体,
不依赖任何系统字体或外部引擎。
"""
import argparse
import base64
import json
import os
import re
import sys
from dataclasses import dataclass, field, replace

import pymupdf as fitz

# Windows 控制台默认 cp936,强制 UTF-8 保证中文 JSON 契约稳定
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ---------- 页面与样式常量 ----------
PAGE = fitz.paper_rect("a4")  # 595 x 842
MARGIN_X = 50.0
MARGIN_TOP = 52.0
MARGIN_BOTTOM = 44.0
CONTENT_W = PAGE.width - 2 * MARGIN_X  # 495
BODY_SIZE = 11.0
LINE_H = 16.5  # 正文字行高
CODE_SIZE = 10.0
CODE_LINE_H = 14.0
COLOR_TEXT = (0.13, 0.13, 0.13)
COLOR_SOFT = (0.45, 0.45, 0.45)
COLOR_ACCENT = (0.16, 0.34, 0.68)
MAX_IMG_BYTES = 20 * 1024 * 1024  # 嵌入图片大小上限 20MB（防内存滥用）


class MdError(Exception):
    """领域错误,携带中文信息。"""


# ---------- 内置字体 ----------
# PyMuPDF 内置字体无 heli(coi) 斜体变体,斜体回退到常规字体
_FONTS_CACHE = None


def fonts():
    global _FONTS_CACHE
    if _FONTS_CACHE is None:
        _FONTS_CACHE = {
            ("n", False): fitz.Font("helv"),
            ("n", True): fitz.Font("hebo"),
            ("m", False): fitz.Font("cour"),
            ("m", True): fitz.Font("cobo"),
            ("cjk", False): fitz.Font("china-s"),  # 内置简体中文字体
            ("cjk", True): fitz.Font("china-s"),
        }
    return _FONTS_CACHE


def _is_cjk(ch):
    o = ord(ch)
    return (
        0x2E80 <= o <= 0x9FFF  # CJK 部首/汉字/假名
        or 0x3000 <= o <= 0x303F  # CJK 标点
        or 0xAC00 <= o <= 0xD7AF  # 谚文
        or 0xF900 <= o <= 0xFAFF  # 兼容汉字
        or 0xFF00 <= o <= 0xFFEF  # 全角形式
    )


def _font_for(ch, mono, bold):
    if _is_cjk(ch):
        return fonts()[("cjk", False)]
    return fonts()[("m" if mono else "n", bold)]


# ---------- 数据模型 ----------
@dataclass
class Span:
    text: str
    bold: bool = False
    italic: bool = False
    mono: bool = False
    url: str = ""


@dataclass
class Block:
    kind: str  # heading|paragraph|code|quote|ul|ol|hr|table|image
    level: int = 0
    spans: list = field(default_factory=list)  # 行内 span
    lines: list = field(default_factory=list)  # code 行
    items: list = field(default_factory=list)  # 列表: list[list[Span]]
    rows: list = field(default_factory=list)  # 表格: list[list[list[Span]]]
    alt: str = ""
    src: str = ""


# ---------- 行内解析 ----------
_INLINE_RE = re.compile(
    r"(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`"
    r"|\[[^\]\n]+\]\([^)\s]+\)|<https?://[^\s>]+>|\\.)"
)


def _parse_inline(text):
    """text -> list[Span],处理 加粗/斜体/行内代码/链接/自动链接/转义。"""
    spans, pos = [], 0
    for m in _INLINE_RE.finditer(text):
        if m.start() > pos:
            spans.append(Span(text[pos:m.start()]))
        tok = m.group(1)
        if tok.startswith("**") and tok.endswith("**"):
            spans.append(Span(tok[2:-2], bold=True))
        elif tok.startswith("__") and tok.endswith("__"):
            spans.append(Span(tok[2:-2], bold=True))
        elif tok.startswith("*") and tok.endswith("*"):
            spans.append(Span(tok[1:-1], italic=True))
        elif tok.startswith("_") and tok.endswith("_"):
            spans.append(Span(tok[1:-1], italic=True))
        elif tok.startswith("`") and tok.endswith("`"):
            spans.append(Span(tok[1:-1], mono=True))
        elif tok.startswith("[") and "](" in tok:
            body, rest = tok[1:].split("](", 1)
            spans.append(Span(body, url=rest[:-1]))
        elif tok.startswith("<") and tok.endswith(">"):
            spans.append(Span(tok[1:-1], url=tok[1:-1]))
        else:  # 转义字符: \* \` 等
            spans.append(Span(tok[1:]))
        pos = m.end()
    if pos < len(text):
        spans.append(Span(text[pos:]))
    return spans


# ---------- 块级解析 ----------
_FENCE_OPEN_RE = re.compile(r"^(```+|~~~+)\s*(\S*)\s*$")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_HR_RE = re.compile(r"^(\s*)(-{3,}|\*{3,}|_{3,})\s*$")
_UL_RE = re.compile(r"^\s*([-*+])\s+(.*)$")
_OL_RE = re.compile(r"^\s*(\d+)[.)]\s+(.*)$")
_IMAGE_LINE_RE = re.compile(r"^!\[([^\]]*)\]\(([^)\s]+)\)\s*$")


def _table_row_cells(line):
    parts = line.strip().strip("|").split("|")
    return [_parse_inline(p.strip()) for p in parts]


def _is_table_divider(line):
    """表格分隔行: 去掉首尾管道后,每格形如 :-+: (可带空格,如 '| --- | ---: |')。"""
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return all(re.fullmatch(r":?-+:?", cell.strip()) for cell in s.split("|"))


def _is_table_start(lines, i):
    s = lines[i].strip()
    return "|" in s and i + 1 < len(lines) and _is_table_divider(lines[i + 1])


def _is_block_start(line):
    s = line.strip()
    if not s:
        return True
    if _HEADING_RE.match(s) or _FENCE_OPEN_RE.match(s) or s.startswith(">"):
        return True
    if _UL_RE.match(s) or _OL_RE.match(s) or _HR_RE.match(s) or _IMAGE_LINE_RE.match(s):
        return True
    return False


def parse_markdown(text):
    """Markdown 文本 -> Block 列表。"""
    lines = text.split("\n")
    blocks = []
    i, n = 0, len(lines)
    while i < n:
        st = lines[i].strip()
        if not st:
            i += 1
            continue

        # 围栏代码块
        m = _FENCE_OPEN_RE.match(st)
        if m:
            fence_char = m.group(1)[0]
            fence_len = len(m.group(1))
            code, j = [], i + 1
            while j < n:
                c = lines[j].strip()
                if c.startswith(fence_char * fence_len):
                    break
                code.append(lines[j])
                j += 1
            blocks.append(Block("code", lines=code))
            i = j + 1 if j < n else n
            continue

        # 标题
        m = _HEADING_RE.match(st)
        if m:
            blocks.append(Block("heading", level=len(m.group(1)), spans=_parse_inline(m.group(2))))
            i += 1
            continue

        # 分割线
        if _HR_RE.match(st):
            blocks.append(Block("hr"))
            i += 1
            continue

        # 引用(可合并多行)
        if st.startswith(">"):
            quoted = []
            while i < n and lines[i].strip().startswith(">"):
                quoted.append(lines[i].strip().lstrip(">").strip())
                i += 1
            blocks.append(Block("quote", spans=_parse_inline(" ".join(quoted))))
            continue

        # 表格(下一行为分隔行)
        if _is_table_start(lines, i):
            header = _table_row_cells(lines[i])
            rows, j = [], i + 2
            while j < n and "|" in lines[j].strip():
                rows.append(_table_row_cells(lines[j]))
                j += 1
            blocks.append(Block("table", rows=[header] + rows))
            i = j
            continue

        # 列表
        m = _UL_RE.match(st) or _OL_RE.match(st)
        if m:
            ordered = _OL_RE.match(st) is not None
            item_re = _OL_RE if ordered else _UL_RE
            items, j = [], i
            while j < n and item_re.match(lines[j].strip()):
                items.append(_parse_inline(item_re.match(lines[j].strip()).group(2)))
                j += 1
                # 非空且非新块的续行并入上一项
                while (
                    j < n
                    and lines[j].strip()
                    and not _is_block_start(lines[j])
                    and not _is_table_start(lines, j)
                    and not item_re.match(lines[j].strip())
                ):
                    items[-1].extend([Span(" ")] + _parse_inline(lines[j].strip()))
                    j += 1
            blocks.append(Block("ol" if ordered else "ul", items=items))
            i = j
            continue

        # 独立图片行
        m = _IMAGE_LINE_RE.match(st)
        if m:
            blocks.append(Block("image", alt=m.group(1), src=m.group(2)))
            i += 1
            continue

        # 段落(收集到空行或新块开始)
        para = []
        while i < n and lines[i].strip() and not _is_block_start(lines[i]) and not _is_table_start(lines, i):
            para.append(lines[i].strip())
            i += 1
        blocks.append(Block("paragraph", spans=_parse_inline(" ".join(para))))
    return blocks


# ---------- 排版(TextWriter 布局) ----------

@dataclass
class PageCtx:
    page: object
    tws: dict  # color -> TextWriter,同一页内按颜色分组(每行单色,分组不重叠)
    y: float = MARGIN_TOP


class PdfBuilder:
    """逐块布局:A4 内容区排版,超页自动换页。"""

    def __init__(self, out_path):
        self.doc = fitz.open()
        self.out_path = out_path
        self.pages = []
        self._new_page()

    def _new_page(self):
        self.doc.new_page(width=PAGE.width, height=PAGE.height)
        tws = {}
        self.pages.append(tws)
        self.ctx = PageCtx(self.doc[-1], tws)

    def ensure(self, needed):
        """剩余空间不足则换页。"""
        if self.ctx.y + needed > PAGE.height - MARGIN_BOTTOM:
            self._new_page()

    def draw_runs(self, x, runs, baseline, size, color):
        """runs: list[(text, font)] -> (text, font),返回末尾 x。按颜色分组存入该页 TextWriter。"""
        tw = self.ctx.tws.setdefault(color, fitz.TextWriter(self.ctx.page.rect))
        cur = x
        for text, font in runs:
            tw.append((cur, baseline), text, font=font, fontsize=size)
            cur += font.text_length(text, size)
        return cur

    def flush(self):
        # 注意: new_page 会使旧 Page 句柄失效,必须用 doc[i] 重取当前有效句柄
        for i, tws in enumerate(self.pages):
            page = self.doc[i]
            for color, tw in tws.items():
                tw.write_text(page, color=color)
            if len(self.pages) > 1:  # 单页不需要页码
                page.insert_text(
                    (PAGE.width / 2 - 8, PAGE.height - 20),
                    str(i + 1),
                    fontsize=9,
                    color=COLOR_SOFT,
                )
        self.doc.save(self.out_path, garbage=4, deflate=True)
        count = self.doc.page_count
        self.doc.close()
        return count


# ---------- 换行与 token ----------

def _tokenize(spans):
    """spans -> tokens[(text, span)]:ASCII 按词切分,CJK 逐字切分,空格单独成 token。"""
    tokens = []

    def flush(buf, sp):
        if buf:
            tokens.append((buf, sp))

    for sp in spans:
        buf = ""
        for ch in sp.text:
            if ch == " ":
                flush(buf, sp)
                buf = ""
                tokens.append((" ", sp))
            elif _is_cjk(ch):
                flush(buf, sp)
                buf = ""
                tokens.append((ch, sp))
            else:
                buf += ch
        flush(buf, sp)
    return tokens


def _measure_token(tok, size):
    text, sp = tok
    font = _font_for(text[0], sp.mono, sp.bold)
    return font.text_length(text, size)


def _runs_for_row(row):
    """row tokens -> [(text, fitz.Font)],按首个字符特性选字体(供 tw.append 使用)。"""
    return [(text, _font_for(text[0], sp.mono, sp.bold)) for text, sp in row]


def _wrap_tokens(tokens, width, size):
    """tokens -> 行列表 list[list[(text, span)]]。行首空格丢弃,超长词逐字符拆分。"""
    rows, row, row_w = [], [], 0.0

    def push(text, sp, w):
        nonlocal row_w
        row.append((text, sp))
        row_w += w

    for tok in tokens:
        text, sp = tok
        w = _measure_token(tok, size)
        if text == " ":
            if row and row[-1][0] != " ":
                push(text, sp, w)
            continue
        if row_w + w <= width:
            push(text, sp, w)
            continue
        if not row and w > width:
            # 单个不可分 token 超宽(如长 URL):逐字符拆分
            seg, seg_w = [], 0.0
            for ch in text:
                cw = _measure_token((ch, sp), size)
                if seg_w + cw > width and seg:
                    rows.append(seg)
                    seg, seg_w = [], 0.0
                seg.append((ch, sp))
                seg_w += cw
            if seg:
                rows.append(seg)
            continue
        rows.append(row)
        row, row_w = [tok], w
    if row:
        rows.append(row)
    return rows


# ---------- 各块渲染 ----------

class Renderer:
    def __init__(self, out_path):
        self.b = PdfBuilder(out_path)

    def _flow(self, spans, first_x, rest_x, width, size=BODY_SIZE, color=COLOR_TEXT, leading=LINE_H, prefix=None):
        """行内内容流式排版,支持首行前缀(列表符号)与悬挂缩进。"""
        tokens = _tokenize(spans)
        if prefix:
            tokens = prefix + tokens
        rows = _wrap_tokens(tokens, width, size)
        for idx, row in enumerate(rows):
            x = first_x if (idx == 0 and not prefix) else rest_x
            if prefix and idx == 0:
                # 前缀行:符号直接画在 first_x,内容紧随(悬挂缩进)
                self.b.ensure(leading)
                pw = self.b.draw_runs(first_x, _runs_for_row(prefix), self.b.ctx.y, size, color)
                self.b.draw_runs(pw, _runs_for_row(row), self.b.ctx.y, size, color)
            else:
                self.b.ensure(leading)
                self.b.draw_runs(x, _runs_for_row(row), self.b.ctx.y, size, color)
            self.b.ctx.y += leading
        return rows

    def heading(self, level, spans):
        size = {1: 20, 2: 16, 3: 14, 4: 12.5, 5: 11.5, 6: 11}[level]
        color = COLOR_ACCENT if level <= 3 else COLOR_TEXT
        spans = [replace(s, bold=True) for s in spans]  # 标题统一加粗展示
        self.b.ensure(size * 2.4 + 6)  # 避免标题孤行落在页尾
        self._flow(spans, MARGIN_X, MARGIN_X, CONTENT_W, size=size, color=color, leading=size + 9.0)
        self.b.ctx.y += 3.0

    def paragraph(self, spans):
        self._flow(spans, MARGIN_X, MARGIN_X, CONTENT_W)

    def quote(self, spans):
        tokens = _wrap_tokens(_tokenize(spans), CONTENT_W - 16, BODY_SIZE)
        ys = []
        for row in tokens:
            self.b.ensure(LINE_H)
            runs = _runs_for_row(row)
            self.b.draw_runs(MARGIN_X + 14, runs, self.b.ctx.y, BODY_SIZE, (0.35, 0.35, 0.4))
            ys.append(self.b.ctx.y)
            self.b.ctx.y += LINE_H
        if ys:
            self.b.ctx.page.draw_line(
                fitz.Point(MARGIN_X + 4, ys[0] - 3), fitz.Point(MARGIN_X + 4, ys[-1] + 8),
                color=(0.55, 0.55, 0.6), width=2.5,
            )
        self.b.ctx.y += 2.0

    def code_block(self, lines):
        pad = 12.0
        width = CONTENT_W - 2 * pad
        rows = []
        for ln in lines:
            span = Span(ln, mono=True)
            wrapped = _wrap_tokens([(t[0], span) for t in _tokenize([span])], width, CODE_SIZE)
            rows.extend(wrapped)
        total_h = len(rows) * CODE_LINE_H + 2 * pad
        self.b.ensure(total_h)
        y0 = self.b.ctx.y
        rect = fitz.Rect(MARGIN_X, y0, MARGIN_X + CONTENT_W, y0 + total_h)
        self.b.ctx.page.draw_rect(rect, color=None, fill=(0.93, 0.93, 0.95), width=0)
        y = y0 + pad + CODE_SIZE * 0.8
        for row in rows:
            runs = _runs_for_row(row)
            self.b.draw_runs(MARGIN_X + pad, runs, y, CODE_SIZE, COLOR_TEXT)
            y += CODE_LINE_H
        self.b.ctx.y = y0 + total_h + 6.0

    def ul(self, items):
        self._list(items, ordered=False)

    def ol(self, items):
        self._list(items, ordered=True)

    def _list(self, items, ordered):
        marker_w = 26.0
        bullet = "\u2022  "
        for idx, spans in enumerate(items, 1):
            marker = f"{idx}. " if ordered else bullet
            prefix = [(marker, Span(marker))]
            self._flow(spans, MARGIN_X, MARGIN_X + marker_w, CONTENT_W - marker_w, prefix=prefix)

    def hr(self):
        self.b.ensure(LINE_H)
        y = self.b.ctx.y + 8
        self.b.ctx.page.draw_line(
            fitz.Point(MARGIN_X, y), fitz.Point(MARGIN_X + CONTENT_W, y), color=COLOR_SOFT, width=0.8
        )
        self.b.ctx.y += LINE_H

    def table(self, rows):
        n_cols = max(len(r) for r in rows)
        pad = 6.0
        size = BODY_SIZE - 1.0
        col_w = [0.0] * n_cols
        for r in rows:
            for ci, cell in enumerate(r):
                toks = [t for t in _tokenize(cell) if t[0] != " "]
                w = max((_measure_token(t, size) for t in toks), default=0.0)
                col_w[ci] = max(col_w[ci], min(w, 200.0) + 2 * pad)
        total = sum(col_w)
        if total > CONTENT_W:
            scale = CONTENT_W / total
            col_w = [c * scale for c in col_w]
            total = CONTENT_W
        elif total < CONTENT_W and n_cols:
            col_w[-1] += CONTENT_W - total
            total = CONTENT_W
        row_lh = 14.0
        row_h = []
        cell_lines = []
        for r in rows:
            max_lines = 1
            lines_row = []
            for ci, cell in enumerate(r):
                toks = [t for t in _tokenize(cell) if t[0] != " "]
                lines = _wrap_tokens(toks, col_w[ci] - 2 * pad, size)
                lines_row.append(lines)
                max_lines = max(max_lines, len(lines))
            cell_lines.append(lines_row)
            row_h.append(max_lines * row_lh + 4.0)
        self.b.ensure(sum(row_h) + 4)
        y = self.b.ctx.y
        border = (0.6, 0.6, 0.6)
        for ri, lines_row in enumerate(cell_lines):
            h = row_h[ri]
            x = MARGIN_X
            for ci in range(n_cols):
                rect = fitz.Rect(x, y, x + col_w[ci], y + h)
                if ri == 0:
                    self.b.ctx.page.draw_rect(rect, color=border, fill=(0.94, 0.94, 0.96), width=0.6)
                else:
                    self.b.ctx.page.draw_rect(rect, color=border, width=0.6)
                lines = lines_row[ci] if ci < len(lines_row) else []
                yy = y + pad + 2
                for ln in lines:
                    runs = [
                        (text, _font_for(text[0], sp.mono, sp.bold or ri == 0))
                        for text, sp in ln
                    ]
                    self.b.draw_runs(x + pad, runs, yy, size, COLOR_TEXT)
                    yy += row_lh
                x += col_w[ci]
            y += h
        self.b.ctx.y = y + 10.0

    def image(self, alt, src, base_dir):
        raw = None
        if src.startswith("data:image/"):
            _, b64 = src.split(",", 1)
            try:
                decoded = base64.b64decode(b64)
                if len(decoded) <= MAX_IMG_BYTES:
                    raw = decoded
            except Exception:
                raw = None
        else:
            # 仅允许 base_dir 内的相对路径：拒绝绝对路径（防读取任意本机文件）与
            # .. 穿越（防逃出文档所在目录）；文件大小上限防内存滥用
            if not os.path.isabs(src):
                p = os.path.normpath(os.path.join(base_dir, src))
                base = os.path.normpath(base_dir)
                if (p == base or p.startswith(base + os.sep)) and os.path.isfile(p):
                    try:
                        if os.path.getsize(p) <= MAX_IMG_BYTES:
                            with open(p, "rb") as f:
                                raw = f.read()
                    except OSError:
                        raw = None
        max_w, max_h = CONTENT_W, 260.0
        self.b.ensure(60)
        try:
            img = fitz.Pixmap(raw) if raw else None
            if img is None:
                raise ValueError("图片不存在")
            w, h = img.width, img.height
            scale = min(max_w / w, max_h / h, 1.0)
            r = fitz.Rect(MARGIN_X, self.b.ctx.y, MARGIN_X + w * scale, self.b.ctx.y + h * scale)
            self.b.ctx.page.insert_image(r, stream=raw)
        except Exception:
            r = fitz.Rect(MARGIN_X, self.b.ctx.y, MARGIN_X + 220, self.b.ctx.y + 54)
            self.b.ctx.page.draw_rect(r, color=COLOR_SOFT, fill=(0.96, 0.96, 0.97), width=0.7)
            runs = [(f"[图片缺失: {alt or src} - {src}]", fonts()[("n", False)])]
            self.b.draw_runs(MARGIN_X + 8, runs, self.b.ctx.y + 24, 10, COLOR_SOFT)
        self.b.ctx.y = r.y1 + 10.0


# ---------- 对外入口 ----------

def markdown_to_pdf(md_text, out_path, base_dir=None):
    """Markdown 文本 -> PDF 文件,返回页数;失败抛 MdError。"""
    if base_dir is None:
        base_dir = os.path.dirname(os.path.abspath(out_path))
    blocks = parse_markdown(md_text)
    renderer = Renderer(out_path)
    try:
        for blk in blocks:
            if blk.kind == "heading":
                renderer.heading(blk.level, blk.spans)
            elif blk.kind == "paragraph":
                renderer.paragraph(blk.spans)
            elif blk.kind == "code":
                renderer.code_block(blk.lines)
            elif blk.kind == "quote":
                renderer.quote(blk.spans)
            elif blk.kind == "ul":
                renderer.ul(blk.items)
            elif blk.kind == "ol":
                renderer.ol(blk.items)
            elif blk.kind == "hr":
                renderer.hr()
            elif blk.kind == "table":
                renderer.table(blk.rows)
            elif blk.kind == "image":
                renderer.image(blk.alt, blk.src, base_dir)
        return renderer.b.flush()
    except MdError:
        raise
    except Exception as e:
        raise MdError(f"渲染失败: {e}") from e


# ---------- CLI ----------

class _Parser(argparse.ArgumentParser):
    """argparse 默认以 exit 2 结束,改为走统一 JSON 契约(exit 1)。"""

    def error(self, message):
        raise MdError(f"参数错误: {message}")


def _print_json(obj):
    print(json.dumps(obj, ensure_ascii=False))


def _print_error(e):
    print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)


def main(argv=None):
    parser = _Parser(prog="md_convert.py", description="WorkLift Markdown 转换工具")
    parser.add_argument("in_md", help="输入 Markdown 文件路径")
    parser.add_argument("out", nargs="?", default=None, help="输出 PDF 文件路径")
    parser.add_argument("--format", default="pdf", help="仅支持 pdf")

    try:
        args = parser.parse_args(argv)
        if args.format != "pdf":
            raise MdError(f"未知格式: {args.format} (仅支持 pdf)")
        if not os.path.isfile(args.in_md):
            raise MdError(f"文件不存在: {args.in_md}")
        if not args.out:
            raise MdError("缺少输出文件参数")
        with open(args.in_md, encoding="utf-8-sig") as f:
            text = f.read()
        num_pages = markdown_to_pdf(
            text, args.out, base_dir=os.path.dirname(os.path.abspath(args.in_md))
        )
        _print_json({"ok": True, "numPages": num_pages})
        return 0
    except MdError as e:
        _print_error(e)
        return 1
    except Exception as e:  # 未知异常同样走契约,避免裸 traceback 污染 stderr JSON
        _print_error(MdError(f"转换失败: {e}"))
        return 1


if __name__ == "__main__":
    sys.exit(main())