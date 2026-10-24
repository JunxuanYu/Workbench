# SafeTest-2026-10-24-安全测试-tulip

> 范围：`server.js`（Express 本机服务）、`public/js/markdown.js`、`public/js/pages/notes.js`、`public/js/vault.js`、静态资源与 npm 生产依赖。
> 前提：WorkLift 是单用户本地工作台，服务仅监听 `127.0.0.1`，无账号体系；安全边界按「本机同源 + 单用户」评估，不按公网多租户系统评估。
> 结论：本轮发现的风险点均已修复或已由回归测试锁定；`npm audit` 为 0 漏洞，安全测试 18/18 通过。

## 一、测试环境与命令

| 项 | 值 |
|---|---|
| 日期 | 2026-10-24 |
| 系统 | Windows / Node.js / Express 4.22.3 |
| 服务地址 | `http://127.0.0.1:8788`（仅回环监听） |
| 数据 | 临时 JSON，未触碰真实 `data/worklift-data.json` |
| 安全测试 | `node --test test/security.test.js` |
| 全量测试 | `npm test` |
| 静态检查 | `npm run lint` |
| 供应链 | `npm audit --registry=https://registry.npmjs.org --omit=dev` |

## 二、发现与处置

### SEC-1 个人笔记 Markdown 渲染面：存储型 XSS 与危险协议 — 已防护

| 属性 | 值 |
|---|---|
| 严重性 | 高（若直接渲染未转义内容） |
| CWE | CWE-79（跨站脚本）/ CWE-601（开放重定向） |
| 路径 | `public/js/markdown.js` → `renderMarkdown` / `renderInline` / `safeUrl` |

**风险**：笔记内容来自用户上传的 `.md/.txt`。若把 Markdown 中的原始 HTML、`onerror` 等事件属性或 `javascript:`、`data:text/html`、`vbscript:`、`file:`、`//evil` 链接直接拼入 `innerHTML`，会形成存储型 XSS 或危险跳转；笔记数据可能被其他本机进程改写，不能默认为可信。

**处置**：
- 先对全部文本做 HTML 转义，再拼接受控标签；Markdown 中的原始 HTML 永远作为文字显示。
- 链接只允许 `http:` / `https:` / `mailto:` / 页内 `#` 锚点；其余协议只保留文字，不生成 `href`。
- 不渲染 Markdown 图片语法为 `<img>`，避免远程资源与事件属性注入。
- 链接属性二次转义；外链统一 `target="_blank" rel="noopener noreferrer"`。
- 标题 id 只保留文字/数字/连字符，重复标题自动加后缀，避免 DOM id 冲突。

**验证**：`test/security.test.js` 覆盖 script/img/svg/iframe、事件属性、危险协议、协议相对链接、标题/表格注入与 `safeUrl` 白名单，全部通过。

### SEC-2 `/api/open`：Windows `cmd start` 命令元字符注入面 — 已修复

| 属性 | 值 |
|---|---|
| 严重性 | 中（本地单用户；需同源请求或恶意本地数据路径） |
| CWE | CWE-78（OS 命令注入） |
| 路径 | `server.js` → `app.post('/api/open')` → `openWithOS()` |

**风险**：接口通过 `cmd /c start` 打开本地文档。路径中包含 `& | < > ^ % ( ) "` 或换行时，可能被 `cmd` 解释为命令分隔符/变量展开符，使「打开文档」升级为命令执行面。虽然接口已限制 JSON POST 与同源，仍不应把路径直接交给 shell 解释。

**处置**：
- 新增 `WINDOWS_CMD_META_RE = /["&|<>^%()\r\n]/`，Windows 下在 `stat` 前直接拒绝。
- 保留 UNC 路径拒绝（防 NetNTLM 泄露）。
- 保留可执行/脚本扩展名拒绝（`.bat/.cmd/.exe/.js/.hta/.lnk/.ps1` 等），避免「打开关联文档」变执行。
- 仅接受 `application/json` POST，降低跨站简单请求触发面。

**验证**：`test/security.test.js` 的 Windows 用例构造含 `&` 的真实路径，断言 400；UNC、可执行扩展名与 Content-Type 用例由 `api.test.js` / 安全测试共同覆盖。

### SEC-3 npm 生产依赖漏洞 — 已修复

初始审计（公共 registry）报告 2 个生产依赖漏洞：

| 包 | 初始问题 | 严重性 | 处置 |
|---|---|---|---|
| `body-parser` | 压缩请求体尾部字节导致 DoS（GHSA-27r3-jxmh-p828） | high | `npm audit fix` 升级至 1.20.9 |
| `proxy-addr` | IPv4-mapped IPv6 信任子网导致 IP 伪造（GHSA-jqcg-44mw-7w3h） | critical | `npm audit fix` 升级至 2.0.8 |

修复后 `npm audit --registry=https://registry.npmjs.org --omit=dev` 返回 `found 0 vulnerabilities`。`npm audit fix` 仅变更依赖锁文件与上述传递依赖，未改业务代码。

> 备注：当前默认镜像 `registry.npmmirror.com` 的 audit 端点返回 404 `[NOT_IMPLEMENTED]`，因此审计改用官方 registry；这是镜像能力限制，不是项目漏洞。

### SEC-4 既有安全基线复核 — 通过

| 控制点 | 现状 | 回归 |
|---|---|---|
| 仅回环监听 | `127.0.0.1`，不监听局域网 | 运行配置 + 测试临时服务 |
| DNS rebinding | Host 仅允许 `127.0.0.1/localhost/[::1]`（可带端口） | 伪造 Host → 403 |
| 跨站请求 | Origin 必须本机同源；`Sec-Fetch-Site` 仅允许 `same-origin`/`none` | 跨站 Origin、null、cross-site/same-site → 403 |
| 缓存泄露 | `/api` 全部 `Cache-Control: no-store` | 响应头断言 |
| 关闭服务 CSRF | `/api/shutdown` 仅接受 JSON POST | text/plain → 415 |
| 打开本地文件 | JSON POST + UNC 拒绝 + 可执行扩展名拒绝 + Windows 元字符拒绝 | 安全测试 / API 测试 |
| 静态目录穿越 | `express.static(public)`；`data/`、`server.js` 不在静态根 | 多组 `..`/编码穿越均非 200 |
| 浏览器侧防护 | CSP（`script-src 'self'`、`frame-ancestors 'none'`）、`X-Frame-Options: DENY`、`nosniff`、COOP/CORP、无 `X-Powered-By` | 响应头断言 |
| 密码箱 | PBKDF2-SHA256 210,000 次 + AES-256-GCM；随机 salt/IV；密文不含主密码/条目明文；迭代上限 10,000,000 防 DoS | `vault.test.js` + 安全测试 |
| 数据写入 | 临时文件 + rename 原子写；保存前 `validateData` | `api.test.js` / `logic.test.js` |

## 三、残余风险（接受并记录）

1. **无认证**：本机任意进程/用户均可调用 `/api` 读取数据。产品定位为单用户本地工具，服务不暴露到局域网/公网；若未来改为多用户或远程访问，必须增加认证与 TLS。
2. **数据文件明文**：除密码箱外，计划、项目、笔记、账目均为本地 JSON 明文，依赖操作系统账户与磁盘权限保护。
3. **`/api/open` 的设计面**：同源用户仍可让系统打开任意非可执行本地文件/文件夹；这是「关联文档」功能所需，已通过同源、JSON、UNC、扩展名与元字符限制收窄。
4. **CSP 的 `style-src 'unsafe-inline'`**：用于运行时主题变量/样式，脚本侧仍为 `script-src 'self'`，不接受内联脚本。
5. **Python 依赖未做 `pip-audit`**：本轮完成 Node 依赖审计；Python 依赖由本地虚拟环境安装，后续可在发布前补充 `pip-audit`。

## 四、测试结果

| 检查 | 结果 |
|---|---|
| `node --test test/security.test.js` | 18 tests / 18 pass / 0 fail |
| `npm test` | 263 tests / 263 pass / 0 fail（12 个测试文件） |
| `npm run lint` | 通过，0 error / 0 warning |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Python unittest | 47 tests / 47 pass |
| 视觉冒烟（1440×1000，无头 Edge） | 桃夭主题、笔记列表、H1 目录、表格/引用渲染正常 |

## 五、结论

本轮安全测试未发现未处置的高危问题。新增个人笔记的渲染面已按「先转义、后拼接、链接白名单」实现并有回归；`/api/open` 的 Windows 命令解释面已封堵；生产依赖漏洞已升级清零。剩余风险均属于单用户本地工具的已接受边界。
