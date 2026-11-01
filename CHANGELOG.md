# 变更日志（Changelog）

本项目版本号遵循 `主版本.次版本.修订号`：新增功能升次版本，修复/加固升修订号。
每次发版需同时更新本文件、`package.json` / `package-lock.json` 与 `docs/开发计划.md` §0。

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
