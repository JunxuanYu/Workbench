# 测试报告 - 工具箱新增 Git 使用指南（v1.2.0）

**日期**: 2026-10-31
**事项**: 工具箱新增 Git 使用指南工具（便于工作时查询 git 命令）
**执行人**: Tulip
**版本**: v1.1.1 → **v1.2.0**

---

## 一、功能实现

新增工具 `🌿 Git 指南`（`public/js/tools/git-guide.js`），注册进工具箱（PDF 转换之后第 4 位），纯前端静态数据，无网络请求、无 CDN、不读写数据文件。

### 功能点

| 功能 | 说明 |
|---|---|
| 命令速查库 | 9 大分类 **52 条**常用命令：基础操作 / 提交修改 / 分支合并 / 远程协作 / 撤销回滚 / 查看历史 / 储藏清理 / 标签发布 / 配置进阶 |
| 场景化条目 | 每条含中文场景标题 + 命令 + 可选示例 + 💡 提示；`reset --hard` / `push --force-with-lease` / `clean -fd` 等 **6 条不可逆命令**带红色「⚠ 不可逆」徽章 |
| 关键字搜索 | 中英文、不区分大小写、多词 AND（如「撤销 提交」「分支 删除」「rebase」「force」）；命中标题 / 命令 / 示例 / 提示 / 标签 / 分类名 |
| 分类页签 | 「全部 + 9 分类」标签页带实时计数，点选过滤，与搜索可组合 |
| 一键复制 | clipboard API + `execCommand` 兜底；按钮反馈「✓ 已复制」 |
| 桃夭风格 | 条目卡片、命令块、页签全部走 `style.css` 主题类，随 13 套主题联动 |

### 架构（延续工具箱「纯逻辑可单测」范式）

- 数据层：`GIT_CATEGORIES` / `GIT_COMMANDS`（静态导出）
- 逻辑层：纯函数 `searchCommands(query, category, list?)` / `countByCategory()` / `formatCommandText()` / `categoryLabel()`
- UI 层：`createGitGuideTool().render()`，动态内容全部 `textContent` 写入（防注入）

---

## 二、开发过程中发现并修复的问题

| # | 问题 | 处置 |
|---|---|---|
| 1 | **搜索框未绑定输入事件**（首版只渲染时同步一次，输入不触发过滤） | 补 `searchInput.oninput`，并新增「搜索框必须绑定 oninput」渲染冒烟测试锁定 |
| 2 | `stash-drop` 标记为危险但缺提示说明 | 补充「删除后无法恢复；先 git stash list 确认」提示，新增「危险命令必须有说明」数据测试 |
| 3 | `test/md-convert.test.js` 的工具注册顺序契约测试失败（新增第 4 个工具） | 更新预期顺序为 `pdf-convert → md-convert → json-convert → git-guide` |

---

## 三、测试执行

### 新增测试（`test/git-guide.test.js`，22 项）

| 组 | 覆盖点 |
|---|---|
| 数据完整性（5） | id 唯一 / 必填字段 / 分类合法且每类非空 / 命令互不重复 / 全部以 `git ` 开头且 ≥40 条 / 危险命令有徽章有说明 |
| 分类与复制（2） | 分类名映射（含未知 id 回退）/ 复制文本去 `$` 前缀与空白、空值安全 |
| 搜索逻辑（7） | 空查询返回全部 / 中文场景词（撤销、冲突）/ 英文大小写不敏感（rebase vs REBASE）/ 多词 AND 与词序无关 / 分类过滤可与关键词组合 / 无匹配空数组不抛错 / **无副作用**（不改动共享数据）/ 支持注入自定义列表 |
| 工具注册（2） | `createGitGuideTool` 结构契约 / 已注册进工具箱、PDF 仍为首个默认工具、无重复注册 |
| 实现约束（1） | clipboard + execCommand 兜底、`textContent` 写入命令文本、无 HTML 拼接 |
| **渲染冒烟（5，最小 DOM 桩真实调用 render）** | 初始渲染全部 52 条且每条命令以 `git ` 开头、oninput 已绑定 / 输入实时过滤且清空恢复 / 分类页签点击过滤 + 高亮互斥 / 无匹配显示引导文案 / 危险徽章渲染 |

### 文档一致性（`test/docs.test.js`，+2 项）

- 开发计划记录 v1.2.0 / `git-guide.js` / 52 条
- README 工具箱包含 Git 使用指南条目
- 版本断言升级至 1.2.0（package + lock 双处）

### 视觉冒烟（无头 Edge，1200×1500）

通过 `http://127.0.0.1:8790` 临时挂载页截图验证：标题/提示/搜索框/清空按钮/10 个分类页签（含计数 6+4+9+6+7+6+4+4+6=52）/ 统计行 / 命令卡片（徽章、命令块、复制按钮、示例、💡 提示）全部按桃夭样式正常渲染，无空白/无样式断裂。冒烟用临时挂载文件已删除，服务已停止。

> 过程备注：首次截图空白，定位为服务 CSP `script-src 'self'` 拦截内联模块脚本 —— 改为外链脚本后正常（顺带验证了 CSP 在真实环境生效）。

---

## 四、全量测试结果

| 检查 | 结果 |
|---|---|
| `node --test`（13 个测试文件） | **302 pass / 0 fail**（v1.1.1 时 281 → 新增 24，含顺序契约更新） |
| `python\.venv\Scripts\python -m unittest discover python/tests` | **78 pass / 0 fail**（含 10-25 后新增的 PDF 版式转换测试） |
| `eslint server.js public test` | **0 error / 0 warning** |
| `npm audit --omit=dev`（官方 registry） | **found 0 vulnerabilities**（本轮新披露的 qs GHSA-6pq8-jhm2-2vcw 已由 `npm audit fix` 升级 qs 6.16.0 → 6.16.2 清零；剩余 5 条 moderate 均为 dev 依赖 eslint 链，不随应用发布） |

---

## 五、相关文件更新

| 文件 | 变更 |
|---|---|
| `public/js/tools/git-guide.js` | **新增**：数据 + 纯函数 + UI（约 570 行） |
| `public/js/pages/consult.js` | 注册 Git 指南工具 |
| `public/css/style.css` | 新增 `.git-search / .git-tabs / .git-list / .git-entry / .git-cmd / .git-copy` 桃夭样式 |
| `test/git-guide.test.js` | **新增**：22 项测试 |
| `test/md-convert.test.js` | 工具注册顺序契约加入 `git-guide` |
| `test/docs.test.js` | 版本 1.2.0 + Git 指南文档一致性 2 项 |
| `package.json` / `package-lock.json` | v1.1.1 → **v1.2.0**；qs → 6.16.2（audit fix） |
| `docs/开发计划.md` | §0 增加 v1.1.1 / v1.2.0 变更记录；§2 工具箱增加 Git 指南条目 |
| `docs/optimization.md` | 执行记录追加 2026-10-31 两条 |
| `README.md` | 工具箱增加 Git 使用指南说明 |

## 六、验收清单

- [x] 工具箱出现「🌿 Git 指南」工具，打开即见 52 条命令、分类页签与搜索框
- [x] 搜索中英文/多词组合可用，输入实时过滤，无结果有引导文案
- [x] 分类页签计数正确、高亮互斥、可与搜索组合
- [x] 一键复制命令（含兜底方案），危险命令有红色警示
- [x] 桃夭主题样式统一，随主题变量联动，无硬编码颜色
- [x] 未触碰任何既有功能：数据流、路由、其他工具测试全部保持通过
- [x] Node 302 / Python 78 / lint 0 / 生产依赖审计 0 漏洞

## 七、结论

Git 使用指南已按工具箱标准范式（静态数据 + 可单测纯函数 + 主题化 UI）落地为第 4 个内置工具。开发过程中由测试驱动修复了搜索框事件缺失与危险命令提示缺失两处真实缺陷；工具注册顺序契约同步更新。全量 302 Node + 78 Python 测试通过，生产依赖审计清零，v1.2.0 可作为下一版本迭代基线。

**后续可扩展**（未在本轮实现）：命令条目按使用频次置顶、常用命令收藏（存入 `state.settings`）、`git flow` / `worktree` 场景专题。
