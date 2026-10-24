# Test-2026-08-27-外观主题与关闭按钮-Tulip.md

## 功能变更

本次共解决 **2 个问题**，均在浏览器与测试中验证通过。

### 问题 1：数据与设置 → 工作台页面外观设置

- 优化「数据与设置」页 UI 设计：新增「🎨 工作台外观」卡片，位于密码箱之前。
- 提供配色选择：**白色 / 黄色 / 蓝色**（基础配色）+ **奶油色**（额外配色）。
- 选择即生效并自动保存（写入数据文件 `settings.theme`），刷新/重启后保持。

### 问题 2：左侧栏底部·工作台关闭按钮

- 在左侧栏最底部（`margin-top:auto` 下推至左下角）新增「关闭工作台」按钮。
- 点击调用 `window.close()`；浏览器可能忽略关闭请求时，自动 toast 提示「请点击右上角关闭浏览器窗口」。

## 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `public/js/theme.js` | 新建 | 主题模块：THEMES 四套配色 + applyTheme() 应用 CSS 变量 |
| `public/js/close-workbench.js` | 新建 | 关闭请求纯逻辑：closeWorkbenchDecision / requestCloseWorkbench |
| `public/js/logic.js` | 修改 | defaultData 增加 `settings.theme`；validateData 校验；currentTheme/setTheme |
| `public/js/app.js` | 修改 | boot 时应用已保存主题；绑定关闭按钮点击 |
| `public/js/pages/settings.js` | 修改 | 新增工作台外观卡片，色块选择切换主题并保存 |
| `public/css/style.css` | 修改 | 主题变量化（--bg/--panel/--nav-active）；外观选择器样式；关闭按钮样式 |
| `public/index.html` | 修改 | 左侧栏底部新增关闭工作台按钮 |
| `test/theme.test.js` | 新建 | 主题与配色逻辑测试（15 个） |
| `test/appearance.test.js` | 新建 | 外观设置 UI + 关闭按钮测试（8 个） |

## 功能说明

### 工作台外观（配色）

四套配色主题，均以 CSS 变量注入 `document.body`（`data-theme` 属性标记）：

| 主题键 | 名称 | 色块 | 描述 | 强调色 --accent | 背景 --bg |
|--------|------|------|------|----------------|-----------|
| `white` | 白色 | `#ffffff` | 明亮清爽 | `#4a6cf7` | `#f7f8fa` |
| `yellow` | 黄色 | `#f59e0b` | 温暖活力 | `#d97706` | `#fffbeb` |
| `blue` | 蓝色 | `#2563eb` | 沉静专注 | `#1d4ed8` | `#eff6ff` |
| `cream` | 奶油色 | `#f5e6c8` | 柔和温馨 | `#b5852f` | `#faf3e3` |

- 持久化字段：`settings.theme`（默认 `white`），兼容无 `settings` 的旧数据。
- 校验：非法主题键拒绝保存，`currentTheme()` 读取时非法回退白色。

### 关闭工作台按钮

- 位于左侧栏底部（导航之下，`margin-top:auto` 下推至左下角）。
- 点击尝试关闭当前窗口；被浏览器策略阻断时提示用户手动关闭。

## 测试结果

```
# tests 176
# pass 176
# fail 0
# cancelled 0
# skipped 0
# duration_ms 约 380-590ms
```

**全部 176 个测试通过，0 失败。** 其中本次新增 26 个测试（theme 15 + appearance 11），原有 150 个测试全部保持通过（含 api/logic/json-convert/pdf-convert/vault）。

### 各测试文件

| 文件 | 用例数 | 结果 |
|------|--------|------|
| `test/theme.test.js`（新增） | 15 | ✅ 通过 |
| `test/appearance.test.js`（新增） | 11 | ✅ 通过 |
| 原有 5 个测试文件 | 150 | ✅ 通过 |
| **合计** | **176** | ✅ 全部通过 |

### 新增测试用例

`test/theme.test.js`（15 个）

| # | 测试 | 内容 |
|---|------|------|
| 1 | 四套预置配色齐全 | white/yellow/blue/cream，label 正确 |
| 2 | 变量键一致且含基础变量 | 四套主题 vars 键完全一致 |
| 3 | 每套主题提供 swatch/desc | 色块与描述齐全 |
| 4 | themeVars 返回对应映射 | 各主题 --accent 互不冲突 |
| 5 | normalizeTheme 非法回退白色 | 非法/空键回退 THEME_DEFAULT |
| 6 | applyTheme 无 DOM 安全 | Node 环境空元素返回规范化键 |
| 7 | defaultData 含 settings.theme=white 且通过校验 | |
| 8 | validateData 接受合法主题键 | 4 个键均通过 |
| 9 | validateData 拒绝非法 theme | 'pink' 拒绝 |
| 10 | 兼容无 settings 旧数据 | 缺失兼容，非对象拒绝 |
| 11 | currentTheme 读取/非法回退 | |
| 12 | setTheme 写入合法主题 | |
| 13 | setTheme 拒绝非法不改动 | |
| 14 | setTheme 兼容 settings 缺失 | 自动重建 settings |
| 15 | isValidTheme 白名单一致 | |

`test/appearance.test.js`（11 个）

| # | 测试 | 内容 |
|---|------|------|
| 1 | settings.js 渲染 THEMES 全部色块 | 主题项写入 dataset.theme |
| 2 | 主题选择调用 mutate 与 applyTheme | 写入 settings.theme + 应用 + 兼容缺失 |
| 3 | settings.js 引入 THEMES/applyTheme | |
| 4 | index.html 含关闭工作台按钮 | sidebar-bottom + close-workbench 存在 |
| 5 | 关闭按钮位于导航之后（底部） | sidebar-bottom 在 </nav> 之后 |
| 6 | 用户取消 → cancelled | 不调用 shutdown/window.close |
| 7 | 确认后 shutdown 成功 + 关窗可用 → closed | shutdown 调用 1 次，notify 成功提示 |
| 8 | shutdown 失败 + 关窗可用 → window-closed | |
| 9 | shutdown 失败 + 关窗不可用 → manual | notify 手动关闭提示 |
| 10 | shutdown 成功 + 关窗不可用 → closed-keep | 服务已关但标签页未关，提示手动关闭标签页 |
| 11 | closeWorkbench 浏览器包装（各分支） | shutdown 成功/失败 × window 有无 → closed-keep / manual |

## 浏览器实测（Playwright）

| 验证项 | 结果 |
|--------|------|
| 「数据与设置」页显示「🎨 工作台外观」卡片 | ✅ |
| 4 个色块（白色/黄色/蓝色/奶油色）渲染 | ✅ |
| 点击奶油色：`data-theme="cream"`、`--accent:#b5852f`、`--bg:#faf3e3` 生效并保存 | ✅ |
| 点回白色：主题即时还原 | ✅ |
| 左侧栏底部显示「关闭工作台」按钮，位于左下角（`.sidebar-bottom` 底缘=侧栏底 749.6px） | ✅ |

## 验收要点

1. 打开「数据与设置」，可见「🎨 工作台外观」卡片与四套配色色块。
2. 点击任意配色（白色/黄色/蓝色/奶油色），整个工作台配色即时变化。
3. 选择后刷新/重启，配色保持不变（已持久化到 `settings.theme`）。
4. 左侧栏最底部（左下角）有「关闭工作台」按钮。
5. 点击关闭按钮：正常关闭窗口；若被浏览器拦截则提示手动关闭。
6. 全部 170 个测试通过，0 失败。

## 备注

- 两版问题描述中配色给出「白色、黑色、蓝色」与「白色、黄色、蓝色」两版；以**最终版本**为准，采用 **白色 / 黄色 / 蓝色 + 奶油色**（黑色主题不在此次范围内）。
- 浏览器 `window.close()` 仅能关闭由脚本打开或无历史记录的窗口；被拦截时已提供友好的 toast 提示，不影响数据安全。
