#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# SIZE_OK - 自包含单文件 CLI 转换器,经用户确认保持单体
"""WorkLift 工具箱 · PDF 转换工具(本机 Python 后端)

解析 PDF 并输出真实格式:Word(.docx) / Excel(.xlsx) / PPT(.pptx) / 图片(.zip) / TXT(.txt) / Markdown(.md)。
由 Node 服务(server.js)通过子进程调用,stdout/stderr 遵循 JSON 契约:

  成功:stdout 恰好一行 JSON {"ok": true, "numPages": N}(--page 追加 "page": N),exit 0
  失败:stderr 一行 JSON {"error": "中文信息"},exit 1
"""
import argparse
import base64
import json
import math
import os
import sys
import zipfile
from collections import Counter
from dataclasses import dataclass
from io import BytesIO

import pymupdf as fitz  # PyMuPDF 官方导入名(fitz 别名会打弃用警告污染 stdout JSON 契约)

# Windows 控制台默认 cp936,强制 UTF-8 保证中文 JSON 契约稳定
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

RENDER_SCALE = 2.0  # 页面渲染缩放(与 design.md 一致)
FORMATS = ("word", "excel", "ppt", "image", "txt", "md")


class PdfError(Exception):
    """领域错误,携带中文信息。"""


@dataclass
class Page:
    num: int
    text: str
    png: bytes | None = None


def count_pages(path):
    """快速统计页数(不渲染),失败抛 PdfError。"""
    try:
        doc = fitz.open(path)
    except Exception as e:
        raise PdfError(f"无法解析 PDF 文件: {e}") from e
    try:
        return len(doc)
    finally:
        doc.close()


def extract_pages(path, scale=RENDER_SCALE, render_images: bool = True):
    """逐页提取文本 + （可选）渲染 PNG,返回 Page 列表。逐页处理并释放 pixmap 以控制内存。"""
    try:
        doc = fitz.open(path)
    except Exception as e:
        raise PdfError(f"无法解析 PDF 文件: {e}") from e
    pages = []
    try:
        for i in range(len(doc)):
            page = doc[i]
            text = page.get_text("text") or ""
            png = None
            if render_images:
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
                try:
                    png = pix.tobytes("png")
                finally:
                    pix = None
            pages.append(Page(num=i + 1, text=text, png=png))
    finally:
        doc.close()
    return pages


def render_page(path, n, out_path, scale=RENDER_SCALE):
    """仅渲染第 n 页为 PNG 到 out_path。"""
    try:
        doc = fitz.open(path)
    except Exception as e:
        raise PdfError(f"无法解析 PDF 文件: {e}") from e
    try:
        if n < 1 or n > len(doc):
            raise PdfError(f"页号超出范围: {n} (共 {len(doc)} 页)")
        pix = doc[n - 1].get_pixmap(matrix=fitz.Matrix(scale, scale))
        pix.save(out_path)
    finally:
        doc.close()


def to_txt(pages):
    """UTF-8 文本,每页以 --- 第 N 页 --- 开头。"""
    parts = [f"--- 第 {p.num} 页 ---\n{p.text}" for p in pages]
    return "\n\n".join(parts)


# 本项目 PyMuPDF 构建不含 get_text("markdown"),自写提取器:
#   标题   由字号与正文中位字号比值推断(#~###,阈值见 _MD_HEADING_TH)
#   加粗/斜体/等宽  由 span flags 推断(**text** / *text* / `text`)
#   链接   由 get_links() 的矩形与 span bbox 重叠度推断([text](url))
#   图片   按块 bbox 裁剪渲染为 PNG,内嵌 data URI(超过上限降采样一次,仍超则跳过)
#   分页   每页以 --- 第 N 页 --- 分隔

# (字号/正文比值阈值, 标题级别):ratio >= 1.6 -> '#', >= 1.35 -> '##', >= 1.15 -> '###'
_MD_HEADING_TH = ((1.6, 1), (1.35, 2), (1.15, 3))
_MD_IMAGE_WIDTH_LIMIT = 480.0  # 内嵌图片目标宽度上限(px)
_MD_IMAGE_BYTES_CAP = 250_000  # 单张内嵌图片字节上限,超过先降采样、仍超则跳过
BULLET_CHARS = "\u2022\u00b7\uf0b7"  # • · 等常见项目符号


def _md_body_size(blocks):
    """正文中位字号:按文本长度加权取最常见字号,无文本时返回 12.0。"""
    sizes = Counter()
    for b in blocks:
        if b.get("type") != 0:
            continue
        for line in b.get("lines", []):
            for s in line.get("spans", []):
                if s.get("text"):
                    sizes[round(s.get("size", 12.0), 1)] += len(s["text"])
    if not sizes:
        return 12.0
    return sizes.most_common(1)[0][0]


def _md_inline(spans, links):
    """将一行的 spans 组装成内联 markdown:样式标记 + 链接包裹 + 空隙补空格。"""
    parts = []
    for i, s in enumerate(spans):
        text = s.get("text", "")
        if not text:
            continue
        t = text
        if s.get("flags", 0) & 2 ** 3:  # 等宽
            t = f"`{t}`"
        if s.get("flags", 0) & 2 ** 4:  # 加粗
            t = f"**{t}**"
        if s.get("flags", 0) & 2:  # 斜体
            t = f"*{t}*"
        rb = fitz.Rect(s["bbox"])
        for lnk in links:
            lr = fitz.Rect(lnk.get("from"))
            inter = lr & rb
            if inter.is_valid and inter.get_area() > 0 and rb.get_area() > 0:
                if inter.get_area() / rb.get_area() >= 0.5:
                    t = f"[{t}]({lnk.get('uri', '')})"
                    break
        parts.append(t)
        if i + 1 < len(spans):
            gap = spans[i + 1]["bbox"][0] - s["bbox"][2]
            if gap > s.get("size", 12.0) * 0.4:
                parts.append(" ")
    return "".join(parts)


def markdown_from_blocks(blocks, links=None, image_fn=None):
    """blocks(page.get_text('dict')['blocks']) -> 该页 markdown(不含分页标记)。

    image_fn: 可选的图片块处理器(block) -> markdown 片段;图片超出可嵌入范围时
    返回 None 或空,由调用方决定兜底占位。
    """
    links = links or []
    body_size = _md_body_size(blocks)
    parts = []
    for b in blocks:
        if b.get("type") == 1:  # 图片块
            frag = image_fn(b) if image_fn else None
            parts.append(frag or "![图片](data:,)")
            parts.append("")
            continue
        for line in b.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            size = max(s.get("size", 0) for s in spans)
            inline = _md_inline(spans, links)
            if not inline.strip():
                continue
            if body_size > 0 and size >= body_size * _MD_HEADING_TH[-1][0]:
                level = _MD_HEADING_TH[0][1]
                for th, lv in _MD_HEADING_TH:
                    if size >= body_size * th:
                        level = lv
                parts.append("#" * level + " " + inline)
            elif inline[0] in BULLET_CHARS:
                parts.append("- " + inline.lstrip(BULLET_CHARS + " "))
            else:
                parts.append(inline)
            parts.append("")
    return "\n".join(parts)


def _page_image_md(page, block, width_limit=_MD_IMAGE_WIDTH_LIMIT, bytes_cap=_MD_IMAGE_BYTES_CAP):
    """将图片块按 bbox 裁剪渲染为 PNG data URI;超限降采样一次,仍超返回 None。"""
    bbox = fitz.Rect(block["bbox"])
    if bbox.is_empty or bbox.width < 2 or bbox.height < 2:
        return None
    scale = min(2.0, width_limit / max(bbox.width, 1.0))

    def render(s):
        pix = page.get_pixmap(clip=bbox, matrix=fitz.Matrix(s, s))
        data = pix.tobytes("png")
        return data

    data = render(scale)
    if len(data) > bytes_cap:
        data = render(scale * math.sqrt(bytes_cap / len(data)))
        if len(data) > bytes_cap:
            return None
    return "![图片](data:image/png;base64," + base64.b64encode(data).decode("ascii") + ")"


def extract_markdown(path):
    """整份 PDF -> 单个 markdown 字符串,每页以 --- 第 N 页 --- 分隔。"""
    try:
        doc = fitz.open(path)
    except Exception as e:
        raise PdfError(f"无法解析 PDF 文件: {e}") from e
    try:
        pages = []
        for i in range(len(doc)):
            page = doc[i]
            blocks = page.get_text("dict").get("blocks", [])
            md = markdown_from_blocks(
                blocks, page.get_links(), lambda b: _page_image_md(page, b)
            )
            pages.append(f"--- 第 {i + 1} 页 ---\n{md.rstrip()}")
        return "\n\n".join(pages) + "\n"
    finally:
        doc.close()


def to_images_zip(pages, out_path):
    """全部页面打包为 zip(单页也打包 zip,不输出裸 PNG)。"""
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in pages:
            if p.png:
                zf.writestr(f"page_{p.num}.png", p.png)


def to_docx(pages, out_path):
    """Word:每页页码标题 + 提取文本段落 + 内嵌页面渲染图。"""
    from docx import Document
    from docx.shared import Inches

    doc = Document()
    for p in pages:
        doc.add_heading(f"第 {p.num} 页", level=1)
        if p.text:
            doc.add_paragraph(p.text)
        if p.png:
            doc.add_picture(BytesIO(p.png), width=Inches(6))
    doc.save(out_path)


def to_xlsx(pages, out_path):
    """Excel:每页一个工作表,文本行写入 A 列。"""
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)
    for p in pages:
        ws = wb.create_sheet(title=f"第{p.num}页")
        ws.column_dimensions["A"].width = 80
        for line in p.text.splitlines():
            if line.strip():
                ws.append([line])
    wb.save(out_path)


def to_pptx(pages, out_path):
    """PPT:16:9 每页一张全幅幻灯片 + 页码角标。"""
    from pptx import Presentation
    from pptx.util import Inches

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    for p in pages:
        slide = prs.slides.add_slide(blank)
        if p.png:
            slide.shapes.add_picture(
                BytesIO(p.png), 0, 0, width=prs.slide_width, height=prs.slide_height
            )
        box = slide.shapes.add_textbox(Inches(11.8), Inches(7.05), Inches(1.4), Inches(0.4))
        box.text_frame.text = f"{p.num} / {len(pages)}"
    prs.save(out_path)


def convert_by_format(fmt, pages, out_path):
    if fmt == "txt":
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(to_txt(pages))
    elif fmt == "image":
        to_images_zip(pages, out_path)
    elif fmt == "word":
        to_docx(pages, out_path)
    elif fmt == "excel":
        to_xlsx(pages, out_path)
    elif fmt == "ppt":
        to_pptx(pages, out_path)
    else:
        raise PdfError(f"未知格式: {fmt}")


class _Parser(argparse.ArgumentParser):
    """argparse 默认以 exit 2 结束,改为走统一 JSON 契约(exit 1)。"""

    def error(self, message):
        raise PdfError(f"参数错误: {message}")


def _print_json(obj):
    print(json.dumps(obj, ensure_ascii=False))


def _print_error(e):
    print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)


def main(argv=None):
    parser = _Parser(prog="pdf_convert.py", description="WorkLift PDF 转换工具")
    parser.add_argument("in_pdf", help="输入 PDF 文件路径")
    parser.add_argument("out", nargs="?", default=None, help="输出文件路径(--format/--page 时必填)")
    parser.add_argument("--format", default=None, help="word|excel|ppt|image|txt")
    parser.add_argument("--page", type=int, default=None, help="仅渲染第 N 页为 PNG")
    parser.add_argument("--check", action="store_true", help="仅统计页数")

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
            if args.format == "md":
                # Markdown 需要 doc/page 上下文(裁剪渲染图片),单独走提取流程
                text = extract_markdown(args.in_pdf)
                with open(args.out, "w", encoding="utf-8") as f:
                    f.write(text)
                _print_json({"ok": True, "numPages": count_pages(args.in_pdf)})
                return 0
            # 优化：txt/excel 不需要页面渲染图像，可跳过渲染加速大文件转换
            need_images = args.format in ("word", "ppt", "image")
            pages = extract_pages(args.in_pdf, render_images=need_images)
            convert_by_format(args.format, pages, args.out)
            _print_json({"ok": True, "numPages": len(pages)})
            return 0

        if args.page is not None:
            if not args.out:
                raise PdfError("缺少输出文件参数")
            render_page(args.in_pdf, args.page, args.out)
            _print_json({"ok": True, "numPages": count_pages(args.in_pdf), "page": args.page})
            return 0

        raise PdfError("缺少操作参数(--check / --format / --page)")
    except PdfError as e:
        _print_error(e)
        return 1
    except Exception as e:  # 未知异常同样走契约,避免裸 traceback 污染 stderr JSON
        _print_error(PdfError(f"转换失败: {e}"))
        return 1


if __name__ == "__main__":
    sys.exit(main())