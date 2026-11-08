# -*- coding: utf-8 -*-
"""pdf_convert.py 单元测试(stdlib unittest,零额外测试依赖)。

- 用 PyMuPDF 程序化生成含中文文本、图形与图片的多页 fixture PDF
- 对六种格式调用转换函数并用对应库读回断言内容结构
- CLI 层覆盖缺参、坏文件、未知格式、页号越界等错误分支
运行: python -m unittest discover -s python/tests -v
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import unittest.mock
import zipfile
from pathlib import Path

import pymupdf as fitz  # PyMuPDF 官方导入名(不触发弃用警告)
from docx import Document
from openpyxl import load_workbook
from pptx import Presentation

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pdf_convert

CLI = Path(__file__).resolve().parent.parent / "pdf_convert.py"


def make_fixture(path, pages=3):
    """生成含中文文本、图形与每页一张小图片的 A4 多页 PDF。"""
    doc = fitz.open()
    for i in range(1, pages + 1):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 96), f"第 {i} 页 测试文档", fontsize=24, fontname="china-s")
        page.insert_text((72, 150), f"正文内容 第{i}页 含中文与 ASCII Line{i}-A", fontsize=12, fontname="china-s")
        page.insert_text((72, 180), f"第二行 金额 ¥{i}00", fontsize=12, fontname="china-s")
        page.insert_text((72, 206), "• 待办事项 检查", fontsize=12, fontname="china-s")
        page.draw_rect(fitz.Rect(72, 220, 320, 280), color=(0.1, 0.3, 0.7), width=2)
        page.draw_circle(fitz.Point(200, 360), 42, color=(0.8, 0.2, 0.1), width=2)
        png = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 48, 32))
        png.clear_with(0x336699)
        page.insert_image(fitz.Rect(72, 300, 220, 360), pixmap=png)
    doc.save(path)
    doc.close()


def make_table_fixture(path):
    """生成带真实表格(线条 + 单元格文字)与表外标题的单页 PDF。"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 80), "报销明细", fontsize=20, fontname="china-s")
    xs = (72, 222, 372, 522)
    ys = (110, 140, 170, 200)
    for y in ys:
        page.draw_line(fitz.Point(xs[0], y), fitz.Point(xs[-1], y))
    for x in xs:
        page.draw_line(fitz.Point(x, ys[0]), fitz.Point(x, ys[-1]))
    cells = [
        ["姓名", "项目", "金额"],
        ["张三", "差旅", "128.50"],
        ["李四", "餐饮", "66.00"],
    ]
    for i, row in enumerate(cells):
        for j, val in enumerate(row):
            page.insert_text((xs[j] + 8, ys[i] + 20), val, fontsize=11, fontname="china-s")
    doc.save(path)
    doc.close()


def make_scanned_fixture(path):
    """生成无任何可提取文本的"扫描件" PDF(整页仅一张图片)。"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    png = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 300, 200))
    png.clear_with(0x112233)
    page.insert_image(fitz.Rect(40, 40, 555, 800), pixmap=png)
    doc.save(path)
    doc.close()


def make_header_footer_fixture(path, pages=3):
    """生成每页都带重复页眉与页脚页码的 PDF。"""
    doc = fitz.open()
    for i in range(1, pages + 1):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 30), "WorkLift 机密文档", fontsize=9, fontname="china-s")
        page.insert_text((280, 815), f"机密文档 第 {i} 页", fontsize=9, fontname="china-s")
        page.insert_text((72, 200), f"正文段落{i}", fontsize=12, fontname="china-s")
    doc.save(path)
    doc.close()


def make_page_number_fixture(path):
    """单页文档:正文 + 页边纯页码(应被剔除)。"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 200), "单页正文段落", fontsize=12, fontname="china-s")
    page.insert_text((285, 815), "- 1 -", fontsize=9, fontname="helv")
    doc.save(path)
    doc.close()


def make_hyperlink_fixture(path):
    """带 URI 超链接的文档页:链接矩形覆盖整行文字。"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 150), "访问 WorkLift 主页了解详情", fontsize=12, fontname="china-s")
    page.insert_text((72, 210), "没有链接的正文段落,补充足够的文字便于稳定统计", fontsize=12, fontname="china-s")
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans.extend(span for span in line.get("spans", []) if span.get("text", "").strip())
    rect = fitz.Rect(spans[0]["bbox"])
    page.insert_link({"kind": fitz.LINK_URI, "from": rect, "uri": "https://worklift.example.com/"})
    doc.save(path)
    doc.close()


def make_layout_fixture(path):
    """典型文档版式:居中标题、小节标题、折行正文、跨块列表续行。

    每段文字都用独立的 insert_text 写入,模拟真实 PDF 中一行/一段各占一个 block 的情况。
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((250, 90), "年度总结", fontsize=22, fontname="china-s")
    page.insert_text((72, 150), "一、项目概况", fontsize=16, fontname="china-s", color=(0.1, 0.2, 0.6))
    page.insert_text((72, 190), "本年度项目围绕个人工作台展开，覆盖计划管理、开发看板，", fontsize=12, fontname="china-s")
    page.insert_text((72, 210), "工具箱与账目等模块，整体运行稳定。", fontsize=12, fontname="china-s")
    page.insert_text((80, 250), "1. 优化数据保存的原子性，避免文件损坏", fontsize=12, fontname="china-s")
    page.insert_text((80, 270), "导致数据丢失。", fontsize=12, fontname="china-s")
    page.insert_text((80, 310), "• 完成转换工具", fontsize=12, fontname="china-s")
    page.insert_text((72, 350), "列表之后的正文段落", fontsize=12, fontname="china-s")
    doc.save(path)
    doc.close()


def make_cross_page_heading_fixture(path):
    """第 1 页有 22pt/16pt 两级标题,第 2 页只有 16pt 小节标题。"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((250, 90), "年度总结", fontsize=22, fontname="china-s")
    page.insert_text((72, 150), "一、项目概况", fontsize=16, fontname="china-s")
    page.insert_text((72, 190), "第一页正文", fontsize=12, fontname="china-s")
    page2 = doc.new_page(width=595, height=842)
    page2.insert_text((72, 150), "二、后续计划", fontsize=16, fontname="china-s")
    page2.insert_text((72, 190), "第二页正文", fontsize=12, fontname="china-s")
    doc.save(path)
    doc.close()


def make_multi_ordered_list_fixture(path):
    """同页两组有序列表(中间隔一个小节标题),每组都从 1 开始。"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 90), "第一组", fontsize=18, fontname="china-s")
    page.insert_text((72, 130), "1. 甲项", fontsize=12, fontname="china-s")
    page.insert_text((72, 153), "2. 乙项", fontsize=12, fontname="china-s")
    page.insert_text((72, 200), "第二组", fontsize=18, fontname="china-s")
    page.insert_text((72, 240), "1. 丙项", fontsize=12, fontname="china-s")
    page.insert_text((72, 263), "2. 丁项", fontsize=12, fontname="china-s")
    doc.save(path)
    doc.close()


def make_cross_page_list_fixture(path):
    """有序列表跨页续写:第 1 页 1、2,第 2 页 3、4。"""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 90), "执行清单", fontsize=18, fontname="china-s")
    page.insert_text((72, 130), "1. 第一步", fontsize=12, fontname="china-s")
    page.insert_text((72, 153), "2. 第二步", fontsize=12, fontname="china-s")
    page2 = doc.new_page(width=595, height=842)
    page2.insert_text((72, 130), "3. 第三步", fontsize=12, fontname="china-s")
    page2.insert_text((72, 153), "4. 第四步", fontsize=12, fontname="china-s")
    doc.save(path)
    doc.close()


def paragraph_numbering(path):
    """读取 docx:文本 -> (numId, 起始序号);numId 为 None 表示未覆盖样式编号。"""
    from docx.oxml.ns import qn

    doc = Document(path)
    numbering = doc.part.numbering_part.element
    starts = {}
    for num in numbering.findall(qn("w:num")):
        num_id = num.get(qn("w:numId"))
        override = num.find(qn("w:lvlOverride"))
        start = 1
        if override is not None:
            start_el = override.find(qn("w:startOverride"))
            if start_el is not None:
                start = int(start_el.get(qn("w:val")))
        starts[num_id] = start

    result = {}
    for paragraph in doc.paragraphs:
        if not paragraph.text.strip():
            continue
        pPr = paragraph._p.pPr
        num_pr = pPr.find(qn("w:numPr")) if pPr is not None else None
        if num_pr is None:
            result[paragraph.text] = (None, None)
            continue
        num_id = num_pr.find(qn("w:numId")).get(qn("w:val"))
        result[paragraph.text] = (num_id, starts.get(num_id))
    return result


def make_margined_short_page_fixture(path):
    """页眉页脚 9pt、正文 12pt,且第 2 页正文极短。

    复现缺陷:按单页统计字号时,第 2 页的 9pt 页眉页脚字符数不少于正文,
    正文基准字号被压到 9pt,12pt 正文因此被判成「比正文大 15%」的标题。
    """
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 30), "内部资料 请勿外传", fontsize=9, fontname="china-s")
    page.insert_text((280, 815), "- 1 -", fontsize=9, fontname="china-s")
    page.insert_text((72, 90), "季度报告", fontsize=22, fontname="china-s")
    page.insert_text((72, 130), "一、总体情况", fontsize=15, fontname="china-s")
    page.insert_text((72, 165), "本季度营收同比增长百分之十八,成本控制良好,回款周期缩短。", fontsize=12, fontname="china-s")
    page.insert_text((72, 190), "团队交付质量稳定,客户满意度较上季度有明显提升。", fontsize=12, fontname="china-s")
    page.insert_text((72, 215), "重点项目的风险已在月初完成识别并制定应对方案。", fontsize=12, fontname="china-s")

    page2 = doc.new_page(width=595, height=842)
    page2.insert_text((72, 30), "内部资料 请勿外传", fontsize=9, fontname="china-s")
    page2.insert_text((280, 815), "- 2 -", fontsize=9, fontname="china-s")
    page2.insert_text((72, 90), "二、下步计划", fontsize=15, fontname="china-s")
    page2.insert_text((72, 130), "1. 拓展市场", fontsize=12, fontname="china-s")
    page2.insert_text((72, 153), "2. 优化流程", fontsize=12, fontname="china-s")
    doc.save(path)
    doc.close()


def png_size(path):
    """读取 PNG 的 IHDR 宽高(避免引入 Pillow 依赖)。"""
    with open(path, "rb") as f:
        data = f.read(33)
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG 文件"
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")



def run_cli(args):
    return subprocess.run(
        [sys.executable, str(CLI), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )


class PdfConvertTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="worklift-pdf-test-")
        cls.pdf = os.path.join(cls.tmp, "sample.pdf")
        make_fixture(cls.pdf, pages=3)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def out(self, name):
        return os.path.join(self.tmp, name)

    # ---------- 解析 ----------

    def test_count_pages(self):
        self.assertEqual(pdf_convert.count_pages(self.pdf), 3)

    def test_extract_pages(self):
        pages = pdf_convert.extract_pages(self.pdf)
        self.assertEqual(len(pages), 3)
        self.assertIn("测试文档", pages[0].text)
        self.assertGreater(len(pages[0].png), 1000)
        self.assertTrue(pages[0].png.startswith(b"\x89PNG"))

    def test_check_cli(self):
        r = run_cli([self.pdf, "--check"])
        self.assertEqual(r.returncode, 0)
        meta = json.loads(r.stdout)
        self.assertTrue(meta["ok"])
        self.assertEqual(meta["numPages"], 3)

    # ---------- 五种格式 ----------

    def test_txt(self):
        out = self.out("out.txt")
        r = run_cli([self.pdf, out, "--format", "txt"])
        self.assertEqual(r.returncode, 0)
        with open(out, encoding="utf-8") as f:
            text = f.read()
        self.assertIn("--- 第 1 页 ---", text)
        self.assertIn("第 3 页 测试文档", text)
        self.assertIn("正文内容", text)
        self.assertIn("金额", text)

    # ---------- Markdown 提取(单元级:合成 dict) ----------

    @staticmethod
    def _block(spans, bbox=(0, 0, 300, 50)):
        return {"type": 0, "bbox": bbox, "lines": [{"spans": spans}]}

    @staticmethod
    def _span(size, text, flags=0, bbox=(0, 0, 60, 20), font="x"):
        return {"size": float(size), "font": font, "flags": flags, "text": text, "bbox": bbox}

    def test_markdown_inline_styles_and_link(self):
        blocks = [
            self._block([self._span(24.0, "项目标题", bbox=(0, 0, 120, 28))]),
            self._block([
                self._span(12.0, "粗体", flags=16, bbox=(0, 30, 40, 44)),
                self._span(12.0, "斜体", flags=2, bbox=(50, 30, 90, 44)),
                self._span(12.0, "code", flags=8, bbox=(100, 30, 145, 44)),
            ]),
            self._block([self._span(12.0, "官网", bbox=(0, 60, 40, 74))]),
        ]
        links = [{"kind": 2, "from": (0, 58, 45, 76), "uri": "https://example.com"}]
        md = pdf_convert.markdown_from_blocks(blocks, links=links)
        self.assertIn("# 项目标题", md)
        self.assertIn("**粗体**", md)
        self.assertIn("*斜体*", md)
        self.assertIn("`code`", md)
        self.assertIn("[官网](https://example.com)", md)

    def test_markdown_heading_levels_by_size_ratio(self):
        # 正文行要足够长,让加权中位字号稳定落在 12 上(标题短、正文长)
        body = "普通正文内容" * 6
        blocks = [
            self._block([self._span(24.0, "一级标题")]),
            self._block([self._span(18.0, "二级标题")]),
            self._block([self._span(14.0, "三级标题")]),
            self._block([self._span(12.0, body)]),
        ]
        md = pdf_convert.markdown_from_blocks(blocks)
        self.assertIn("# 一级标题", md)
        self.assertIn("## 二级标题", md)
        self.assertIn("### 三级标题", md)
        self.assertIn("普通正文内容", md)
        self.assertNotIn("####", md)

    def test_markdown_bullet_line(self):
        blocks = [self._block([self._span(12.0, "• 待办事项", bbox=(0, 0, 120, 14))])]
        md = pdf_convert.markdown_from_blocks(blocks)
        self.assertIn("- 待办事项", md)

    def test_markdown_image_fn_unused_gives_placeholder(self):
        blocks = [{"type": 1, "bbox": (0, 0, 100, 80), "width": 10, "height": 8}]
        md = pdf_convert.markdown_from_blocks(blocks)
        self.assertIn(pdf_convert.MD_IMAGE_FALLBACK_TEXT, md)

    def test_markdown_failed_image_has_no_broken_media_uri(self):
        blocks = [{"type": 1, "bbox": (0, 0, 100, 80), "width": 10, "height": 8}]
        md = pdf_convert.markdown_from_blocks(blocks)
        self.assertNotIn("data:,", md, "不应输出 ![图片](data:,) 这类坏图片占位")

    def test_markdown_bold_span_with_spaces_is_valid_commonmark(self):
        # 带/不含首尾空格的粗体 span:强调标记只应包住文本本身
        blocks = [self._block([self._span(12.0, "  加粗文本  ", flags=16)])]
        md = pdf_convert.markdown_from_blocks(blocks)
        self.assertIn("**加粗文本**", md)
        self.assertNotIn("** 加粗文本 **", md)
        self.assertNotIn("**加粗文本 **", md)
        self.assertNotIn("** 加粗文本**", md)

    # ---------- 文本拼接 / 跨块合并 / 标题层级 ----------

    def test_span_gap_does_not_double_space(self):
        spans = [
            self._span(12.0, "and ", bbox=(0, 0, 30, 14)),
            self._span(12.0, "offline", bbox=(40, 0, 80, 14)),
        ]
        runs = pdf_convert._span_runs(spans, [])
        self.assertEqual(pdf_convert._run_text(runs), "and offline")

    def test_markdown_no_double_space_after_trailing_space(self):
        block = {
            "type": 0,
            "bbox": (0, 0, 300, 40),
            "lines": [
                {"spans": [self._span(12.0, "Hello ", bbox=(0, 0, 44, 14))], "bbox": (0, 0, 44, 14)},
                {"spans": [self._span(12.0, "world", bbox=(0, 16, 40, 30))], "bbox": (0, 16, 40, 30)},
            ],
        }
        md = pdf_convert.markdown_from_blocks([block])
        self.assertIn("Hello world", md)
        self.assertNotIn("Hello  world", md)

    def test_wrapped_lines_merge_across_text_blocks(self):
        src = self.out("layout.pdf")
        make_layout_fixture(src)
        pages = pdf_convert.extract_pages(src, render_images=False, keep_blocks=True)
        blocks = pages[0].blocks
        body = [b for b in blocks if b.kind == "paragraph" and "本年度项目" in b.text]
        self.assertEqual(len(body), 1, "被 PDF 拆块的两行正文应合并为一段")
        self.assertIn("整体运行稳定。", body[0].text)
        numbered = [b for b in blocks if b.kind == "list" and "优化数据保存" in b.text]
        self.assertEqual(len(numbered), 1)
        self.assertIn("导致数据丢失。", numbered[0].text, "列表续行应并入列表项")
        after = [b for b in blocks if b.kind == "paragraph" and "列表之后的正文段落" in b.text]
        self.assertTrue(after, "列表之后回到左边界的正文不应被并入列表")

    def test_heading_levels_use_size_ranking_and_alignment(self):
        src = self.out("layout2.pdf")
        make_layout_fixture(src)
        pages = pdf_convert.extract_pages(src, render_images=False, keep_blocks=True)
        headings = {b.text: b for b in pages[0].blocks if b.kind == "heading"}
        self.assertEqual(headings["年度总结"].level, 1)
        self.assertEqual(headings["一、项目概况"].level, 2)
        self.assertEqual(headings["年度总结"].align, "center", "居中标题应识别为居中")
        self.assertEqual(headings["一、项目概况"].align, "left")

    def test_heading_levels_are_ranked_across_pages(self):
        src = self.out("cross-page.pdf")
        make_cross_page_heading_fixture(src)
        pages = pdf_convert.extract_pages(src, render_images=False, keep_blocks=True)
        page1 = {b.text: b.level for b in pages[0].blocks if b.kind == "heading"}
        page2 = {b.text: b.level for b in pages[1].blocks if b.kind == "heading"}
        self.assertEqual(page1["年度总结"], 1)
        self.assertEqual(page1["一、项目概况"], 2)
        self.assertEqual(page2["二、后续计划"], 2, "第 2 页小节标题应与全文其他小节同级")

    def test_single_page_pure_page_number_removed(self):
        src = self.out("single-page-number.pdf")
        make_page_number_fixture(src)
        pages = pdf_convert.extract_pages(src, render_images=False, keep_blocks=True)
        self.assertNotIn("- 1 -", pages[0].text, "纯页码页脚应被剔除")
        self.assertIn("单页正文段落", pages[0].text)

    # ---------- Markdown 提取(CLI 集成:真实 fixture) ----------

    def test_md_cli_multipage_with_images(self):
        out = self.out("out.md")
        r = run_cli([self.pdf, out, "--format", "md"])
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = json.loads(r.stdout)
        self.assertTrue(meta["ok"])
        self.assertEqual(meta["numPages"], 3)
        with open(out, encoding="utf-8") as f:
            text = f.read()
        for i in range(1, 4):
            self.assertIn(f"--- 第 {i} 页 ---", text)
        self.assertIn("# 第 1 页 测试文档", text)
        self.assertIn("正文内容 第2页 含中文与 ASCII Line2-A", text)
        self.assertIn("- 待办事项 检查", text)
        self.assertIn("![图片](data:image/png;base64,", text)
        self.assertTrue(text.startswith("--- 第 1 页 ---"))

    def test_images_zip(self):
        out = self.out("pages.zip")
        r = run_cli([self.pdf, out, "--format", "image"])
        self.assertEqual(r.returncode, 0)
        with zipfile.ZipFile(out) as zf:
            self.assertEqual(sorted(zf.namelist()), ["page_1.png", "page_2.png", "page_3.png"])

    def test_images_zip_single_page_still_zip(self):
        one = self.out("one.pdf")
        make_fixture(one, pages=1)
        out = self.out("one.zip")
        r = run_cli([one, out, "--format", "image"])
        self.assertEqual(r.returncode, 0)
        with zipfile.ZipFile(out) as zf:
            self.assertEqual(zf.namelist(), ["page_1.png"])

    def test_docx(self):
        out = self.out("out.docx")
        r = run_cli([self.pdf, out, "--format", "word"])
        self.assertEqual(r.returncode, 0)
        doc = Document(out)
        # 不再插入「第 N 页」标题,内容标题按字号排名成为 Heading 1
        h1 = [p.text for p in doc.paragraphs if p.style.name == "Heading 1"]
        self.assertEqual(h1, ["第 1 页 测试文档", "第 2 页 测试文档", "第 3 页 测试文档"])
        self.assertNotIn("第 1 页", [p.text for p in doc.paragraphs], "不应出现页标记标题")
        # 页与页之间用分页符分隔(3 页 = 2 个分页符)
        self.assertEqual(doc.element.body.xml.count('w:type="page"'), 2)
        h2 = [p.text for p in doc.paragraphs if p.style.name == "Heading 2"]
        self.assertEqual(h2, [], "同一文档只有一种标题字号时不应强行分出多级")
        all_text = "\n".join(p.text for p in doc.paragraphs)
        self.assertIn("测试文档", all_text)
        self.assertIn("正文内容", all_text)
        # 文本页优先可编辑文字:只保留 PDF 内真实图片(每页 1 张小图),
        # 不再整页贴图造成"文字 + 截图"重复(整页图宽 6.5 英寸)
        self.assertEqual(len(doc.inline_shapes), 3)
        for shape in doc.inline_shapes:
            self.assertLess(shape.width.inches, 3.0, "文本页不应出现整页截图")

    def test_docx_default_font_is_cjk_friendly(self):
        out = self.out("font.docx")
        pages = [pdf_convert.Page(num=1, text="中文", blocks=[])]
        pdf_convert.to_docx(pages, out)
        doc = Document(out)
        self.assertEqual(doc.styles["Normal"].font.name, "Microsoft YaHei")

    def test_docx_preserves_bold_runs(self):
        out = self.out("bold.docx")
        pages = [
            pdf_convert.Page(
                num=1,
                text="普通加粗",
                blocks=[
                    pdf_convert.Block(
                        "paragraph",
                        text="普通加粗",
                        runs=[pdf_convert.Run("普通"), pdf_convert.Run("加粗", bold=True)],
                    )
                ],
            )
        ]
        pdf_convert.to_docx(pages, out)
        doc = Document(out)
        bold = [r.text for p in doc.paragraphs for r in p.runs if r.bold]
        self.assertIn("加粗", bold)
        self.assertNotIn("普通", bold)

    def test_docx_run_keeps_original_font_name(self):
        # 原 PDF 声明的字体名(含子集前缀)应原样写回 run,不再全部回退默认字体
        out = self.out("font.docx")
        pages = [
            pdf_convert.Page(
                num=1,
                text="字体",
                blocks=[
                    pdf_convert.Block(
                        "paragraph",
                        text="字体",
                        runs=[
                            pdf_convert.Run("代码", font="ABCDEE+SourceCodePro"),
                            pdf_convert.Run("正文"),
                        ],
                    )
                ],
            )
        ]
        pdf_convert.to_docx(pages, out)
        doc = Document(out)
        names = {r.text: r.font.name for p in doc.paragraphs for r in p.runs}
        self.assertEqual(names.get("代码"), "SourceCodePro")
        self.assertIsNone(names.get("正文"), "未声明字体的 run 交给 Normal 样式")

    def test_docx_hyperlink_run_is_clickable(self):
        # 带链接的 Run 应写成 w:hyperlink(可点击),并保留原文字
        from docx.oxml.ns import qn

        out = self.out("link.docx")
        pages = [
            pdf_convert.Page(
                num=1,
                text="链接",
                blocks=[
                    pdf_convert.Block(
                        "paragraph",
                        text="链接",
                        runs=[
                            pdf_convert.Run("WorkLift", link="https://worklift.example.com/"),
                            pdf_convert.Run(" 与 ", size=12),
                            pdf_convert.Run(
                                "文档", bold=True, link="https://docs.worklift.example.com/"
                            ),
                        ],
                    )
                ],
            )
        ]
        pdf_convert.to_docx(pages, out)
        doc = Document(out)
        links = doc.element.body.findall(".//" + qn("w:hyperlink"))
        self.assertEqual(len(links), 2, "两个带链接的 run 应各自产出一个 hyperlink")
        targets = {doc.part.rels.get(h.get(qn("r:id"))).target_ref for h in links}
        self.assertEqual(
            targets, {"https://worklift.example.com/", "https://docs.worklift.example.com/"}
        )
        texts = {h.find(".//" + qn("w:t")).text for h in links}
        self.assertEqual(texts, {"WorkLift", "文档"})

    def test_docx_hyperlink_glyph_and_text_fallback(self):
        # 无链接 run 不应误包超链接;链接写入失败时退回普通文字(异常分支)
        from docx.oxml.ns import qn

        out = self.out("link-fallback.docx")
        pages = [
            pdf_convert.Page(
                num=1,
                text="降级",
                blocks=[
                    pdf_convert.Block(
                        "paragraph",
                        text="降级",
                        runs=[pdf_convert.Run("纯文字", size=12)],
                    )
                ],
            )
        ]
        pdf_convert.to_docx(pages, out)
        doc = Document(out)
        self.assertFalse(doc.element.body.findall(".//" + qn("w:hyperlink")))

        with unittest.mock.patch(
            "docx.opc.part.Part.relate_to",  # 文档部件注册关系入口:强制走异常分支
            side_effect=OSError("关系注册失败"),
        ):
            fallback = self.out("link-error.docx")
            pdf_convert.to_docx(
                [
                    pdf_convert.Page(
                        num=1,
                        text="降级",
                        blocks=[
                            pdf_convert.Block(
                                "paragraph",
                                text="降级",
                                runs=[pdf_convert.Run("纯文字", link="https://broken.example.com")],
                            )
                        ],
                    )
                ],
                fallback,
            )
        err_doc = Document(fallback)
        self.assertIn("纯文字", err_doc.paragraphs[0].text, "异常分支应保留文字本身")

    def test_cli_word_converts_link_to_clickable_hyperlink(self):
        src = self.out("link.pdf")
        make_hyperlink_fixture(src)
        out = self.out("link-cli.docx")
        r = run_cli([src, out, "--format", "word"])
        self.assertEqual(r.returncode, 0, r.stderr)
        from docx.oxml.ns import qn

        doc = Document(out)
        links = doc.element.body.findall(".//" + qn("w:hyperlink"))
        self.assertEqual(len(links), 1)
        rid = links[0].get(qn("r:id"))
        self.assertEqual(doc.part.rels.get(rid).target_ref, "https://worklift.example.com/")
        inner = links[0].find(".//" + qn("w:t")).text or ""
        self.assertIn("WorkLift", inner)

    def test_docx_unsafe_link_scheme_falls_back_to_plain_text(self):
        # javascript: 协议不允许进入转换结果,一律退回普通文字
        from docx.oxml.ns import qn

        out = self.out("unsafe-link.docx")
        pages = [
            pdf_convert.Page(
                num=1,
                text="危险",
                blocks=[
                    pdf_convert.Block(
                        "paragraph",
                        text="危险",
                        runs=[
                            pdf_convert.Run("脚本", link="javascript:alert(1)"),
                            pdf_convert.Run("邮件", link="mailto:a@b.example.com"),
                        ],
                    )
                ],
            )
        ]
        pdf_convert.to_docx(pages, out)
        doc = Document(out)
        links = doc.element.body.findall(".//" + qn("w:hyperlink"))
        self.assertEqual(len(links), 1, "只有白名单内的 mailto 应产出超链接")
        self.assertIn("mailto:a@b.example.com", doc.part.rels.get(links[0].get(qn("r:id"))).target_ref)
        plain = [r.text for p in doc.paragraphs for r in p.runs]
        self.assertIn("脚本", plain, "白名单外的链接文字退回普通 run")

    def test_markdown_drops_unsafe_link_scheme(self):
        blocks = [self._block([self._span(12.0, "危险链接", bbox=(0, 0, 60, 16))])]
        links = [{"kind": 2, "from": (0, -2, 60, 18), "uri": "javascript:alert(1)"}]
        md = pdf_convert.markdown_from_blocks(blocks, links=links)
        self.assertIn("危险链接", md, "文字本身必须保留")
        self.assertNotIn("javascript", md)
        self.assertNotIn("](", md)

    def test_markdown_link_parens_do_not_break_syntax(self):
        blocks = [self._block([self._span(12.0, "括号链接", bbox=(0, 0, 60, 16))])]
        links = [{"kind": 2, "from": (0, -2, 60, 18), "uri": "https://example.com/page(1)"}]
        md = pdf_convert.markdown_from_blocks(blocks, links=links)
        self.assertIn("[括号链接](https://example.com/page%281%29)", md)

    def test_span_runs_captures_font_name(self):
        spans = [self._span(12.0, "正文", font="ABCDEE+SourceCodePro")]
        runs = pdf_convert._span_runs(spans, [])
        self.assertEqual(runs[0].font, "ABCDEE+SourceCodePro")

    def test_span_runs_font_missing_is_none(self):
        span = {"size": 12.0, "flags": 0, "text": "无字体", "bbox": (0, 0, 40, 16)}
        runs = pdf_convert._span_runs([span], [])
        self.assertIsNone(runs[0].font)

    def test_docx_table_becomes_real_table(self):
        src = self.out("table.pdf")
        make_table_fixture(src)
        out = self.out("table.docx")
        r = run_cli([src, out, "--format", "word"])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = Document(out)
        self.assertEqual(len(doc.tables), 1)
        table = doc.tables[0]
        self.assertEqual([c.text for c in table.rows[0].cells], ["姓名", "项目", "金额"])
        self.assertEqual([c.text for c in table.rows[1].cells], ["张三", "差旅", "128.50"])
        # 表内文字不应再作为普通段落重复输出
        paras = "\n".join(p.text for p in doc.paragraphs)
        self.assertNotIn("张三", paras)
        # 表外标题仍保留
        self.assertIn("报销明细", paras)

    def test_docx_scanned_page_embeds_full_image(self):
        src = self.out("scan.pdf")
        make_scanned_fixture(src)
        out = self.out("scan.docx")
        r = run_cli([src, out, "--format", "word"])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = Document(out)
        self.assertEqual(len(doc.inline_shapes), 1, "扫描页应整页嵌入图片兜底")

    def test_docx_preserves_font_size_color_and_alignment(self):
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.shared import RGBColor

        out = self.out("format.docx")
        pages = [
            pdf_convert.Page(
                num=1,
                text="",
                width=595,
                height=842,
                blocks=[
                    pdf_convert.Block(
                        "heading",
                        text="标题",
                        level=1,
                        runs=[pdf_convert.Run("标题", bold=True, size=22, color=(26, 51, 153))],
                        bbox=(250, 68, 338, 94),
                        size=22,
                        align="center",
                    ),
                    pdf_convert.Block(
                        "paragraph",
                        text="正文",
                        runs=[pdf_convert.Run("正文", size=12, color=(0, 0, 0))],
                        bbox=(72, 120, 120, 134),
                    ),
                ],
            )
        ]
        pdf_convert.to_docx(pages, out)
        doc = Document(out)
        heading = doc.paragraphs[0]
        self.assertEqual(heading.style.name, "Heading 1")
        self.assertEqual(heading.alignment, WD_ALIGN_PARAGRAPH.CENTER)
        self.assertEqual(heading.runs[0].font.size.pt, 22)
        self.assertEqual(heading.runs[0].font.color.rgb, RGBColor(26, 51, 153))
        body = doc.paragraphs[1]
        self.assertEqual(body.runs[0].font.size.pt, 12)

    def test_docx_page_size_follows_pdf(self):
        src = self.out("layout3.pdf")
        make_layout_fixture(src)
        out = self.out("layout3.docx")
        r = run_cli([src, out, "--format", "word"])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = Document(out)
        self.assertAlmostEqual(doc.sections[0].page_width.inches, 595 / 72, delta=0.05)
        self.assertAlmostEqual(doc.sections[0].page_height.inches, 842 / 72, delta=0.05)

    def test_docx_inline_image_uses_pdf_width(self):
        out = self.out("image-width.docx")
        r = run_cli([self.pdf, out, "--format", "word"])
        self.assertEqual(r.returncode, 0, r.stderr)
        pages = pdf_convert.extract_pages(self.pdf, render_images=False, keep_blocks=True)
        image_block = next(block for block in pages[0].blocks if block.kind == "image")
        expected_inches = (image_block.bbox[2] - image_block.bbox[0]) / 72
        doc = Document(out)
        self.assertAlmostEqual(doc.inline_shapes[0].width.inches, expected_inches, delta=0.01)

    def test_docx_layout_mode_preserves_page_and_text_positions(self):
        from docx.oxml.ns import qn

        src = self.out("preserve-layout.pdf")
        make_layout_fixture(src)
        out = self.out("preserve-layout.docx")
        pdf_convert.to_docx_preserve(src, out)
        doc = Document(out)
        self.assertAlmostEqual(doc.sections[0].page_width.pt, 595.0, places=1)
        self.assertAlmostEqual(doc.sections[0].page_height.pt, 842.0, places=1)
        anchors = doc.paragraphs[0]._p.findall(".//" + qn("wp:anchor"))
        self.assertGreaterEqual(len(anchors), 9, "1 张背景图 + 8 个文字 span")
        self.assertEqual(anchors[0].get("behindDoc"), "1", "背景图必须在文字层下方")
        offsets = []
        for anchor in anchors[1:]:
            horizontal = anchor.find(".//" + qn("wp:positionH")).find(qn("wp:posOffset"))
            vertical = anchor.find(".//" + qn("wp:positionV")).find(qn("wp:posOffset"))
            offsets.append((int(horizontal.text), int(vertical.text)))
        # “年度总结”在 PDF 中从 x=250pt 开始;250pt = 3,175,000 EMU
        self.assertIn((3_175_000, 863_600), offsets)
        text = "".join(node.text or "" for node in doc.element.body.iter(qn("w:t")))
        self.assertEqual(text.count("年度总结"), 1, "文字只应出现在文本框层,背景图不含文字")

    def test_docx_layout_mode_keeps_font_size_and_color(self):
        src = self.out("preserve-style.pdf")
        make_layout_fixture(src)
        out = self.out("preserve-style.docx")
        pdf_convert.to_docx_preserve(src, out)
        doc = Document(out)
        xml = doc.element.body.xml
        self.assertIn('<w:sz w:val="44"/>', xml, "22pt 标题应保留字号")
        self.assertIn('<w:color w:val="1A3399"/>', xml, "蓝色小节标题应保留颜色")

    def test_cli_layout_word_outputs_real_docx(self):
        out = self.out("preserve-cli.docx")
        r = run_cli([self.pdf, out, "--format", "word", "--layout"])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('"ok": true', r.stdout)
        self.assertGreater(len(Document(out).paragraphs), 0)

    def test_cli_layout_rejects_non_word_ppt(self):
        out = self.out("preserve-bad.xlsx")
        r = run_cli([self.pdf, out, "--format", "excel", "--layout"])
        self.assertEqual(r.returncode, 1)
        self.assertIn("--layout", r.stderr)

    def test_layout_font_name_strips_subset_prefix(self):
        self.assertEqual(pdf_convert._layout_font_name("ABCDEF+SimSun"), "SimSun")
        self.assertEqual(pdf_convert._layout_font_name("Arial,Bold"), "Arial")
        self.assertEqual(pdf_convert._layout_font_name(""), "Microsoft YaHei")

    def test_xlsx(self):
        out = self.out("out.xlsx")
        r = run_cli([self.pdf, out, "--format", "excel"])
        self.assertEqual(r.returncode, 0)
        wb = load_workbook(out)
        self.assertEqual(wb.sheetnames, ["第1页", "第2页", "第3页"])
        ws = wb["第1页"]
        values = [c for row in ws.iter_rows(values_only=True) for c in row if c]
        self.assertIn("正文内容 第1页 含中文与 ASCII Line1-A", values)
        # 文本工作表也做了可读性处理
        self.assertEqual(ws.freeze_panes, "A2")
        self.assertTrue(ws["A1"].alignment.wrap_text)

    def test_xlsx_table_becomes_real_columns(self):
        src = self.out("table2.pdf")
        make_table_fixture(src)
        out = self.out("table.xlsx")
        r = run_cli([src, out, "--format", "excel"])
        self.assertEqual(r.returncode, 0, r.stderr)
        wb = load_workbook(out)
        self.assertEqual(wb.sheetnames, ["第1页", "第1页-文本"])
        ws = wb["第1页"]
        self.assertEqual(ws["A1"].value, "姓名")
        self.assertEqual(ws["B1"].value, "项目")
        self.assertEqual(ws["C1"].value, "金额")
        self.assertEqual(ws["A2"].value, "张三")
        self.assertEqual(ws["C2"].value, 128.5)
        self.assertEqual(ws["C2"].number_format, "0.00", "金额应保留两位小数显示")
        self.assertIsInstance(ws["C2"].value, float, "金额应写成数值而非文本")
        self.assertEqual(ws["A3"].value, "李四")
        self.assertTrue(ws["A1"].font.bold, "表头应加粗")
        self.assertEqual(ws.freeze_panes, "A2")
        # 表外文字进独立文本表,不与表格混在一起
        self.assertIn("报销明细", [c for row in wb["第1页-文本"].iter_rows(values_only=True) for c in row if c])

    def test_xlsx_text_sheet_excludes_table_content(self):
        src = self.out("table5.pdf")
        make_table_fixture(src)
        out = self.out("table5.xlsx")
        r = run_cli([src, out, "--format", "excel"])
        self.assertEqual(r.returncode, 0, r.stderr)
        wb = load_workbook(out)
        values = [c for row in wb["第1页-文本"].iter_rows(values_only=True) for c in row if c]
        self.assertIn("报销明细", values)
        self.assertNotIn("姓名", values, "表格内容不应在文本表中重复出现")
        self.assertNotIn("张三", values)

    def test_xlsx_numbers_are_numeric(self):
        self.assertEqual(pdf_convert._coerce_cell_value("128.50"), (128.5, "0.00"))
        self.assertEqual(pdf_convert._coerce_cell_value("12"), (12, "0"))
        self.assertEqual(pdf_convert._coerce_cell_value("1,280.50"), (1280.5, "0.00"))
        self.assertEqual(pdf_convert._coerce_cell_value("007"), ("007", None), "前导零编号应保持文本")
        self.assertEqual(pdf_convert._coerce_cell_value("差旅"), ("差旅", None))

    def test_pptx(self):
        out = self.out("out.pptx")
        r = run_cli([self.pdf, out, "--format", "ppt"])
        self.assertEqual(r.returncode, 0)
        prs = Presentation(out)
        self.assertEqual(len(prs.slides), 3)
        texts = "\n".join(
            sh.text_frame.text for s in prs.slides for sh in s.shapes if getattr(sh, "has_text_frame", False)
        )
        self.assertIn("第 1 页 测试文档", texts)
        self.assertIn("正文内容", texts)
        pictures = sum(1 for s in prs.slides for sh in s.shapes if sh.shape_type == 13)
        self.assertEqual(pictures, 0, "文本页应输出可编辑文字,而不是整页图片")

    def test_pptx_scanned_page_uses_full_image(self):
        src = self.out("scan2.pdf")
        make_scanned_fixture(src)
        out = self.out("scan.pptx")
        r = run_cli([src, out, "--format", "ppt"])
        self.assertEqual(r.returncode, 0, r.stderr)
        prs = Presentation(out)
        self.assertEqual(len(prs.slides), 1)
        pictures = sum(1 for s in prs.slides for sh in s.shapes if sh.shape_type == 13)
        self.assertEqual(pictures, 1, "扫描页应有整页图片兜底")

    def test_pptx_splits_overflow_items(self):
        blocks = [
            pdf_convert.Block(
                "heading",
                text="标题",
                level=1,
                runs=[pdf_convert.Run("标题", size=22)],
                bbox=(72, 68, 120, 94),
                size=22,
            )
        ]
        for index in range(1, 26):
            blocks.append(
                pdf_convert.Block(
                    "paragraph",
                    text=f"要点{index}",
                    runs=[pdf_convert.Run(f"要点{index}", size=12)],
                    bbox=(72, 100 + index * 20, 200, 100 + index * 20 + 14),
                )
            )
        out = self.out("overflow.pptx")
        pdf_convert.to_pptx([pdf_convert.Page(num=1, text="", blocks=blocks)], out)
        prs = Presentation(out)
        self.assertEqual(len(prs.slides), 2, "25 条要点应拆成 2 页,而不是截断")
        texts = "\n".join(
            sh.text_frame.text for s in prs.slides for sh in s.shapes if getattr(sh, "has_text_frame", False)
        )
        self.assertIn("要点1", texts)
        self.assertIn("要点25", texts)
        self.assertIn("（续）", texts)

    def test_pptx_layout_mode_has_background_and_positioned_text(self):
        from pptx.enum.shapes import MSO_SHAPE_TYPE

        src = self.out("preserve-ppt.pdf")
        make_layout_fixture(src)
        out = self.out("preserve-ppt.pptx")
        pdf_convert.to_pptx_preserve(src, out)
        prs = Presentation(out)
        self.assertEqual(len(prs.slides), 1)
        self.assertAlmostEqual(prs.slide_width.pt, 595.0, delta=1)
        slide = prs.slides[0]
        pictures = [shape for shape in slide.shapes if shape.shape_type == MSO_SHAPE_TYPE.PICTURE]
        self.assertEqual(len(pictures), 1, "每页应有一张去文字背景图")
        self.assertAlmostEqual(pictures[0].width.pt, 595.0, delta=1)
        title = next(
            shape
            for shape in slide.shapes
            if getattr(shape, "has_text_frame", False) and shape.text_frame.text == "年度总结"
        )
        self.assertAlmostEqual(title.left.pt, 250.0, delta=2.0)
        self.assertLess(title.top.pt, 90.0)
        texts = "\n".join(
            shape.text_frame.text for shape in slide.shapes if getattr(shape, "has_text_frame", False)
        )
        self.assertEqual(texts.count("年度总结"), 1, "文字不应在背景与文字层重复")

    def test_txt_collapses_blank_lines(self):
        text = pdf_convert.to_txt([pdf_convert.Page(num=1, text="第一段\n\n\n\n第二段\n")])
        self.assertEqual(text, "--- 第 1 页 ---\n第一段\n\n第二段")

    def test_markdown_merges_wrapped_paragraph_lines(self):
        block = {
            "type": 0,
            "bbox": (0, 0, 300, 40),
            "lines": [
                {"spans": [self._span(12.0, "This is a wrapped", bbox=(0, 0, 120, 14))], "bbox": (0, 0, 120, 14)},
                {
                    "spans": [self._span(12.0, "sentence for testing", bbox=(0, 16, 140, 30))],
                    "bbox": (0, 16, 140, 30),
                },
            ],
        }
        md = pdf_convert.markdown_from_blocks([block])
        self.assertIn("This is a wrapped sentence for testing", md)
        self.assertEqual(md.count("This is a wrapped"), 1)

    def test_markdown_table_syntax(self):
        src = self.out("table3.pdf")
        make_table_fixture(src)
        out = self.out("table.md")
        r = run_cli([src, out, "--format", "md"])
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(out, encoding="utf-8") as f:
            text = f.read()
        self.assertIn("| 姓名 | 项目 | 金额 |", text)
        self.assertIn("| --- | --- | --- |", text)
        self.assertIn("| 张三 | 差旅 | 128.50 |", text)

    def test_txt_table_is_tab_separated(self):
        src = self.out("table4.pdf")
        make_table_fixture(src)
        out = self.out("table.txt")
        r = run_cli([src, out, "--format", "txt"])
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(out, encoding="utf-8") as f:
            text = f.read()
        self.assertIn("姓名\t项目\t金额", text)
        self.assertIn("张三\t差旅\t128.50", text)

    def test_repeated_header_footer_removed(self):
        src = self.out("hdr.pdf")
        make_header_footer_fixture(src)
        pages = pdf_convert.extract_pages(src, render_images=False, keep_blocks=True)
        self.assertEqual(len(pages), 3)
        for p in pages:
            self.assertNotIn("机密文档", p.text, "重复页眉/页码应被剔除")
            self.assertIn(f"正文段落{p.num}", p.text)

    def test_single_page_keeps_margin_text(self):
        src = self.out("single-hdr.pdf")
        make_header_footer_fixture(src, pages=1)
        pages = pdf_convert.extract_pages(src, render_images=False, keep_blocks=True)
        self.assertIn("机密文档", pages[0].text, "单页文档不判定页眉页脚,避免误删正文")

    def test_render_resolution_is_sharper(self):
        self.assertGreaterEqual(pdf_convert.RENDER_SCALE, 3.0)
        out = self.out("sharp.png")
        r = run_cli([self.pdf, out, "--page", "1"])
        self.assertEqual(r.returncode, 0)
        width, height = png_size(out)
        self.assertGreaterEqual(width, 1500, "A4 页面 3x 渲染宽度应约 1785px")
        self.assertGreater(height, width)

    def test_page_render(self):
        out = self.out("p2.png")
        r = run_cli([self.pdf, out, "--page", "2"])
        self.assertEqual(r.returncode, 0)
        meta = json.loads(r.stdout)
        self.assertEqual(meta["page"], 2)
        self.assertEqual(meta["numPages"], 3)
        with open(out, "rb") as f:
            self.assertTrue(f.read(8).startswith(b"\x89PNG"))

    # ---------- 错误分支(CLI 契约) ----------

    def test_bad_pdf_file(self):
        bad = self.out("bad.pdf")
        with open(bad, "wb") as f:
            f.write(b"this is definitely not a pdf")
        r = run_cli([bad, "--check"])
        self.assertEqual(r.returncode, 1)
        err = json.loads(r.stderr)
        self.assertIn("无法解析", err["error"])

    def test_missing_file(self):
        r = run_cli([os.path.join(self.tmp, "missing.pdf"), "--check"])
        self.assertEqual(r.returncode, 1)
        self.assertIn("文件不存在", json.loads(r.stderr)["error"])

    def test_unknown_format(self):
        r = run_cli([self.pdf, self.out("x.out"), "--format", "bogus"])
        self.assertEqual(r.returncode, 1)
        self.assertIn("未知格式", json.loads(r.stderr)["error"])

    def test_missing_out_for_format(self):
        r = run_cli([self.pdf, "--format", "txt"])
        self.assertEqual(r.returncode, 1)
        self.assertIn("缺少输出文件", json.loads(r.stderr)["error"])

    def test_missing_out_for_page(self):
        r = run_cli([self.pdf, "--page", "1"])
        self.assertEqual(r.returncode, 1)

    def test_page_out_of_range(self):
        r = run_cli([self.pdf, self.out("x.png"), "--page", "99"])
        self.assertEqual(r.returncode, 1)
        self.assertIn("页号超出范围", json.loads(r.stderr)["error"])

    def test_page_out_of_range_low(self):
        r = run_cli([self.pdf, self.out("x.png"), "--page", "0"])
        self.assertEqual(r.returncode, 1)

    def test_no_operation(self):
        r = run_cli([self.pdf])
        self.assertEqual(r.returncode, 1)
        self.assertIn("缺少操作参数", json.loads(r.stderr)["error"])

    def test_stdout_kept_clean_on_error(self):
        bad = self.out("bad2.pdf")
        with open(bad, "wb") as f:
            f.write(b"not a pdf")
        r = run_cli([bad, "--check"])
        self.assertEqual(r.stdout.strip(), "")  # 失败时 stdout 必须为空


class RenderBudgetTest(unittest.TestCase):
    """渲染像素预算：恶意 PDF 用超大 MediaBox 撑爆内存（本地拒绝服务）的防护。

    正常页面必须保持原倍率（功能不变），超大页面按预算降采样。
    """

    def test_normal_a4_keeps_scale(self):
        rect = fitz.Rect(0, 0, 595, 842)  # A4：3 倍下约 4.5MP，远低于预算
        self.assertAlmostEqual(pdf_convert._render_scale(rect, 3.0), 3.0)
        self.assertAlmostEqual(pdf_convert._render_scale(rect, 2.0), 2.0)

    def test_huge_page_clamped_to_budget(self):
        rect = fitz.Rect(0, 0, 20000, 20000)  # 3 倍需 60000×60000 ≈ 10.8GB
        scale = pdf_convert._render_scale(rect, 3.0)
        pixels = (rect.width * scale) * (rect.height * scale)
        self.assertLessEqual(pixels, pdf_convert.MAX_RENDER_PIXELS * 1.001)
        self.assertGreater(scale, 0)

    def test_budget_is_configurable(self):
        rect = fitz.Rect(0, 0, 1000, 1000)
        scale = pdf_convert._render_scale(rect, 3.0, max_pixels=250_000)
        self.assertAlmostEqual(scale, 0.5)  # sqrt(250000/1e6)

    def test_extreme_page_hits_scale_floor(self):
        rect = fitz.Rect(0, 0, 1_000_000, 1_000_000)  # 预算倍率会趋近 0，仍保底可辨识缩略图
        self.assertGreaterEqual(pdf_convert._render_scale(rect, 3.0), pdf_convert.MIN_RENDER_SCALE)

    def test_non_positive_budget_returns_input(self):
        rect = fitz.Rect(0, 0, 10, 10)
        self.assertEqual(pdf_convert._render_scale(rect, 3.0, max_pixels=0), 3.0)

    def test_render_page_respects_budget(self):
        """真实渲染：超大页面在受限预算下产出受控尺寸的图片，且不抛异常。"""
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "big.pdf")
            out = os.path.join(tmp, "big.png")
            doc = fitz.open()
            page = doc.new_page(width=2000, height=2000)  # 常规倍率需 6000×6000 = 36MP
            page.insert_text((72, 96), "big page", fontsize=24, fontname="china-s")
            doc.save(src)
            doc.close()

            with unittest.mock.patch.object(pdf_convert, "MAX_RENDER_PIXELS", 1_000_000):
                pdf_convert.render_page(src, 1, out, scale=3.0)

            pix = fitz.Pixmap(out)
            try:
                self.assertLessEqual(pix.width * pix.height, 1_000_000 * 1.05)
                self.assertGreater(pix.width * pix.height, 500_000, "应尽量用满预算而非过度降采样")
            finally:
                pix = None


class PageRangeTest(unittest.TestCase):
    """按页码转换：范围解析 + 各格式选页输出 + CLI 参数校验。

    页码选择属于"减少输出范围"的功能，关键是既不能多转页（用户拿到多余内容），
    也不能改变页号语义（TXT/Markdown 的页码标题、图片文件名仍用原始页号）。
    """

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="worklift-pages-test-")
        cls.pdf = os.path.join(cls.tmp, "sample.pdf")
        make_fixture(cls.pdf, pages=3)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def out(self, name):
        return os.path.join(self.tmp, name)

    # ---------- 纯函数：范围解析 ----------

    def test_parse_empty_means_all(self):
        self.assertEqual(pdf_convert.parse_page_range(None, 3), [1, 2, 3])
        self.assertEqual(pdf_convert.parse_page_range("", 3), [1, 2, 3])
        self.assertEqual(pdf_convert.parse_page_range("   ", 3), [1, 2, 3])

    def test_parse_single_and_range(self):
        self.assertEqual(pdf_convert.parse_page_range("2", 5), [2])
        self.assertEqual(pdf_convert.parse_page_range("2-4", 5), [2, 3, 4])
        self.assertEqual(pdf_convert.parse_page_range("1-1", 5), [1])
        self.assertEqual(pdf_convert.parse_page_range("1-5", 5), [1, 2, 3, 4, 5])

    def test_parse_open_ended_range(self):
        self.assertEqual(pdf_convert.parse_page_range("3-", 5), [3, 4, 5])
        self.assertEqual(pdf_convert.parse_page_range("-2", 5), [1, 2])

    def test_parse_combo_sorts_and_dedupes(self):
        self.assertEqual(pdf_convert.parse_page_range("3,1,2,2", 5), [1, 2, 3])
        self.assertEqual(pdf_convert.parse_page_range("5,1-2,2-3", 5), [1, 2, 3, 5])

    def test_parse_fullwidth_and_spaces_tolerated(self):
        # 中文输入法常见的全角逗号/连字符/波浪线，以及多余空格
        self.assertEqual(pdf_convert.parse_page_range("1－2，4", 5), [1, 2, 4])
        self.assertEqual(pdf_convert.parse_page_range(" 1 ~ 2 , 4 ", 5), [1, 2, 4])
        self.assertEqual(pdf_convert.parse_page_range("1、3", 5), [1, 3])

    def test_parse_rejects_out_of_range_and_reversed(self):
        with self.assertRaises(pdf_convert.PdfError) as ctx:
            pdf_convert.parse_page_range("9", 3)
        self.assertIn("超出范围", str(ctx.exception))
        self.assertIn("共 3 页", str(ctx.exception))

        with self.assertRaises(pdf_convert.PdfError) as ctx:
            pdf_convert.parse_page_range("3-9", 3)
        self.assertIn("超出范围", str(ctx.exception))

    def test_parse_rejects_zero_and_negative_and_garbage(self):
        for spec in ("0", "-0", "abc", "1-a", "1-2-3"):
            with self.assertRaises(pdf_convert.PdfError, msg=f"{spec} 应报错"):
                pdf_convert.parse_page_range(spec, 3)

    def test_parse_rejects_start_greater_than_end(self):
        with self.assertRaises(pdf_convert.PdfError) as ctx:
            pdf_convert.parse_page_range("3-1", 5)
        self.assertIn("起始页不能大于结束页", str(ctx.exception))

    def test_parse_requires_known_total(self):
        with self.assertRaises(pdf_convert.PdfError):
            pdf_convert.parse_page_range("1", 0)

    # ---------- 提取层：选页不影响原始页号 ----------

    def test_extract_pages_subset_keeps_original_numbers(self):
        pages = pdf_convert.extract_pages(self.pdf, render_images=False, page_numbers="2-3")
        self.assertEqual([p.num for p in pages], [2, 3])
        self.assertIn("第 2 页 测试文档", pages[0].text)
        self.assertIn("第 3 页 测试文档", pages[1].text)

    def test_extract_pages_accepts_list_and_returns_single_page(self):
        pages = pdf_convert.extract_pages(self.pdf, render_images=False, page_numbers=[2])
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0].num, 2)
        self.assertNotIn("第 1 页", pages[0].text)

    def test_extract_pages_rejects_bad_range(self):
        with self.assertRaises(pdf_convert.PdfError):
            pdf_convert.extract_pages(self.pdf, page_numbers="9")

    # ---------- CLI：各格式只产出选中页 ----------

    def test_cli_txt_only_selected_page(self):
        out = self.out("pages-txt.txt")
        r = run_cli([self.pdf, out, "--format", "txt", "--pages", "2"])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["numPages"], 1)
        with open(out, encoding="utf-8") as f:
            text = f.read()
        self.assertIn("第 2 页 测试文档", text)
        self.assertNotIn("第 1 页 测试文档", text)
        self.assertNotIn("第 3 页 测试文档", text)

    def test_cli_images_zip_only_selected_pages(self):
        out = self.out("pages-images.zip")
        r = run_cli([self.pdf, out, "--format", "image", "--pages", "2-3"])
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as zf:
            names = sorted(zf.namelist())
        self.assertEqual(names, ["page_2.png", "page_3.png"])

    def test_cli_markdown_only_selected_page(self):
        out = self.out("pages-md.md")
        r = run_cli([self.pdf, out, "--format", "md", "--pages", "3"])
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(out, encoding="utf-8") as f:
            text = f.read()
        self.assertIn("--- 第 3 页 ---", text)
        self.assertNotIn("--- 第 1 页 ---", text)

    def test_cli_word_only_selected_page(self):
        out = self.out("pages-word.docx")
        r = run_cli([self.pdf, out, "--format", "word", "--pages", "1"])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = Document(out)
        text = "\n".join(p.text for p in doc.paragraphs)
        self.assertIn("第 1 页", text)
        self.assertNotIn("第 2 页", text)

    def test_cli_layout_word_respects_pages(self):
        """保留原版式按整份 PDF 写出，选页时必须先裁出子集（回归：曾整份输出）。"""
        from docx.oxml.ns import qn

        out = self.out("pages-layout.docx")
        r = run_cli([self.pdf, out, "--format", "word", "--layout", "--pages", "2"])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["numPages"], 1)
        doc = Document(out)
        # 保真模式下文字在文本框层，需从 XML 里取；正文段落是空的
        text = "".join(node.text or "" for node in doc.element.body.iter(qn("w:t")))
        self.assertIn("第 2 页", text)
        self.assertNotIn("第 1 页", text)
        self.assertFalse(os.path.exists(out + ".pages.pdf"), "选页用的临时 PDF 应被清理")

    def test_cli_all_pages_when_pages_omitted(self):
        out = self.out("pages-all.txt")
        r = run_cli([self.pdf, out, "--format", "txt"])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["numPages"], 3)

    def test_cli_rejects_bad_pages(self):
        cases = {"9": "超出范围", "0": "超出范围", "3-1": "起始页不能大于结束页", "abc": "格式不正确"}
        for spec, expected in cases.items():
            with self.subTest(spec=spec):
                out = self.out(f"bad-{abs(hash(spec))}.txt")
                r = run_cli([self.pdf, out, "--format", "txt", "--pages", spec])
                self.assertEqual(r.returncode, 1)
                self.assertIn(expected, r.stderr)
                self.assertFalse(os.path.exists(out), "参数非法时不应产出文件")

    def test_cli_pages_conflicts_with_single_page_render(self):
        out = self.out("conflict.png")
        r = run_cli([self.pdf, out, "--page", "1", "--pages", "1-2"])
        self.assertEqual(r.returncode, 1)
        self.assertIn("--pages", r.stderr)


class BodySizeTest(unittest.TestCase):
    """正文基准字号必须跨整份文档统计,且排除页眉/页脚。

    历史缺陷:按单页统计时,页眉页脚 9pt 小字会压低基准字号,12pt 正文被判成标题,
    进而在 Word 里变成 Heading 3、Markdown 里变成 ###、PPT 里进标题区——格式整体乱套。
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.pdf = os.path.join(self.tmp, "margined.pdf")
        make_margined_short_page_fixture(self.pdf)

    def out(self, name):
        return os.path.join(self.tmp, name)

    def test_document_body_size_not_biased_by_margins(self):
        doc = fitz.open(self.pdf)
        self.addCleanup(doc.close)
        self.assertAlmostEqual(pdf_convert._document_body_size(doc), 12.0, places=1)

    def test_margin_lines_are_excluded_from_body_size(self):
        """页眉行(顶部 7% 内)与页脚行不应计入正文字号统计。"""
        self.assertTrue(pdf_convert._segment_in_margin((72, 20, 200, 32), 842))
        self.assertTrue(pdf_convert._segment_in_margin((280, 806, 320, 818), 842))
        self.assertFalse(pdf_convert._segment_in_margin((72, 130, 300, 142), 842))
        self.assertFalse(pdf_convert._segment_in_margin(None, 842))

    def test_short_page_body_text_stays_paragraph(self):
        pages = pdf_convert.extract_pages(self.pdf, render_images="none", keep_blocks=True)
        second = pages[1]
        headings = [b for b in second.blocks if b.kind == "heading"]
        self.assertEqual([b.text for b in headings], ["二、下步计划"])
        lists = [b for b in second.blocks if b.kind == "list"]
        self.assertEqual([b.text for b in lists], ["拓展市场", "优化流程"])
        self.assertTrue(all(b.ordered for b in lists), "1./2. 应识别为有序列表")

    def test_heading_levels_follow_size_not_margin_noise(self):
        pages = pdf_convert.extract_pages(self.pdf, render_images="none", keep_blocks=True)
        levels = {(b.text, b.level) for b in pages[0].blocks if b.kind == "heading"}
        self.assertEqual(levels, {("季度报告", 1), ("一、总体情况", 2)})

    def test_markdown_body_not_promoted_to_heading(self):
        md_path = self.out("m.md")
        pdf_convert._write_markdown(self.pdf, md_path)
        with open(md_path, encoding="utf-8") as handle:
            text = handle.read()
        self.assertNotIn("### ", text, "12pt 正文不应变成三级标题")
        body_lines = [line for line in text.splitlines() if "拓展市场" in line]
        self.assertTrue(body_lines)
        self.assertFalse(body_lines[0].lstrip().startswith("#"), "正文列表项不应带标题标记")

    def test_body_size_sampling_is_bounded(self):
        """大文档只采样前 BODY_SIZE_SAMPLE_PAGES 页,避免整份重解析把耗时翻倍。"""
        pdf = os.path.join(self.tmp, "many.pdf")
        doc = fitz.open()
        for index in range(pdf_convert.BODY_SIZE_SAMPLE_PAGES + 5):
            page = doc.new_page(width=595, height=842)
            page.insert_text((72, 200), f"正文第{index}页 内容内容内容", fontsize=12, fontname="china-s")
        doc.save(pdf)
        doc.close()
        doc = fitz.open(pdf)
        self.addCleanup(doc.close)
        self.assertEqual(len(list(pdf_convert._body_size_pages(doc))), pdf_convert.BODY_SIZE_SAMPLE_PAGES)
        self.assertAlmostEqual(pdf_convert._document_body_size(doc), 12.0, places=1)

    def test_docx_body_not_styled_as_heading(self):
        pages = pdf_convert.extract_pages(self.pdf, render_images="none", keep_blocks=True)
        docx_path = self.out("m.docx")
        pdf_convert.to_docx(pages, docx_path)
        doc = Document(docx_path)
        styled = {p.text: p.style.name for p in doc.paragraphs if p.text}
        self.assertEqual(styled.get("拓展市场"), "List Number")
        self.assertEqual(styled.get("优化流程"), "List Number")
        self.assertEqual(styled.get("二、下步计划"), "Heading 2")
        self.assertNotEqual(styled.get("拓展市场"), "Heading 3")


class DocxListNumberingTest(unittest.TestCase):
    """Word 里有序列表必须「每组从 1 开始」,跨页续写则接续原序号。

    历史缺陷:内置 List Number 样式全文共用一个编号实例(numId=5),
    第二组列表接着上一组编号,输出成 3、4 而不是 1、2。
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def out(self, name):
        return os.path.join(self.tmp, name)

    def convert(self, make, name="x.docx"):
        pdf = self.out(name.replace(".docx", ".pdf"))
        make(pdf)
        pages = pdf_convert.extract_pages(pdf, render_images="none", keep_blocks=True)
        docx_path = self.out(name)
        pdf_convert.to_docx(pages, docx_path)
        return docx_path

    def test_two_groups_get_separate_numbering_instances(self):
        docx_path = self.convert(make_multi_ordered_list_fixture)
        numbers = paragraph_numbering(docx_path)
        first = {numbers["甲项"], numbers["乙项"]}
        second = {numbers["丙项"], numbers["丁项"]}
        self.assertEqual(len(first), 1, "同一组内应共用一个编号实例")
        self.assertEqual(len(second), 1, "同一组内应共用一个编号实例")
        self.assertNotEqual(first, second, "两组有序列表必须使用不同编号实例,才能各自从 1 开始")
        self.assertEqual(numbers["甲项"][1], 1)
        self.assertEqual(numbers["丙项"][1], 1)

    def test_cross_page_list_continues_from_original_number(self):
        docx_path = self.convert(make_cross_page_list_fixture)
        numbers = paragraph_numbering(docx_path)
        self.assertEqual(numbers["第一步"][1], 1)
        self.assertEqual(numbers["第三步"][1], 3, "跨页续写的列表应从原文档的 3 继续,而不是重置为 1")
        self.assertNotEqual(numbers["第一步"][0], numbers["第三步"][0])

    def test_bullet_list_keeps_style_numbering(self):
        pdf = self.out("b.pdf")
        doc = fitz.open()
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 90), "要点", fontsize=18, fontname="china-s")
        page.insert_text((72, 130), "• 无序项一", fontsize=12, fontname="china-s")
        page.insert_text((72, 153), "• 无序项二", fontsize=12, fontname="china-s")
        doc.save(pdf)
        doc.close()
        pages = pdf_convert.extract_pages(pdf, render_images="none", keep_blocks=True)
        docx_path = self.out("b.docx")
        pdf_convert.to_docx(pages, docx_path)
        numbers = paragraph_numbering(docx_path)
        self.assertEqual(numbers["无序项一"], (None, None), "无序列表不应改用有序编号实例")
        styles = {p.text: p.style.name for p in Document(docx_path).paragraphs if p.text}
        self.assertEqual(styles["无序项一"], "List Bullet")

    def test_list_marker_number_parsing(self):
        cases = {
            "1. 甲": 1,
            "12) 乙": 12,
            "一、丙": 1,
            "十、丁": 10,
            "十一、戊": 11,
            "无编号": 0,
            "1.2 版本说明": 0,  # 小数不是编号
        }
        for text, expected in cases.items():
            self.assertEqual(pdf_convert._list_marker_number(text), expected, text)


class MarkdownListTest(unittest.TestCase):
    """Markdown 列表:条目之间不插空行(否则渲染成 loose list,间距变大),有序列表保留真实序号。"""

    def render(self, blocks):
        return pdf_convert._render_markdown_blocks(blocks)

    def test_consecutive_items_share_one_line_break(self):
        blocks = [
            pdf_convert.Block("list", text="甲"),
            pdf_convert.Block("list", text="乙"),
            pdf_convert.Block("list", text="丙"),
        ]
        self.assertEqual(self.render(blocks), "- 甲\n- 乙\n- 丙")

    def test_ordered_list_uses_real_numbers(self):
        blocks = [
            pdf_convert.Block("list", text="甲", ordered=True, start=1),
            pdf_convert.Block("list", text="乙", ordered=True, start=2),
            pdf_convert.Block("list", text="丙", ordered=True, start=3),
        ]
        self.assertEqual(self.render(blocks), "1. 甲\n2. 乙\n3. 丙")

    def test_ordered_list_falls_back_to_increment_without_marker(self):
        blocks = [
            pdf_convert.Block("list", text="甲", ordered=True, start=0),
            pdf_convert.Block("list", text="乙", ordered=True, start=0),
        ]
        self.assertEqual(self.render(blocks), "1. 甲\n2. 乙")

    def test_new_group_restarts_numbering(self):
        blocks = [
            pdf_convert.Block("list", text="甲", ordered=True, start=1),
            pdf_convert.Block("list", text="乙", ordered=True, start=2),
            pdf_convert.Block("heading", text="第二节", level=2),
            pdf_convert.Block("list", text="丙", ordered=True, start=1),
            pdf_convert.Block("list", text="丁", ordered=True, start=2),
        ]
        text = self.render(blocks)
        self.assertIn("1. 甲\n2. 乙", text)
        self.assertIn("1. 丙\n2. 丁", text)
        self.assertNotIn("3. 丙", text, "第二组不应接着第一组编号")

    def test_block_types_keep_blank_line_between(self):
        blocks = [
            pdf_convert.Block("list", text="甲"),
            pdf_convert.Block("paragraph", text="列表之后的正文"),
            pdf_convert.Block("list", text="乙", ordered=True, start=1),
        ]
        text = self.render(blocks)
        self.assertIn("- 甲\n\n列表之后的正文", text)
        self.assertIn("列表之后的正文\n\n1. 乙", text, "无序与有序列表之间必须留空行,否则会被当成同一个列表")

    def test_markdown_document_keeps_original_numbers(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf = os.path.join(tmp, "l.pdf")
            make_multi_ordered_list_fixture(pdf)
            md_path = os.path.join(tmp, "l.md")
            pdf_convert._write_markdown(pdf, md_path)
            with open(md_path, encoding="utf-8") as handle:
                text = handle.read()
        self.assertIn("1. 甲项\n2. 乙项", text)
        self.assertIn("1. 丙项\n2. 丁项", text)


class PlainTextListTest(unittest.TestCase):
    """纯文本(TXT)与 PPT 只能写字符串,列表符号/编号必须由输出层补回。

    历史缺陷:符号在提取阶段被剥离后没有补回,TXT 里项目符号与编号全部消失,
    PPT 里有序列表统一显示成 "•",步骤顺序丢失。
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_blocks_to_text_keeps_markers(self):
        blocks = [
            pdf_convert.Block("paragraph", text="引言"),
            pdf_convert.Block("list", text="甲"),
            pdf_convert.Block("list", text="乙"),
            pdf_convert.Block("list", text="第一步", ordered=True, start=1),
            pdf_convert.Block("list", text="第二步", ordered=True, start=2),
        ]
        self.assertEqual(
            pdf_convert._blocks_to_text(blocks),
            "引言\n• 甲\n• 乙\n1. 第一步\n2. 第二步",
        )

    def test_blocks_to_text_restarts_numbering_between_groups(self):
        blocks = [
            pdf_convert.Block("list", text="甲", ordered=True, start=1),
            pdf_convert.Block("list", text="乙", ordered=True, start=2),
            pdf_convert.Block("heading", text="第二节", level=2),
            pdf_convert.Block("list", text="丙", ordered=True, start=1),
            pdf_convert.Block("list", text="丁", ordered=True, start=2),
        ]
        self.assertEqual(
            pdf_convert._blocks_to_text(blocks),
            "1. 甲\n2. 乙\n第二节\n1. 丙\n2. 丁",
        )

    def test_blocks_to_text_without_marker_increments(self):
        blocks = [
            pdf_convert.Block("list", text="甲", ordered=True, start=0),
            pdf_convert.Block("list", text="乙", ordered=True, start=0),
            pdf_convert.Block("list", text="丙", ordered=True, start=0),
        ]
        self.assertEqual(pdf_convert._blocks_to_text(blocks), "1. 甲\n2. 乙\n3. 丙")

    def test_table_still_tab_separated_without_prefix(self):
        blocks = [pdf_convert.Block("table", rows=[["姓名", "金额"], ["张三", "10"]])]
        self.assertEqual(pdf_convert._blocks_to_text(blocks), "姓名\t金额\n张三\t10")

    def test_pptx_items_keep_numbering(self):
        blocks = [
            pdf_convert.Block("heading", text="执行步骤", level=1),
            pdf_convert.Block("list", text="第一步", ordered=True, start=1),
            pdf_convert.Block("list", text="第二步", ordered=True, start=2),
            pdf_convert.Block("list", text="补充说明"),
        ]
        title, items = pdf_convert._pptx_texts(blocks)
        self.assertEqual(title, "执行步骤")
        self.assertEqual(items, ["1. 第一步", "2. 第二步", "• 补充说明"])

    def test_txt_file_contains_markers(self):
        pdf = os.path.join(self.tmp, "l.pdf")
        make_multi_ordered_list_fixture(pdf)
        pages = pdf_convert.extract_pages(pdf, render_images="none", keep_blocks=True)
        out = os.path.join(self.tmp, "l.txt")
        pdf_convert._write_txt(pages, out)
        with open(out, encoding="utf-8") as handle:
            text = handle.read()
        self.assertIn("1. 甲项", text)
        self.assertIn("2. 乙项", text)
        self.assertIn("1. 丙项", text)

    def test_pptx_slide_keeps_ordered_list(self):
        pdf = os.path.join(self.tmp, "p.pdf")
        make_multi_ordered_list_fixture(pdf)
        pages = pdf_convert.extract_pages(pdf, render_images="none", keep_blocks=True)
        out = os.path.join(self.tmp, "p.pptx")
        pdf_convert.to_pptx(pages, out)
        prs = Presentation(out)
        texts = [
            shape.text_frame.text for slide in prs.slides for shape in slide.shapes if shape.has_text_frame
        ]
        joined = "\n".join(texts)
        self.assertIn("1. 甲项", joined)
        self.assertIn("2. 乙项", joined)


class SecurityGuardTest(unittest.TestCase):
    """本轮改动的安全守卫:编号 XML 只能写整数、文本一律转义、解析不得被超长输入拖死。"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_list_text_cannot_inject_numbering_xml(self):
        """列表文本若含 XML 片段,只能作为转义后的文本出现,不得进入 numbering.xml 结构。"""
        payload = '</w:num><w:num w:numId="1"><w:abstractNumId w:val="7"/>'
        blocks = [pdf_convert.Block("list", text=payload, ordered=True, start=1)]
        pages = [pdf_convert.Page(num=1, text="", blocks=blocks, width=595, height=842)]
        out = os.path.join(self.tmp, "inj.docx")
        pdf_convert.to_docx(pages, out)
        with zipfile.ZipFile(out) as zf:
            document = zf.read("word/document.xml").decode("utf-8")
            numbering = zf.read("word/numbering.xml").decode("utf-8")
        self.assertIn("&lt;/w:num&gt;", document, "文本中的 XML 片段必须被转义")
        self.assertNotIn(payload, document, "未转义的注入片段不得出现在文档 XML 中")
        # 我们追加的编号定义只使用整数属性:出现非数字的 numId 即视为污染
        for value in re.findall(r'<w:num w:numId="([^"]*)"', numbering):
            self.assertTrue(value.isdigit(), f"numId 必须是整数,实际为 {value!r}")

    def test_list_marker_parsing_survives_huge_line(self):
        """超长行不能引发灾难性回溯(ReDoS):十万字符量级应瞬间返回。"""
        huge = "9" * 200_000
        start = time.perf_counter()
        number = pdf_convert._list_marker_number(huge)
        elapsed = time.perf_counter() - start
        self.assertEqual(number, 0, "未以分隔符结尾的超长数字不构成编号")
        self.assertLess(elapsed, 2.0, f"解析耗时 {elapsed:.2f}s,疑似回溯放大")

    def test_body_size_sampling_keeps_cpu_bounded(self):
        """字号统计必须带页数上限:否则大文档会被额外完整解析一遍(CPU 放大)。"""
        self.assertGreaterEqual(pdf_convert.BODY_SIZE_SAMPLE_PAGES, 1)
        self.assertLessEqual(pdf_convert.BODY_SIZE_SAMPLE_PAGES, 200, "采样页数上限过大,失去防护意义")


if __name__ == "__main__":
    unittest.main(verbosity=2)