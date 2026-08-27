# Test-2026-08-26-Tulip.md

## 功能变更：咨询工作 → 工具箱

### 变更概要

将原"咨询工作"模块（客户管理、咨询记录、待办、费用）替换为"工具箱"通用框架，支持后续按需注册小工具。

### 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `public/index.html` | 修改 | 导航项 🤝 咨询工作 → 🧰 工具箱 |
| `public/js/pages/consult.js` | 重写 | 客户管理页面 → 工具箱框架（工具注册表 + 左栏列表 + 右栏渲染区） |
| `public/js/pages/home.js` | 修改 | 首页咨询卡片 → 工具箱卡片，移除 clients 相关引用 |
| `public/js/logic.js` | 修改 | 移除 `clientFeeSummary`、`consultWeekCount`、`allPendingFees`、`consultRecordsInRange`；简化 `computeHomeSummary` |
| `test/logic.test.js` | 修改 | 移除 5 个咨询相关测试用例，更新 import 和 P8 首页摘要测试 |

### 测试结果

```
# tests 104
# pass 104
# fail 0
# cancelled 0
# skipped 0
# duration_ms 831.5942
```

**全部 104 个测试通过，0 失败。**

### 已移除的测试用例

- `P5 客户费用汇总：已收/待收分别合计`
- `P5 本周咨询次数：周一至周日统计`
- `P5 全部客户待收费用合计`
- `P8 首页摘要` 中的 `consultWeek` 和 `pendingFees` 断言
- `P8 概要：本周咨询记录预览带客户名与内容，倒序取前 N 条`

### 工具箱框架 API

```javascript
import { registerTool, getTools } from './pages/consult.js';

// 注册工具
registerTool({
  id: 'calculator',
  name: '计算器',
  icon: '🔢',
  render: (container) => { /* 渲染工具 UI */ }
});

// 获取所有已注册工具
const tools = getTools(); // [{ id, name, icon, render }]
```

### 验收要点

1. ✅ 导航栏显示 🧰 工具箱，路由 `#/consult` 仍可用
2. ✅ 工具箱页面左栏显示工具列表，右栏渲染选中工具
3. ✅ 无工具时显示"暂无工具"空状态
4. ✅ 首页工具箱卡片显示已注册工具数量
5. ✅ 数据模型中 `clients` 字段保留（向后兼容），但页面不再使用
6. ✅ 全部 104 个测试通过
