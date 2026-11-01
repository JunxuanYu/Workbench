# 安全审计与漏洞修复报告 — WorkLift v1.2.1

- **报告日期**：2026-11-01
- **审计对象**：WorkLift 本地个人工作生活 APP（Node 22 + Express 5 + 原生前端 + Python 转换后端）
- **版本范围**：v1.2.0 → **v1.2.1**
- **审计类型**：白盒代码审计 + 黑盒动态验证 + 依赖审计 + 回归测试
- **结论**：共发现 **8 项**安全缺陷（中危 3 / 低危 5），**全部已修复**；历史已加固的 18 项边界复测全部通过；生产依赖 0 漏洞。修复后全量测试 **Node 313/313、Python 84/84** 全绿，无功能回归。

---

## 1. 审计范围与方法

| 维度 | 覆盖内容 |
|---|---|
| 服务端 | `server.js`（路由、静态托管、请求体解析、子进程调用、文件系统写入） |
| 前端 | `public/js/**`（Markdown 渲染、笔记/密码箱、四个工具箱、关闭流程） |
| 转换后端 | `python/pdf_convert.py`、`python/md_convert.py`（PDF 解析/渲染/打包、路径处理） |
| 数据 | `data/worklift-data.json`（原子写入、字段校验、密码箱密文） |
| 构建与依赖 | `package.json` / `package-lock.json` / `python/requirements.txt` |
| 方法 | ① 威胁建模（本机 Web 服务：恶意网页 → 本机端口、DNS rebinding、恶意文档、并发/资源耗尽）② 源码逐点审查 ③ 起真实服务做黑盒探测（伪造 Host/Origin/Sec-Fetch-Site）④ 新增回归测试固化 |

**威胁模型前提**：应用仅监听 `127.0.0.1`、单用户本机使用、无账号体系。因此把「跨站网页攻击本机服务」「恶意 PDF/Markdown 文档」「本地文件系统被预置」作为主要攻击面，而非网络侧入侵。

---

## 2. 风险清单

| ID | 等级 | 类别（CWE） | 位置 | 问题摘要 | 状态 |
|---|---|---|---|---|---|
| SEC-01 | 🟠 中 | 命令注入/执行面（CWE-78/184） | `server.js` `POST /api/open` | 执行类扩展名黑名单仅 22 项，`.cpl`/`.msc`/`.chm`/`.settingcontent-ms`/`.scf`/`.diagcab`/`.appx`/`.msix`/`.reg`/`.inf`/`.ws` 等 10+ 项未拦截 → `cmd start` 直接运行 | ✅ 已修复 |
| SEC-02 | 🟠 中 | 链接跟随绕过（CWE-59） | `server.js` `POST /api/open` | 仅校验请求字符串后缀；符号链接/硬链接 `notes.txt → evil.exe` 可绕过 | ✅ 已修复 |
| SEC-03 | 🟠 中 | 资源耗尽/DoS（CWE-400/789） | `python/pdf_convert.py` | 整页渲染固定 3×，恶意 PDF 声明 20000×20000pt → 申请 ≈10.8GB 内存，进程崩溃 | ✅ 已修复 |
| SEC-04 | 🟡 低-中 | 竞态/可用性（CWE-362） | `server.js` 启动清理 | 启动即 `rmtree` 临时目录，两个实例（或并发测试）会互删正在转换的文件 | ✅ 已修复 |
| SEC-05 | 🟡 低 | 符号链接写穿（CWE-377） | `server.js` 临时文件 | 临时文件名基于 `Date.now()+Math.random()`（可预测）且非独占创建 | ✅ 已修复 |
| SEC-06 | 🟡 低 | 响应头编码（CWE-113/116） | `server.js` 三处附件下载 | `Content-Disposition` 的 `filename*` 未转义 `' ( ) * !`，不符合 RFC 5987 | ✅ 已修复 |
| SEC-07 | 🟡 低 | 信息泄露（CWE-209） | `server.js` 错误中间件 | 5xx 直接回显 `err.message`，可能带内部路径/堆栈信息 | ✅ 已修复 |
| SEC-08 | 🟡 低 | 安全响应头缺失（CWE-693） | `server.js` 全局头 | 缺 `X-Permitted-Cross-Domain-Policies` | ✅ 已修复 |

等级判定：结合「仅本机可达 + 需同源/本地条件」的可利用性，与「命中后为任意代码执行/进程崩溃」的影响综合给出。

---

## 3. 详细发现与修复

### SEC-01 `/api/open` 可执行扩展名覆盖不足（中危）

**问题**：该接口用系统默认程序打开「关联文档」，Windows 下经 `cmd /c start "" <path>` 实现。原实现用后缀黑名单拒绝可执行/脚本，但清单只覆盖传统可执行后缀（`.bat/.exe/.js/.lnk/...`）。Windows 上还有一批后缀在「双击/start」时**执行代码**而非「打开内容」：

```
.cpl(控制面板项)  .msc(管理控制台)  .chm(编译帮助)  .scf(资源管理器命令)
.settingcontent-ms(设置页, 已知绕过手法)  .diagcab(诊断包)  .appx/.appxbundle  .msix/.msixbundle
.reg(注册表导入)  .inf(驱动/安装信息)  .vb/.ws/.wsc/.wsf/.wsh(脚本宿主)  .ps1xml/.pssc/.cdxml
```

**验证**：黑盒探测遍历 14 个高危后缀，12 个未被拦截（`cpl/msc/chm/settingcontent-ms/scf/url/appx/msix/diagcab/vb` 等）；HTTP 层实测 `.scf` 返回 `200` 并触发系统调用，`.cpl` 等同样放行 —— 即「打开文档」可升级为「运行任意程序」。

**修复**：
- 黑名单扩至 **40 项**并集中为 `BLOCKED_OPEN_EXT_RE`；
- 判定逻辑抽为可单测的 `inspectOpenTarget()`（注入 `statSync/realpathSync/platform`，纯逻辑可测）；
- 保留原有 UNC 拒绝、Windows 元字符拒绝、非文件/目录拒绝。

```js
export const BLOCKED_OPEN_EXT_RE =
  /\.(?:bat|cmd|com|exe|scr|pif|msi|msp|msc|cpl|chm|hta|lnk|scf|js|jse|vbs|vbe|vb|ws|wsf|wsh|wsc|ps1|...|reg|inf)$/i;
```

**测试**：`test/security.test.js` 新增「覆盖 Windows 上以『文档』面貌出现的执行入口」（20 个后缀全量断言）+「HTTP 层新增执行类扩展名均返回 400」。**修复过程中该测试立即抓出 `.scf` 漏配**，已补齐。

---

### SEC-02 `/api/open` 未校验真实路径（中危）

**问题**：只对请求字符串做后缀判断。若攻击者能在用户目录放置 `报告.txt`（实际为指向 `payload.exe` 的符号链接/硬链接），后缀检查通过，`start` 会按真实目标处理，绕过 SEC-01 的全部防御。

**修复**：文件类型先 `statSync`，再 `realpathSync` 取真实路径，**对「请求路径」与「真实路径」分别执行后缀校验**；解析失败则退回原路径继续校验（不 fail-open）。

```js
let real = p;
try { real = realpathSync(p); } catch { /* 沿用原路径，仍需通过后缀校验 */ }
if (BLOCKED_OPEN_EXT_RE.test(p) || BLOCKED_OPEN_EXT_RE.test(real)) {
  return { ok: false, status: 400, error: '不支持打开可执行/脚本文件' };
}
return { ok: true, target: real };
```

**测试**：注入 `realpathSync → C:\tmp\evil.exe`，断言 `notes.txt` 被拒绝；普通 `报告.pdf` 与目录仍放行。

---

### SEC-03 PDF 渲染无像素上限（中危 · 本地拒绝服务）

**问题**：`_render_png` / `render_page` / 版式背景三处均以固定倍率调用 `page.get_pixmap(matrix=fitz.Matrix(scale, scale))`。PDF 的 `MediaBox` 由文件自身声明，构造 `20000×20000pt` 页面后按 3× 渲染需要 `60000×60000×3B ≈ 10.8GB` 内存，Python 子进程被 OOM 杀掉；连续触发可拖垮整机。上传阶段 `--check` 只统计页数，不做尺寸限制，因此恶意文件可顺利通过校验。

**计算示例（修复前）**：

| 页面尺寸(pt) | 3× 渲染像素 | RGB 内存 |
|---|---|---|
| A4 595×842 | 1785×2526（4.5MP） | 13.5 MB |
| 2000×2000 | 6000×6000（36MP） | 108 MB |
| 20000×20000 | 60000×60000（3600MP） | **≈10.8 GB** |

**修复**：新增像素预算 `MAX_RENDER_PIXELS = 30_000_000`（30MP/页 ≈ 90MB）与 `_render_scale(rect, scale, max_pixels)`：按 `sqrt(预算 / 页面面积)` 收敛倍率，并设 `MIN_RENDER_SCALE = 0.05` 下限保证极端页面仍有可辨识缩略图。三处渲染统一走该函数，**正常 A4 倍率不变（3.0）**，功能与清晰度无回归。

```python
def _render_scale(rect, scale, max_pixels=None):
    budget = MAX_RENDER_PIXELS if max_pixels is None else max_pixels
    width, height = max(float(rect.width), 1.0), max(float(rect.height), 1.0)
    if budget <= 0: return scale
    return max(min(scale, math.sqrt(budget / (width * height))), MIN_RENDER_SCALE)
```

**测试**：`python/tests/test_pdf_convert.py` 新增 `RenderBudgetTest` 6 项 —— 正常 A4 保持 3.0、20000×20000 收敛到预算内、预算可配、极端页面触及下限、非正预算退化为原倍率、**真实渲染**（2000×2000 页面 + 1MP 预算）产出像素数落在预算区间。

---

### SEC-04 临时目录启动即清空，导致并发互删（低-中）

**问题**：`createApp()` 启动时 `fs.rmSync(PDF_TMP_DIR, {recursive:true})`。当用户开两个窗口（或两个测试进程并行）时，后启动的实例会删除前一个实例**正在转换**的临时文件，转换失败；在部分安全中间件/沙箱环境下还会因目录已被并发删除而抛错。本轮全量测试即复现为 2 个 hook 失败。

**修复**：改为 `ensureDir()` + `sweepStaleFiles(dir, maxAgeMs)` —— 只删除 **mtime 超过 60 分钟**（`PDF_TOKEN_TTL_MS`）的遗留文件，保留在用文件。既清得掉上次崩溃的残留，又不会互相干扰。

**测试**：新增用例构造「2 小时前」与「刚刚」两个文件，断言旧文件被删、新文件保留。

---

### SEC-05 临时文件可预测命名 + 非独占创建（低）

**问题**：`${Date.now()}-${Math.random().toString(36).slice(2)}.pdf` 可被本地攻击者预估；若不预先创建文件而预置同名**符号链接**，`writeFileSync` 会跟随链接写到目录外（POSIX 上无需特权）。

**修复**：改用 `crypto.randomUUID()`，并以 `{ flag: 'wx' }` 独占创建（目标已存在即失败，不跟随已存在的链接）；PDF 与 Markdown 两条链路同步修改。

---

### SEC-06 附件名 RFC 5987 编码不完整（低）

**问题**：`encodeURIComponent()` 不转义 `' ( ) * !`，与 RFC 5987 的 `attr-char` 集合不一致；含这些字符的文件名会产出不规范响应头，不同客户端解析结果不一致（可能造成文件名截断/伪装）。

**修复**：新增 `contentDispositionAttachment(name)`，在 `encodeURIComponent` 基础上把 `' ( ) * !` 补转义，三处下载（备份 JSON、PDF 转换、MD 转换）统一使用。

**测试**：`"a'b(c)*d!.pdf"` → 头部不含裸保留字符，`decodeURIComponent` 可无损还原。

---

### SEC-07 5xx 回显内部错误信息（低）

**问题**：错误中间件 `res.status(err?.status || 500).json({ error: err?.message })`，异常文本可能包含内部路径、库调用细节。

**修复**：4xx 保留可读业务提示（体积超限/解析失败），5xx 统一返回「服务器内部错误」，细节只留在服务端。工具箱接口仍通过 `PdfHttpError` 返回面向用户的中文提示（不受影响）。

---

### SEC-08 缺少 X-Permitted-Cross-Domain-Policies（低）

**修复**：全局响应头补 `X-Permitted-Cross-Domain-Policies: none`，与既有 CSP / `X-Frame-Options: DENY` / `X-Content-Type-Options: nosniff` / `Referrer-Policy: no-referrer` / COOP / CORP / `Permissions-Policy` 形成完整基线。

---

## 4. 复测结果（修复后）

### 4.1 全量测试

| 套件 | 结果 | 说明 |
|---|---|---|
| Node（`node --test`） | **313 / 313 通过** | 本轮新增 11 项（安全 8 + 临时目录 1 + 文档同步 2），原 302 项零回归 |
| Python（`unittest discover`） | **84 / 84 通过** | 本轮新增 `RenderBudgetTest` 6 项，原 78 项零回归 |
| ESLint | 0 error | `server.js` / `public` / `test` |
| Ruff | All checks passed | `python/` |
| `npm audit --omit=dev` | **found 0 vulnerabilities** | 生产依赖仅 express 5.3.0（qs 6.17.1） |

### 4.2 黑盒动态探测（18 项，起真实服务 + 伪造请求头）

| 探测项 | 结果 | 判定 |
|---|---|---|
| 静态穿越 `/../data/…`、`%2e%2e`、`..%2f`、`/.workbuddy/…` | 404 | ✅ 拦截 |
| `Host: evil.example.com` / `127.0.0.1.evil.com` | 403 | ✅ DNS rebinding 防护有效 |
| `Origin: https://evil…` / `Origin: null` | 403 | ✅ 跨站拒绝 |
| `Sec-Fetch-Site: cross-site` | 403 | ✅ |
| `OPTIONS` 跨站预检 | 403（无任何 CORS 头） | ✅ 不可跨源读取 |
| `PUT /api/data` 非法结构 | 400 且不落盘 | ✅ |
| `PUT /api/data` 携带 `__proto__` | 200，`Object.prototype` 未被污染、落盘无该键 | ✅ |
| `PUT` 11MB 请求体 | 413 | ✅ 体积限制生效 |
| `POST /api/shutdown` 非 JSON | 415 | ✅ 简单请求 CSRF 面关闭 |
| `GET /api/tools/pdf/page?token=../../etc/passwd` | 404 | ✅ 令牌白名单查找，无路径穿越 |
| `convert` 未知格式 / 非法页号 | 400 / 404 | ✅ 参数白名单 |
| 安全响应头 | CSP(script-src 'self')、nosniff、DENY、COOP、CORP、no-referrer、无 `X-Powered-By`、新增 X-Permitted-Cross-Domain-Policies | ✅ |

### 4.3 历史防线复核（未发现新问题）

- **XSS**：Markdown 渲染器「先转义后受控拼接」，原始 HTML/事件属性/`javascript:`/`data:text/html`/属性注入均无效（`notes.test.js` + `security.test.js` 已覆盖 12 项）；全量扫描 `public/js` 无「`innerHTML` 拼接变量」，工具箱动态内容一律 `textContent`。
- **密码箱**：PBKDF2-SHA256（210k 迭代）+ AES-256-GCM（随机 IV），`iterations` 上限 1000 万防解锁 DoS，密文不含主密码/条目明文，明文仅存内存。
- **凭据扫描**：全仓库无硬编码密钥/令牌（唯一命中为 `vault.test.js` 的伪造 PEM 头，非真实凭据）。
- **版本控制**：`.gitignore` 已忽略 `data/`、`python/.venv/`、缓存目录，个人数据与虚拟环境不会进仓库。

---

## 5. 残余风险与建议（未在本轮改动，供决策）

| # | 风险 | 说明 | 建议 |
|---|---|---|---|
| R1 | 无认证（设计使然） | 仅绑定 `127.0.0.1` + 同源守卫；**非浏览器客户端**（本机任意进程/脚本）可直接调用 API，Origin 校验对其无效 | 若存在「多人共用同一 Windows 账户」场景，建议加启动令牌（URL 带一次性 token）或改命名管道 |
| R2 | 转换并发/页数无上限 | 200MB + 120s 超时是唯一约束；并发上传多个大文件仍可能耗尽 CPU/内存 | 加并发信号量（如同时 2 个转换）与单文档页数上限提示 |
| R3 | Python 依赖未锁定哈希 | `requirements.txt` 为版本区间（`>=1.24,<2`），首次安装取最新版 | 生产环境建议 `pip freeze` 锁版本 + `--require-hashes` |
| R4 | 笔记为明文存储 | 仅密码箱内容加密；`notes`/`ledger` 等以明文落在 `data/*.json` | 敏感笔记可迁移进密码箱，或对整库加密 |
| R5 | 无安全审计日志 | 打开本地文件、关闭服务等操作无留痕 | 如需追溯，可记录「时间 + 操作 + 路径」到本地日志（注意不含敏感内容） |
| R6 | `/api/open` 仍可打开任意非执行文件/目录 | 设计如此（关联文档功能）；已加执行类拦截与真实路径校验 | 如需更严，可改为「仅允许打开用户已登记在数据里的路径」白名单 |

---

## 6. 变更文件清单

| 文件 | 变更 |
|---|---|
| `server.js` | 新增 `BLOCKED_OPEN_EXT_RE`（40 项）/`inspectOpenTarget()`/`contentDispositionAttachment()`/`ensureDir()`/`sweepStaleFiles()`；重写 `/api/open` 校验；临时文件改 `randomUUID` + `wx`；错误中间件 5xx 收敛；补安全响应头 |
| `python/pdf_convert.py` | 新增 `MAX_RENDER_PIXELS`/`MIN_RENDER_SCALE`/`_render_scale()`；三处整页渲染统一走预算收敛 |
| `test/security.test.js` | 新增 8 项（扩展名矩阵、realpath 绕过、放行路径、状态码、平台差异、HTTP 层、RFC5987、响应头）+ 临时目录并发用例 |
| `python/tests/test_pdf_convert.py` | 新增 `RenderBudgetTest` 6 项 |
| `test/docs.test.js` | 版本断言 → v1.2.1；新增 v1.2.1 文档同步与本报告存在性校验 |
| `docs/开发计划.md` / `docs/optimization.md` | 追加 v1.2.1 安全审计记录 |
| `package.json` / `package-lock.json` | 1.2.0 → 1.2.1 |

## 7. 复现命令

```bash
node --test                                  # Node 全量 313
python/.venv/Scripts/python.exe -m unittest discover -s python/tests   # Python 全量 84
node node_modules/eslint/bin/eslint.js server.js public test           # Lint
python/.venv/Scripts/python.exe -m ruff check python                   # Python Lint
npm audit --omit=dev --registry=https://registry.npmjs.org             # 依赖审计
```

---

**验收要点**：本报告的每一项「已修复」都对应可执行测试用例（非人工描述）；建议优先复看 `test/security.test.js` 的「打开本地文件：执行类扩展名与真实路径校验」与 `python/tests/test_pdf_convert.py` 的 `RenderBudgetTest`。
