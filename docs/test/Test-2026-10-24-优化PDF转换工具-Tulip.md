# 测试报告 - 优化 PDF 转换工具

**日期**: 2026-10-24
**事项**: 优化工具箱中的 PDF 转换工具（转换结果不满意）
**执行人**: Tulip
**涉及文件**:
- `python/pdf_convert.py`（转换核心，整体重构）
- `python/tests/test_pdf_convert.py`（测试更新 + 新增 13 项）

---

## 一、问题定位（为什么"转换结果不满意"）

| 格式 | 旧实现 | 导致的结果 |
| --- | --- | --- |
| Word | 每页先插一行文本，再整页截图插入 | 文字与截图重复、无法编辑、文件巨大 |
| Excel | 每页一列，逐行堆字符串 | 表格全散成文本，无法计算/排序 |
| PPT | 每页只塞整页截图 | 不可编辑、体积大 |
| Markdown | 逐行输出，行内样式与表格丢失 | 标题层级乱、表格散架 |
| TXT / 图片 | 渲染倍率 2.0 | 放大后文字发虚；页眉页脚/页码重复出现 |

---

## 二、本次改动

### 1. 版面结构提取（核心）

- 新增语义块模型 `Run / Block / Page`：`heading / paragraph / list / table / image`。
- 按字号与正文中位字号之比判定标题层级（`>=1.6 → #`，`>=1.35 → ##`，`>=1.15 → ###`）。
- 跨行段落合并：CJK 折行不插空格、英文折行补空格、行尾连字符合并；按行间距断段。
- 列表识别：`• · ` 等符号 + `1. / 1) / 一、` 编号，且**排除 `128.50` 这类小数误判**。
- 表格：`page.find_tables()` 还原真实单元格，且把表格区域内已提取的文字去重（避免"表格 + 同样文字段落"）。
  - `find_tables()` 首次调用会向 stdout 打印提示语，已用 `contextlib.redirect_stdout` 包裹，**不破坏 CLI 单行 JSON 契约**。
- 页眉页脚：仅多页文档，页边 7% 区域内出现于 ≥60% 页面的文本（数字归一化后比较）与纯页码才剔除；单页文档不剔除，避免误删正文。

### 2. 各格式输出

- **Word**：页标记 Heading 1 + 内容标题 Heading 2–4 + run 级粗体/斜体/等宽 + 真实 `add_table`（Table Grid、表头加粗）+ 中文字体 `Microsoft YaHei`（含 eastAsia）。**文本页不再整页截图**，只有扫描页（无任何可提取文字）才整页嵌图。
- **Excel**：识别到的表格 → 多列工作表（表头加粗 + 底色 + 冻结首行 `A2` + 自适应列宽）；表外文字 → 独立「第N页-文本」表；单列文本表设 A 列宽 100 + 自动换行。
- **PPT**：文本页 → 可编辑标题（30pt）+ 要点（18/15pt）+ 页码；无文字页 → 整页图片兜底。
- **Markdown**：标题/段落/列表/表格（GFM `| a | b |` + 分隔行）/ 行内样式/链接/图片 data URI。
- **TXT**：表格用制表符分列（可直接粘进 Excel），连续空行压缩为一行。

### 3. 清晰度

- `RENDER_SCALE` 2.0 → **3.0**（A4 ≈ 1785×2526，约 216 DPI）。
- 新增 `EMBED_SCALE = 2.0` 单独控制文档内嵌整页图倍率，控制体积。

---

## 三、验证过程中发现并修复的真实缺陷

> 说明：以下 4 个缺陷是"写完新实现 → 跑测试 → 定位"过程中发现的真实 bug，不是测试问题。

1. **标题级别恒为三级**：`_heading_level()` 顺序遍历阈值且不提前返回，大字号会依次命中所有阈值，最终总落在最后一级（24pt 标题被写成 Heading 4）。改为阈值从大到小匹配、命中即返回。
2. **小数被当成有序列表**：`_LIST_NUM_RE` 把 `128.50` 的 `128.` 当编号，单元格变成 `50`。正则加 `(?!\d)` 否定前瞻。
3. **表格文字去重失效**：`Block.bbox` 的 x 范围被硬编码为 0，中心点永远不在表格框内，导致表格内容又作为段落输出一遍。改为按行 bbox 累积真实 x 范围。
4. **扫描页重复贴图**：扫描页同时有"整页 png"和"图片块"，Word 里出现 2 张图。改为扫描页只嵌整页图并跳过块。

---

## 四、测试执行

### Python 单元/集成测试

```powershell
python -m unittest discover -s D:\Blogs\WorkLiftApp\python\tests
```

**结果**：`Ran 60 tests ... OK`（原 47 项 + 新增 13 项，失败 0）

新增测试（均针对本次改动的行为，非凑数）：

| 测试 | 覆盖点 |
| --- | --- |
| `test_docx_default_font_is_cjk_friendly` | 默认字体为 Microsoft YaHei（中文不退字体） |
| `test_docx_preserves_bold_runs` | 粗体 run 保留、普通文字不被误加粗 |
| `test_docx_table_becomes_real_table` | 真表格 + 表头/单元格内容 + 表内文字不重复成段落 |
| `test_docx_scanned_page_embeds_full_image` | 扫描页整页图兜底（1 张） |
| `test_xlsx_table_becomes_real_columns` | 3 列单元格定位、表头加粗、冻结首行、表外文字进独立表 |
| `test_pptx_scanned_page_uses_full_image` | 扫描页整页图兜底（1 张） |
| `test_markdown_merges_wrapped_paragraph_lines` | 英文折行合并为一句且不重复 |
| `test_markdown_table_syntax` | GFM 表格语法（表头/分隔行/数据行） |
| `test_txt_table_is_tab_separated` | 表格用 `\t` 分列 |
| `test_txt_collapses_blank_lines` | 连续空行压缩 |
| `test_repeated_header_footer_removed` | 多页重复页眉/页码被剔除，正文保留 |
| `test_single_page_keeps_margin_text` | 单页文档不误删页边正文 |
| `test_render_resolution_is_sharper` | `RENDER_SCALE >= 3.0` 且 PNG 实际宽 ≥1500px |

同时按新行为更新了 3 项既有断言（`test_docx` / `test_xlsx` / `test_pptx`）：由"整页截图"改为"可编辑文字 + 真实结构"，并额外断言**文本页不出现整页截图**（图宽 <2 英寸）。

### Node.js 全量测试

```powershell
node --test
```

**结果**：`tests 263 / pass 263 / fail 0`（含 `test/pdf-convert.test.js` 23 项：工具注册、`FORMAT_OPTIONS` 扩展名/MIME 契约、token store、`/api/tools/pdf/*` 各分支）

### 环境校验

- `python -m py_compile python/pdf_convert.py python/tests/test_pdf_convert.py` → OK
- CLI 契约回归：成功仅 stdout 一行 JSON；错误只走 stderr + exit 1（既有 `test_stdout_kept_clean_on_error` 等覆盖）

---

## 五、验收清单

- [x] Word 文本页为可编辑结构化内容，无"文字 + 截图"重复
- [x] Word 表格为真实表格，表头加粗
- [x] Excel 表格还原为多列，表头加粗、冻结首行、列宽自适应
- [x] PPT 文本页可编辑，扫描页有整页图兜底
- [x] Markdown 标题层级、表格、行内样式、图片正确
- [x] TXT 表格制表符分列、空行压缩
- [x] 多页文档重复页眉/页码剔除，单页不误删
- [x] 渲染倍率 3.0，导出图片更清晰
- [x] Python 60 项、Node 263 项测试全部通过
- [x] 未引入新依赖；仍为自包含单文件 CLI 转换器（`# SIZE_OK`）

---

## 六、结论

PDF 转换工具已从"截图 + 文本堆叠"升级为"结构化可编辑输出"：Word/Excel/PPT 的转换结果可直接编辑、可计算、体积更小，图片导出更清晰，且页眉页脚不再重复污染正文。全部测试通过，CLI 与 HTTP 接口契约保持不变，前端无需改动。

**已知边界（本次未覆盖）**：

- 扫描件只做整页图兜底，不做 OCR（无文字层则无法提取文字）。
- 多栏排版、嵌套/跨页表格按单栏顺序近似还原。
- Word 中图片按段落流插入，不做文字环绕定位。

---

## 七、追加：`pdf_convert.py` 整体重写（同日）

**事项**: 用户要求整体重写 `pdf_convert.py`（"it's so bad, step on it"），行为保持不变。
**结果**: 从 1005 行重构为 1195 行（含完整中文注释），分层清晰，公开 API 与 CLI 契约 100% 保留，全部测试在零改动测试文件的前提下通过。

### 重写解决的结构问题

1. **4 处重复的 `fitz.open` 样板** → 唯一的 `_open_pdf()` 上下文管理器（整个文件只剩 1 处 `fitz.open` 调用，错误翻译集中在一次）。
2. **3 条重叠的 Markdown 管线 + `hasattr` 兼容垫片** → 单一管线：原始 dict → `list[Block]` → `_render_markdown_blocks`（垫片删除，`hasattr` 出现 0 次）。
3. **`Page.blocks` 三态（None/空列表/有值）** → 恒为列表；`p.blocks or []` 散布 0 处；`extract_pages` 不再对 text 做两次派生。
4. **格式知识散落在 `main` 的 if/else** → 单一 `_FORMAT_SPECS` 注册表（needs_blocks / image_mode / writer），`convert_by_format` 与 CLI 共用；Markdown 只打开 PDF 一次（旧版为统计页数打开两次）。
5. **死代码** → 删除 `Block.items`（写入但从未读取）、`_parse_raw_blocks` 从未被传入的 `body_size` 形参。
6. **四态 `render_images` 魔法参数** → 显式 `ImageMode`（"all"/"scanned"/"none"），兼容旧值 True/"auto"/False。
7. **魔法数字散布**（5.5/6.5/0.2/30pt/13.333…）→ 全部收进顶部常量区（约 40 个具名常量，AST 检查 0 个未使用）。
8. **弱类型** → `BlockKind`/`ImageMode` 为 `Literal`，数据类字段 `list[Run]`、`list[list[str]]`、`BBox = tuple[float, float, float, float]`；0 处 `type: ignore`/`getattr` 逃生舱。
9. **模块导入副作用** → stdout/stderr 强制 UTF-8 从导入期移入 `main()`；import 现在无副作用。
10. **巨型 if/elif** → 每种块一个写入函数（`_docx_write_block`、`_pptx_add_title` 等）；最长函数 53 行（`_blocks_from_text_block`），全部 <60。
11. **裸 `except Exception: pass`** → 0 个；每处异常捕获都收窄并注明降级原因（如 find_tables 的 stdout 污染重定向、图片解码失败不中断整篇转换）。

### 重写后的验证（全部实测）

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| Python 测试（零改动） | `python -m unittest discover -s python/tests` | **Ran 60 tests ... OK** |
| Node 全量 | `node --test` | **tests 275 / pass 275 / fail 0** |
| 编译 | `python -m py_compile python/pdf_convert.py` | OK |
| CLI 契约抽查 | 自写验证脚本（fixture 复用测试工厂） | **35/35 通过**：`--check`、6 种 `--format` 的成功路径（stdout 恰好一行 JSON、stderr 为空、exit 0、文件落盘）、`--page`、坏文件（stdout 空 + stderr 一行 JSON + exit 1 + 无 traceback）、缺 out 参数、`convert_by_format("md")` 拒绝信息、`FORMATS`/`RENDER_SCALE` 契约、markdown 占位图 |
| 静态审计 | AST 脚本 | `fitz.open` 1 处；`blocks or []` 0 处；`hasattr` 0 处；`type: ignore` 0 处；裸 except-pass 0 处；未使用常量 0 个；`无法解析 PDF 文件` 字符串只出现 1 处 |

**不兼容变更**：无。`Run`/`Block`/`Page` 字段顺序、公开函数签名、六种格式的输出内容、CLI 参数与 JSON 契约均与重写前一致（由 60 项未改动的测试锁定）。唯一的 API 语义收紧是 `convert_by_format("md", ...)` 现在返回带说明的 `PdfError`（旧版同样报错，消息更明确）。
