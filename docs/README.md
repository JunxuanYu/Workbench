# WorkLift 文档索引

> 根目录的 `README.md` 只保留快速开始与功能概览；需求、架构、优化记录和测试报告统一放在 `docs/`。

## 核心文档

- [PRD](PRD.md)：当前产品范围、模块、页面与验收标准。
- [开发计划](开发计划.md)：技术选型、项目结构、数据模型、迭代阶段与测试清单。
- [优化记录](optimization.md)：历史优化项与背景说明。
- [测试报告](test/)：按日期归档的功能验收与安全测试报告。

## 目录约定

```text
docs/
├── README.md          # 本索引
├── PRD.md             # 需求依据
├── 开发计划.md         # 实现与架构说明
├── optimization.md    # 优化记录
└── test/
    ├── Test-日期-事项-Tulip.md       # 功能/迭代验收
    └── SafeTest-日期-安全测试-tulip.md # 安全测试
```

## 维护规则

1. 新增功能先更新 `PRD.md`，再更新 `开发计划.md` 与代码。
2. 每次功能验收在 `docs/test/` 新增 `Test-YYYY-MM-DD-事项-Tulip.md`。
3. 安全相关改动同时更新 `SafeTest-YYYY-MM-DD-安全测试-tulip.md`。
4. 根目录不存放测试日志、服务日志、Playwright 快照等运行产物。
