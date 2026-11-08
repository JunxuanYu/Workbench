# 测试报告：PDF 工具转换格式保真修复（v1.3.1 → v1.3.2）

- **日期**：2026-11-08
- **事项**：优化工具箱 PDF 工具，使转换成其他格式时能正确保留原文本格式，不出现多余内容、不出现版式错乱
- **执行人**：鲤鱼（WorkBuddy）
- **结论**：✅ 4 个问题逐个修复并各自配套测试，全量测试通过，可验收

---

## 0. 复现方式（缺陷怎么被发现的）

用 PyMuPDF 程序化生成一份「像真实公文」的 PDF：页眉 9pt、页脚 `- 1 -`、主标题 22pt、小节 15pt、正文 12pt（含粗体/彩色片段）、两组无序列表、两组有序列表、一组真实表格、跨页续写的列表。逐格式转换后回读产物结构比对原文。

四个问题都是这份样本**稳定复现**的，不是猜测：

| # | 现象（修复前） | 影响格式 |
|---|---|---|
| 1 | 第 2 页 12pt 正文变成 `heading lvl=3` | Word（Heading 3）/ Markdown（`###`）/ PPT（进标题区） |
| 2 | 第 2 组有序列表编成 3、4 | Word（`List Number` 共用编号实例） |
| 3 | 列表项之间多空行 + 全部写成 `1.` | Markdown（loose list，间距变大） |
| 4 | `•` 与 `1.` 整体消失 | TXT（纯文本无符号）/ PPT（有序列统一变 `•`） |

---

## 1. 问题 1：正文被误判成标题（最严重）

**根因**：正文基准字号 `_body_font_size()` 按**单页**统计。某页正文只有两行时，9pt 页眉页脚的字符数不少于正文，基准字号被压到 9pt，于是 12pt 正文满足「比正文大 15%」→ 判成标题。

**修复**：
- 新增 `_document_body_size(doc)`：**跨整份文档**累计「字号 → 字符数」直方图；`_pick_body_size()` 取高频字号中的最小值（保持原判据不变）
- 新增 `_segment_in_margin(bbox, height)`：页边（上下各 7%）文本不参与统计，页眉页脚天然被排除
- `_extract_blocks(page, body_size)` / `_parse_raw_blocks(..., body_size)` 接受文档级基准；`extract_pages()` 与 `_markdown_document()` 各计算一次后透传

**效果**：第 2 页正文恢复为 `paragraph` / `list`，标题只保留真实的两级（22pt→1 级、15pt→2 级）。

**测试**（`BodySizeTest`，7 项）：
| 用例 | 断言 |
|---|---|
| `test_document_body_size_not_biased_by_margins` | 文档级基准 = 12.0pt |
| `test_margin_lines_are_excluded_from_body_size` | 页眉/页脚行判定为页边，正文行不是 |
| `test_short_page_body_text_stays_paragraph` | 第 2 页无 12pt 标题，两条正文为有序列表 |
| `test_heading_levels_follow_size_not_margin_noise` | 标题集合恰为 {标题:1, 小节:2} |
| `test_markdown_body_not_promoted_to_heading` | Markdown 中无 `### ` |
| `test_docx_body_not_styled_as_heading` | Word 样式为 `List Number` / `Heading 2`，不是 `Heading 3` |

---

## 2. 问题 2：Word 有序列表编号跨组累加

**根因**：`doc.add_paragraph(style="List Number")` 使用内置样式，该样式全文挂同一个编号实例（numId=5），第二组列表接着第一组继续编号 → 3、4。

**修复**：
- `_docx_decimal_abstract_id(doc)`：从 `List Number` 样式反查其 `abstractNum` 定义号（不回退硬编码）
- `_docx_new_list_numbering(doc, abstract_id, start)`：为**每组**列表追加独立 `w:num`（新 numId + 可选 `w:startOverride`）
- `_docx_apply_numbering(paragraph, num_id)`：段落级 `w:numPr` 覆盖样式编号，`w:numPr` 按 OOXML schema 顺序插入（`pStyle` 之后、`jc`/`spacing` 之前）
- `to_docx()` 按「连续有序列表 = 一组」分组，遇标题/段落/表格/分页即换组

**顺带修正**：提取阶段记录 `Block.start`（`_list_marker_number()`，支持 `1.` / `12)` / `一、` / `十一、`，且 `1.2` 这类小数不误判），跨页续写的列表用 `startOverride` 从 3 继续，而不是重置成 1。

**测试**（`DocxListNumberingTest`，4 项）：
| 用例 | 断言 |
|---|---|
| `test_two_groups_get_separate_numbering_instances` | 两组 numId 不同，组内相同，起始均为 1 |
| `test_cross_page_list_continues_from_original_number` | 第 2 页起始序号 = 3 |
| `test_bullet_list_keeps_style_numbering` | 无序列表不套用有序编号实例，样式仍为 `List Bullet` |
| `test_list_marker_number_parsing` | 阿拉伯/中文数字解析，小数不误判 |

**产物校验**：段落 XML 为 `pStyle → numPr(ilvl 0, numId 10/11) → jc`，顺序合法；python-docx 可正常回读。

---

## 3. 问题 3：Markdown 列表被空行拆散、编号丢失

**根因**：`_render_markdown_blocks()` 无条件用 `"\n\n"` 拼接所有块。列表项之间插空行会被 GFM 解析为 **loose list**（每项包一层 `<p>`，间距明显变大）；有序列表一律写 `1.`，纯文本阅读/粘贴时编号全变成 1。

**修复**：同类型相邻列表项之间改用单个换行；有序列表写真实序号（优先 `Block.start`，缺失时递增）。

**测试**（`MarkdownListTest`，6 项）：连续条目单换行、真实序号 `1./2./3.`、无标记时递增、新组从 1 重新开始、列表与正文之间仍保留空行、无序与有序列表之间保留空行（否则会被当成同一个列表）、真实 PDF 链路端到端序号正确。

---

## 4. 问题 4：TXT / PPT 列表符号与编号丢失

**根因**：符号在提取阶段为写 Word 真实列表而剥离，纯文本/PPT 这类只能写字符串的输出没有补回。TXT 里项目符号与编号整体消失；PPT 里 `_pptx_texts()` 把所有列表一律写成 `•`，步骤顺序丢失。

**修复**：新增 `_list_prefixes(blocks)` 统一计算前缀（`• ` / `3. `，非列表块重置计数），`_blocks_to_text()`（TXT、Excel 文本表、Word 纯文本兜底）与 `_pptx_texts()` 共用。

**测试**（`PlainTextListTest`，7 项）：符号与序号补回、组间重新编号、无标记时递增、表格仍为制表符分列、PPT 要点保留序号、TXT 端到端含 `1./2.`、PPT 端到端含 `1./2.`。

---

## 5. 全量复测

| 项目 | 结果 | 说明 |
|---|---|---|
| Python（`python -m unittest discover -s python/tests`） | **142 / 142 通过** | 原 115 + 本轮新增 27，零回归 |
| Node（`node --test`） | **361 / 361 通过** | 原 357 + 文档同步守卫 4 |
| ESLint（server/public/test） | **0 error / 0 warning** | — |
| Prettier（`--check`） | **全部匹配** | — |
| Ruff（`python`） | **All checks passed** | — |

**四格式产物抽样（修复后）**

| 格式 | 关键产物 |
|---|---|
| Word | 标题 `Heading 1/2`；正文 `Normal`；两组列表各自 `1./2.`；表格 3×3 真实行列 |
| Markdown | `#` / `##` 分层；`- ` 连续无空行；`1.` `2.` 真实序号；GFM 表格 |
| TXT | `• 完成 A 项目交付` / `1. 第一季度目标` / 表格制表符分列 |
| PPT | 标题 + `• 无序要点` + `1./2. 有序要点`，页脚 `1 / 2` |

---

## 6. 安全审计

本轮改动集中在转换内核，仍然复核了「新代码是否引入攻击面」：

| 检查项 | 结论 |
|---|---|
| 新增外部输入入口（HTTP / 文件路径 / 子进程） | **无**。未新增路由、未新增文件读写路径、未新增子进程与网络调用 |
| 危险调用扫描（`subprocess` / `eval` / `exec` / `pickle` / `shell=True`） | `python/pdf_convert.py` 内 **0 处** |
| DOCX 编号 XML 注入 | 追加的 `w:num` / `w:abstractNumId` / `w:startOverride` 只写**整数**（`_xml_int()` 收敛），列表文本仍由 python-docx 转义；新增 `test_list_text_cannot_inject_numbering_xml` 用 `</w:num><w:num w:numId="1">` 载荷验证文本被转义、numbering.xml 属性全为数字 |
| ReDoS（正则回溯） | `_list_marker_number` 用锚定简单正则，20 万字符超长行 < 2s 返回；`test_list_marker_parsing_survives_huge_line` 守卫生效 |
| CPU 放大（新引入的整份重扫描） | 统计字号会多读一遍文本，已限制为前 `BODY_SIZE_SAMPLE_PAGES = 30` 页，`test_body_size_sampling_keeps_cpu_bounded` 守卫上限 |
| 异常模板健壮性 | 编号 XML 解析全部走 `_xml_int()`，非数字/缺失属返回 `None` 降级，不会因异常 docx 模板抛异常中断转换 |
| 既有安全基线回归 | `test/security.test.js` 24 项全通过（回环监听、Host/Origin/`Sec-Fetch-Site`、目录穿越、`/api/open` 执行面、上传体积、CSP 等） |
| 依赖漏洞 | `npm audit --omit=dev` → **found 0 vulnerabilities** |

**结论**：无新增风险项；本轮改动使「大文档转换」的 CPU 消耗有明确上限，较修改前更可控。

---

## 7. 已知边界（不影响验收）

1. **字号仅比正文大 15%~30% 的强调文字**仍可能被判为标题（例：12pt 正文中的 14pt 彩色句 → `Heading 2`）。这是 `HEADING_MIN_RATIO = 1.15` 的启发式取舍：阈值调高会漏掉真实的 14pt 小节标题。若你的文档以「正文 + 同字号强调」为主，建议把该常量调到 1.3（`docs/开发计划.md` §0 已记录）。
2. **纯页码页脚**在单页文档中不会被剔除（`REPEAT_PAGE_RATIO` 需要多页才判定为页眉页脚），单页页码属内容还是页脚无法仅凭版式判断，保持现状。
3. Word 每页之间用分页符保留原始分页边界，因此会存在空的换页段落（Word 的正常表现，不产生多余可见内容）。

---

## 8. 相关文件

| 文件 | 改动 |
|---|---|
| `python/pdf_convert.py` | `_document_body_size` / `_segment_in_margin` / `_pick_body_size`；`Block.start` 与 `_list_marker_number`；`_docx_decimal_abstract_id` / `_docx_new_list_numbering` / `_docx_apply_numbering`；`_render_markdown_blocks` 重写；`_list_prefixes` / `_blocks_to_text` / `_pptx_texts` |
| `python/tests/test_pdf_convert.py` | 新增 5 个测试类 27 项（含 3 项安全守卫）+ 4 个 fixture + `paragraph_numbering()` 读回工具 |
| `test/docs.test.js` | 版本断言 → v1.3.2；CHANGELOG 版本覆盖；新增 3 项文档同步守卫 |
| `package.json` / `package-lock.json` | 1.3.1 → 1.3.2 |
| `CHANGELOG.md` / `README.md` / `docs/开发计划.md` / `docs/optimization.md` | 版本与能力说明同步 |
