# 变更日志（Changelog）

本项目版本号遵循 `主版本.次版本.修订号`：新增功能升次版本，修复/加固升修订号。
每次发版需同时更新本文件、`package.json` / `package-lock.json` 与 `docs/开发计划.md` §0。

---

## v1.3.2 — 2026-11-08 · PDF 转换保真度修复（正文误判标题 / 列表编号与符号）

本轮只修「转换结果不像原文」的真实缺陷，不新增功能：同一份 PDF 转出去后正文变标题、多出空白、列表符号消失、编号错乱，都属于格式走样。

- **正文被误判成标题（最严重）**：正文基准字号原先按**单页**统计，页眉页脚 9pt 小字会把基准压到 9pt，12pt 正文于是「比正文大 15%」而被判成标题——Word 里变 Heading 3、Markdown 里变 `###`、PPT 里被塞进标题区。改为 `_document_body_size()` **跨整份文档**统计并排除页边文本（`_segment_in_margin`），标题级别只在真正的字号台阶上分配
- **Word 有序列表编号跨组累加**：内置 `List Number` 样式全文共用一个编号实例（numId=5），第二组列表接着第一组编成 3、4。现为每组列表派生独立 `w:num` 实例（`_docx_new_list_numbering`），并在段落级 `w:numPr` 覆盖样式编号
- **跨页续写的列表接续原序号**：提取阶段记录列表原始序号（`Block.start` + `_list_marker_number`，支持阿拉伯数字与中文数字），续写到第 2 页的列表从 3 继续，而不是重置成 1
- **Markdown 列表被空行拆散 + 编号丢失**：所有块之间固定插空行，连续列表项因此被渲染成 loose list（间距变大）；有序列表一律写 `1.`。改为同类型相邻列表项只用一个换行，并写真实序号
- **TXT / PPT 列表符号消失**：符号在提取阶段被剥离后没有补回，TXT 里项目符号与编号全部丢失、PPT 里有序列统一显示成 `•`。新增 `_list_prefixes()` 统一补回 `•` 与真实序号
- **测试**：Python **+27**（`BodySizeTest` 7 / `DocxListNumberingTest` 4 / `MarkdownListTest` 6 / `PlainTextListTest` 7 / `SecurityGuardTest` 3），全量 **142/142**；Node 全量 **357/357**；ESLint / Prettier / Ruff 全 0
- **报告**：`docs/test/Test-2026-11-08-PDF转换格式保真修复-Tulip.md`

---

## v1.3.1 — 2026-11-08 · 国风 UI/UX 精修（按钮 · 图标，纯外观）

- 侧栏导航 7 个 emoji 图标换为**印章汉字**（览 / 计 / 匠 / 具 / 笔 / 账 / 设），`.nav-icon` 渲染为随主题描色的篆印小方章
- 按钮层统一国风处理（圆角、描边、悬浮抬升与胭脂高光），13 套配色自适应
- 零功能改动：不改 DOM 结构、事件与数据流，既有功能测试全部保持通过
- **报告**：`docs/test/Test-2026-11-08-国风UIUX美化按钮图标-Tulip.md`

---

## v1.3.0 — 2026-11-01 · PDF 工具支持按页码转换

- PDF 转换新增「页码范围」输入：`3` / `2-5` / `2-`（到末页） / `-3`（从首页） / `1,3,5-7`，全角符号与空格自动兼容，留空 = 全部页
- 六种格式（Word / 图片 / Excel / PPT / TXT / Markdown）与「保留原版式」均支持选页；保留原版式通过先裁剪选中页子集 PDF 再复用既有实现
- 页号语义保持原始页码：TXT / Markdown 的「第 N 页」标题、图片 zip 的 `page_N.png` 不因选页而重排
- 解析逻辑分层：`public/js/tools/page-range.js` 为前后端共用纯函数（Node 服务端据此返回 400 而非 500），Python 侧 `parse_page_range` 独立校验（双保险），新增一致性对照测试保证两端判定不漂移
- 前端体验：上传后启用输入框并显示总页数；输入实时校验（越界/倒序/格式错误即时提示，标红）；非法输入不发请求；转换状态与结果区标明「已转换第 2-3 页（共 N 页）」；图片只预览所选页；下载文件名带 `-p2-3` 后缀
- **测试**：Python +20（`PageRangeTest`：解析/提取/CLI/保真选页），Node +30（共享解析 12 项含跨语言一致性、最小 DOM 全流程 8 项、转换计划与 API 10 项）；无头 Edge 视觉冒烟通过
- **报告**：`docs/test/Test-2026-11-01-按页码转换PDF-Tulip.md`

---

## v1.2.1 — 2026-11-01 · 安全审计与漏洞修复

**安全（中危 3 / 低危 5）**

- `/api/open` 执行面收敛：拒绝扩展名由 22 项扩至 **40 项**（补 `.cpl` / `.msc` / `.chm` / `.scf` / `.settingcontent-ms` / `.diagcab` / `.appx` / `.msix` / `.reg` / `.inf` / `.ws` 等 Windows 上"文档面貌"的执行入口），并抽为可单测的 `inspectOpenTarget()`
- 新增 `realpath` 真实路径二次校验，堵住「`报告.txt` → `evil.exe`」符号链接/硬链接改后缀绕过
- PDF 整页渲染引入像素预算 `MAX_RENDER_PIXELS`（3000 万像素/页）：超大 MediaBox 的恶意 PDF 不再按固定 3× 申请数十 GB 内存（`_render_scale()` 动态降采样，正常 A4 输出不变）
- 临时目录不再启动即 `rmtree`，改为只清理 60 分钟前的遗留文件（`sweepStaleFiles()`），修复双实例/并发测试互删在转文件
- 临时文件改用 `crypto.randomUUID()` 命名 + `wx` 独占创建，避免可预测文件名与符号链接预置
- 附件名按 RFC 5987 补齐 `' ( ) * !` 转义（`contentDispositionAttachment()`）
- 5xx 响应不再回显内部错误文本（4xx 保留业务提示）
- 补齐安全响应头 `X-Permitted-Cross-Domain-Policies: none`

**测试**：Node 313 项（新增 11）、Python 84 项（新增渲染预算 6 项）、ESLint / Ruff / Prettier 全通过、生产依赖 0 漏洞。
**报告**：`docs/test/SafeTest-2026-11-01-安全审计与漏洞修复-tulip.md`

---

## v1.2.0 — 2026-10-31 · 工具箱新增 Git 使用指南

- 新增 `public/js/tools/git-guide.js`「🌿 Git 指南」：9 大分类 **52 条**常用命令，场景化中文标题 + 示例 + 💡提示
- 搜索支持中英文、不区分大小写、多词 AND（命中标题/命令/示例/提示/标签/分类名），输入实时过滤；分类页签带实时计数
- 一键复制（`navigator.clipboard` + `execCommand` 兜底）；`reset --hard` / `push --force-with-lease` / `clean -fd` 等不可逆命令带红色警示
- 查询逻辑抽为纯函数 `searchCommands` / `countByCategory` / `formatCommandText`；样式全部走主题类，随 13 套配色联动
- 纯前端静态数据，无网络请求、不改数据文件
- 修复：搜索框漏绑 `oninput`（输入不过滤）、`stash-drop` 标了危险却缺提示
- 测试：新增 `test/git-guide.test.js` 22 项（含最小 DOM 渲染冒烟）；依赖侧 `npm audit fix` 将 `qs` 升至 6.16.2
- **报告**：`docs/test/Test-2026-10-31-工具箱Git使用指南-Tulip.md`

---

## v1.1.1 — 2026-10-25 · PDF 工具前端优化与视觉一致性

- PDF 转换后可**连续转换为多种格式**（此前格式按钮转换一次即永久禁用），令牌有效期内可直接再转
- 文件校验抽为导出纯函数 `validatePdfFile`（类型 / 空文件 / 200MB 上限 / 拒绝 `.pdf.exe` 伪装），下载链接显示结果文件大小
- 桃夭视觉一致性：PDF 上传区改为 `.pdf-dropzone` 主题类（顺带修复 `var(--primary)` 未声明导致**拖拽高亮一直无效**）；`md-convert` 的 `var(--card-bg)` → `var(--panel)`；工具箱/开发页残留旧蓝 `#eef1fe` → `var(--nav-active)`
- 新增「JS 内联样式主题变量白名单」守卫测试（首次运行即抓出 `md-convert` 隐患）
- **报告**：`docs/test/Test-2026-10-25-优化PDF工具与桃夭UI美化-Tulip.md`

---

## v1.1.0 — 2026-10-24 · 个人笔记上线、饮食计划下线、桃夭主题

- 新增「个人笔记」模块：上传 `.md` / `.markdown` / `.txt`（≤ 1MB），安全渲染（HTML 全量转义），H1 目录与重复标题唯一锚点
- 下线「饮食计划」模块（`diet` 字段与旧数据保留以兼容，无 UI 入口）
- 「工作台外观」升级为 **13 套配色**，默认「桃夭」桃粉国风
- PDF 转换核心重写：结构化可编辑输出，Word / PPT 默认「保留原版式」
- 文档目录迁移至 `docs/`，新增文档索引与测试报告归档约定
- **报告**：`docs/test/Test-2026-10-24-优化PDF转换工具-Tulip.md`

---

## v1.0.0 — 基础版本（PRD v1 全功能）

首页总览（摘要卡 + 快速备忘提醒）、今日计划（表格式添加 / 顺延 / 拖拽排序 / 关联文档）、开发工作（项目与三栏看板 / 工作日志 / 远程仓库跳转）、工具箱（PDF / Markdown / JSON 转换）、账目计划（月度预算 / 环形图 / 分类管理）、数据与设置（密码箱 PBKDF2+AES-GCM / 备份恢复 / 外观主题）。

工程侧：Node.js + Express（单依赖）、原生 HTML/CSS/JS SPA、单 JSON 数据文件原子保存、Python 子进程承担文档转换、`node --test` + `unittest` 双测试链路、GitHub Actions CI。
