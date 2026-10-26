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

import pymupdf as fitz  # 官方导入名;fitz 别名会触发弃用警告污染 stdout

# ---------- 常量 ----------

RENDER_SCALE = 3.0  # 图片导出/预览渲染倍率(A4 约 1785×2526,≈216 DPI)
EMBED_SCALE = 2.0  # 文档内嵌整页图(扫描件兜底)倍率,控制文件体积
FORMATS = ("word", "excel", "ppt", "image", "txt", "md")

DEFAULT_FONT_SIZE = 12.0

# 标题判定:字号 / 正文中位字号 的比值阈值,必须按从大到小排列
HEADING_RATIOS: tuple[tuple[float, int], ...] = ((1.6, 1), (1.35, 2), (1.15, 3))
HEADING_MARK_MAX = 6

# 文本拼接
BULLET_CHARS = "\u2022\u00b7\uf0b7"  # • · 等常见项目符号
LIST_NUMBER_RE = re.compile(r"^\s*(?:\d{1,3}|[一二三四五六七八九十]{1,3})\s*[.)、](?!\d)\s*")
CJK_NO_SPACE_BEFORE = "，。、；：！？）》」』】”’,.!?;:%)]}"
CJK_NO_SPACE_AFTER = "（《「『【“‘([{"
SPAN_GAP_RATIO = 0.4  # 同行 span 间距 > 字号×0.4 视为词间空格
LINK_OVERLAP_RATIO = 0.5  # span 与链接矩形重叠 ≥50% 视为链接文字
LINE_GAP_RATIO = 0.9  # 行距 > 行高×0.9 视为新段落
MIN_LINE_HEIGHT_RATIO = 0.8

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
DOCX_IMAGE_MIN_RATIO = 0.2  # 小图最小占正文宽度比例
DOCX_TABLE_FONT_PT = 10
DOCX_BODY_SPACE_AFTER_PT = 4
DOCX_HEADING_MAX_LEVEL = 4

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

# PPT
PPTX_SLIDE_WIDTH_IN = 13.333
PPTX_SLIDE_HEIGHT_IN = 7.5
PPTX_TITLE_PT = 30
PPTX_ITEM_PT = 18
PPTX_ITEM_SMALL_PT = 15
PPTX_ITEM_SMALL_THRESHOLD = 60  # 超过该字符数的要点用小一号字
PPTX_MAX_ITEMS = 20


# ---------- 错误与数据模型 ----------


class PdfError(Exception):
    """领域错误,携带可直接展示给用户的中文信息。"""


BlockKind = Literal["heading", "paragraph", "list", "table", "image"]
ImageMode = Literal["all", "scanned", "none"]
BBox = tuple[float, float, float, float]


@dataclass
class Run:
    """一段同格式文本(粗体/斜体/等宽/超链接)。"""

    text: str
    bold: bool = False
    italic: bool = False
    mono: bool = False
    link: str | None = None


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
    left, right = (left or "").rstrip(), (right or "").lstrip()
    if not left or not right:
        return False
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


def _span_runs(spans: list[dict], link_targets: list[tuple[fitz.Rect, str]]) -> list[Run]:
    """一行 span -> Run 列表:保留粗体/斜体/等宽/链接,并按视觉间隙补空格。"""
    runs: list[Run] = []
    for index, span in enumerate(spans):
        text = span.get("text", "")
        if not text:
            continue
        flags = span.get("flags", 0) or 0
        run = Run(
            text,
            bold=bool(flags & BOLD_FLAG),
            italic=bool(flags & ITALIC_FLAG),
            mono=bool(flags & MONO_FLAG),
        )
        rect = _safe_rect(span.get("bbox"))
        if rect is not None:
            run.link = _link_for(rect, link_targets)
        runs.append(run)
        if index + 1 < len(spans):
            size = float(span.get("size", DEFAULT_FONT_SIZE) or DEFAULT_FONT_SIZE)
            if _span_gap(span, spans[index + 1]) > size * SPAN_GAP_RATIO:
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
    """正文中位字号:按字符数加权取最常见字号,无文本时回退 12pt。"""
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
    return sizes.most_common(1)[0][0]


def _heading_level(size: float, body_size: float) -> int:
    """按字号比给出标题级别:阈值从大到小匹配,首个命中即返回。"""
    if not body_size:
        return HEADING_RATIOS[-1][1]
    ratio = size / body_size
    for threshold, level in HEADING_RATIOS:
        if ratio >= threshold:
            return level
    return HEADING_RATIOS[-1][1]


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
            out.append(Run(without_marker, run.bold, run.italic, run.mono, run.link))
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

        if body_size and size >= body_size * HEADING_RATIOS[-1][0]:
            flush()
            blocks.append(
                Block(
                    "heading",
                    text=text.strip(),
                    level=_heading_level(size, body_size),
                    runs=runs,
                    bbox=bbox,
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
    """剔除页眉/页脚:页边区域内重复出现的文本与纯页码(仅多页文档)。"""
    if len(pages) < 2:
        return

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


def _render_png(page: fitz.Page, scale: float) -> bytes:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
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
        for page in pages:
            page.text = _blocks_to_text(page.blocks)
    return pages


def render_page(path: str, n: int, out_path: str, scale: float = RENDER_SCALE) -> None:
    """仅渲染第 n 页为 PNG 并写入 out_path。"""
    with _open_pdf(path) as doc:
        if n < 1 or n > len(doc):
            raise PdfError(f"页号超出范围: {n} (共 {len(doc)} 页)")
        doc[n - 1].get_pixmap(matrix=fitz.Matrix(scale, scale)).save(out_path)


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
    return _render_markdown_blocks(_parse_raw_blocks(blocks, links), image_fn)


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
    ratio = 1.0
    if page.width > 0:
        ratio = min(1.0, max(DOCX_IMAGE_MIN_RATIO, (block.bbox[2] - block.bbox[0]) / page.width))
    _docx_add_picture(doc, block.image, DOCX_IMAGE_MAX_INCHES * ratio)


def _docx_write_block(doc, block: Block, page: Page) -> None:
    from docx.shared import Pt

    if block.kind == "heading":
        doc.add_heading(block.text, level=min(block.level + 1, DOCX_HEADING_MAX_LEVEL))
    elif block.kind == "paragraph":
        paragraph = doc.add_paragraph()
        if block.runs:
            _docx_add_runs(paragraph, block.runs)
        else:
            paragraph.add_run(block.text)
        paragraph.paragraph_format.space_after = Pt(DOCX_BODY_SPACE_AFTER_PT)
    elif block.kind == "list":
        try:
            doc.add_paragraph(block.text, style="List Number" if block.ordered else "List Bullet")
        except KeyError:  # 模板缺少列表样式时降级为手写符号
            doc.add_paragraph(("1. " if block.ordered else "- ") + block.text)
    elif block.kind == "table":
        _docx_add_table(doc, block.rows)
        doc.add_paragraph("")
    elif block.kind == "image":
        _docx_add_inline_image(doc, block, page)


def to_docx(pages: list[Page], out_path: str) -> None:
    """Word:可编辑结构化正文(标题/段落/列表/表格);仅扫描页嵌入整页图。"""
    from docx import Document

    doc = Document()
    _docx_set_default_font(doc)
    for page in pages:
        doc.add_heading(f"第 {page.num} 页", level=1)
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
            value = row[column_index - 1] if column_index - 1 < len(row) else ""
            cell = sheet.cell(row=row_index, column=column_index, value=value)
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
        if tables:
            for index, table in enumerate(tables, start=1):
                base = f"第{page.num}页" if index == 1 else f"第{page.num}页-表{index}"
                _xlsx_write_table(workbook.create_sheet(title=_sheet_name(base, used)), table.rows)
            if page.text.strip():
                title = _sheet_name(f"第{page.num}页-文本", used)
                _xlsx_write_text(workbook.create_sheet(title=title), page.text)
        else:
            title = _sheet_name(f"第{page.num}页", used)
            _xlsx_write_text(workbook.create_sheet(title=title), page.text)

    if not workbook.sheetnames:
        workbook.create_sheet(title=XLSX_EMPTY_SHEET)
    workbook.save(out_path)


# ---------- PPT ----------


def _pptx_texts(blocks: list[Block]) -> tuple[str, list[str]]:
    """语义块 -> (标题, 要点列表);标题取第一个标题块,要点截断到上限。"""
    title = ""
    items: list[str] = []
    for block in blocks:
        if block.kind not in ("heading", "paragraph", "list"):
            continue
        if block.kind == "heading" and not title:
            title = block.text
            continue
        items.append(("• " if block.kind == "list" else "") + block.text)
    return title, items[:PPTX_MAX_ITEMS]


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
        slide = presentation.slides.add_slide(blank_layout)
        title, items = _pptx_texts(page.blocks)
        if title or items:
            if title:
                _pptx_add_title(slide, title)
            if items:
                _pptx_add_items(slide, items)
        elif page.png:
            try:
                slide.shapes.add_picture(
                    BytesIO(page.png), 0, 0, width=presentation.slide_width, height=presentation.slide_height
                )
            except Exception:  # noqa: BLE001 - 图片异常时保留可读的页码占位
                pass
        footer = slide.shapes.add_textbox(Inches(11.8), Inches(7.05), Inches(1.4), Inches(0.4))
        footer.text_frame.text = f"{page.num} / {total}"

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
