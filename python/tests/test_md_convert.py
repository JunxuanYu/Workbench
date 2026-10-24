# -*- coding: utf-8 -*-
"""md_convert.py 单元测试(stdlib unittest,零额外测试依赖)。

- 解析层: parse_markdown 块结构 + _parse_inline 行内样式(纯函数,无需渲染)
- 渲染层: 真实 md 文件 -> PDF,用 PyMuPDF 读回文本断言内容与整体结构
- 错误分支: 缺文件 / 缺输出 / 未知格式 / 失败时 stdout 保持干净
- 分页: 长文档自动多页; 图片: 本地文件与 data URI 均可嵌入
运行: python -m unittest discover -s python/tests -v
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf as fitz

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import md_convert

CLI = Path(__file__).resolve().parent.parent / "md_convert.py"

FIXTURE_MD = """# 一级标题 Title

正文段落包含 **加粗** 与 *斜体* 和 `code` 以及 [链接](https://example.com)。

## 二级标题

- 项目一
- 项目二 带 **加粗**
1. 第一步
2. 第二步

> 这是一段引用文本

```python
def hi():
    return "中文"
```

| 列A | 列B |
| --- | --- |
| 值1 | 值2 |

![测试图片](img.png)

---
"""


def make_img(path):
    png = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 120, 80))
    png.clear_with(0x4477AA)
    png.save(path)


def run_cli(args):
    return subprocess.run(
        [sys.executable, str(CLI), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )


class ParseTest(unittest.TestCase):

    def test_parse_block_kinds(self):
        blocks = md_convert.parse_markdown(FIXTURE_MD)
        kinds = [b.kind for b in blocks]
        self.assertIn("heading", kinds)
        self.assertIn("paragraph", kinds)
        self.assertIn("code", kinds)
        self.assertIn("quote", kinds)
        self.assertIn("ul", kinds)
        self.assertIn("ol", kinds)
        self.assertIn("table", kinds)
        self.assertIn("hr", kinds)
        self.assertIn("image", kinds)
        # 顺序: 标题在段落前, 表格在分割线前
        self.assertEqual(kinds[0], "heading")
        self.assertLess(kinds.index("table"), kinds.index("hr"))

    def test_parse_heading_levels(self):
        blocks = md_convert.parse_markdown("# a\n## b\n### c\n#### d")
        self.assertEqual([b.level for b in blocks], [1, 2, 3, 4])
        self.assertEqual(blocks[0].spans[0].text, "a")

    def test_parse_fence_code_with_language_tag(self):
        blocks = md_convert.parse_markdown("```python\nprint(1)\n```")
        self.assertEqual(blocks[0].kind, "code")
        self.assertEqual(blocks[0].lines, ["print(1)"])

    def test_parse_ul_and_ol(self):
        blocks = md_convert.parse_markdown("- a\n- b\n\n1. x\n2. y")
        self.assertEqual([b.kind for b in blocks], ["ul", "ol"])
        self.assertEqual([s.text for s in blocks[0].items[0]], ["a"])
        self.assertEqual([s.text for s in blocks[1].items[1]], ["y"])

    def test_parse_list_continuation_line(self):
        blocks = md_convert.parse_markdown("- 第一行\n  续行内容")
        self.assertEqual(len(blocks[0].items), 1)
        joined = "".join(s.text for s in blocks[0].items[0])
        self.assertIn("续行内容", joined)

    def test_parse_table_rows(self):
        blocks = md_convert.parse_markdown("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |")
        self.assertEqual(blocks[0].kind, "table")
        rows = blocks[0].rows
        self.assertEqual(len(rows), 3)  # 表头 + 两行
        self.assertEqual("".join(s.text for s in rows[0][0]), "A")
        self.assertEqual("".join(s.text for s in rows[2][1]), "4")

    def test_parse_quote_merges_lines(self):
        blocks = md_convert.parse_markdown("> 第一行\n> 第二行")
        self.assertEqual(blocks[0].kind, "quote")
        self.assertEqual("".join(s.text for s in blocks[0].spans), "第一行 第二行")

    def test_parse_image_line(self):
        blocks = md_convert.parse_markdown("![示意图](pic.png)")
        self.assertEqual(blocks[0].kind, "image")
        self.assertEqual(blocks[0].alt, "示意图")
        self.assertEqual(blocks[0].src, "pic.png")

    def test_parse_empty_and_blank(self):
        self.assertEqual(md_convert.parse_markdown(""), [])
        self.assertEqual(md_convert.parse_markdown("\n\n  \n"), [])

    def test_inline_styles_link_escape(self):
        spans = md_convert._parse_inline(
            "**粗** 与 *斜* 与 `c` 与 [文字](https://x.com) 与 \\*星号\\*"
        )
        styles = {s.text: s for s in spans if s.bold or s.italic or s.mono or s.url}
        self.assertEqual(styles["粗"].bold, True)
        self.assertEqual(styles["斜"].italic, True)
        self.assertEqual(styles["c"].mono, True)
        self.assertEqual(styles["文字"].url, "https://x.com")
        self.assertEqual("".join(s.text for s in spans[-3:]), "*星号*")


class ConvertTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="worklift-md-test-")
        cls.md = os.path.join(cls.tmp, "sample.md")
        with open(cls.md, "w", encoding="utf-8") as f:
            f.write(FIXTURE_MD)
        make_img(os.path.join(cls.tmp, "img.png"))
        cls.out = os.path.join(cls.tmp, "out.pdf")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_cli_render_full_fixture(self):
        r = run_cli([self.md, self.out])
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = json.loads(r.stdout)
        self.assertTrue(meta["ok"])
        self.assertGreaterEqual(meta["numPages"], 1)
        with open(self.out, "rb") as f:
            self.assertTrue(f.read(5).startswith(b"%PDF"))
        doc = fitz.open(self.out)
        try:
            text = "\n".join(doc[i].get_text() for i in range(len(doc)))
            for expected in [
                "一级标题", "Title", "加粗", "斜体", "code", "链接",
                "项目一", "项目二", "第一步", "第二步",
                "引用文本", "def hi", "中文",
            ]:
                self.assertIn(expected, text, f"缺少: {expected}")
            # 表格单元格为 CJK+拉丁混排,提取时按字体拆行,用紧凑文本断言
            compact = text.replace("\n", "")
            for expected in ["列A", "列B", "值1", "值2"]:
                self.assertIn(expected, compact, f"缺少表格内容: {expected}")
        finally:
            doc.close()

    def test_cli_data_uri_image(self):
        png = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 64, 40))
        png.clear_with(0x225588)
        b64 = base64.b64encode(png.tobytes("png")).decode("ascii")
        md = os.path.join(self.tmp, "datauri.md")
        with open(md, "w", encoding="utf-8") as f:
            f.write("# 数据图\n\n![内嵌](data:image/png;base64," + b64 + ")\n")
        out = os.path.join(self.tmp, "datauri.pdf")
        r = run_cli([md, out])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = fitz.open(out)
        try:
            self.assertIn("数据图", doc[0].get_text())
            self.assertGreaterEqual(len(doc[0].get_images(full=True)), 1, "应嵌入图片")
        finally:
            doc.close()

    def test_cli_missing_image_placeholder(self):
        md = os.path.join(self.tmp, "noimg.md")
        with open(md, "w", encoding="utf-8") as f:
            f.write("![丢失](not-exist.png)\n")
        out = os.path.join(self.tmp, "noimg.pdf")
        r = run_cli([md, out])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = fitz.open(out)
        try:
            text = doc[0].get_text()
            self.assertIn("图片", text)
            self.assertIn("not-exist.png", text)
        finally:
            doc.close()

    def test_cli_absolute_path_image_placeholder(self):
        # 安全修复：绝对路径图片必须拒绝（防读取任意本机文件），即使文件真实存在
        real = os.path.join(self.tmp, "real.png")
        make_img(real)
        md = os.path.join(self.tmp, "abspath.md")
        # os.path.abspath 产出 Windows 盘符路径 C:\...，isabs 判定为绝对路径
        with open(md, "w", encoding="utf-8") as f:
            f.write("![绝对路径](%s)\n" % os.path.abspath(real).replace("\\", "/"))
        out = os.path.join(self.tmp, "abspath.pdf")
        r = run_cli([md, out])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = fitz.open(out)
        try:
            text = doc[0].get_text()
            self.assertIn("图片缺失", text, "绝对路径图片应渲染占位符而非嵌入")
            self.assertEqual(len(doc[0].get_images(full=True)), 0, "绝对路径图片不应被嵌入")
        finally:
            doc.close()

    def test_cli_traversal_image_placeholder(self):
        # 安全修复：.. 穿越 base_dir 必须拒绝；父目录真实存在的文件也不允许读取
        parent = os.path.dirname(os.path.abspath(self.tmp))
        secret = os.path.join(parent, "wl-secret-%s.png" % os.path.basename(self.tmp))
        make_img(secret)
        try:
            md = os.path.join(self.tmp, "traversal.md")
            with open(md, "w", encoding="utf-8") as f:
                f.write("![穿越](../%s)\n" % os.path.basename(secret))
            out = os.path.join(self.tmp, "traversal.pdf")
            r = run_cli([md, out])
            self.assertEqual(r.returncode, 0, r.stderr)
            doc = fitz.open(out)
            try:
                text = doc[0].get_text()
                self.assertIn("图片", text)
                self.assertEqual(len(doc[0].get_images(full=True)), 0, "穿越文件不应被嵌入")
            finally:
                doc.close()
        finally:
            if os.path.exists(secret):
                os.remove(secret)

    def test_cli_oversized_image_placeholder(self):
        # 安全修复：超过 20MB 上限的图片文件拒绝嵌入（防内存滥用）
        big = os.path.join(self.tmp, "big.png")
        with open(big, "wb") as f:
            f.truncate(md_convert.MAX_IMG_BYTES + 1)
        md = os.path.join(self.tmp, "oversize.md")
        with open(md, "w", encoding="utf-8") as f:
            f.write("![超大](big.png)\n")
        out = os.path.join(self.tmp, "oversize.pdf")
        r = run_cli([md, out])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = fitz.open(out)
        try:
            text = doc[0].get_text()
            self.assertIn("图片", text)
            self.assertEqual(len(doc[0].get_images(full=True)), 0, "超大文件不应被嵌入")
        finally:
            doc.close()

    def test_cli_long_doc_multipage(self):
        md = os.path.join(self.tmp, "long.md")
        body = "这是一段用于测试自动分页的正文,包含不少中文与前缀填充文字。\n"
        with open(md, "w", encoding="utf-8") as f:
            f.write("# 长篇文档\n\n" + (body * 80))
        out = os.path.join(self.tmp, "long.pdf")
        r = run_cli([md, out])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = fitz.open(out)
        try:
            self.assertGreaterEqual(len(doc), 2, "长文档应自动分页")
            text = "\n".join(doc[i].get_text() for i in range(len(doc)))
            self.assertIn("长篇文档", text)
        finally:
            doc.close()

    def test_cli_empty_md(self):
        md = os.path.join(self.tmp, "empty.md")
        with open(md, "w", encoding="utf-8") as f:
            f.write("")
        out = os.path.join(self.tmp, "empty.pdf")
        r = run_cli([md, out])
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = json.loads(r.stdout)
        self.assertEqual(meta["numPages"], 1)

    def test_cli_bom_tolerated(self):
        md = os.path.join(self.tmp, "bom.md")
        with open(md, "wb") as f:
            f.write("\ufeff# BOM 标题\n".encode("utf-8"))
        out = os.path.join(self.tmp, "bom.pdf")
        r = run_cli([md, out])
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = fitz.open(out)
        try:
            self.assertIn("BOM 标题", doc[0].get_text())
        finally:
            doc.close()

    # ---------- 错误分支(CLI 契约) ----------

    def test_missing_file(self):
        r = run_cli([os.path.join(self.tmp, "missing.md"), self.out])
        self.assertEqual(r.returncode, 1)
        self.assertIn("文件不存在", json.loads(r.stderr)["error"])

    def test_missing_output(self):
        r = run_cli([self.md])
        self.assertEqual(r.returncode, 1)
        self.assertIn("缺少输出文件", json.loads(r.stderr)["error"])

    def test_unknown_format(self):
        r = run_cli([self.md, self.out, "--format", "docx"])
        self.assertEqual(r.returncode, 1)
        self.assertIn("未知格式", json.loads(r.stderr)["error"])

    def test_stdout_kept_clean_on_error(self):
        r = run_cli([os.path.join(self.tmp, "missing.md"), self.out])
        self.assertEqual(r.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)