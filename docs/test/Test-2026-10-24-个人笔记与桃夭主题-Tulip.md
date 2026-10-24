# 测试报告 - 个人笔记与桃夭主题

**日期**: 2026-10-24
**事项**: 移除饮食计划、新增个人笔记、桃夭国风外观、文档与安全迭代
**执行人**: Tulip

## 一、测试范围

本轮覆盖 4 项需求：

1. 工作计划中的「饮食计划」下线，替换为「个人笔记」。
2. 工作台外观升级为「桃夭」国风主题，仅改变视觉，不改变既有业务功能。
3. 同步更新 README、PRD、开发计划、package 版本，并增加文档一致性测试。
4. 完成安全测试与修复，安全报告与验收报告写入 `docs/test/`。

## 二、实现摘要

### 2.1 个人笔记

- 移除 `public/js/pages/diet.js`，导航、路由、首页卡片与数据模型不再包含饮食计划。
- 新增 `public/js/markdown.js`：纯逻辑 Markdown 渲染，先转义 HTML，再拼接受控标签；链接白名单为 http(s)/mailto/页内锚点；不渲染 Markdown 图片标签。
- 新增 `public/js/pages/notes.js`：支持上传 `.md/.markdown/.txt`，单文件上限 1 MiB；自动取首个 H1 作为标题，无 H1 回退文件名；支持笔记列表、删除确认、H1 右侧目录、锚点平滑滚动、重复标题唯一 id。
- 首页改为 5 张摘要卡：计划、项目、工具、笔记、账目；笔记卡显示总数与最近标题。
- 数据模型新增 `notes: []`；`migrateData()` 清理旧 `meals`、补全并过滤 `notes`、归一化主题；`validateData()` 拒绝非数组 notes 与非对象条目。

### 2.2 桃夭主题与视觉

- `public/js/theme.js` 新增 `peach`（桃夭），置于主题列表首位；`THEME_DEFAULT = 'peach'`。
- 新数据默认 `settings.theme = 'peach'`；旧数据/备份在迁移时对非法或缺失主题回退桃夭。
- 13 套主题顺序与默认值由 `test/theme.test.js` 精确断言。
- `public/css/style.css` 增加桃夭全局视觉覆盖：宣纸底色、桃粉侧栏、标题、卡片、按钮、表单、徽章、表格、日期导航、标签页、Toast、弹窗、主题选择器、笔记页、响应式与 reduced-motion。
- 仅调整外观层；路由、数据读写、工具转换、密码箱等业务逻辑未因主题改造而改变。

### 2.3 文档与版本

- `README.md`：移除饮食计划，新增个人笔记、13 套配色/桃夭说明。
- `docs/PRD.md`：更新为第三版 / v1.1，7 个模块、5 张首页摘要卡、新增 5.5 个人笔记、13 套主题。
- `docs/开发计划.md`：更新为 v1.1，补充 P6 个人笔记、P6.0 饮食下线、数据模型、测试清单、迁移与安全说明。
- `package.json` / `package-lock.json`：版本统一为 `1.1.0`。
- 新增 `test/docs.test.js`，锁定文档版本、模块、导航顺序、主题数量与报告目录。

### 2.4 安全加固

- 新增 `test/security.test.js`，覆盖 Markdown XSS/危险协议、API Host/Origin/Sec-Fetch-Site 守卫、静态目录穿越、UNC/Windows 命令元字符、笔记数据形状、密码箱参数；可执行扩展名拒绝由 `test/api.test.js` 覆盖。
- `/api/open` 增加 Windows `cmd` 元字符拒绝（`" & | < > ^ % ( )` 与换行），配合既有的 JSON-only、UNC 拒绝、可执行扩展名拒绝。
- 修复 npm 生产依赖漏洞：`body-parser` 升级到 1.20.9，`proxy-addr` 升级到 2.0.8；`npm audit` 清零。
- 详细安全分析见 `docs/test/SafeTest-2026-10-24-安全测试-tulip.md`。

## 三、测试执行

### 3.1 Node.js 全量测试

```bash
npm test
```

**结果**：

- 测试文件：12 个
- 测试总数：263
- 通过：263
- 失败：0
- 跳过：0
- 状态：全部通过

### 3.2 安全回归

```bash
node --test test/security.test.js
```

**结果**：18 tests / 18 pass / 0 fail。

### 3.3 文档一致性

```bash
node --test test/docs.test.js
```

**结果**：6 tests / 6 pass / 0 fail。

### 3.4 代码规范

```bash
npm run lint
```

**结果**：通过，0 error / 0 warning。

### 3.5 Python 测试

```bash
python -m unittest discover -s python/tests -v
```

**结果**：47 tests / 47 pass（使用项目 `python/.venv`）。

### 3.6 依赖审计

```bash
npm audit --registry=https://registry.npmjs.org --omit=dev
```

**结果**：`found 0 vulnerabilities`。

> 默认镜像 `registry.npmmirror.com` 的 audit 端点不支持该接口（404 `[NOT_IMPLEMENTED]`），因此使用官方 registry 完成审计。

### 3.7 视觉冒烟

使用无头 Edge，在 1440×1000 视口加载临时数据下的 `#/notes` 页面，确认：

- 桃夭主题的宣纸底色、桃粉侧栏、卡片与按钮正常；
- 笔记列表、H1 目录、表格、引用、删除按钮显示正常；
- 页面完整渲染，文字未被截断，未出现横向滚动。

## 四、问题与修复记录

| 问题 | 处置 | 验证 |
|---|---|---|
| 旧数据含 `meals`，新代码无该字段 | `migrateData()` 删除 `meals`，补全 `notes` | `logic.test.js` / `api.test.js` |
| 备份/旧数据缺少 `settings.theme` 或主题非法 | 迁移回退 `peach`；`currentTheme()` 容错 | `logic.test.js` / `theme.test.js` |
| notes 可能被写入 null/字符串条目 | `validateData()` 拒绝；迁移时过滤 | `security.test.js` / `logic.test.js` |
| Markdown 原始 HTML/危险协议 XSS 面 | 先转义再拼接；`safeUrl` 白名单；不渲染图片标签 | `security.test.js` |
| `/api/open` 的 Windows 命令元字符 | 新增 `WINDOWS_CMD_META_RE` 并返回 400 | `security.test.js` |
| `body-parser` / `proxy-addr` 依赖漏洞 | `npm audit fix` 升级 | `npm audit` 0 |
| `markdown.js` 存在未使用函数导致 lint 失败 | 删除未使用函数 | `npm run lint` |

## 五、验收清单

- [x] 饮食计划已从导航、路由、首页、数据模型和逻辑中移除。
- [x] 个人笔记可上传、命名、查看、切换、删除，单文件 1 MiB 限制生效。
- [x] Markdown 渲染安全，原始 HTML 不执行，危险协议不生成链接。
- [x] 桃夭主题为首套且为默认；13 套主题顺序与测试一致。
- [x] 主题仅影响视觉，不影响既有业务功能。
- [x] README / PRD / 开发计划 / package 版本同步到 v1.1。
- [x] 文档一致性测试通过。
- [x] Node 263 项、Python 47 项、安全 18 项全部通过。
- [x] lint 通过，npm 生产依赖 0 漏洞。
- [x] 安全报告与验收报告已写入 `docs/test/`。

## 六、结论

个人笔记替换饮食计划、桃夭主题、文档同步与安全加固均已完成并通过回归。全量 Node 测试 263/263、Python 测试 47/47、安全测试 18/18、lint 与依赖审计均通过。未执行 git 提交/回滚，工作区改动保持待审阅状态。
