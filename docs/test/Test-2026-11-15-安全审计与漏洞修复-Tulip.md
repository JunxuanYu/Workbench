# 安全审计与漏洞修复报告 — WorkLift v1.3.4

- **报告日期**：2026-11-15
- **审计对象**：WorkLift 本地个人工作生活 APP（Node 22 + Express 5 + 原生前端 + Python 转换后端）
- **版本范围**：v1.3.3 → **v1.3.4**
- **审计类型**：白盒代码审计 + 动态验证（真实服务黑盒 + 真实文件系统复现）+ 依赖审计 + 全量回归
- **结论**：发现 **3 项**安全缺陷（中危 2 / 低危 1），**全部已修复**；历史 26 项已加固边界复测通过；生产依赖 0 漏洞。修复后全量测试 **Node 397/397（+1 SKIP）、Python 142/142** 全绿，黑盒探测 **11/11** 通过，无功能回归。

---

## 1. 审计范围与方法

| 维度 | 覆盖内容 |
|---|---|
| 服务端 | `server.js`（路由、静态托管、请求体解析、子进程调用、文件系统读写、安全响应头） |
| 前端 | `public/js/**`（Markdown 渲染、密码箱、保存链路、工具箱四件套） |
| 转换后端 | `python/pdf_convert.py`、`python/md_convert.py`（PDF 解析/渲染/打包） |
| 数据 | `data/worklift-data.json`（原子写入、字段校验、密码箱密文） |
| 构建与依赖 | `package.json` / `package-lock.json` / `python/requirements.txt` |
| 方法 | ① 威胁建模 ② 源码逐点审查 ③ **真实文件系统复现**（硬链接、真实目录/文件）④ 起真实服务黑盒探测（伪造 Host/Origin、并发 token、UNC 路径）⑤ 新增回归测试固化 |

**威胁模型前提**：应用仅监听 `127.0.0.1`、单用户本机使用、无账号体系。主要攻击面为：跨站网页攻击本机服务、**恶意/被污染的本地目录布局**（预置链接、同步盘/解压包带出的符号链接）、恶意文档、资源耗尽。

本轮与上一轮（v1.2.1）的差异：v1.3.3 新增了「保存并发校验」与「密码箱防回滚」两条新链路，涉及新请求头与新的写入路径，属本轮重点复核对象；同时把审计重心从「API 入参」扩展到 **文件系统竞态与链接语义**。

---

## 2. 风险清单

| ID | 等级 | 类别（CWE） | 位置 | 问题摘要 | 状态 |
|---|---|---|---|---|---|
| SEC-09 | 🟠 中 | 符号链接跟随 / 链接注入（CWE-59 / CWE-377） | `server.js` `writeAtomic()` | 临时文件用固定名 `<data>.tmp` 且默认 `'w'` 标志，会跟随预置的同名硬链接/符号链接 → 一次保存即可把整份 JSON 写到任意文件；两实例并发保存共用同名临时文件互相截断 | ✅ 已修复 |
| SEC-10 | 🟠 中 | 链接跟随绕过（CWE-59 / CWE-918） | `server.js` `inspectOpenTarget()` | UNC 校验只比对请求字符串，且顺序为「先 `statSync` 后 `realpathSync`」；指向 `\\server\share` 的链接在检查前就已发起 SMB 认证（NetNTLM 泄露）。目录分支直接 `return`，完全跳过解析 | ✅ 已修复 |
| SEC-11 | 🟡 低 | 安全响应头缺失（CWE-693） | `server.js` 全局头 | CSP 的 `object-src`/`frame-src`/`worker-src`/`manifest-src` 依赖 `default-src 'self'` 兜底，等于「同源即可加载」 | ✅ 已修复 |

等级判定：结合「仅本机可达 + 需本地目录写权限」的可利用性，与「命中后为任意文件覆盖（可改配置/授权文件）」或「凭据外泄」的影响综合给出。

---

## 3. 详细发现与修复

### SEC-09 数据文件原子写入可被「预置同名临时文件」重定向（中危）

**问题**：`writeAtomic()` 是数据落盘的唯一入口（`/api/data` PUT 与首次建库各调用一次）：

```js
const tmp = filePath + '.tmp';                    // 固定名，可预测
fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8'); // 默认 'w'，跟随链接
fs.renameSync(tmp, filePath);
```

临时名固定为 `worklift-data.json.tmp`，且 `writeFileSync` 默认 `'w'` 标志会**跟随已存在的链接**。只要该位置被预置一个指向其他文件的硬链接（Windows 同卷创建硬链接**无需管理员权限**）或符号链接，用户下一次保存（改一条账目即可触发）就会把整份 JSON 覆盖到链接目标——可指向 `~/.ssh/authorized_keys`、启动项配置文件、其它应用的配置等。此外两个实例同时保存会共用同一临时名，可能互相截断产生半截 JSON。

**验证（真实文件系统，本机复现）**：

```
hardlink ok                       # fs.linkSync(victim, 'data.json.tmp') 成功
victim 内容 = {"pwned":true}      # 一次写入后，victim 被完整覆盖
```

**修复**：

```js
export function writeAtomic(filePath, data) {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`; // 不可预测
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {
      encoding: 'utf8',
      flag: 'wx',   // 独占创建：目标已存在即失败，绝不跟随既有链接
      mode: 0o600,  // 数据文件含笔记/账目明文，仅属主可读写
    });
    fs.renameSync(tmp, filePath); // rename 不跟随链接，替换的是链接本身
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 清理失败不影响上抛 */ }
    throw e;
  }
}
```

同时把数据目录创建权限收紧为 `mode: 0o700`（`ensureDataFile`）。

**测试**：新增 `test/write-atomic.test.js`（5 项）
1. 预置 `<data>.tmp` 硬链接时写入不落到链接目标，且预置链接本身不被覆盖/清理；
2. 连续写入后目录内无 `*.tmp` 残留，只有目标数据文件；
3. 12 路并发写入互不干扰，最终文件始终是**完整** JSON（不被截断）；
4. `rename` 失败（目标被同名目录占用）时抛出并清理自己的临时文件；
5. POSIX 下数据文件权限为 `0600`（Windows SKIP，由 ACL 决定）。

---

### SEC-10 `/api/open` 链接目标 UNC 在解析期绕过（中危）

**问题**：`/api/open` 用于「关联文档」点击后由本机打开文件/文件夹，最终执行 `cmd /c start "" <path>`。原实现对 UNC 的校验是：

```js
if (/^(\\\\|\/\/)/.test(p)) return 400;   // 只看请求字符串
let st = statSync(p);                     // ← 会跟随链接：此刻已向远程 SMB 发起认证
...
let real = realpathSync(p);               // ← 再解析真实路径
if (!st.isFile()) return { ok: true, target: p };  // ← 目录直接放行，完全没解析
```

三个问题叠加：

1. **只看字符串**：`报告.pdf` → `\\attacker\share\x.pdf` 的链接，请求字符串完全合法；
2. **顺序错误**：`statSync` 就跟随链接，`\\attacker\share` 的 SMB 认证握手（NetNTLM 哈希外泄）在校验之前已经发出，事后再判断已无意义；
3. **目录短路**：目录分支在 `realpathSync` 之前就 `return`，目录 junction 指向网络共享同样会触发认证。

**修复**：改为「**先解析链接（只读链接目标字符串），每跳先判 UNC，再 stat**」：

```js
function resolveLocalLinks(p, { lstatSync, readlinkSync }) {
  let cur = p;
  for (let hop = 0; hop <= MAX_LINK_HOPS; hop++) {   // ≤8 跳，防环
    const lst = lstatSync(cur);                      // lstat：不跟随最后一跳
    if (!lst.isSymbolicLink()) return { ok: true, path: cur };
    const resolved = normalizeLinkTarget(readlinkSync(cur)); // \\?\UNC\ → \\ ... 归一化
    if (isUncPath(resolved)) return { ok: false, status: 400, error: '不支持网络路径（UNC）' };
    cur = path.resolve(path.dirname(cur), resolved);
  }
  return { ok: false, status: 400, error: '符号链接层级过深，已拒绝' };
}
```

- `normalizeLinkTarget()` 归一化 Windows NT 对象前缀（junction 的 `readlink` 常返回 `\\?\C:\...` / `\\?\UNC\srv\share`），否则漏判；
- 顺序改为 `lstat → readlink → (判 UNC) → stat(resolved) → realpath`，真实路径再做一次 UNC 兜底；
- **目录同样返回真实路径**，不再短路；
- 文件后缀校验从「请求路径 + 真实路径」两份扩到「请求路径 + 解析后路径 + 真实路径」三份。

**测试**：`test/security.test.js` 新增 8 项（`SEC-10` 套件）
- 指向 UNC 的链接被拒，且 **`statSync`/`realpathSync` 被注入为「一调用即失败」**——证明拒绝发生在触网之前；
- junction 的 `\\?\UNC\` 前缀同样识别；
- 目录链接指向 UNC 不再放行；
- 多跳 `a→b→\\srv\share` 在第二跳被拒；
- 链接成环时 8 跳内快速失败（不无限循环）；
- 本地文件链接正常放行并返回真实路径（一正例，防过度拦截）；
- 真实路径兜底为 UNC 时拒绝；
- `normalizeLinkTarget` 四种前缀归一化断言。

**真实文件系统复核**：普通 `.txt` 放行、目录放行（返回真实路径）、`.exe` 拒绝、指向 `.exe` 的硬链接以 `.txt` 名放行但**不会被执行**（Windows 按扩展名派发，见 §6 R2）。

---

### SEC-11 CSP 缺少插件/子框架/Worker 限制（低）

**问题**：CSP 为

```
default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

`object-src`/`frame-src`/`worker-src`/`manifest-src` 均未声明，回落到 `default-src 'self'`，即「同源即可加载插件内容、嵌子框架、起 Worker」。本应用完全不使用这些能力（已全仓检索：无 `<iframe>`/`<object>`/`<embed>`/`new Worker`/manifest），声明 `'none'` 零成本，且能收窄「一旦出现注入点」时的利用链。

**修复**：显式补 `object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'`，并补 `X-DNS-Prefetch-Control: off`（避免页面中的链接被浏览器预解析）。

**测试**：`test/security.test.js` 新增 1 项，断言四条指令均为 `'none'`、未放开 `unsafe-eval`、`base-uri`/`form-action` 仍受限、`X-DNS-Prefetch-Control: off`；全量测试中另有旧断言继续保证 `script-src 'self'` 且无 `unsafe-inline`。

**功能复核**：真实启动服务，首页与 `/js/app.js` 均 200，页面脚本全部为同源外链（CSP 未变的部分不构成新约束），无内联脚本被新策略影响。

---

## 4. 复测结果

### 4.1 全量测试

| 套件 | 结果 | 说明 |
|---|---|---|
| Node（`node --test`） | **397 通过 / 0 失败 / 1 SKIP**（共 398） | 本轮 +17（`write-atomic.test.js` 5、`security.test.js` 9、`docs.test.js` 3），v1.3.3 基线 381 零回归 |
| Python（`unittest discover`） | **142 / 142** | 无改动，零回归 |
| ESLint | 0 error | `server.js` / `public` / `test` |
| Prettier | 全部匹配 | 同上范围 |
| Ruff | All checks passed | `python/` |
| `npm audit --omit=dev` | **found 0 vulnerabilities** | 生产依赖仅 express 5 |

> `1 SKIP` 为 POSIX 文件权限用例，Windows 上无 `chmod` 语义，按设计跳过（CI/Linux 上会执行）。

### 4.2 黑盒动态探测（11/11，起真实服务）

| 探测项 | 结果 | 判定 |
|---|---|---|
| `PUT /api/data` 正常保存并返回新 token | 200 + `updatedAt` | ✅ 功能无回归 |
| **预置 `data.json.tmp` 硬链接后保存** | 受害者文件仍为 `ORIGINAL` | ✅ SEC-09 写穿阻断 |
| 保存后目录内无随机临时文件残留 | 无 | ✅ |
| 过期 `X-WorkLift-Base-Updated-At` | 409 | ✅ 并发校验仍生效 |
| `POST /api/open` 路径为 UNC | 400 | ✅ SEC-10 |
| `POST /api/open` 真实本地目录 | 200 | ✅ 功能无回归 |
| `POST /api/open` `.exe` | 400 | ✅ 执行面仍关闭 |
| CSP 四条 `'none'` + `X-DNS-Prefetch-Control: off` | 全部命中 | ✅ SEC-11 |
| `Host: evil.example.com`（DNS rebinding） | 403 | ✅ 既有防线 |
| `Origin: https://evil.example.com` | 403 | ✅ 既有防线 |
| 静态路径穿越 `/../data/…` | 404 | ✅ 既有防线 |

### 4.3 历史防线复核（26 项已加固边界，未发现新问题）

- **XSS**：`renderMarkdown()` 先整体转义再受控拼接；全仓 `public/js` 无 `eval`/`new Function`/内联事件属性；动态内容一律 `esc()` 或 `textContent`。本轮新增的 `modal.js` 密码框 `autocomplete` 属性走 `esc()`，`data-k` 为开发者常量。
- **密码箱**：PBKDF2-SHA256（210k，上限 1000 万防 PBKDF2 DoS）+ AES-256-GCM（随机 IV + 随机盐）；`validateVault` 校验 `salt`/`iterations`/`data` 形状；明文仅在内存。
- **保存并发**：`X-WorkLift-Base-Updated-At` 乐观校验、`nextUpdatedAt()` 单调 token、salt 变化需有效 base 或显式 `X-WorkLift-Vault-Replace: 1`（v1.3.3 引入，本轮复测：过期 base 仍 409）。
- **`/api/open`**：40 类可执行后缀、Windows 元字符、UNC、非文件/目录一律拒绝（本轮把 UNC 判定前移到链接解析阶段）。
- **`/api` 守卫**：Host/Origin/`Sec-Fetch-Site` 三重校验，`Cache-Control: no-store`，无 CORS 头。
- **临时文件**：上传用 `randomUUID` + `wx`，启动清扫只删过期文件；本轮把同一原则补齐到数据落盘路径。
- **凭据扫描**：全仓无硬编码密钥/令牌；`.gitignore` 忽略 `data/`、`python/.venv/`。

---

## 5. 变更文件清单

| 文件 | 变更 |
|---|---|
| `server.js` | `writeAtomic()` 改随机名 + `wx` + `0600` + 失败清理；`ensureDataFile()` 目录 `0700`；新增 `isUncPath()`/`normalizeLinkTarget()`/`resolveLocalLinks()`；`inspectOpenTarget()` 重写链接解析顺序与目录分支；CSP 补四条 `'none'`；补 `X-DNS-Prefetch-Control: off` |
| `test/write-atomic.test.js` | 新增（5 项）：写穿阻断、无残留、并发完整性、失败清理、权限 |
| `test/security.test.js` | 新增 SEC-10 套件 8 项 + CSP 纵深 1 项；既有 `/api/open` 用例补注入 `lstatSync`（链接分支显式化，避免误判为「文件不存在」） |
| `test/docs.test.js` | 版本断言 → v1.3.4；版本清单补 1.3.4；新增 v1.3.4 文档同步与报告存在性 3 项 |
| `package.json` / `package-lock.json` | 1.3.3 → 1.3.4 |
| `CHANGELOG.md` / `README.md` / `docs/开发计划.md` | 新增 v1.3.4 条目、安全基线与两条实现规则（原子写入禁用固定名、`/api/open` 解析顺序） |

## 6. 残余风险与建议（本轮未改动，供决策）

| # | 风险 | 说明 | 建议 |
|---|---|---|---|
| R1 | 无认证（设计使然） | 仅绑定 `127.0.0.1` + 同源守卫；**本机任意进程/脚本**可直接调用 API（含 `X-WorkLift-Vault-Replace`）。Origin 校验对非浏览器客户端无效 | 多人共用同一 Windows 账户时，可加启动令牌（URL 带一次性 token）或改命名管道 |
| R2 | 硬链接无法通过 `realpath` 识别 | `报告.txt` 硬链接到 `payload.exe` 时真实路径仍是 `报告.txt`。但 Windows/macOS 均按**扩展名**派发，`.txt` 不会被当程序执行，且需本地写权限（已有该权限即可直接落盘载荷） | 如需彻底关闭，可对 `statSync().nlink > 1` 的文件拒绝打开（会误伤部分备份盘布局，暂不做） |
| R3 | 转换并发/页数无上限 | 200MB + 120s 超时是唯一约束；并发上传多个大文件仍可能耗尽 CPU/内存 | 加并发信号量（同时 2 个转换）与单文档页数上限提示 |
| R4 | Python 依赖未锁定哈希 | `requirements.txt` 为版本区间 | 生产环境建议 `pip freeze` 锁版本 + `--require-hashes` |
| R5 | 笔记/账目为明文存储 | 仅密码箱内容加密 | 敏感笔记可迁入密码箱，或对整库加密 |
| R6 | 无安全审计日志 | 打开本地文件、关闭服务等操作无留痕 | 如需追溯，可记录「时间 + 操作 + 路径」到本地日志（不含敏感内容） |

## 7. 复现命令

```bash
node --test                                                             # Node 全量 398
./python/.venv/Scripts/python.exe -m unittest discover -s python/tests   # Python 全量 142
node node_modules/eslint/bin/eslint.js .                                 # Lint
node node_modules/prettier/bin/prettier.cjs --check server.js public test eslint.config.js
./python/.venv/Scripts/ruff.exe check python                             # Python Lint
npm audit --omit=dev --registry=https://registry.npmjs.org               # 依赖审计
```

---

**验收要点**：每项「已修复」都对应可执行测试，且其中两条用**真实文件系统**而非纯 mock 证明——`test/write-atomic.test.js` 的「预置硬链接」用例（旧实现下受害者文件必被覆盖）、`test/security.test.js` 的「拒绝先于 stat」用例（`statSync` 一旦被调用即判失败）。
