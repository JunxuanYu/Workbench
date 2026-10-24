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
        headings = [p.text for p in doc.paragraphs if p.style.name.startswith("Heading")]
        self.assertEqual(len(headings), 3)
        self.assertIn("第 1 页", headings)
        self.assertIn("第 3 页", headings)
        all_text = "\n".join(p.text for p in doc.paragraphs)
        self.assertIn("测试文档", all_text)
        self.assertIn("正文内容", all_text)

    def test_xlsx(self):
        out = self.out("out.xlsx")
        r = run_cli([self.pdf, out, "--format", "excel"])
        self.assertEqual(r.returncode, 0)
        wb = load_workbook(out)
        self.assertEqual(wb.sheetnames, ["第1页", "第2页", "第3页"])
        ws = wb["第1页"]
        values = [c for row in ws.iter_rows(values_only=True) for c in row if c]
        self.assertIn("正文内容 第1页 含中文与 ASCII Line1-A", values)

    def test_pptx(self):
        out = self.out("out.pptx")
        r = run_cli([self.pdf, out, "--format", "ppt"])
        self.assertEqual(r.returncode, 0)
        prs = Presentation(out)
        self.assertEqual(len(prs.slides), 3)
        pictures = sum(1 for s in prs.slides for sh in s.shapes if sh.shape_type == 13)
        self.assertEqual(pictures, 3)

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