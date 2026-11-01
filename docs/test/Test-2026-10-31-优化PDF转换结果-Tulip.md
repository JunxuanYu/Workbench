# 测试报告 - 优化 PDF 转换结果

**日期**: 2026-10-31
**事项**: 优化工具箱中的 PDF 转换工具（转换结果不满意）
**执行人**: Tulip
**版本**: v1.1.1（不升版本，仅转换质量优化）
**涉及文件**:
- `python/pdf_convert.py`（转换核心）
- `python/tests/test_pdf_convert.py`（更新 2 项旧断言，新增 12 项测试）
- `docs/optimization.md`（执行记录同步）

> 背景：2026-10-24 已完成结构化输出重构，2026-10-25 完成前端交互优化。
> 本轮先用一份「居中标题 + 小节标题 + 折行正文 + 折行列表 + 真实表格 + 图片 + 页脚页码」的典型 PDF
> 实测六种格式输出，再针对实际看到的缺陷逐项修复，不重复前两轮工作。

---

## 一、实测发现的真实缺陷

| # | 实测现象 | 根因 |
|---|---|---|
| 1 | Word 里每个视觉行都是独立段落，正文被切成一行一段 | 部分 PDF 每行/每段各占一个 PyMuPDF `block`，原逻辑只在单 block 内合并行 |
| 2 | 有序列表的续行（如「导致数据丢失。」）脱离列表变成普通段落 | 同上：列表块后一行是独立 block，未做续行归并 |
| 3 | 16pt 小节标题在 Word 中变成 Heading 4；每页顶部还多一行「第 1 页」Heading 1 | 标题级别用固定字号比阈值，且 Word 写入时统一 +1 级；每页强制插入页标记 |
| 4 | 英文折行处出现双空格（`and  offline`） | 拼接前先 `rstrip()`，丢掉了「原文已带空格」的信息，又补了一个空格 |
| 5 | Word 正文统一 11pt、标题颜色/居中对齐丢失；A4 PDF 被写成 Letter 页面 | Run 未保留字号/颜色，Block 未保留对齐，页面尺寸未跟随 PDF |
| 6 | Word 内嵌图片被额外缩小（120pt 宽图片只剩 1.1 英寸） | 图片宽度按「占正文宽度比例 × 5.5 英寸」估算，而非 PDF 真实宽度 |
| 7 | 单页文档的页脚 `- 1 -` 原样进入 Word/TXT/Markdown | 页眉页脚清理只在多页文档执行 |
| 8 | Excel 中金额/数量是文本（`"128.50"`），不能直接求和；表格内容又在「文本」工作表重复一遍 | 表格单元格未做数值转换；文本表直接使用包含表格的 `page.text` |
| 9 | PPT 单页超过 20 条要点时被静默截断 | `_pptx_texts` 直接 `items[:20]`，无续页 |
| 10 | 短文档中 16pt 小节被误判成列表（`一、项目概况` → `项目概况`） | 正文中位字号按「最常见字号」选取，短文档里标题字数接近正文，导致正文基准被抬到 22pt |

---

## 二、改动内容

### 1. 文本与段落还原

- **双空格修复**：`_needs_space` 在补空格前检查原文是否已有空白；`_span_runs` 的视觉间隙补空格也做同样判断。
- **跨块合并**：新增 `_merge_continuous_blocks`，把同字号、垂直间距 ≤ 字号×1.2×0.8、水平同栏的相邻 `paragraph` 块合并；`list` 后一行若左边界与列表一致，则并入列表项。
- **列表续行**：合并后列表文本保持 `List Bullet` / `List Number` 样式，不再拆成普通段落。
- **正文字号识别**：`_body_font_size` 改为「高频字号中取最小值」，避免短文档把标题当正文。

### 2. 标题层级与对齐

- 删除固定比值阈值分级，改为**全文按字号排名**：最大字号 = 1 级，其次 2 级……（`_apply_heading_levels`）。
- 标题级别在**整份文档范围**统一排名，避免「只有一种标题字号的页面」把小节误判为一级标题。
- 新增 `_apply_alignment`：根据 bbox 左右留白推断 `left / center / right`，居中标题不再被强制左对齐。

### 3. Word（.docx）

- 移除每页「第 N 页」标题；页与页之间改用**分页符**分隔，目录不再被页标记污染。
- Run 保留 PDF 原始**字号与颜色**；标题/正文/列表统一走 `_docx_add_text_paragraph`，同时写入对齐方式。
- 页面尺寸跟随 PDF 首页（A4 不再写成 Letter）。
- 内嵌图片按 PDF 真实宽度（pt ÷ 72）换算英寸，仅做上下限保护。
- 文本页仍然只输出可编辑文字 + 真实图片，扫描页才整页嵌图（保持上一轮行为）。

### 4. Excel（.xlsx）

- 新增 `_coerce_cell_value`：纯数字、千分位、货币符号转为数值；`128.50` → `128.5` + `number_format="0.00"`（显示仍为 128.50）；`007` 等前导零编号保持文本。
- 有表格的页面，文本工作表只写**表外文字**，不再重复表格内容。

### 5. PPT（.pptx）

- 单页要点超过 `PPTX_MAX_ITEMS` 时自动拆成续页（标题追加「（续）」），不再静默丢内容。

### 6. 页眉页脚

- 纯页码在**任意页数**的页边区域都剔除；多页重复页眉/页脚逻辑保持不变。
- 单页文档的非页码页边文字仍然保留（避免误删正文）。

---

## 三、测试变更

### 新增测试（12 项，均为行为断言）

| 测试 | 覆盖点 |
| --- | --- |
| `test_span_gap_does_not_double_space` | 原文带尾随空格 + 视觉间隙时不产生双空格 |
| `test_markdown_no_double_space_after_trailing_space` | 折行拼接后仍是 `Hello world` |
| `test_wrapped_lines_merge_across_text_blocks` | 跨 block 的两行正文合并为一段；列表续行并入列表；列表后左对齐正文不被误并 |
| `test_heading_levels_use_size_ranking_and_alignment` | 22pt → 1 级、16pt → 2 级；居中标题识别为 `center` |
| `test_heading_levels_are_ranked_across_pages` | 第 2 页只有 16pt 小节时仍与全文小节同为 2 级 |
| `test_single_page_pure_page_number_removed` | 单页 `- 1 -` 页脚被剔除，正文保留 |
| `test_docx_preserves_font_size_color_and_alignment` | Word 保留 22pt/颜色/居中，正文 12pt |
| `test_docx_page_size_follows_pdf` | A4 PDF → Word 页面约 8.27×11.69 英寸 |
| `test_docx_inline_image_uses_pdf_width` | Word 图片宽度 = PDF bbox 宽度 ÷ 72 |
| `test_xlsx_text_sheet_excludes_table_content` | 文本表不含表格的「姓名/张三」，仍含表外标题 |
| `test_xlsx_numbers_are_numeric` | `128.50`→float、`12`→int、千分位、前导零文本 |
| `test_pptx_splits_overflow_items` | 25 条要点拆成 2 页，第 25 条不丢失 |

### 更新测试（2 项，行为按新规格调整）

| 测试 | 调整 |
| --- | --- |
| `test_docx` | 断言不再有「第 N 页」标题；3 页产生 2 个分页符；标题按字号排名为 Heading 1；图片宽度上限从 2.0 放宽到 3.0 英寸（真实宽度约 2.06） |
| `test_xlsx_table_becomes_real_columns` | 金额单元格由字符串 `"128.50"` 改为数值 `128.5` + `number_format="0.00"` |

---

## 四、全量测试结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Python 单元/集成 | `python\.venv\Scripts\python.exe -m unittest discover -s python\tests` | **Ran 72 tests — OK**（20.2s；原 60 + 新增 12） |
| Node 全量 | `node --test` | **tests 275 / pass 275 / fail 0**（6 suites） |
| ESLint | `npm run lint` | **0 error / 0 warning** |
| Ruff | `python -m ruff check python` | **All checks passed** |
| Python 编译 | `python -m py_compile python/pdf_convert.py python/tests/test_pdf_convert.py` | **OK** |
| Prettier | `npm run format:check` | ⚠️ 4 个文件有格式警告（`public/js/tools/pdf-convert.js`、`test/pdf-convert.test.js`、`test/security.test.js`、`test/ui-theme.test.js`），为上一轮未提交改动遗留，本轮未触碰这些文件 |

> Node 侧 CLI / HTTP 契约完全未变（`--check` / `--format` / `--page`、stdout 单行 JSON、错误走 stderr），
> 因此 `test/pdf-convert.test.js` 无需改动，275 项全部保持通过。

---

## 五、验收清单

- [x] 跨 block 折行正文合并为自然段落，不再一行一段
- [x] 列表续行归属列表项，列表后的正文不被误并
- [x] 标题按字号排名分级，全文同级小节级别一致
- [x] Word 不再出现「第 N 页」标题，页间用分页符分隔
- [x] Word 保留字号、颜色、居中对齐与 PDF 页面尺寸
- [x] Word 内嵌图片按 PDF 真实宽度插入
- [x] 英文/中文折行均不再产生双空格
- [x] 单页文档纯页码页脚被剔除
- [x] Excel 金额/数量为数值且保留小数显示格式，文本表不重复表格
- [x] PPT 要点超限自动续页，不丢内容
- [x] Python 72 / Node 275 / ESLint / Ruff / py_compile 全部通过

---

## 六、结论

本轮把「转换结果不满意」拆成 10 个可复现的实测缺陷并逐项修复：Word 的可编辑正文现在更接近原文版式（段落、标题层级、字号/颜色/对齐、页面尺寸、图片宽度），Excel 的表格可计算且不再重复，PPT 不再截断，TXT/Markdown 的段落与空格更干净。全部改动只发生在 Python 转换核心，前端、Node 接口与数据契约零改动；新增 12 项行为测试锁定，Python 72 项与 Node 275 项全部通过。

**已知边界（本轮未改变）**：

- 扫描件仍只做整页图兜底，不做 OCR。
- 多栏排版、跨页表格按阅读顺序近似还原。
- Word 图片按段落流插入，不做文字环绕定位。
- 不能仅凭 PDF 几何信息 100% 区分「段间距」与「行距」，相邻同字号段落可能被合并为一段；这是无字体元数据时的固有限制。
