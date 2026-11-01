# SafeTest-2026-10-25-安全测试-tulip

> 范围：v1.1.1 迭代涉及面（`public/js/tools/pdf-convert.js`、`md-convert.js`、`consult.js`、`dev.js`、`public/css/style.css`）+ 全量安全基线复核。
> 前提：WorkLift 为单用户本地工作台，服务仅监听 `127.0.0.1`，无账号体系；按「本机同源 + 单用户」边界评估。
> 结论：**本轮改动未引入新的安全面**；新增 2 项注入面回归测试；`npm audit` 0 漏洞，安全测试 24/24 通过，全量 281 Node + 60 Python 全绿。

## 一、测试环境与命令

| 项 | 值 |
|---|---|
| 日期 | 2026-10-25 |
| 版本 | v1.1.1 |
| 系统 | Windows / Node.js v22.22.2 / Express 4.x |
| 服务地址 | `http://127.0.0.1`（仅回环监听） |
| 安全测试 | `node --test test/security.test.js`（24 项） |
| 全量测试 | `node --test`（281 项）+ Python unittest（60 项） |
| 静态检查 | eslint server.js public test → 0 / ruff check python → pass |
| 供应链 | `npm audit --registry=https://registry.npmjs.org --omit=dev` → **found 0 vulnerabilities** |

## 二、本轮改动安全审查

### SEC-25-1 工具箱 UI innerHTML 注入面 — 无问题，新增回归锁定

| 属性 | 值 |
|---|---|
| 严重性 | 信息（预防性） |
| CWE | CWE-79（跨站脚本） |
| 路径 | `public/js/tools/*.js` → `innerHTML` |

**审查**：逐行检查 `pdf-convert.js` / `md-convert.js` / `json-convert.js` 的全部 `innerHTML` 赋值（共 9 处）：8 处为 `= ''` 清空，1 处为**纯静态模板**（PDF 上传区提示文案），均不含 `${` 变量插值；用户文件名只进入 `textContent` 与 `encodeURIComponent` 后的 URL 参数，不拼入 HTML。

**处置**：新增 2 项回归测试（`test/security.test.js`）：
1. `工具箱 UI：tools/*.js 的 innerHTML 调用均为静态字符串，不拼接变量` —— 扫描全部工具 JS，任何 `innerHTML = ...${...}` 即失败；
2. `文件名校验在前（validatePdfFile），文件名仅用于 UI 文本与 URL 编码参数` —— 锁定 `encodeURIComponent(file.name)` 必须存在、文件名不得拼入 innerHTML。

### SEC-25-2 改动面安全影响评估 — 通过

| 改动 | 安全影响 | 结论 |
|---|---|---|
| `validatePdfFile` 抽取为纯函数 | 无；校验规则（类型/空文件/200MB）与原逻辑等价，且新增测试覆盖 `.pdf.exe` 伪装扩展名拒绝 | ✅ |
| PDF 上传区改 `.pdf-dropzone` 类 | 无；仅 className/拖拽视觉态，事件处理与上传数据流不变 | ✅ |
| `var(--card-bg)`→`var(--panel)`、`#eef1fe`→`var(--nav-active)` | 无；纯样式 | ✅ |
| `doConvert` finally 恢复按钮 | 无；`currentToken` 校验仍在函数入口，无效 token 不发起请求 | ✅ |
| 版本号/文档更新 | 无 | ✅ |

## 三、既有安全基线复核 — 通过（与 2026-10-24 报告一致，未回退）

| 控制点 | 现状 | 回归 |
|---|---|---|
| 仅回环监听 | `127.0.0.1` | 测试内临时服务 + 启动配置 |
| DNS rebinding | Host 白名单 `127.0.0.1/localhost/[::1]` | 伪造 Host → 403 |
| 跨站请求 | Origin 同源 + `Sec-Fetch-Site` 仅 same-origin/none | 跨站 Origin → 403 |
| 缓存泄露 | `/api` 全部 `Cache-Control: no-store` | 响应头断言 |
| 关闭服务 CSRF | `/api/shutdown` 仅 JSON POST | text/plain → 415 |
| 打开本地文件 | UNC 拒绝 + 可执行扩展名拒绝 + Windows cmd 元字符拒绝（`WINDOWS_CMD_META_RE`） | `api.test.js` + 安全测试 |
| 静态目录穿越 | `express.static(public)`，`data/`、`server.js` 不在静态根 | `..`/编码穿越非 200 |
| 浏览器侧防护 | CSP `script-src 'self'`、`X-Frame-Options: DENY`、nosniff、COOP/CORP | 响应头断言 |
| 密码箱 | PBKDF2-SHA256 + AES-256-GCM，迭代上限 10,000,000 防 DoS | `vault.test.js` + 安全测试 |
| Markdown 渲染 | 先转义后拼接、链接协议白名单（http/https/mailto/#）、不渲染原始 HTML/图片 | `security.test.js` |
| md_convert.py 图片路径 | 仅 base_dir 内相对路径，拒绝穿越/超 20MB | Python 测试 |

## 四、残余风险（接受并记录，与上轮一致）

1. **无认证**：本机任意进程可调用 `/api`；产品定位单用户本地工具，不暴露局域网/公网。
2. **数据文件明文**：除密码箱外均为本地 JSON 明文，依赖 OS 账户与磁盘权限。
3. **`/api/open` 设计面**：同源可打开任意非可执行本地文件；已按同源+JSON+UNC+扩展名+元字符收窄。
4. **CSP `style-src 'unsafe-inline'`**：运行时主题所需；脚本侧仍为 `script-src 'self'`。
5. **Python 依赖未做 pip-audit**：Node 侧已审计清零；Python venv 本地安装，发布前可补充。

## 五、测试结果汇总

| 检查 | 结果 |
|---|---|
| `node --test test/security.test.js` | **24 tests / 24 pass / 0 fail**（含本轮新增 2 项） |
| `node --test` 全量 | **281 tests / 281 pass / 0 fail** |
| Python unittest | **60 tests / 60 pass** |
| eslint / ruff | 0 error / All checks passed |
| `npm audit --omit=dev` | **0 vulnerabilities** |

## 六、结论

本轮 v1.1.1 迭代（PDF 前端优化 + 桃夭视觉对齐 + 文档同步）**未引入任何新的安全风险**；同步为工具箱 UI 建立了 innerHTML 静态性回归守卫，把"今后给工具加 UI"的注入风险挡在测试层。全部既有安全基线复核通过，生产依赖 0 漏洞。
