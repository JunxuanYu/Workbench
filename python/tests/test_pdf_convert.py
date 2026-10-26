# -*- coding: utf-8 -*-
"""pdf_convert.py 单元测试(stdlib unittest,零额外测试依赖)。

- 用 PyMuPDF 程序化生成含中文文本、图形与图片的多页 fixture PDF
- 对六种格式调用转换函数并用对应库读回断言内容结构
- CLI 层覆盖缺参、坏文件、未知格式、页号越界等错误分支
运行: python -m unittest discover -s python/tests -v
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
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
    def _span(size, text, flags=0, bbox=(0, 0, 60, 20)):
        return {"size": float(size), "font": "x", "flags": flags, "text": text, "bbox": bbox}

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
        self.assertIn("![图片](data:,)", md)

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
        # 每页页标记固定为 Heading 1
        h1 = [p.text for p in doc.paragraphs if p.style.name == "Heading 1"]
        self.assertEqual(h1, ["第 1 页", "第 2 页", "第 3 页"])
        # 内容标题按字号识别为更深层级(不再把标题写成普通正文)
        h2 = [p.text for p in doc.paragraphs if p.style.name == "Heading 2"]
        self.assertIn("第 1 页 测试文档", h2)
        all_text = "\n".join(p.text for p in doc.paragraphs)
        self.assertIn("测试文档", all_text)
        self.assertIn("正文内容", all_text)
        # 文本页优先可编辑文字:只保留 PDF 内真实图片(每页 1 张小图),
        # 不再整页贴图造成"文字 + 截图"重复(整页图宽 6.5 英寸)
        self.assertEqual(len(doc.inline_shapes), 3)
        for shape in doc.inline_shapes:
            self.assertLess(shape.width.inches, 2.0, "文本页不应出现整页截图")

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
        self.assertEqual(ws["C2"].value, "128.50")
        self.assertEqual(ws["A3"].value, "李四")
        self.assertTrue(ws["A1"].font.bold, "表头应加粗")
        self.assertEqual(ws.freeze_panes, "A2")
        # 表外文字进独立文本表,不与表格混在一起
        self.assertIn("报销明细", [c for row in wb["第1页-文本"].iter_rows(values_only=True) for c in row if c])

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


if __name__ == "__main__":
    unittest.main(verbosity=2)