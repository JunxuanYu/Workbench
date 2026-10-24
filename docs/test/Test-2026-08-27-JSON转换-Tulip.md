# Test-2026-08-27-JSON转换-Tulip.md

## 功能变更：工具箱添加 JSON 转换工具

### 变更概要

在工具箱中新增 JSON 转换工具，支持 5 种操作：格式化、压缩、校验、→ CSV、→ YAML。纯浏览器端实现，无外部依赖。

### 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `public/js/tools/json-convert.js` | 新建 | JSON 转换工具模块（纯逻辑函数 + UI 渲染） |
| `public/js/pages/consult.js` | 修改 | 导入并注册 JSON 转换工具到工具箱 |

### 功能说明

#### 支持的操作

| 操作 | 说明 | 实现 |
|------|------|------|
| ✨ 格式化 | 美化 JSON 缩进 | `JSON.stringify(data, null, indent)` |
| 📦 压缩 | 压缩为单行 | `JSON.stringify(data)` |
| 🔍 校验 | 检查 JSON 语法 | `JSON.parse` + 错误位置解析 |
| 📊 → CSV | JSON 数组转 CSV 表格 | 自动收集所有键，含逗号字段自动加引号 |
| 📝 → YAML | JSON 转 YAML 格式 | 自定义递归转换（支持嵌套对象/数组/null） |

#### 技术实现

- **纯 JavaScript**：无外部依赖，使用原生 `JSON.parse/stringify`
- **CSV 转换**：自动收集所有键名作为表头，处理含逗号/引号的字段
- **YAML 转换**：递归处理对象、数组、字符串、数字、布尔、null，自动判断是否需要引号
- **校验**：解析错误消息中的 position，计算行列号
- **下载**：Blob + `<a>` 标签，支持 UTF-8 BOM

### 测试结果

```
# tests 147
# pass 147
# fail 0
# cancelled 0
# skipped 0
# duration_ms 477.707
```

**全部 147 个测试通过，0 失败。**

### 新增测试用例（32 个）

| # | 测试名称 | 测试内容 |
|---|----------|----------|
| 1 | parseJsonSafe：合法 JSON 返回 ok | 正确解析 `{a:1}` |
| 2 | parseJsonSafe：非法 JSON 返回 error | 解析 `{a:1}` 报错 |
| 3 | parseJsonSafe：空字符串返回 error | 空输入返回 invalid |
| 4 | formatJson：美化输出有缩进 | 输出含换行和缩进 |
| 5 | formatJson：自定义缩进 | 4 空格缩进 |
| 6 | formatJson：非法 JSON 抛错 | 抛出"解析失败" |
| 7 | minifyJson：压缩为单行 | 输出无换行 |
| 8 | minifyJson：非法 JSON 抛错 | 抛出"解析失败" |
| 9 | validateJson：合法 JSON 返回 valid | valid=true |
| 10 | validateJson：非法 JSON 返回位置信息 | 含 line/column |
| 11 | validateJson：空输入返回 invalid | valid=false |
| 12 | jsonToCsv：对象数组转 CSV | 表头+数据行 |
| 13 | jsonToCsv：含逗号的字段自动加引号 | CSV 转义 |
| 14 | jsonToCsv：空数组返回空字符串 | 空输入 |
| 15 | jsonToCsv：非数组对象包装为单行 | 单对象转 CSV |
| 16 | jsonToCsv：null/undefined 字段输出空 | 空值处理 |
| 17 | jsonToYaml：简单对象 | 键值对输出 |
| 18 | jsonToYaml：嵌套对象 | 缩进嵌套 |
| 19 | jsonToYaml：数组 | `- ` 前缀 |
| 20 | jsonToYaml：布尔和 null | 字面量输出 |
| 21 | jsonToYaml：非法 JSON 抛错 | 抛出"解析失败" |
| 22 | jsonToYaml：空对象/数组 | `{}` / `[]` |
| 23-28 | executeOperation 各操作 | 5 种操作 + 未知操作 |
| 29 | OPERATIONS：包含 5 种操作 | 结构校验 |
| 30 | createJsonConvertTool：返回正确结构 | id/name/icon/render |
| 31-32 | 工具箱注册验证 | JSON 工具已注册，共 2 个工具 |

### 验收要点

1. ✅ 工具箱左栏显示「🔧 JSON 转换」工具（共 2 个工具）
2. ✅ 输入 JSON 后点击操作按钮即可转换
3. ✅ 格式化：美化缩进输出
4. ✅ 压缩：单行输出
5. ✅ 校验：显示 ✓/✗ 状态及错误位置
6. ✅ → CSV：自动提取键值为表格
7. ✅ → YAML：嵌套结构正确缩进
8. ✅ 支持下载转换结果
9. ✅ 全部 147 个测试通过
