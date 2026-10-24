# WorkLift 项目优化方案

> 日期：2026-09-25
> 定位：个人本地工具（单用户、127.0.0.1、单 JSON 数据文件）。优化原则：不套用 SaaS 过度工程，只做对单人本地工具真正有价值的事。

## 现状体检（数据支撑）

| 维度 | 现状 | 评价 |
|---|---|---|
| 测试 | 208 JS + 44 Python，全绿 | ✅ 优秀 |
| 代码质量 | **无 ESLint/Prettier/ruff** | ❌ 最大短板 |
| 自动化 | **无 CI（.github 不存在）** | ❌ 测试靠手跑 |
| 依赖安全 | `npm audit` 3 个 moderate（qs DoS） | ⚠️ 一条命令可修 |
| 安全基线 | 无安全头、无 Host/Origin 校验（2026-09-25 安全测试进行中） | ⚠️ 见 `docs/test/SafeTest+*+tulip.md` |
| 类型安全 | logic.js 604 行纯 JS 无类型 | ⚠️ 核心逻辑裸奔 |
| 数据层 | 单 JSON 全量读写、11KB | ✅ 当前规模完全够用 |
| 架构 | 原生 SPA + 单文件服务，11 路由 | ✅ 对单人本地工具是正确选择 |

## 分阶段执行

### P0 · 安全与稳定（半天，必做）

1. **`npm audit fix`** — 修掉 3 个 qs moderate，改 lockfile 即可
2. **安全响应头** — 加 CSP、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`
3. **Host/Origin 校验中间件** — 拒绝非 `127.0.0.1` 的 Host，堵 DNS rebinding
4. **收敛两个危险面** — `/api/open` 加路径白名单（用户文档/下载目录）；`md_convert.py` 图片 src 禁止读取白名单外的绝对路径
5. 落地时以 `docs/test` 的安全测试报告为验收清单，逐条闭环

### P1 · 工程质量（2-3 天，强烈建议）

6. **ESLint + Prettier（flat config）+ ruff** — 现在是「靠 review 手动兜底」，上工具后增量守住
7. **GitHub Actions CI** — push 即跑 `npm test` + `python -m unittest`，252 个测试从「想起来才跑」变「每次必跑」
8. **核心逻辑加 JSDoc 类型 + `tsc --checkJs`** — 不迁 TS，只给 `logic.js`/`vault.js`/`api.js` 注解，渐进拿回类型保护（604 行 logic.js 是全应用数据心脏，最值得）
9. **覆盖率工具接入** — `node --test --experimental-test-coverage` + coverage.py，先看盲区再补测试（当前 208 个测试覆盖了什么没有度量）
10. **Git 提交纪律** — 按 `feat/fix/test/chore` 分主题提交，出问题可回滚

### P2 · 架构演进（按需，数据量增长时再做）

11. **数据层 schema versioning** — `validateData` 现在只校验形状不校验版本；加 `schemaVersion` 字段 + 迁移钩子，防未来数据格式变更静默丢字段
12. **自动备份/回滚** — 每次 `PUT /api/data` 前留一份 `.bak`（轮转 3 份），防误清空
13. **拆分 logic.js（604 行）** — 按领域拆 `logic/plan.js`、`logic/money.js`…（等触碰 250 行红线时再动）
14. **E2E 冒烟** — Playwright 跑 5 条主路径（开页/添加计划/记账/转换/密码箱解锁）

### P3 · 性能（当前不必做）

- 数据 11KB、本地回环、全量渲染 —— 全都没问题，不要优化
- 触发条件：数据文件 > 1MB 或列表 > 1000 条时，再考虑虚拟列表、增量保存

## 明确不建议做的

- ❌ **上数据库 / 换框架** — 单 JSON + 原生 SPA 是本项目的正确架构
- ❌ **全量迁移 TypeScript** — 成本远超收益，checkJs 渐进足够
- ❌ **引入打包器（Vite/webpack）** — localhost 静态服务 + 原生 ES modules，无加载痛点
- ❌ **缓存层/读写分离** — 11KB 数据加任何中间层都是负优化

## 执行记录

| 日期 | 项目 | 状态 |
|---|---|---|
| 2026-09-25 | P0.1 npm audit fix（express 4.22.3 / qs 6.16.0，0 漏洞） | ✅ |
| 2026-09-25 | P1.6 ESLint flat config + Prettier + ruff.toml；存量 14 个 lint 错误清零 | ✅ lint 0 / format:check 0 / ruff 0 / test 208 + 44 ✅ |
| 2026-09-25 | ⚠️ 环境修复：venv 重建为 Python 3.12.4（Anaconda），PyMuPDF 等依赖重装 | ✅ 44 python 测试全绿 |
| 2026-09-25 | P1.7 GitHub Actions CI（node lint+test / python 测试+ruff 双 job） | ✅ |
| 2026-09-25 | P1.9 覆盖率：npm script `test:coverage`；python 覆盖率由 CI 中 `coverage` 承担 | ✅ 总行覆盖 69.2% / server.js 64.5% / vault.js 100% |
| 2026-09-25 | P0.2 安全响应头（CSP/XFO/nosniff/Referrer-Policy/Permissions-Policy/COOP/CORP）+ disable x-powered-by | ✅ |
| 2026-09-25 | P0.2 /api 守卫：Host 白名单（防 DNS rebinding）、Origin 同源、Sec-Fetch-Site、Cache-Control no-store | ✅ |
| 2026-09-25 | P0.3 /api/shutdown 仅接受 application/json（415），防跨站简单请求关停本机服务 | ✅ |
| 2026-09-25 | P0.3 /api/open 拒绝 UNC 路径（防 NetNTLM 凭据泄露）；非 JSON 内容 400 | ✅ |
| 2026-09-25 | P0.3 /api/open 拒绝可执行/脚本扩展名（.bat/.exe/.js/.hta/.lnk/.vbs 等 22 种，大小写不敏感；防 cmd start 执行任意代码） | ✅ 新增 2 个安全用例 |
| 2026-09-25 | P0.4 密码策略：主密码最短 6→10 位；validateVault 迭代次数仅设上限 1000 万（放弃下限 21 万：测试用 1000 加速、降级攻击已证伪） | ✅ vault.js 100% 覆盖 |
| 2026-09-25 | P0.4 md_convert.py：图片仅允许 base_dir 内相对路径，拒绝绝对路径/..穿越/超 20MB | ✅ 新增 3 个安全用例 |
| 2026-09-25 | P0.4 dev.js/远程仓库链接经 normalizeRepoUrl 归一化后渲染，javascript: 伪协议不落地为 href | ✅ 新增断言 |
| 2026-09-25 | P0.2-4 全量回归 | ✅ npm 217/217（原 208 + 新增 9）+ python 47/47（原 44 + 新增 3）+ lint/format:check/ruff 全 0 |