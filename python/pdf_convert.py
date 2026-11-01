#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# SIZE_OK - 自包含单文件 CLI 转换器,经用户确认保持单体
"""WorkLift 工具箱 · PDF 转换工具(本机 Python 后端)

解析 PDF 并输出真实格式:Word(.docx) / Excel(.xlsx) / PPT(.pptx) / 图片(.zip) / TXT(.txt) / Markdown(.md)。
由 Node 服务(server.js)通过子进程调用,stdout/stderr 遵循 JSON 契约:

  成功:stdout 恰好一行 JSON {"ok": true, "numPages": N}(--page 追加 "page": N),exit 0
  失败:stderr 一行 JSON {"error": "中文信息"},exit 1

转换策略(相对"整页截图"式转换):
  - 版面结构:按字号推断标题层级,同段落折行合并,列表/编号项识别,真实表格还原
  - 可编辑优先:Word / PPT / Excel 输出可编辑结构,仅扫描件(整页无文字)才嵌入整页图片
  - 去噪:多页文档中位于页边且重复出现的内容与纯页码自动剔除
  - 清晰度:图片按 3x 渲染(约 216 DPI),文档内嵌图用较低倍率控制体积
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import io
import json
import math
import os
import re
import sys
import zipfile
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass, field
from io import BytesIO
from typing import Callable, Iterator, Literal
from xml.sax.saxutils import escape

import pymupdf as fitz  # 官方导入名;fitz 别名会触发弃用警告污染 stdout

# ---------- 常量 ----------

RENDER_SCALE = 3.0  # 图片导出/预览渲染倍率(A4 约 1785×2526,≈216 DPI)
EMBED_SCALE = 2.0  # 文档内嵌整页图(扫描件兜底)倍率,控制文件体积
# 单页渲染像素上限:恶意/异常 PDF 可声明上万点的超大 MediaBox,按固定倍率渲染会申请数十 GB
# 内存并把进程拖死(本地拒绝服务)。改为按像素预算动态降倍率,正常 A4(≈4.5MP)不受影响。
MAX_RENDER_PIXELS = 30_000_000
MIN_RENDER_SCALE = 0.05  # 降采样下限,极端页面仍能产出可辨识缩略图
FORMATS = ("word", "excel", "ppt", "image", "txt", "md")

DEFAULT_FONT_SIZE = 12.0

# 标题判定:字号 ≥ 正文中位字号 × 该比值才视为标题
HEADING_MIN_RATIO = 1.15
HEADING_MARK_MAX = 6  # Markdown 最多支持 6 级标题

# 文本拼接
BULLET_CHARS = "\u2022\u00b7\uf0b7"  # • · 等常见项目符号
LIST_NUMBER_RE = re.compile(r"^\s*(?:\d{1,3}|[一二三四五六七八九十]{1,3})\s*[.)、](?!\d)\s*")
CJK_NO_SPACE_BEFORE = "，。、；：！？）》」』】”’,.!?;:%)]}"
CJK_NO_SPACE_AFTER = "（《「『【“‘([{"
SPAN_GAP_RATIO = 0.4  # 同行 span 间距 > 字号×0.4 视为词间空格
LINK_OVERLAP_RATIO = 0.5  # span 与链接矩形重叠 ≥50% 视为链接文字
LINE_GAP_RATIO = 0.9  # 行距 > 行高×0.9 视为新段落
MIN_LINE_HEIGHT_RATIO = 0.8

# 跨文本块合并(部分 PDF 每行/每段各占一个 block)
LINE_MERGE_GAP_RATIO = 0.8  # 块间垂直间距 ≤ 字号×1.2×该系数 视为同一段
LINE_MERGE_SIZE_TOLERANCE = 1.0  # 字号差超过该值不合并(避免标题串到正文)
LIST_CONTINUATION_TOLERANCE = 0.5  # 列表续行与列表符号的左边界容差(×字号)

# 段落对齐推断(基于行 bbox 与页面宽度)
CENTERED_MAX_WIDTH_RATIO = 0.85  # 超过该宽度不可能是居中标题
CENTERED_TOLERANCE_RATIO = 0.04  # 左右留白差 ≤ 页宽×该比例 视为居中
RIGHT_ALIGN_LEFT_RATIO = 0.55  # 右对齐:左留白 ≥ 页宽×该比例
RIGHT_ALIGN_RIGHT_RATIO = 0.08  # 且右留白 ≤ 页宽×该比例

# PyMuPDF span flags 位
BOLD_FLAG = 1 << 4
ITALIC_FLAG = 1 << 1
MONO_FLAG = 1 << 3

# 页眉页脚
PAGE_MARGIN_RATIO = 0.07  # 页上下各 7% 为页边区
REPEAT_PAGE_RATIO = 0.6  # 出现在 ≥60% 页面才判定为页眉/页脚
PAGE_NUMBER_RE = re.compile(r"^[\s\-–—]*(?:第\s*)?\d{1,4}(?:\s*页)?(?:\s*/\s*\d{1,4})?[\s\-–—]*$")

# Markdown 内嵌图片
MD_IMAGE_WIDTH_LIMIT = 480.0
MD_IMAGE_BYTES_CAP = 250_000
MD_IMAGE_MAX_SCALE = 2.0
MD_IMAGE_MIN_SIDE = 2.0

# Word
DOCX_BODY_FONT = "Microsoft YaHei"
DOCX_MONO_FONT = "Consolas"
DOCX_TEXT_WIDTH_INCHES = 6.5  # 整页图兜底宽度
DOCX_IMAGE_MAX_INCHES = 5.5  # 正文图片最大宽度
DOCX_IMAGE_MIN_INCHES = 0.3  # 极小图最小宽度,避免缩成不可见
DOCX_TABLE_FONT_PT = 10
DOCX_BODY_SPACE_AFTER_PT = 4
DOCX_HEADING_MAX_LEVEL = 4
DOCX_PT_PER_INCH = 72.0  # PDF 点 -> 英寸

# Excel
SHEET_NAME_MAX_LEN = 31
SHEET_BAD_CHARS_RE = re.compile(r"[\\/*?:\[\]]")
XLSX_TEXT_COL_WIDTH = 100
XLSX_COL_MIN_WIDTH = 10
XLSX_COL_MAX_WIDTH = 60
XLSX_COL_WIDTH_FACTOR = 1.6
XLSX_COL_WIDTH_PAD = 2
XLSX_HEADER_FILL = "F2EDE7"
XLSX_EMPTY_SHEET = "空文档"
NUMERIC_CELL_RE = re.compile(r"^(?P<sign>-)?(?P<int>\d{1,3}(?:,\d{3})+|\d+)(?P<frac>\.\d+)?$")
CURRENCY_SYMBOLS = "¥$€£"

# PPT
PPTX_SLIDE_WIDTH_IN = 13.333
PPTX_SLIDE_HEIGHT_IN = 7.5
PPTX_TITLE_PT = 30
PPTX_ITEM_PT = 18
PPTX_ITEM_SMALL_PT = 15
PPTX_ITEM_SMALL_THRESHOLD = 60  # 超过该字符数的要点用小一号字
PPTX_MAX_ITEMS = 20

# 原版式输出(Word/PPT):背景保留原始图形与图片,只把文字抽成绝对定位文本框
LAYOUT_BG_SCALE = 2.0
LAYOUT_BG_JPEG_QUALITY = 90
LAYOUT_BOX_MIN_PT = 1.0
LAYOUT_PAGE_SIZE_TOLERANCE_PT = 1.0


# ---------- 错误与数据模型 ----------


class PdfError(Exception):
    """领域错误,携带可直接展示给用户的中文信息。"""


BlockKind = Literal["heading", "paragraph", "list", "table", "image"]
ImageMode = Literal["all", "scanned", "none"]
BBox = tuple[float, float, float, float]


@dataclass
class Run:
    """一段同格式文本(粗体/斜体/等宽/超链接/字号/颜色)。"""

    text: str
    bold: bool = False
    italic: bool = False
    mono: bool = False
    link: str | None = None
    size: float = 0.0  # PDF 原始字号(pt),0 表示未知
    color: tuple[int, int, int] | None = None


@dataclass
class Block:
    """页面内的语义块;kind 决定各渲染器如何处理。"""

    kind: BlockKind
    text: str = ""
    level: int = 0
    runs: list[Run] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    image: bytes | None = None
    bbox: BBox = (0.0, 0.0, 0.0, 0.0)
    ordered: bool = False
    size: float = 0.0  # 标题/图片块的代表字号(pt)
    align: str = "left"  # 推断的段落对齐:left / center / right


@dataclass
class Page:
    """单页解析结果;blocks 恒为列表(未提取结构时为空列表)。"""

    num: int
    text: str
    png: bytes | None = None
    blocks: list[Block] = field(default_factory=list)
    height: float = 0.0
    width: float = 0.0


# ---------- 文本原语 ----------


def _is_cjk(char: str) -> bool:
    """是否为中日韩文字或全角标点(决定折行拼接是否补空格)。"""
    if not char:
        return False
    code = ord(char)
    return (
        0x3000 <= code <= 0x303F
        or 0x3400 <= code <= 0x4DBF
        or 0x4E00 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0xFF00 <= code <= 0xFF65
    )


def _join_text(left: str, right: str) -> str:
    """拼接折行的两段文本:中文之间不补空格,英文补一个,行尾连字符去掉。"""
    left, right = (left or "").rstrip(), (right or "").lstrip()
    if not left:
        return right
    if not right:
        return left
    if left.endswith("-") and len(left) > 1 and left[-2].isalpha() and right[:1].islower():
        return left[:-1] + right
    if left[-1] in CJK_NO_SPACE_AFTER or right[0] in CJK_NO_SPACE_BEFORE:
        return left + right
    if _is_cjk(left[-1]) and _is_cjk(right[0]):
        return left + right
    return left + " " + right


def _needs_space(left: str, right: str) -> bool:
    """折行拼接处是否需要一个空格(与 _join_text 的判定保持一致)。"""
    left, right = left or "", right or ""
    # 原文已带空格时不再补,避免 "and  offline" 这类双空格
    if not left.strip() or not right.strip():
        return False
    if left[-1].isspace() or right[0].isspace():
        return False
    left, right = left.rstrip(), right.lstrip()
    return _join_text(left, right) == left + " " + right


def _run_text(runs: list[Run]) -> str:
    return "".join(run.text for run in runs)


def _rect_tuple(value, default: BBox = (0.0, 0.0, 0.0, 0.0)) -> BBox:
    """把任意 bbox 值规整为 4 元浮点元组;非法值回退默认。"""
    try:
        return (float(value[0]), float(value[1]), float(value[2]), float(value[3]))
    except (TypeError, ValueError, IndexError, KeyError):
        return default


def _safe_rect(value) -> fitz.Rect | None:
    """把 bbox 转成 fitz.Rect;非法输入返回 None(链接/图片匹配的容错)。"""
    if not value:
        return None
    try:
        rect = fitz.Rect(value)
    except (TypeError, ValueError):
        return None
    return rect if rect.is_valid else None


def _link_targets(links) -> list[tuple[fitz.Rect, str]]:
    """链接字典 -> (矩形, URI) 列表,避免每个 span 重复构造 Rect。"""
    targets = []
    for link in links or []:
        rect = _safe_rect(link.get("from"))
        if rect is not None:
            targets.append((rect, link.get("uri", "") or ""))
    return targets


def _link_for(rect: fitz.Rect, targets: list[tuple[fitz.Rect, str]]) -> str | None:
    """命中链接的 span:重叠面积占 span ≥50% 取第一个匹配。"""
    area = rect.get_area()
    if area <= 0:
        return None
    for target, uri in targets:
        overlap = target & rect
        if overlap.is_valid and overlap.get_area() / area >= LINK_OVERLAP_RATIO:
            return uri
    return None


def _span_gap(span: dict, next_span: dict) -> float:
    """相邻 span 的水平间距;缺 bbox 时视为 0。"""
    try:
        return float(next_span["bbox"][0]) - float(span["bbox"][2])
    except (KeyError, IndexError, TypeError, ValueError):
        return 0.0


def _int_to_rgb(value) -> tuple[int, int, int] | None:
    """PyMuPDF 的 sRGB 整数(0xRRGGBB) -> (r, g, b);非法值返回 None。"""
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return ((number >> 16) & 0xFF, (number >> 8) & 0xFF, number & 0xFF)


def _span_runs(spans: list[dict], link_targets: list[tuple[fitz.Rect, str]]) -> list[Run]:
    """一行 span -> Run 列表:保留粗体/斜体/等宽/字号/颜色/链接,并按视觉间隙补空格。"""
    runs: list[Run] = []
    for index, span in enumerate(spans):
        text = span.get("text", "")
        if not text:
            continue
        flags = span.get("flags", 0) or 0
        size = float(span.get("size", DEFAULT_FONT_SIZE) or DEFAULT_FONT_SIZE)
        run = Run(
            text,
            bold=bool(flags & BOLD_FLAG),
            italic=bool(flags & ITALIC_FLAG),
            mono=bool(flags & MONO_FLAG),
            size=size,
            color=_int_to_rgb(span.get("color")) if "color" in span else None,
        )
        rect = _safe_rect(span.get("bbox"))
        if rect is not None:
            run.link = _link_for(rect, link_targets)
        runs.append(run)
        if index + 1 < len(spans):
            next_text = spans[index + 1].get("text", "") or ""
            if _span_gap(span, spans[index + 1]) > size * SPAN_GAP_RATIO and not (
                text[-1:].isspace() or next_text[:1].isspace()
            ):
                runs.append(Run(" "))
    return runs


def _render_inline(runs: list[Run]) -> str:
    """Run 列表 -> 内联 markdown(加粗/斜体/等宽/链接)。"""
    parts = []
    for run in runs:
        text = run.text
        if not text:
            continue
        if run.mono:
            text = f"`{text}`"
        if run.bold:
            text = f"**{text}**"
        if run.italic:
            text = f"*{text}*"
        if run.link:
            text = f"[{text}]({run.link})"
        parts.append(text)
    return "".join(parts).strip()


# ---------- 版面结构提取 ----------


def _body_font_size(raw_blocks: list[dict]) -> float:
    """正文中位字号:按字符数加权,并在接近高频的字号中取最小值。

    短文档里标题字数可能接近正文,只取「最常见字号」会把 22pt 标题误判为正文,
    进而把 16pt 小节误判成列表;取高频字号中的最小值可稳定落在正文上。
    """
    sizes: Counter[float] = Counter()
    for block in raw_blocks:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text")
                if text:
                    size = float(span.get("size", DEFAULT_FONT_SIZE) or DEFAULT_FONT_SIZE)
                    sizes[round(size, 1)] += len(text)
    if not sizes:
        return DEFAULT_FONT_SIZE
    maximum = max(sizes.values())
    candidates = [size for size, count in sizes.items() if count >= maximum * 0.5]
    return min(candidates)


def _strip_list_marker(text: str) -> str:
    """去掉行首的项目符号或编号。"""
    stripped = (text or "").lstrip()
    if stripped[:1] in BULLET_CHARS:
        return stripped[1:].lstrip()
    match = LIST_NUMBER_RE.match(stripped)
    return stripped[match.end() :].lstrip() if match else stripped


def _strip_marker_runs(runs: list[Run]) -> list[Run]:
    """去掉列表项首个 run 的符号前缀,保留其余内联样式。"""
    out: list[Run] = []
    stripped = False
    for run in runs:
        if stripped or not run.text:
            out.append(run)
            continue
        without_marker = _strip_list_marker(run.text)
        if without_marker == run.text:
            out.append(run)
            continue
        stripped = True
        if without_marker:
            out.append(
                Run(
                    without_marker,
                    bold=run.bold,
                    italic=run.italic,
                    mono=run.mono,
                    link=run.link,
                    size=run.size,
                    color=run.color,
                )
            )
    return out


def _flush_paragraph(pending: list[tuple[list[Run], BBox]]) -> Block | None:
    """把累积的多行合并为一个段落块;返回 None 表示无有效文本。"""
    if not pending:
        return None
    merged: list[Run] = []
    for index, (line_runs, _bbox) in enumerate(pending):
        if index and _needs_space(_run_text(merged), _run_text(line_runs)):
            merged.append(Run(" "))
        merged.extend(line_runs)
    text = _run_text(merged).strip()
    if not text:
        return None
    bbox: BBox = (
        min(item[1][0] for item in pending),
        pending[0][1][1],
        max(item[1][2] for item in pending),
        pending[-1][1][3],
    )
    return Block("paragraph", text=text, runs=merged, bbox=bbox)


def _blocks_from_text_block(raw: dict, body_size: float, link_targets: list[tuple[fitz.Rect, str]]) -> list[Block]:
    """把一个 PyMuPDF 文本块拆成语义块:标题 / 列表 / 段落(跨行合并)。"""
    blocks: list[Block] = []
    pending: list[tuple[list[Run], BBox]] = []

    def flush() -> None:
        block = _flush_paragraph(pending)
        if block is not None:
            blocks.append(block)
        pending.clear()

    for line in raw.get("lines", []):
        spans = line.get("spans", [])
        if not spans:
            continue
        text = "".join(span.get("text", "") for span in spans)
        if not text.strip():
            continue
        size = max(float(span.get("size", 0) or 0) for span in spans)
        bbox = _rect_tuple(line.get("bbox"))
        x0, y0, x1, y1 = bbox
        runs = _span_runs(spans, link_targets)
        first = text.lstrip()
        ordered = bool(LIST_NUMBER_RE.match(first)) and first[:1] not in BULLET_CHARS

        if body_size and size >= body_size * HEADING_MIN_RATIO:
            flush()
            blocks.append(
                Block(
                    "heading",
                    text=text.strip(),
                    runs=runs,
                    bbox=bbox,
                    size=size,
                )
            )
            continue

        if first[:1] in BULLET_CHARS or ordered:
            flush()
            item = _strip_list_marker(first)
            blocks.append(
                Block("list", text=item, runs=_strip_marker_runs(runs), bbox=bbox, ordered=ordered)
            )
            continue

        line_height = max(y1 - y0, size * MIN_LINE_HEIGHT_RATIO)
        if pending and (y0 - pending[-1][1][3]) > line_height * LINE_GAP_RATIO:
            flush()
        pending.append((runs, bbox))

    flush()
    return blocks


def _image_block(raw: dict) -> Block:
    return Block("image", image=raw.get("image"), bbox=_rect_tuple(raw.get("bbox")))


# ---------- 版面后处理(合并 / 层级 / 对齐) ----------


def _block_font_size(block: Block) -> float:
    """块内最大字号;0 表示未知(合成数据或图片块)。"""
    sizes = [run.size for run in block.runs if run.size > 0]
    return max(sizes) if sizes else 0.0


def _apply_heading_levels(blocks: list[Block]) -> None:
    """按字号从大到小排名分配标题级别:最大字号 = 1 级。

    比固定比值阈值更贴近真实文档:22pt/16pt/14pt 会稳定输出 1/2/3 级,
    而不是把 16pt 硬压成 4 级。
    """
    sizes = sorted({round(block.size, 1) for block in blocks if block.kind == "heading" and block.size > 0}, reverse=True)
    rank = {size: index + 1 for index, size in enumerate(sizes)}
    for block in blocks:
        if block.kind == "heading":
            block.level = min(rank.get(round(block.size, 1), 1), HEADING_MARK_MAX)


def _apply_alignment(blocks: list[Block], width: float) -> None:
    """根据 bbox 左右留白推断对齐方式(居中标题 / 右对齐落款 / 默认左对齐)。"""
    if width <= 0:
        return
    for block in blocks:
        if block.kind not in ("heading", "paragraph", "list"):
            continue
        x0, _, x1, _ = block.bbox
        left, right, span = x0, width - x1, x1 - x0
        if span <= 0:
            continue
        if span < width * CENTERED_MAX_WIDTH_RATIO and abs(left - right) <= width * CENTERED_TOLERANCE_RATIO:
            block.align = "center"
        elif left >= width * RIGHT_ALIGN_LEFT_RATIO and right <= width * RIGHT_ALIGN_RIGHT_RATIO:
            block.align = "right"


def _can_merge_blocks(previous: Block, current: Block) -> bool:
    """相邻块是否应合并:同字号、垂直间距小、水平方向属于同一栏。"""
    if current.kind != "paragraph" or previous.kind not in ("paragraph", "list"):
        return False
    previous_size = _block_font_size(previous)
    current_size = _block_font_size(current)
    if previous_size and current_size and abs(previous_size - current_size) > LINE_MERGE_SIZE_TOLERANCE:
        return False
    size = previous_size or current_size or DEFAULT_FONT_SIZE
    gap = current.bbox[1] - previous.bbox[3]
    if gap < -size or gap > size * 1.2 * LINE_MERGE_GAP_RATIO:
        return False
    if current.bbox[0] > previous.bbox[2] + size * 0.5:  # 起始点已越过上一行右边缘:多半是新栏/右栏
        return False
    if previous.kind == "list" and current.bbox[0] < previous.bbox[0] - size * LIST_CONTINUATION_TOLERANCE:
        return False
    return True


def _merge_blocks_into(previous: Block, current: Block) -> None:
    """把 current 的文本/样式并入 previous(保持 previous 的类型与列表属性)。"""
    joiner = " " if _needs_space(previous.text, current.text) else ""
    if previous.runs or current.runs:
        if joiner:
            previous.runs.append(Run(" "))
        previous.runs.extend(current.runs)
        previous.text = _run_text(previous.runs).strip()
    else:
        previous.text = f"{previous.text}{joiner}{current.text}".strip()
    previous.bbox = (
        min(previous.bbox[0], current.bbox[0]),
        previous.bbox[1],
        max(previous.bbox[2], current.bbox[2]),
        current.bbox[3],
    )


def _merge_continuous_blocks(blocks: list[Block]) -> list[Block]:
    """合并被 PDF 拆成多个 block 的同一段落/列表续行(常见于逐行插入的文本)。"""
    merged: list[Block] = []
    for block in blocks:
        if merged and _can_merge_blocks(merged[-1], block):
            _merge_blocks_into(merged[-1], block)
        else:
            merged.append(block)
    return merged


def _parse_raw_blocks(raw_blocks: list[dict], links=None) -> list[Block]:
    """PyMuPDF dict blocks -> 语义块列表(含图片块)。"""
    link_targets = _link_targets(links)
    body_size = _body_font_size(raw_blocks)
    blocks: list[Block] = []
    for raw in raw_blocks:
        if raw.get("type") == 1:
            blocks.append(_image_block(raw))
        else:
            blocks.extend(_blocks_from_text_block(raw, body_size, link_targets))
    return blocks


def _table_blocks(page: fitz.Page) -> list[Block]:
    """用 find_tables() 还原真实表格;识别失败或无表格返回空列表。

    注意:find_tables() 首次调用会向 stdout 打印提示语,直接污染 JSON 契约,必须重定向;
    表格识别属于增强能力,任何异常都退化为纯文本(不阻断整份转换)。
    """
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            finder = page.find_tables()
            tables = list(finder.tables)
            extracted = []
            for table in tables:
                try:
                    extracted.append(table.extract())
                except Exception:  # 单个表格解析失败不影响其它表格
                    extracted.append(None)
    except Exception:  # noqa: BLE001 - 见上:表格识别失败只降级,不报错
        return []

    blocks = []
    for table, rows in zip(tables, extracted):
        if not rows:
            continue
        normalized = [[" ".join((cell or "").split()) for cell in row] for row in rows]
        normalized = [row for row in normalized if any(row)]
        if len(normalized) < 2:
            continue
        width = max(len(row) for row in normalized)
        if width < 2:
            continue
        padded = [row + [""] * (width - len(row)) for row in normalized]
        blocks.append(Block("table", rows=padded, bbox=_rect_tuple(table.bbox)))
    return blocks


def _center_inside(inner: BBox, outer: BBox) -> bool:
    center_x = (inner[0] + inner[2]) / 2
    center_y = (inner[1] + inner[3]) / 2
    return outer[0] <= center_x <= outer[2] and outer[1] <= center_y <= outer[3]


def _extract_blocks(page: fitz.Page) -> list[Block]:
    """单页 -> 语义块列表(按阅读顺序排序,表格区域内的文字不会重复输出)。"""
    try:
        raw_blocks = page.get_text("dict").get("blocks", [])
    except Exception as exc:
        raise PdfError(f"无法解析 PDF 页面: {exc}") from exc
    try:
        links = page.get_links() or []
    except Exception:  # noqa: BLE001 - 无链接信息时降级为纯文本提取
        links = []

    tables = _table_blocks(page)
    blocks = _parse_raw_blocks(raw_blocks, links) + tables
    if tables:
        blocks = [
            block
            for block in blocks
            if block.kind == "table" or not any(_center_inside(block.bbox, table.bbox) for table in tables)
        ]
    blocks.sort(key=lambda block: (round(block.bbox[1], 1), round(block.bbox[0], 1)))
    blocks = _merge_continuous_blocks(blocks)
    _apply_heading_levels(blocks)
    _apply_alignment(blocks, float(page.rect.width))
    return blocks


def _blocks_to_text(blocks: list[Block]) -> str:
    """语义块 -> 纯文本(表格用制表符分列,便于粘贴到 Excel)。"""
    lines = []
    for block in blocks:
        if block.kind == "table":
            lines.extend("\t".join(row) for row in block.rows)
        elif block.kind != "image" and block.text:
            lines.append(block.text)
    return "\n".join(lines)


def _in_margin(bbox: BBox, height: float) -> bool:
    return bbox[3] <= height * PAGE_MARGIN_RATIO or bbox[1] >= height * (1 - PAGE_MARGIN_RATIO)


def _margin_key(text: str) -> str:
    """页边文本归一化键:数字抹平,使 "第 1 页" 与 "第 2 页" 视为同一个页脚。"""
    return re.sub(r"\d+", "#", (text or "").strip())


def _strip_running_headers(pages: list[Page]) -> None:
    """剔除页眉/页脚:多页文档剔除页边重复文本;纯页码在任意页数都剔除。"""
    repeated: set[str] = set()
    if len(pages) >= 2:
        counts: Counter[str] = Counter()
        for page in pages:
            if page.height <= 0:
                continue
            seen = set()
            for block in page.blocks:
                if block.kind == "image" or not _in_margin(block.bbox, page.height):
                    continue
                key = _margin_key(block.text)
                if key and key not in seen:
                    seen.add(key)
                    counts[key] += 1

        threshold = max(2, math.ceil(len(pages) * REPEAT_PAGE_RATIO))
        repeated = {key for key, count in counts.items() if count >= threshold}

    for page in pages:
        if page.height <= 0:
            continue
        page.blocks = [
            block for block in page.blocks if not _is_running_margin_block(block, page.height, repeated)
        ]


def _is_running_margin_block(block: Block, height: float, repeated: set[str]) -> bool:
    if block.kind == "image" or not _in_margin(block.bbox, height):
        return False
    text = (block.text or "").strip()
    return _margin_key(text) in repeated or bool(PAGE_NUMBER_RE.match(text))


# ---------- 页面加载 ----------


@contextmanager
def _open_pdf(path: str) -> Iterator[fitz.Document]:
    """统一打开/关闭 PDF,并把所有打开失败翻译成中文领域错误。"""
    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001 - 第三方库异常类型不稳定,统一转 PdfError
        raise PdfError(f"无法解析 PDF 文件: {exc}") from exc
    try:
        yield doc
    finally:
        doc.close()


def _render_scale(rect, scale: float, max_pixels: int | None = None) -> float:
    """按像素预算收敛渲染倍率。

    超大页面按 sqrt(预算/面积) 降采样,保证单页像素数 ≤ max_pixels,
    避免 page.get_pixmap 一次性申请巨量内存;正常页面返回原倍率(行为不变)。
    """
    budget_pixels = MAX_RENDER_PIXELS if max_pixels is None else max_pixels
    width = max(float(rect.width), 1.0)
    height = max(float(rect.height), 1.0)
    if budget_pixels <= 0:
        return scale
    budget_scale = math.sqrt(budget_pixels / (width * height))
    return max(min(scale, budget_scale), MIN_RENDER_SCALE)


def _render_png(page: fitz.Page, scale: float) -> bytes:
    effective = _render_scale(page.rect, scale)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(effective, effective))
    return pixmap.tobytes("png")


def _normalize_image_mode(render_images) -> ImageMode:
    """兼容历史参数(True/"auto"/False)并支持显式模式名。"""
    if render_images is True or render_images == "all":
        return "all"
    if render_images == "auto" or render_images == "scanned":
        return "scanned"
    return "none"


def count_pages(path: str) -> int:
    """快速统计页数(不渲染),失败抛 PdfError。"""
    with _open_pdf(path) as doc:
        return len(doc)


def extract_pages(
    path: str,
    scale: float = RENDER_SCALE,
    render_images=True,
    keep_blocks: bool = False,
) -> list[Page]:
    """逐页提取文本 + (可选)渲染 PNG,返回 Page 列表。

    render_images:
        True / "all"      -> 每页都渲染(图片导出/预览)
        "auto" / "scanned"-> 仅整页无可提取文本时才渲染(扫描件兜底,避免图文重复)
        其它              -> 不渲染
    keep_blocks:
        True -> 额外提取语义块(标题/段落/列表/表格),并清理页眉页脚
    """
    mode = _normalize_image_mode(render_images)
    pages: list[Page] = []
    with _open_pdf(path) as doc:
        for index in range(len(doc)):
            page = doc[index]
            raw_text = page.get_text("text") or ""
            blocks = _extract_blocks(page) if keep_blocks else []
            png = None
            if mode == "all":
                png = _render_png(page, scale)
            elif mode == "scanned" and not raw_text.strip():
                png = _render_png(page, min(scale, EMBED_SCALE))
            pages.append(
                Page(
                    num=index + 1,
                    text="" if keep_blocks else raw_text,  # 结构模式下由块派生,避免重复计算
                    png=png,
                    blocks=blocks,
                    height=float(page.rect.height),
                    width=float(page.rect.width),
                )
            )

    if keep_blocks:
        _strip_running_headers(pages)
        # 标题级别必须在整份文档范围内排名,否则只有单一字号的页面会把小节误判为一级标题
        _apply_heading_levels([block for page in pages for block in page.blocks])
        for page in pages:
            page.text = _blocks_to_text(page.blocks)
    return pages


def render_page(path: str, n: int, out_path: str, scale: float = RENDER_SCALE) -> None:
    """仅渲染第 n 页为 PNG 并写入 out_path。"""
    with _open_pdf(path) as doc:
        if n < 1 or n > len(doc):
            raise PdfError(f"页号超出范围: {n} (共 {len(doc)} 页)")
        page = doc[n - 1]
        effective = _render_scale(page.rect, scale)
        page.get_pixmap(matrix=fitz.Matrix(effective, effective)).save(out_path)


# ---------- TXT ----------


def _collapse_blank_lines(text: str) -> str:
    """连续空行压缩为一行,并去掉首尾空行。"""
    lines = []
    blank = 0
    for line in (text or "").splitlines():
        if not line.strip():
            blank += 1
            if blank > 1:
                continue
            lines.append("")
        else:
            blank = 0
            lines.append(line.rstrip())
    return "\n".join(lines).strip("\n")


def to_txt(pages: list[Page]) -> str:
    """UTF-8 文本,每页以 --- 第 N 页 --- 开头;连续空行压缩。"""
    parts = []
    for page in pages:
        body = _collapse_blank_lines(page.text)
        parts.append(f"--- 第 {page.num} 页 ---\n{body}".rstrip())
    return "\n\n".join(parts)


def _write_txt(pages: list[Page], out_path: str) -> None:
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(to_txt(pages))


# ---------- Markdown ----------


def _escape_md_cell(cell: str) -> str:
    return " ".join((cell or "").split()).replace("|", "\\|")


def _render_md_table(rows: list[list[str]]) -> str:
    """二维表 -> GFM 表格(不足的列补空,首行作表头)。"""
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [list(row) + [""] * (width - len(row)) for row in rows]
    lines = [
        "| " + " | ".join(_escape_md_cell(cell) for cell in normalized[0]) + " |",
        "| " + " | ".join("---" for _ in range(width)) + " |",
    ]
    for row in normalized[1:]:
        lines.append("| " + " | ".join(_escape_md_cell(cell) for cell in row) + " |")
    return "\n".join(lines)


def _image_markdown(page: fitz.Page, block: Block) -> str | None:
    """按 bbox 裁剪渲染为 PNG data URI;超限先降采样一次,仍超返回 None。"""
    rect = fitz.Rect(block.bbox) & page.rect
    if rect.is_empty or rect.width < MD_IMAGE_MIN_SIDE or rect.height < MD_IMAGE_MIN_SIDE:
        return None

    scale = min(MD_IMAGE_MAX_SCALE, MD_IMAGE_WIDTH_LIMIT / max(rect.width, 1.0))

    def render(factor: float) -> bytes:
        return page.get_pixmap(clip=rect, matrix=fitz.Matrix(factor, factor)).tobytes("png")

    data = render(scale)
    if len(data) > MD_IMAGE_BYTES_CAP:
        data = render(scale * math.sqrt(MD_IMAGE_BYTES_CAP / len(data)))
        if len(data) > MD_IMAGE_BYTES_CAP:
            return None
    return "![图片](data:image/png;base64," + base64.b64encode(data).decode("ascii") + ")"


def _block_inline(block: Block) -> str:
    return _render_inline(block.runs) if block.runs else block.text


def _render_markdown_blocks(blocks: list[Block], image_fn: Callable[[Block], str | None] | None = None) -> str:
    """语义块 -> markdown;块之间恰好一个空行。"""
    chunks: list[str] = []
    for block in blocks:
        if block.kind == "image":
            chunk = image_fn(block) if image_fn else None
            chunks.append(chunk or "![图片](data:,)")
        elif block.kind == "heading":
            marks = "#" * max(1, min(block.level, HEADING_MARK_MAX))
            chunks.append(f"{marks} {_block_inline(block)}")
        elif block.kind == "list":
            chunks.append(("- " if not block.ordered else "1. ") + _block_inline(block))
        elif block.kind == "table":
            chunks.append(_render_md_table(block.rows))
        else:
            chunks.append(_block_inline(block))
    return "\n\n".join(chunk for chunk in chunks if chunk.strip())


def markdown_from_blocks(blocks: list[dict], links=None, image_fn=None) -> str:
    """`page.get_text("dict")["blocks"]` -> 该页 markdown(不含分页标记)。"""
    parsed = _parse_raw_blocks(blocks, links)
    _apply_heading_levels(parsed)
    return _render_markdown_blocks(parsed, image_fn)


def _markdown_document(path: str) -> tuple[str, int]:
    """整份 PDF -> (markdown, 页数);只打开文件一次(图片裁剪需要 page 上下文)。"""
    with _open_pdf(path) as doc:
        pages = []
        for index in range(len(doc)):
            page = doc[index]
            pages.append(
                Page(
                    num=index + 1,
                    text="",
                    blocks=_extract_blocks(page),
                    height=float(page.rect.height),
                    width=float(page.rect.width),
                )
            )
        _strip_running_headers(pages)
        _apply_heading_levels([block for page in pages for block in page.blocks])

        chunks = []
        for page_info in pages:
            body = _render_markdown_blocks(
                page_info.blocks,
                lambda block, current=doc[page_info.num - 1]: _image_markdown(current, block),
            )
            chunks.append(f"--- 第 {page_info.num} 页 ---\n{body.rstrip()}")
        return "\n\n".join(chunks) + "\n", len(doc)


def extract_markdown(path: str) -> str:
    """整份 PDF -> 单个 markdown 字符串,每页以 --- 第 N 页 --- 分隔。"""
    return _markdown_document(path)[0]


def _write_markdown(in_path: str, out_path: str) -> int:
    text, num_pages = _markdown_document(in_path)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return num_pages


# ---------- 图片 ----------


def to_images_zip(pages: list[Page], out_path: str) -> None:
    """全部页面打包为 zip(单页也打包,不输出裸 PNG)。"""
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for page in pages:
            if page.png:
                archive.writestr(f"page_{page.num}.png", page.png)


# ---------- Word ----------


def _docx_set_default_font(doc) -> None:
    """正文默认中文字体,避免 Word 里中文回退成方框或宋体错位。"""
    from docx.oxml.ns import qn

    style = doc.styles["Normal"]
    style.font.name = DOCX_BODY_FONT
    try:
        style.element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), DOCX_BODY_FONT)
    except AttributeError:  # 极简模板可能没有 rPr/rFonts 结构
        pass


def _docx_add_runs(paragraph, runs: list[Run]) -> None:
    """按 run 写入文本,并尽量保留原文的字号与颜色。"""
    from docx.shared import Pt, RGBColor

    for run in runs:
        if not run.text:
            continue
        target = paragraph.add_run(run.text)
        if run.bold:
            target.bold = True
        if run.italic:
            target.italic = True
        if run.mono:
            target.font.name = DOCX_MONO_FONT
        if run.size > 0:
            target.font.size = Pt(run.size)
        if run.color:
            target.font.color.rgb = RGBColor(*run.color)


def _docx_set_alignment(paragraph, align: str) -> None:
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    mapping = {
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "left": WD_ALIGN_PARAGRAPH.LEFT,
    }
    if align in mapping:
        paragraph.alignment = mapping[align]


def _docx_add_text_paragraph(doc, block: Block, style: str | None = None):
    """写一个带 run 样式与对齐的段落;style 缺失时退回 Normal。"""
    try:
        paragraph = doc.add_paragraph(style=style) if style else doc.add_paragraph()
    except KeyError:  # 模板缺少样式时退回默认段落
        paragraph = doc.add_paragraph()
    if block.runs:
        _docx_add_runs(paragraph, block.runs)
    if not paragraph.runs:
        paragraph.add_run(block.text)
    _docx_set_alignment(paragraph, block.align)
    return paragraph


def _docx_add_table(doc, rows: list[list[str]]) -> None:
    from docx.shared import Pt

    columns = max(len(row) for row in rows)
    table = doc.add_table(rows=len(rows), cols=columns)
    try:
        table.style = "Table Grid"
    except (KeyError, ValueError):  # 模板缺少该样式时退回默认网格
        pass
    for row_index, row in enumerate(rows):
        for column_index in range(columns):
            cell = table.cell(row_index, column_index)
            cell.text = row[column_index] if column_index < len(row) else ""
            for run in cell.paragraphs[0].runs:
                run.font.size = Pt(DOCX_TABLE_FONT_PT)
                if row_index == 0:
                    run.bold = True


def _docx_add_picture(doc, data: bytes, width_inches: float) -> None:
    from docx.shared import Inches

    try:
        doc.add_picture(BytesIO(data), width=Inches(width_inches))
    except Exception:  # noqa: BLE001 - 损坏的内嵌图不应中断整篇转换
        return


def _docx_add_inline_image(doc, block: Block, page: Page) -> None:
    if not block.image:
        return
    width_pt = max(block.bbox[2] - block.bbox[0], 0.0)
    if width_pt <= 0 and page.width > 0:
        width_pt = page.width
    # 按 PDF 中的真实宽度换算英寸,而不是固定占正文宽度的比例(避免小图被继续缩小)
    width_inches = min(DOCX_IMAGE_MAX_INCHES, max(DOCX_IMAGE_MIN_INCHES, width_pt / DOCX_PT_PER_INCH))
    _docx_add_picture(doc, block.image, width_inches)


def _docx_write_block(doc, block: Block, page: Page) -> None:
    from docx.shared import Pt

    if block.kind == "heading":
        level = min(max(block.level, 1), DOCX_HEADING_MAX_LEVEL)
        _docx_add_text_paragraph(doc, block, style=f"Heading {level}")
    elif block.kind == "paragraph":
        paragraph = _docx_add_text_paragraph(doc, block)
        paragraph.paragraph_format.space_after = Pt(DOCX_BODY_SPACE_AFTER_PT)
    elif block.kind == "list":
        style = "List Number" if block.ordered else "List Bullet"
        try:
            paragraph = doc.add_paragraph(style=style)
        except KeyError:  # 模板缺少列表样式时降级为手写符号
            paragraph = doc.add_paragraph(("1. " if block.ordered else "- ") + block.text)
        else:
            if block.runs:
                _docx_add_runs(paragraph, block.runs)
            if not paragraph.runs:
                paragraph.add_run(block.text)
        _docx_set_alignment(paragraph, block.align)
    elif block.kind == "table":
        _docx_add_table(doc, block.rows)
        doc.add_paragraph("")
    elif block.kind == "image":
        _docx_add_inline_image(doc, block, page)


def _docx_set_page_size(doc, pages: list[Page]) -> None:
    """页面尺寸跟随 PDF 首页(A4/Letter),避免默认 Letter 导致版式偏移。"""
    from docx.shared import Inches

    for page in pages:
        if page.width > 0 and page.height > 0:
            section = doc.sections[0]
            section.page_width = Inches(page.width / DOCX_PT_PER_INCH)
            section.page_height = Inches(page.height / DOCX_PT_PER_INCH)
            return


def to_docx(pages: list[Page], out_path: str) -> None:
    """Word:可编辑结构化正文(标题/段落/列表/表格);仅扫描页嵌入整页图。

    不再为每页插入「第 N 页」标题(会污染目录),页与页之间用分页符分隔。
    """
    from docx import Document

    doc = Document()
    _docx_set_default_font(doc)
    _docx_set_page_size(doc, pages)
    for index, page in enumerate(pages):
        if index:  # 保留原始分页边界,但不写入任何可见标题
            doc.add_page_break()
        if page.png:  # 扫描件:整页图片兜底,跳过零散图片块避免重复贴图
            _docx_add_picture(doc, page.png, DOCX_TEXT_WIDTH_INCHES)
            continue
        for block in page.blocks:
            _docx_write_block(doc, block, page)
        if not page.blocks and page.text.strip():  # 未提取结构时的纯文本兜底
            for line in page.text.splitlines():
                if line.strip():
                    doc.add_paragraph(line.strip())
    doc.save(out_path)


# ---------- Excel ----------


def _sheet_name(base: str, used: set[str]) -> str:
    """工作表名:去非法字符、截断到 31 字符、重名追加序号。"""
    name = SHEET_BAD_CHARS_RE.sub("-", base or "Sheet")[:SHEET_NAME_MAX_LEN] or "Sheet"
    candidate = name
    index = 2
    while candidate in used:
        suffix = f"-{index}"
        candidate = name[: SHEET_NAME_MAX_LEN - len(suffix)] + suffix
        index += 1
    used.add(candidate)
    return candidate


def _xlsx_write_table(sheet, rows: list[list[str]]) -> None:
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    columns = max(len(row) for row in rows)
    for row_index, row in enumerate(rows, start=1):
        for column_index in range(1, columns + 1):
            raw = row[column_index - 1] if column_index - 1 < len(row) else ""
            value, number_format = _coerce_cell_value(raw)
            cell = sheet.cell(row=row_index, column=column_index, value=value)
            if number_format:
                cell.number_format = number_format
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            if row_index == 1:
                cell.font = Font(bold=True)
                cell.fill = PatternFill("solid", fgColor=XLSX_HEADER_FILL)

    sheet.freeze_panes = "A2"
    for column_index in range(1, columns + 1):
        longest = max(
            (len(str(sheet.cell(row=row, column=column_index).value or "")) for row in range(1, len(rows) + 1)),
            default=0,
        )
        width = longest * XLSX_COL_WIDTH_FACTOR + XLSX_COL_WIDTH_PAD
        sheet.column_dimensions[get_column_letter(column_index)].width = min(
            XLSX_COL_MAX_WIDTH, max(XLSX_COL_MIN_WIDTH, width)
        )


def _coerce_cell_value(text: str) -> tuple[object, str | None]:
    """表格单元格文本 -> (值, 数字格式)。

    纯数字(含千分位/货币符号)转成 Excel 数值,便于直接求和排序;
    保留原始小数位数作为 number_format(128.50 -> 128.5 但显示 128.50)。
    带前导零的编号(007、0123)按文本保留,避免丢位。
    """
    raw = (text or "").strip()
    if not raw:
        return raw, None
    candidate = raw[1:].lstrip() if raw[:1] in CURRENCY_SYMBOLS else raw
    match = NUMERIC_CELL_RE.match(candidate)
    if not match:
        return raw, None
    digits = match.group("int").replace(",", "")
    if len(digits) > 1 and digits.startswith("0"):
        return raw, None
    number_text = ("-" if match.group("sign") else "") + digits + (match.group("frac") or "")
    try:
        fraction = match.group("frac")
        if fraction:
            return float(number_text), "0." + "0" * (len(fraction) - 1)
        return int(number_text), "0"
    except ValueError:
        return raw, None


def _xlsx_write_text(sheet, text: str) -> None:
    from openpyxl.styles import Alignment

    sheet.column_dimensions["A"].width = XLSX_TEXT_COL_WIDTH
    row = 1
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        cell = sheet.cell(row=row, column=1, value=line.strip())
        cell.alignment = Alignment(vertical="top", wrap_text=True)
        row += 1
    if row > 1:
        sheet.freeze_panes = "A2"


def to_xlsx(pages: list[Page], out_path: str) -> None:
    """Excel:识别到的表格按真实行列输出(表头加粗/冻结首行/自适应列宽),其余按文本行输出。"""
    from openpyxl import Workbook

    workbook = Workbook()
    workbook.remove(workbook.active)
    used: set[str] = set()

    for page in pages:
        tables = [block for block in page.blocks if block.kind == "table"]
        # 表格内容已写入独立工作表,文本表只放表外文字,避免同一份数据出现两次
        text = _blocks_to_text([block for block in page.blocks if block.kind != "table"])
        if tables:
            for index, table in enumerate(tables, start=1):
                base = f"第{page.num}页" if index == 1 else f"第{page.num}页-表{index}"
                _xlsx_write_table(workbook.create_sheet(title=_sheet_name(base, used)), table.rows)
            if text.strip():
                title = _sheet_name(f"第{page.num}页-文本", used)
                _xlsx_write_text(workbook.create_sheet(title=title), text)
        else:
            title = _sheet_name(f"第{page.num}页", used)
            _xlsx_write_text(workbook.create_sheet(title=title), text)

    if not workbook.sheetnames:
        workbook.create_sheet(title=XLSX_EMPTY_SHEET)
    workbook.save(out_path)


# ---------- PPT ----------


def _pptx_texts(blocks: list[Block]) -> tuple[str, list[str]]:
    """语义块 -> (标题, 要点列表);标题取第一个标题块,要点不截断(由调用方分页)。"""
    title = ""
    items: list[str] = []
    for block in blocks:
        if block.kind not in ("heading", "paragraph", "list"):
            continue
        if block.kind == "heading" and not title:
            title = block.text
            continue
        items.append(("• " if block.kind == "list" else "") + block.text)
    return title, items


def _pptx_add_title(slide, title: str) -> None:
    from pptx.util import Inches, Pt

    frame = slide.shapes.add_textbox(Inches(0.7), Inches(0.45), Inches(11.9), Inches(1.1)).text_frame
    frame.word_wrap = True
    frame.text = title
    frame.paragraphs[0].font.size = Pt(PPTX_TITLE_PT)
    frame.paragraphs[0].font.bold = True


def _pptx_add_items(slide, items: list[str]) -> None:
    from pptx.util import Inches, Pt

    frame = slide.shapes.add_textbox(Inches(0.9), Inches(1.8), Inches(11.5), Inches(4.9)).text_frame
    frame.word_wrap = True
    for index, item in enumerate(items):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.text = item
        size = PPTX_ITEM_PT if len(item) < PPTX_ITEM_SMALL_THRESHOLD else PPTX_ITEM_SMALL_PT
        paragraph.font.size = Pt(size)
        paragraph.space_after = Pt(6)


def to_pptx(pages: list[Page], out_path: str) -> None:
    """PPT:文本页输出可编辑标题+要点;整页无文字(扫描件)才用整页图片。"""
    from pptx import Presentation
    from pptx.util import Inches

    presentation = Presentation()
    presentation.slide_width = Inches(PPTX_SLIDE_WIDTH_IN)
    presentation.slide_height = Inches(PPTX_SLIDE_HEIGHT_IN)
    blank_layout = presentation.slide_layouts[6]
    total = len(pages)

    for page in pages:
        title, items = _pptx_texts(page.blocks)
        if not title and not items and page.png:
            slide = presentation.slides.add_slide(blank_layout)
            try:
                slide.shapes.add_picture(
                    BytesIO(page.png), 0, 0, width=presentation.slide_width, height=presentation.slide_height
                )
            except Exception:  # noqa: BLE001 - 图片异常时保留可读的页码占位
                pass
            _pptx_add_footer(slide, page.num, total)
            continue

        # 单页要点过多时自动续页,避免被静默截断
        chunks = [items[index : index + PPTX_MAX_ITEMS] for index in range(0, len(items), PPTX_MAX_ITEMS)] or [[]]
        for chunk_index, chunk in enumerate(chunks):
            slide = presentation.slides.add_slide(blank_layout)
            if chunk_index == 0:
                slide_title = title
            else:
                slide_title = f"{title or f'第 {page.num} 页'}（续）"
            if slide_title:
                _pptx_add_title(slide, slide_title)
            if chunk:
                _pptx_add_items(slide, chunk)
            _pptx_add_footer(slide, page.num, total)

    presentation.save(out_path)


def _pptx_add_footer(slide, page_num: int, total: int) -> None:
    from pptx.util import Inches

    footer = slide.shapes.add_textbox(Inches(11.8), Inches(7.05), Inches(1.4), Inches(0.4))
    footer.text_frame.text = f"{page_num} / {total}"


# ---------- 原版式输出(Word / PPT) ----------


_LAYOUT_NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
)


def _layout_font_name(name: str) -> str:
    """去掉 PDF 字体子集前缀(ABCDEF+)与回退列表,尽量沿用原字体名。"""
    value = re.sub(r"^[A-Z]{6}\+", "", (name or "").strip())
    value = value.split(",")[0].strip()
    return value or DOCX_BODY_FONT


def _layout_color_hex(value: int) -> str:
    return f"{(value >> 16) & 255:02X}{(value >> 8) & 255:02X}{value & 255:02X}"


def _layout_emu(points: float) -> int:
    return max(0, int(round(points * 12700)))


def _layout_anchor(inner: str, x: float, y: float, width: float, height: float, shape_id: int, behind: bool) -> str:
    """生成 WordprocessingML 浮动锚点(相对页面左上角定位)。"""
    return (
        f"<w:r {_LAYOUT_NS}><w:drawing>"
        f'<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" '
        f'relativeHeight="{shape_id}" behindDoc="{1 if behind else 0}" locked="0" '
        f'layoutInCell="1" allowOverlap="1">'
        f'<wp:simplePos x="0" y="0"/>'
        f'<wp:positionH relativeFrom="page"><wp:posOffset>{_layout_emu(x)}</wp:posOffset></wp:positionH>'
        f'<wp:positionV relativeFrom="page"><wp:posOffset>{_layout_emu(y)}</wp:posOffset></wp:positionV>'
        f'<wp:extent cx="{_layout_emu(width)}" cy="{_layout_emu(height)}"/>'
        f'<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>'
        f'<wp:docPr id="{shape_id}" name="Shape{shape_id}"/><wp:cNvGraphicFramePr/>'
        f"{inner}</wp:anchor></w:drawing></w:r>"
    )


def _layout_picture_xml(rid: str, width: float, height: float, shape_id: int) -> str:
    inner = (
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="page-bg.jpg"/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{_layout_emu(width)}" cy="{_layout_emu(height)}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        "</pic:pic></a:graphicData></a:graphic>"
    )
    return _layout_anchor(inner, 0, 0, width, height, shape_id, behind=True)


def _layout_run_xml(span: dict) -> str:
    text = span.get("text") or ""
    size = max(float(span.get("size") or DEFAULT_FONT_SIZE), 1.0)
    font = escape(_layout_font_name(span.get("font") or "")).replace('"', "&quot;")
    color = _layout_color_hex(int(span.get("color") or 0))
    flags = int(span.get("flags") or 0)
    half_points = max(1, int(round(size * 2)))
    props = f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}"/>'
    if flags & BOLD_FLAG:
        props += "<w:b/>"
    if flags & ITALIC_FLAG:
        props += "<w:i/>"
    props += f'<w:color w:val="{color}"/><w:sz w:val="{half_points}"/><w:szCs w:val="{half_points}"/>'
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def _layout_textbox_xml(span: dict, shape_id: int) -> str:
    x0, y0, x1, y1 = span.get("bbox") or (0, 0, 0, 0)
    width = max(x1 - x0, LAYOUT_BOX_MIN_PT) + 1.0
    height = max(y1 - y0, LAYOUT_BOX_MIN_PT) + 1.0
    paragraph = (
        '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
        '<w:jc w:val="left"/></w:pPr>'
        f"{_layout_run_xml(span)}</w:p>"
    )
    inner = (
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
        '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>'
        f'<a:xfrm><a:off x="0" y="0"/><a:ext cx="{_layout_emu(width)}" cy="{_layout_emu(height)}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>'
        "</wps:spPr>"
        f"<wps:txbx><w:txbxContent>{paragraph}</w:txbxContent></wps:txbx>"
        '<wps:bodyPr rot="0" vert="horz" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" '
        'anchor="ctr" anchorCtr="0" upright="1"><a:noAutofit/></wps:bodyPr>'
        "</wps:wsp></a:graphicData></a:graphic>"
    )
    return _layout_anchor(inner, x0, y0, width, height, shape_id, behind=False)


def _layout_page_background(doc: fitz.Document, index: int) -> bytes:
    """把单页复制一份并抹掉文字层,保留图片/线条/底纹,作为原版式背景。"""
    work_doc = fitz.open()
    try:
        work_doc.insert_pdf(doc, from_page=index, to_page=index)
        page = work_doc[0]
        page.add_redact_annot(page.rect, fill=False, cross_out=False)
        page.apply_redactions(
            images=fitz.PDF_REDACT_IMAGE_NONE,
            graphics=fitz.PDF_REDACT_LINE_ART_NONE,
            text=fitz.PDF_REDACT_TEXT_REMOVE,
        )
        bg_scale = _render_scale(page.rect, LAYOUT_BG_SCALE)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(bg_scale, bg_scale), alpha=False)
        try:
            return pixmap.tobytes("jpeg", jpg_quality=LAYOUT_BG_JPEG_QUALITY)
        except (RuntimeError, ValueError):  # 个别 PyMuPDF 构建不支持 JPEG 参数时退回 PNG
            return pixmap.tobytes("png")
    finally:
        work_doc.close()


def _layout_text_spans(page: fitz.Page) -> Iterator[dict]:
    """按文档顺序产出可见文字 span(带 bbox/字号/颜色/粗斜体)。"""
    try:
        blocks = page.get_text("dict").get("blocks", [])
    except Exception:  # noqa: BLE001 - 单页解析失败时保留背景图,不中断整篇
        return
    for block in blocks:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text") or ""
                if not text.strip() or span.get("alpha", 255) == 0:
                    continue
                x0, y0, x1, y1 = span.get("bbox") or (0, 0, 0, 0)
                if x1 - x0 < 0.2 or y1 - y0 < 0.2:
                    continue
                yield span


def _docx_layout_section(section, page: fitz.Page) -> None:
    from docx.shared import Pt

    section.page_width = Pt(page.rect.width)
    section.page_height = Pt(page.rect.height)
    section.left_margin = Pt(0)
    section.right_margin = Pt(0)
    section.top_margin = Pt(0)
    section.bottom_margin = Pt(0)
    section.header_distance = Pt(0)
    section.footer_distance = Pt(0)


def to_docx_preserve(in_path: str, out_path: str) -> None:
    """Word 原版式:页面尺寸/位置/字号/颜色/图片与 PDF 一致,文字仍可编辑。

    做法:每页先渲染一张「去掉文字层、保留图形与图片」的背景图,再按 span 的
    PDF 坐标覆盖绝对定位文本框。这样表格线、图表、底纹、图片不会丢失,而文字
    仍能在 Word 中选中和修改。
    """
    from docx import Document
    from docx.enum.section import WD_SECTION
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn
    from docx.shared import Pt

    with _open_pdf(in_path) as pdf:
        if len(pdf) == 0:
            raise PdfError("PDF 没有页面")
        document = Document()
        _docx_set_default_font(document)
        section = document.sections[0]
        current_size: tuple[float, float] | None = None
        shape_id = 1000
        new_section = False

        for index in range(len(pdf)):
            page = pdf[index]
            page_size = (round(page.rect.width, 1), round(page.rect.height, 1))
            if current_size is None:
                _docx_layout_section(section, page)
                current_size = page_size
            elif (
                abs(page_size[0] - current_size[0]) > LAYOUT_PAGE_SIZE_TOLERANCE_PT
                or abs(page_size[1] - current_size[1]) > LAYOUT_PAGE_SIZE_TOLERANCE_PT
            ):
                section = document.add_section(WD_SECTION.NEW_PAGE)
                _docx_layout_section(section, page)
                current_size = page_size
                new_section = True

            paragraph = document.add_paragraph()
            fmt = paragraph.paragraph_format
            fmt.space_before = Pt(0)
            fmt.space_after = Pt(0)
            fmt.line_spacing = Pt(1)
            if index and not new_section:
                fmt.page_break_before = True
            new_section = False

            # 背景图:先作为 inline 图片建立关系,再替换成相对页面定位的浮动锚点
            run = paragraph.add_run()
            run.add_picture(
                BytesIO(_layout_page_background(pdf, index)),
                width=Pt(page.rect.width),
                height=Pt(page.rect.height),
            )
            inline = run._r.find(".//" + qn("wp:inline"))
            if inline is not None:
                blip = inline.find(".//" + qn("a:blip"))
                rid = blip.get(qn("r:embed")) if blip is not None else None
                run._r.getparent().remove(run._r)
                if rid:
                    shape_id += 1
                    paragraph._p.append(
                        parse_xml(_layout_picture_xml(rid, page.rect.width, page.rect.height, shape_id))
                    )

            for span in _layout_text_spans(page):
                shape_id += 1
                paragraph._p.append(parse_xml(_layout_textbox_xml(span, shape_id)))

        document.save(out_path)


def _pptx_set_east_asian_font(run, font_name: str) -> None:
    """python-pptx 只写 latin 字体;补 a:ea 让中文也尽量使用原字体。"""
    from pptx.oxml.ns import qn
    from pptx.oxml.xmlchemy import OxmlElement

    rpr = run._r.get_or_add_rPr()
    ea = rpr.find(qn("a:ea"))
    if ea is None:
        ea = OxmlElement("a:ea")
        rpr.append(ea)
    ea.set("typeface", font_name)


def to_pptx_preserve(in_path: str, out_path: str) -> None:
    """PPT 原版式:一页 PDF 对应一张同尺寸幻灯片,背景+绝对定位文字框。"""
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
    from pptx.util import Pt

    with _open_pdf(in_path) as pdf:
        if len(pdf) == 0:
            raise PdfError("PDF 没有页面")
        first = pdf[0]
        presentation = Presentation()
        presentation.slide_width = Pt(first.rect.width)
        presentation.slide_height = Pt(first.rect.height)
        blank_layout = presentation.slide_layouts[6]

        for index in range(len(pdf)):
            page = pdf[index]
            slide = presentation.slides.add_slide(blank_layout)
            slide.shapes.add_picture(
                BytesIO(_layout_page_background(pdf, index)),
                0,
                0,
                width=presentation.slide_width,
                height=presentation.slide_height,
            )
            scale_x = first.rect.width / max(page.rect.width, 1.0)
            scale_y = first.rect.height / max(page.rect.height, 1.0)
            font_scale = min(scale_x, scale_y)
            for span in _layout_text_spans(page):
                x0, y0, x1, y1 = span.get("bbox") or (0, 0, 0, 0)
                box = slide.shapes.add_textbox(
                    Pt(x0 * scale_x),
                    Pt(y0 * scale_y),
                    Pt(max(x1 - x0, LAYOUT_BOX_MIN_PT) * scale_x),
                    Pt(max(y1 - y0, LAYOUT_BOX_MIN_PT) * scale_y),
                )
                frame = box.text_frame
                frame.word_wrap = False
                frame.auto_size = MSO_AUTO_SIZE.NONE
                frame.margin_left = 0
                frame.margin_right = 0
                frame.margin_top = 0
                frame.margin_bottom = 0
                frame.vertical_anchor = MSO_ANCHOR.MIDDLE
                paragraph = frame.paragraphs[0]
                paragraph.alignment = PP_ALIGN.LEFT
                run = paragraph.add_run()
                run.text = span.get("text") or ""
                size = max(float(span.get("size") or DEFAULT_FONT_SIZE), 1.0) * font_scale
                font = run.font
                font.size = Pt(size)
                font.name = _layout_font_name(span.get("font") or "")
                _pptx_set_east_asian_font(run, font.name)
                flags = int(span.get("flags") or 0)
                font.bold = bool(flags & BOLD_FLAG)
                font.italic = bool(flags & ITALIC_FLAG)
                color = int(span.get("color") or 0)
                font.color.rgb = RGBColor((color >> 16) & 255, (color >> 8) & 255, color & 255)

        presentation.save(out_path)


# ---------- 格式注册表 / 分发 ----------


@dataclass(frozen=True)
class _FormatSpec:
    """单一事实来源:每种格式需要什么、如何写出。

    writer 为 None 表示该格式需要源文件上下文(Markdown 要按 bbox 裁剪图片),
    由 CLI 走 `_write_markdown` 路径,避免为了渲染图片再打开一次 PDF。
    """

    needs_blocks: bool
    image_mode: ImageMode
    writer: Callable[[list[Page], str], None] | None


_FORMAT_SPECS: dict[str, _FormatSpec] = {
    "word": _FormatSpec(True, "scanned", to_docx),
    "excel": _FormatSpec(True, "none", to_xlsx),
    "ppt": _FormatSpec(True, "scanned", to_pptx),
    "image": _FormatSpec(False, "all", to_images_zip),
    "txt": _FormatSpec(True, "none", _write_txt),
    "md": _FormatSpec(True, "none", None),
}


def convert_by_format(fmt: str, pages: list[Page], out_path: str) -> None:
    """把已解析的页面写成目标格式。

    Markdown 需要 PDF 页面对象来裁剪图片,只能通过 `main`/CLI 使用
    (`--format md`),直接调用本函数会报错。
    """
    spec = _FORMAT_SPECS.get(fmt)
    if spec is None:
        raise PdfError(f"未知格式: {fmt}")
    if spec.writer is None:
        raise PdfError(f"格式 {fmt} 需要源文件上下文,请通过 --format {fmt} 调用")
    spec.writer(pages, out_path)


# ---------- CLI ----------


class _Parser(argparse.ArgumentParser):
    """argparse 默认以 exit 2 结束,改为统一 JSON 契约(由 main 输出 exit 1)。"""

    def error(self, message):
        raise PdfError(f"参数错误: {message}")


def _force_utf8_streams() -> None:
    """Windows 控制台默认 cp936,强制 UTF-8 保证中文 JSON 契约稳定。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, io.UnsupportedOperation):  # 被重定向到不支持 reconfigure 的流
            pass


def _print_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _print_error(error: Exception) -> None:
    print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)


def _build_parser() -> _Parser:
    parser = _Parser(prog="pdf_convert.py", description="WorkLift PDF 转换工具")
    parser.add_argument("in_pdf", help="输入 PDF 文件路径")
    parser.add_argument("out", nargs="?", default=None, help="输出文件路径(--format/--page 时必填)")
    parser.add_argument("--format", default=None, help="word|excel|ppt|image|txt|md")
    parser.add_argument("--layout", action="store_true", help="Word/PPT 保留原版式(绝对定位文字层)")
    parser.add_argument("--page", type=int, default=None, help="仅渲染第 N 页为 PNG")
    parser.add_argument("--check", action="store_true", help="仅统计页数")
    return parser


def main(argv=None) -> int:
    _force_utf8_streams()
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
        if not os.path.isfile(args.in_pdf):
            raise PdfError(f"文件不存在: {args.in_pdf}")

        if args.check:
            _print_json({"ok": True, "numPages": count_pages(args.in_pdf)})
            return 0

        if args.format is not None:
            if args.format not in FORMATS:
                raise PdfError(f"未知格式: {args.format}")
            if not args.out:
                raise PdfError("缺少输出文件参数")
            if args.layout:
                if args.format not in ("word", "ppt"):
                    raise PdfError("--layout 仅支持 word / ppt")
                writer = to_docx_preserve if args.format == "word" else to_pptx_preserve
                writer(args.in_pdf, args.out)
                _print_json({"ok": True, "numPages": count_pages(args.in_pdf)})
                return 0
            spec = _FORMAT_SPECS[args.format]
            if spec.writer is None:
                num_pages = _write_markdown(args.in_pdf, args.out)
            else:
                pages = extract_pages(
                    args.in_pdf,
                    render_images=spec.image_mode,
                    keep_blocks=spec.needs_blocks,
                )
                spec.writer(pages, args.out)
                num_pages = len(pages)
            _print_json({"ok": True, "numPages": num_pages})
            return 0

        if args.page is not None:
            if not args.out:
                raise PdfError("缺少输出文件参数")
            render_page(args.in_pdf, args.page, args.out)
            _print_json({"ok": True, "numPages": count_pages(args.in_pdf), "page": args.page})
            return 0

        raise PdfError("缺少操作参数(--check / --format / --page)")
    except PdfError as error:
        _print_error(error)
        return 1
    except Exception as error:  # noqa: BLE001 - 未知异常也走契约,避免裸 traceback 污染 stderr
        _print_error(PdfError(f"转换失败: {error}"))
        return 1


if __name__ == "__main__":
    sys.exit(main())
