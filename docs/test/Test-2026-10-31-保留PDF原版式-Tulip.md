# 测试报告 - 保留 PDF 原版式

**日期**: 2026-10-31
**事项**: PDF 转换结果保留原有 PDF 版式（Word / PPT）
**执行人**: Tulip
**版本**: v1.1.1（不升版本，转换模式增强）
**涉及文件**:

- `python/pdf_convert.py`（新增原版式输出与 CLI `--layout`）
- `python/tests/test_pdf_convert.py`（新增 6 项测试）
- `server.js`（转换接口透传 `layout=1`）
- `public/js/tools/pdf-convert.js`（新增「保留原版式」开关与 `buildConvertUrl`）
- `test/pdf-convert.test.js`（新增 3 项测试）
- `README.md` / `docs/开发计划.md` / `docs/optimization.md`（行为说明同步）

> 背景：上一轮已优化流式结构的段落、标题、字号/颜色/对齐、表格与图片，但 Word/PPT 仍是
> 「重新排版」：文字会按新页面宽度换行，表格会变成 Word 表格，无法做到「PDF 长什么样，
> 输出就长什么样」。本轮新增「保留原版式」模式，并把前端默认值切到该模式。

---

## 一、问题与方案

### 原实现为什么不保版式

原 `to_docx` / `to_pptx` 把 PDF 解析成标题/段落/表格等语义块，再按 Word/PPT 的正常文档流重新排版：

- 段落宽度由 Word 页边距决定，PDF 中的精确换行位置丢失；
- 表格变成 Word 表格后，列宽、行高、边框样式会重新计算；
- 图片只保留内容，原 PDF 中的底纹、线条、图表、页眉页脚位置无法整体还原；
- 多栏、图文混排、绝对定位元素会被拉直成单栏。

因此「结构可编辑」和「视觉原样」是两种不同目标，不能只靠调参同时满足。

### 本轮方案：去文字背景 + 绝对定位文字层

每页分两层输出：

1. **背景层**：复制当前页，用 PyMuPDF redaction 移除文字层，但保留图片、线条、底纹、图表，再按 2 倍渲染为 JPEG。这样表格线、图形、图片位置与 PDF 完全一致。
2. **文字层**：按 `page.get_text("dict")` 的每个 span 的 bbox、字号、颜色、粗体/斜体，生成绝对定位文本框（Word 用 `wp:anchor` 浮动文本框，PPT 用 `add_textbox`）。文字仍可选中、修改，但不会重新换行或改变位置。
3. 页面尺寸严格使用 PDF 页面尺寸（pt → Word/PPT 单位），页边距为 0，确保坐标原点一致。

这样既保留原版式，又避免「整页截图不可编辑」的缺点。

---

## 二、改动内容

### 1. Python 转换核心

- 新增常量：`LAYOUT_BG_SCALE=2.0`、`LAYOUT_BG_JPEG_QUALITY=90`、`LAYOUT_BOX_MIN_PT=1.0`、`LAYOUT_PAGE_SIZE_TOLERANCE_PT=1.0`。
- 新增 `_layout_page_background()`：复制单页 → `add_redact_annot(rect, fill=False, cross_out=False)` → `apply_redactions(images=NONE, graphics=NONE, text=REMOVE)` → 2x JPEG。保留图片/线条/底纹，只去掉文字。
- 新增 `_layout_text_spans()`：按阅读顺序产出可见 span，过滤空文本、透明文本和过小 bbox。
- 新增 `_layout_run_xml()` / `_layout_textbox_xml()`：写入字号、颜色、粗体、斜体、原字体名（去除 `ABCDEF+` 子集前缀），文本框无填充/无边框、`wrap="none"`、垂直居中。
- 新增 `_layout_picture_xml()` / `_layout_anchor()`：按页面坐标写入 EMU 偏移，背景图 `behindDoc=1`，文字层 `behindDoc=0`。
- 新增 `to_docx_preserve(in_path, out_path)`：
  - 页面尺寸/边距按 PDF 设置；混合页面尺寸时按尺寸分组新建 section；
  - 每页一个极小行高段落，页间用 `page_break_before`，避免额外空白页；
  - 背景图 + 每个 span 的浮动文本框。
- 新增 `to_pptx_preserve(in_path, out_path)`：
  - 幻灯片尺寸等于 PDF 首页尺寸；每页背景图铺满；
  - 每个 span 一个绝对定位文本框；混合页面尺寸按比例缩放；
  - 补充 `a:ea` 东亚字体，避免中文全部回退。
- CLI 新增 `--layout`，仅允许 `--format word|ppt`；其它格式返回中文错误。
- 原 `to_docx` / `to_pptx` 流式模式保持不变，API 未带 `layout` 时行为向后兼容。

### 2. Node 服务

- `createDefaultPdfTool().convert(token, format, { layout })`：仅当 `layout && (format === 'word' || format === 'ppt')` 时追加 `--layout`，避免无效参数传给其它格式。
- `GET /api/tools/pdf/convert` 读取 `layout=1` / `layout=true` 并透传。

### 3. 前端

- 新增「保留原版式（推荐）」复选框，默认勾选；说明文字明确「Word / PPT 按 PDF 的页面尺寸、文字位置、字号、颜色和图片原样输出」。
- 新增纯函数 `buildConvertUrl(token, format, layout)`：仅 Word/PPT 追加 `layout=1`，Excel/TXT/MD 不带。
- 转换完成后提示「已保留原版式：文字可编辑，表格线 / 图片 / 底纹保留在背景中」。
- 关闭开关即回到原流式可编辑输出（标题层级、列表、Word 表格）。

---

## 三、测试变更

### Python 新增 6 项

| 测试 | 覆盖点 |
| --- | --- |
| `test_docx_layout_mode_preserves_page_and_text_positions` | 页面 595×842pt；背景锚点 `behindDoc=1`；标题 bbox x=250pt → 3,175,000 EMU；文字只出现一次 |
| `test_docx_layout_mode_keeps_font_size_and_color` | 22pt → `w:sz=44`；蓝色小节 → `w:color=1A3399` |
| `test_cli_layout_word_outputs_real_docx` | `--format word --layout` 成功并产出可读 docx |
| `test_cli_layout_rejects_non_word_ppt` | `excel + --layout` 返回 exit 1 与中文错误 |
| `test_layout_font_name_strips_subset_prefix` | `ABCDEF+SimSun` → `SimSun`；`Arial,Bold` → `Arial` |
| `test_pptx_layout_mode_has_background_and_positioned_text` | 幻灯片 595pt；1 张全页背景图；标题 left≈250pt；文字不重复 |

### Node 新增 3 项

| 测试 | 覆盖点 |
| --- | --- |
| `buildConvertUrl 仅对 Word/PPT 追加 layout=1` | word/ppt 带 `layout=1`；excel/md 不带；关闭开关后不带 |
| `默认开启“保留原版式”` | 源码守卫：`layoutCheckbox.checked = true`、说明含 Word/PPT |
| `layout=1 透传给工具层` | HTTP API 调用 `convert(token, format, { layout: true })` |

---

## 四、全量测试结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Python 单元/集成 | `python\.venv\Scripts\python.exe -m unittest discover -s python\tests` | **Ran 78 tests — OK**（22.9s；原 72 + 新增 6） |
| Node 全量 | `node --test` | **tests 278 / pass 278 / fail 0**（6 suites） |
| ESLint | `npm run lint` | **0 error / 0 warning** |
| Prettier | `npm run format:check` | **All matched files use Prettier code style** |
| Ruff | `python -m ruff check python` | **All checks passed** |
| Python 编译 | `python -m py_compile python/pdf_convert.py python/tests/test_pdf_convert.py` | **OK** |

---

## 五、真实渲染验收（Word / PowerPoint COM）

用 3 页 A4 测试 PDF（含标题、正文、列表、图形、每页图片）分别生成 Word/PPT 原版式文件，
再用本机 Word 2016 / PowerPoint 2016 导出 PDF，逐页与源 PDF 做像素对比：

| 输出 | 页数 | 页面尺寸 | 逐页平均绝对像素差（0–255） |
| --- | --- | --- | --- |
| Word 原版式 | 3 | 595×842 pt | **1.49 / 1.52 / 1.52** |
| PPT 原版式 | 3 | 595×842 pt | **1.76 / 1.78 / 1.78** |

对比结果：页数一致、页面尺寸一致，文字位置/字号/颜色、图形、图片、页脚均落在原位置；
没有出现空白页或整页偏移。单页样例的标题、表格线、图片框也与原 PDF 对齐。

---

## 六、验收清单

- [x] Word 输出页面尺寸与 PDF 一致，不再被改成 Letter
- [x] Word 文字按 PDF 坐标绝对定位，不因页边距重新换行
- [x] Word 保留原字号、颜色、粗体/斜体
- [x] 背景保留图片、线条、表格线、底纹、图表，不再丢失
- [x] 文字仍可在 Word 中选中/编辑，不是整页截图
- [x] PPT 幻灯片尺寸与 PDF 页面一致，一页 PDF 对应一张幻灯片
- [x] PPT 每页背景图 + 绝对定位文字框，文字不重复
- [x] 前端默认勾选「保留原版式」，可关闭切回流式可编辑
- [x] Excel / TXT / Markdown 不受影响，不传无效 `--layout`
- [x] Python 78 / Node 278 / ESLint / Prettier / Ruff / py_compile 全部通过

---

## 七、已知边界

- 背景为 2 倍 JPEG 栅格：放大到很高倍率时，表格线/图形会有轻微锯齿；文字层本身是矢量文本，不受影响。
- 表格线、图形是背景的一部分，不是 Word 原生表格；需要在 Word 中改表格结构时请关闭「保留原版式」使用流式模式。
- 超链接只保留外观，不保留可点击链接。
- 旋转文字暂按水平文本框输出；多栏/竖排等极端版式可能有个别错位。
- 若 PDF 字体未安装，Word/PPT 会回退到本机字体，文字宽度可能略有差异；位置锚点不变。
- 带不可见 OCR 文字层的扫描件会同时有背景图像文字和覆盖文字，视觉上可能略粗；纯扫描件（无可提取文字）只有背景图。

---

## 八、结论

本轮把「保留原有 PDF 格式」落成可切换的原版式模式：Word/PPT 默认按 PDF 的页面尺寸和
span 坐标输出，背景保留全部非文字元素，文字层可编辑。真实 Word/PowerPoint 导出 PDF 的
逐页像素差约 1.5–1.8（满分 255），页数与页面尺寸完全一致。原流式模式保留，用户可在
「保留原版式」和「流式可编辑」之间按需切换；全部 78 项 Python 测试与 278 项 Node 测试通过。
