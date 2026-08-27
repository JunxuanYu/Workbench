# Test-2026-08-27-Tulip.md

## 功能变更：工具箱添加 PDF 转换工具

### 变更概要

在工具箱中新增 PDF 转换工具，支持将 PDF 文件转换为 5 种格式：Word、图片、Excel、PPT、TXT。使用 pdf.js（CDN）在浏览器端完成解析和转换。

### 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `public/js/tools/pdf-convert.js` | 新建 | PDF 转换工具模块：pdf.js 动态加载 + 5 种格式转换器 |
| `public/js/pages/consult.js` | 修改 | 导入并注册 PDF 转换工具到工具箱 |

### 功能说明

#### 支持的转换格式

| 格式 | 输出文件 | 实现方式 |
|------|----------|----------|
| Word (.doc) | HTML 格式（Word 可直接打开） | 页面图片嵌入 + 文本提取 |
| 图片 (.png) | 逐页 PNG 图片 | Canvas 渲染 |
| Excel (.csv) | CSV 表格 | 文本按页提取，逗号分隔字段 |
| PPT (.ppt) | HTML 幻灯片（浏览器/PowerPoint 可打开） | 页面图片 + 翻页样式 |
| TXT (.txt) | 纯文本 | pdf.js 文本层提取 |

#### 技术实现

- **pdf.js**：通过 CDN 动态加载（`cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174`）
- **页面渲染**：Canvas 绘制 → `toDataURL('image/png')`
- **文件下载**：Blob + `<a>` 标签 `download` 属性
- **文本提取**：`page.getTextContent()` → 拼接文本

### 测试结果

```
# tests 115
# pass 115
# fail 0
# cancelled 0
# skipped 0
# duration_ms 432.3588
```

**全部 115 个测试通过，0 失败。**

### 新增测试用例（11 个）

| # | 测试名称 | 测试内容 |
|---|----------|----------|
| 1 | 工具注册表：导入成功 | registerTool / getTools 函数可导入 |
| 2 | 工具注册表：getTools 返回数组 | 返回值为数组，至少包含 1 个工具 |
| 3 | 工具注册表：PDF 转换工具已自动注册 | pdf-convert 工具自动注册，结构正确 |
| 4 | 工具注册表：重复注册同 id 抛错 | 同 id 注册抛出"已注册"错误 |
| 5 | 工具注册表：缺字段抛错 | 缺少 id/name/render 抛出"必须包含"错误 |
| 6 | PDF 工具：导入成功 | createPdfConvertTool / FORMAT_OPTIONS / convertTxt 可导入 |
| 7 | PDF 工具：createPdfConvertTool 返回正确结构 | id/name/icon/render 字段完整 |
| 8 | PDF 工具：FORMAT_OPTIONS 包含 5 种格式 | word/image/excel/ppt/txt 五种格式定义完整 |
| 9 | convertTxt：提取文本，包含页码标记 | 多页文本提取，含"第 N 页"标记 |
| 10 | convertTxt：空 PDF 返回空内容 | 空页面数组返回空 Blob |
| 11 | convertTxt：单页 PDF 只有一个页码标记 | 单页时只有"第 1 页" |

### 验收要点

1. ✅ 工具箱左栏显示「📑 PDF 转换」工具
2. ✅ 选择 PDF 文件后显示 5 个转换按钮
3. ✅ TXT 转换：提取全文文本，按页分隔
4. ✅ 图片转换：逐页渲染为 PNG，提供预览和下载
5. ✅ Word 转换：生成 HTML 格式 .doc 文件（Word 可打开）
6. ✅ Excel 转换：提取文本为 CSV 格式
7. ✅ PPT 转换：生成 HTML 幻灯片格式
8. ✅ 全部 115 个测试通过
