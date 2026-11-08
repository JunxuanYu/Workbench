# 测试报告：PDF 工具支持按页码转换（v1.2.1 → v1.3.0）

- **日期**：2026-11-01
- **事项**：工具箱 PDF 转换支持选择页码转换成其他格式
- **执行人**：鲤鱼（WorkBuddy）
- **结论**：✅ 全部通过，可验收

---

## 1. 需求与设计

**需求**：转换 PDF 时可以选择页码，只把选中的页转换成 Word / 图片 / Excel / PPT / TXT / Markdown。

**页码语法**（留空 = 全部页）：

| 写法 | 含义 |
|---|---|
| `3` | 第 3 页 |
| `2-5` | 第 2~5 页 |
| `2-` | 第 2 页到末页 |
| `-3` | 第 1~3 页 |
| `1,4,6-8` | 组合，逗号分隔，自动去重排序 |
| `1－2，4` | 全角符号 / 中文顿号 / 空格自动兼容（中文输入法场景） |

**三层实现**：

1. **Python**（`python/pdf_convert.py`）：新增 `parse_page_range()`（范围解析，越界/倒序/非法统一中文报错）、`_resolve_page_numbers()`、`_copy_pages()`；`extract_pages()` / `_markdown_document()` 支持选页；CLI 新增 `--pages`；「保留原版式」模式先把选中页裁剪成子集 PDF 再复用既有实现。
2. **Node**（`server.js` + 新模块 `public/js/tools/page-range.js`）：页码解析做成**前后端共用纯函数**，服务端在调用 Python 前校验（非法范围返回 **400** 而非 500）；`buildPdfConvertPlan()` 纯函数负责参数拼装与文件名后缀；选满全部页等价于不限定，不传 `--pages`。
3. **前端**（`public/js/tools/pdf-convert.js`）：上传后启用「页码范围」输入框并显示总页数；输入实时校验（非法标红提示）；非法输入不发起请求；转换状态/结果区标明「已转换第 2-3 页（共 N 页）」；图片格式只预览所选页；下载文件名带 `-p2-3` 后缀便于区分。

**关键语义**：页号始终保留原始编号 —— TXT / Markdown 的「第 N 页」标题、图片 zip 的 `page_N.png` 不因选页而重排，方便对照原文。

## 2. 新增测试（50 项）

### Python（`python/tests/test_pdf_convert.py` 新增 `PageRangeTest`，20 项）

- 范围解析：空=全部 / 单页 / 区间 / 开放式 / 组合去重排序 / 全角兼容 / 越界 / 0 与负数 / 倒序 / 非数字 / 页数未知
- 提取层：选页后 `Page.num` 保持原始页号、内容只含选中页、非法范围抛 `PdfError`
- CLI：TXT / 图片 zip / Markdown / Word / **保真模式 Word** 各自只产出选中页（图片 zip 精确校验 `page_2.png`+`page_3.png`）；省略 `--pages` 行为不变（`numPages` 仍为总页数）
- 参数校验：`9` / `0` / `3-1` / `abc` 均返回码 1 且不产出文件；`--pages` 与 `--page` 冲突报错

### Node（30 项）

- `test/page-range.test.js`（12 项）：共享解析函数全分支、`describePageSelection` 压缩连续页号、解析↔描述往返一致、**与 Python 实现的跨语言一致性对照**（12 组样例逐个比对判定与页号，解释器缺失时自动跳过）
- `test/pdf-page-select.test.js`（8 项，最小 DOM 桩真实调用 `render()` 串全流程）：上传前禁用→解析后启用、输入实时校验、**非法输入零网络请求**、选页时请求带 `pages` 参数、未选页不带参数（旧行为不变）、状态/结果区页码文案、下载名 `报告-p2.docx`、重新选择后复位
- `test/pdf-convert.test.js`（10 项）：`buildConvertUrl` 追加 pages、`buildPdfConvertPlan` 纯函数（归一化 `--pages`、全选不传参、layout 与 pages 共存、非法抛 400 级 `PdfHttpError`）、API 层 pages 透传与 400 映射、默认工具层在启动 Python 前就拒绝非法页码

### 视觉冒烟

无头 Edge 截图 `#/consult` 真实页面：页码范围行渲染正常、与桃夭主题一致、未上传时正确禁用。

## 3. 测试发现并修复的问题

| # | 问题 | 修复 |
|---|---|---|
| 1 | **前后端解析分歧**：`1-2-3` 在 JS 中被 `split('-', 2)` 静默截断成 `1-2`（会转出错误页范围），Python 则报错 | 跨语言一致性测试当场抓出；JS 改为检测多个连字符并报「格式不正确」 |
| 2 | Python 侧曾出现重复的 `_write_markdown` 定义（编辑残留），导致 Markdown 选页报 `unexpected keyword argument` | 删除旧副本；被 CLI 测试抓出 |
| 3 | 新样式初版用了未声明的 `var(--danger, #c0392b)`，会被「主题变量白名单」守卫拦截 | 改用已声明的 `var(--red)`；守卫测试起到作用 |

## 4. 全量复测

| 项目 | 结果 |
|---|---|
| Node（`node --test`） | **349 / 349 通过**（新增 32：页码 12 + 前端交互 8 + PDF/API 10 + 文档 2；原 317 项零回归） |
| Python（`python -m unittest`） | **104 / 104 通过**（新增 20；原 84 项零回归） |
| ESLint / Prettier / Ruff | 0 错误，全部文件格式匹配 |
| 功能回归 | 转换后连续多格式、保留原版式、会话令牌、安全测试（349 项中含 security 26 项）全部保持通过 |

## 5. 相关文件

- 代码：`python/pdf_convert.py`、`public/js/tools/page-range.js`（新增）、`public/js/tools/pdf-convert.js`、`public/css/style.css`、`server.js`
- 测试：`python/tests/test_pdf_convert.py`、`test/page-range.test.js`（新增）、`test/pdf-page-select.test.js`（新增）、`test/pdf-convert.test.js`
- 版本：`package.json` / `package-lock.json` → **1.3.0**；`CHANGELOG.md` 新增 v1.3.0 条目；`docs/开发计划.md` §0/§2/§3、`README.md`、`docs/optimization.md`、`test/docs.test.js` 同步更新
