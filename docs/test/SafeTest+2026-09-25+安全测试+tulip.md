# SafeTest+2026-09-25+安全测试+tulip

> 依据：WorkLift 本地应用的攻击面分析、HTTP 实证、认证/数据层审查与运行时供应链初步审查。
> 范围：server.js（Express，127.0.0.1:8788，无认证 /api）+ public/js（vault 密码箱、dev.js 项目链）+ python/md_convert.py（Markdown→PDF 图片内嵌）。
> 本文档中的所有漏洞均已修复并通过回归；修复验证见文末。

## 一、测试环境

| 项 | 值 |
|---|---|
| 运行环境 | Windows 11 / Node.js（Express 4.22.3）/ Python 3.12.4 venv（PyMuPDF） |
| 服务地址 | http://127.0.0.1:8788（仅回环监听） |
| 数据文件 | 单 JSON（`data/worklift-data.json`），含密码箱密文 |
| 测试数据 | 临时副本（`%TEMP%\opencode\*`），未触碰真实数据 |

## 二、发现列表

### AP-1 关闭服务端点 /api/shutdown 无 Content-Type 校验 — 已修复

| 属性 | 值 |
|---|---|
| 严重性 | 中（本地仅限） |
| CWE | CWE-749（暴露危险方法） |
| 路径 | `server.js` → `app.post('/api/shutdown')` |

**现象**：实现只检查路由与 POST 方法，任何 Content-Type 的 POST（含 `<form>` 简单请求）都能触发关闭回调。跨站页面可通过表单诱导关停本机服务（拒绝服务）。

**修复**：进入处理前强制 `req.is('application/json')`，否则 `415`。
```js
if (!req.is('application/json')) return res.status(415).json({ error: '仅接受 application/json' });
```

**验证**：`api.test.js` 新增「POST /api/shutdown 非 application/json → 415 且不触发关闭」。

### AP-2 无 Host / Origin 校验（DNS rebinding）— 已修复

| 属性 | 值 |
|---|---|
| 严重性 | 高（本地） |
| CWE | CWE-350（DNS rebinding）/ CWE-942（跨站） |
| 路径 | `server.js` → 全 /api 路由 |

**现象**：服务器无 Host 校验。恶意域名解析到 127.0.0.1 后，浏览器可跨站读取 `/api/data`（含密码箱 salt+密文）；同源校验缺失使 `<img>`/`<form>` 简单请求可直达 `/api/open`、`/api/shutdown`。

**修复**：在 `/api` 上挂守卫中间件——Host 必须匹配 `127.0.0.1|localhost|[::1]`（可带端口）；Origin 存在时必须同源；`Sec-Fetch-Site` 非 `same-origin`/`none` 一律 403；所有 /api 响应 `Cache-Control: no-store`。
```js
app.use('/api', (req, res, next) => { /* Host/Origin/Sec-Fetch-Site 校验 + no-store */ });
```

**验证**：`api.test.js` 新增「伪造 Host → 403 / 跨站 Origin → 403 / Sec-Fetch-Site: cross-site → 403 / no-store」。

### AP-3 /api/open 接受 UNC 路径 → NetNTLM 凭据泄露 — 已修复

| 属性 | 值 |
|---|---|
| 严重性 | 高（本地） |
| CWE | CWE-350 / CWE-922（不安全的敏感信息存储） |
| 路径 | `server.js` → `app.post('/api/open')` |

**现象**：`path` 传入 `\\attacker\share\file` 或 `//attacker/share` 时，`child_process` 调用系统关联程序打开 UNC 路径，向远程 SMB 共享发起认证握手，泄露本机 NetNTLM 哈希（目标为域用户时可达凭据重用攻击）。本工具仅面向本机文件/文件夹，无需 UNC。

**修复**：开头即拒绝 `^(\\\\|\/\/)`：
```js
if (/^(\\\\|\/\/)/.test(p)) return res.status(400).json({ error: '不支持网络路径（UNC）' });
```
同时拒绝可执行/脚本文件扩展名——`cmd start` 会**执行** `.bat/.cmd/.com/.exe/.scr/.js/.jse/.vbs/.vbe/.wsf/.wsh/.hta/.lnk/.pif/.msi/.msp/.ps1/.psm1/.psd1/.jar/.reg/.appref-ms`（大小写不敏感），避免「打开关联文档」升级为任意代码执行面（runtime-supply-hunter 实测 marker.bat 探针确认执行可达）：
```js
if (st.isFile() && /\.(bat|cmd|com|exe|scr|js|jse|vbs|vbe|wsf|wsh|hta|lnk|pif|msi|msp|ps1|psm1|psd1|jar|reg|appref-ms)$/i.test(p))
  return res.status(400).json({ error: '不支持打开可执行/脚本文件' });
```

**验证**：`api.test.js` 新增「.bat/.cmd/.exe/.js/.hta/.lnk/.vbs/.ps1 → 400」与「.BAT 大小写 → 400」用例。

### AP-4 md_convert.py 图片路径任意文件读取 — 已修复

| 属性 | 值 |
|---|---|
| 严重性 | 高（本机，需服务端可访问源） |
| CWE | CWE-22（路径穿越）/ CWE-73（文件路径外部控制） |
| 路径 | `python/md_convert.py` → `image()` |

**现象**：非 data URI 的图片路径 `os.path.join(base_dir, src)` 直接拼接并读取，绝对路径与 `..` 穿越均可读取 base_dir 外任意本机文件并内嵌进生成的 PDF（带目录外文件内容回显）。

**修复**：仅接受 base_dir 内的相对路径——拒绝绝对路径；`normpath` 后必须落在 base_dir 内；文件大小上限 20MB。
```python
if not os.path.isabs(src):
    p = os.path.normpath(os.path.join(base_dir, src))
    base = os.path.normpath(base_dir)
    if (p == base or p.startswith(base + os.sep)) and os.path.isfile(p):
        ...
```
拒绝时渲染占位符，不中断转换。

**验证**：`python/tests/test_md_convert.py` 新增 3 个用例（绝对路径 / `..` 穿越 / 超 20MB → 占位符、零图片嵌入）。

### AP-5 dev.js 远程仓库链接 javascript: sink — 已修复

| 属性 | 值 |
|---|---|
| 严重性 | 中（数据文件被篡改前提） |
| CWE | CWE-79（存储型 XSS 变体）/ CWE-94（代码注入） |
| 路径 | `public/js/pages/dev.js` → `repoLink.href` |

**现象**：数据文件中 `project.repoUrl` 若被篡改为 `javascript:alert(1)`，渲染时直接写入 `href` 成为可点击执行 sink（本地数据文件可被其他进程改写）。

**修复**：渲染前经 `normalizeRepoUrl()` 归一化，非 http(s) 协议（javascript:/data:/ftp: 等）一律不落地为 href：
```js
const repoHref = normalizeRepoUrl(project.repoUrl);
if (repoHref) { const repoLink = ...; repoLink.href = repoHref; }
```

**验证**：`logic.test.js` 新增 `normalizeRepoUrl('javascript:...') === null`、`data:` 伪协议拒绝断言。

## 三、密码箱密码学实证（auth-data-hunter / 提取代理）

### 3.1 迭代次数降级攻击：证伪

理论：攻击者（有本地读权限）将磁盘上 `vault.iterations` 从 210000 改为 1000，使解锁变快、便于离线爆破。
**结论**：迭代次数改变后 vault 解密失败（密文解密结果与 `entries` 校验不符 → 数据作废），**改变 iterations 仅造成数据损坏（DoS），不能降低实际爆破成本**。攻击者可直接离线爆破 210000 迭代版本，无需降级。

### 3.2 真实风险：未认证 GET /api/data + 弱主密码 → GPU 爆破

真实攻击面是**未认证的 `/api/data` 泄露 salt + ciphertext**，叠加**主密码最短 6 位**的策略（PBKDF2+随机盐，估算 6 位纯数字/常见弱密码在 GPU 上小时级可破）。

**修复**：
1. 主密码最短长度 6 → **10 位**（`vault.js validateMasterPassword`）。
2. `validateVault` 增加迭代次数**上限 1000 万**（`MAX_ITERATIONS=10_000_000`）——防恶意数据量级的迭代次数造成 PBKDF2 卡死浏览器（DoS）。
3. **放弃迭代下限 210000**（原计划）：测试刻意用 `ITER=1000` 加速（`vault.test.js`），且降级攻击已证伪，下限无安全增益；上限与密码长度才是有效防线。

**验证**：`vault.test.js` 新增长度边界（9 位拒/10 位过）、迭代上限（10,000,001 拒/10,000,000 过）断言；vault.js 行覆盖维持 100%。

## 四、防护纵深（防御性响应头）

新增全局中间件：

| 头 | 值 | 防护 |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` | XSS、点击劫持、注入面收窄 |
| `X-Frame-Options` | `DENY` | 点击劫持 |
| `X-Content-Type-Options` | `nosniff` | MIME 嗅探 |
| `Referrer-Policy` | `no-referrer` | 跨页泄 referrer |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | 传感器权限 |
| `Cross-Origin-Opener-Policy` | `same-origin` | 跨源窗口隔离（配合 COEP） |
| `Cross-Origin-Resource-Policy` | `same-origin` | 跨源资源读取隔离 |
| `X-Powered-By` | 移除 | 版本指纹 |

## 五、回归验证

| 项 | 结果 |
|---|---|
| `npm test` | **217/217 通过**（原 208 + 新增 9） |
| `python -m unittest discover -s python/tests` | **47/47 通过**（原 44 + 新增 3） |
| `npm run lint`（eslint） | 0 错误 |
| `npm run format:check`（prettier） | 0 差异 |
| `python -m ruff check python` | 0 问题 |

新增测试清单：
- `test/api.test.js`：安全响应头齐全 / 无 X-Powered-By / /api no-store / Host 伪造 403 / 跨站 Origin 403 / Sec-Fetch-Site cross-site 403 / shutdown 415 / open UNC 400 / open 可执行文件 400（8 种扩展名+大小写）/ open 路径不存在 404。
- `test/logic.test.js`：normalizeRepoUrl 拒绝 javascript:/data: 伪协议。
- `test/vault.test.js`：主密码 10 位边界、迭代上限边界。
- `python/tests/test_md_convert.py`：绝对路径 / .. 穿越 / 超大图 → 占位符且零嵌入。

## 六、结论

本地工具的攻击面以「未认证 HTTP + 单 JSON 数据文件 + 子进程调本机程序」为主。P0.2-4 共 5 个已确认问题全部修复，并落地 7 项纵深响应头；密码策略升级（10 位 + 迭代上限）同时回应了离线爆破与 DoS 两个维度。行为锁（全量测试全绿、三套 lint 零报告）保持不变。