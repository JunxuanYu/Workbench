## Context

WorkLift 是无框架 Vanilla JS 单页应用：`public/index.html` 为唯一页面壳（侧边栏 + `<main id="app">`），所有页面由 `public/js/pages/*.js` 渲染，视觉样式集中在 `public/css/style.css`（全局 CSS 变量 + 共享 class：`.card` `.btn` `.row` `.modal` `.toast` `.tab` `.badge` 等）。页面 JS 极少使用内联样式（仅 consult.js 一处引用 `var(--green)` / `var(--orange)` 颜色变量）。动机见 proposal.md。

约束：只改外观、零功能影响 → 理想目标是**仅修改 style.css，不动 HTML 与 JS**。现状为扁平白底风格（`#f7f8fa` 背景 + 白色容器）。

## Goals / Non-Goals

**Goals:**
- 全部容器/控件通过纯 CSS 呈现磨砂玻璃质感与波光背景。
- 背景波光动画流畅、克制，支持 `prefers-reduced-motion` 降级。
- 保持既有 CSS 变量名（`--accent`、`--green`、`--orange`…）与 class 命名不变，保证页面 JS 与内联样式零改动仍正常。
- 不引入任何新依赖，不引入构建步骤。

**Non-Goals:**
- 不改动 DOM 结构、ID、class 命名、路由、事件、数据逻辑。
- 不做暗色模式、不做布局/间距重构、不新增交互行为。
- 不引入 CSS 框架、预处理器或 canvas/JS 动效库。

## Decisions

### D1: 波光背景用 CSS 伪元素实现，零 HTML 改动
- `html`/`body` 上设置水蓝色系静态渐变基色（若干 `linear-gradient` + `radial-gradient` 叠加，模拟水面色泽）。
- `body::before`（`position: fixed; inset: 0; z-index: -1`）承载波光高光层：大尺寸渐变 + `background-size: 200%`，用慢速 `background-position` 动画模拟水面反光流动。
- 依据标准绘制顺序，`z-index: -1` 的伪元素绘制在画布背景之上、内容之下，因此无需新增背景 div。
- **备选方案（否决）**：在 index.html 添加 `<div class="bg">` 装饰层 —— 需改动 HTML，且与"零功能影响"承诺冲突；canvas 波光 —— 引入 JS 与性能成本，超出纯外观范围。

### D2: 玻璃质感基于 CSS 变量 + `backdrop-filter`，带 `@supports` 降级
- 新增玻璃变量族：`--glass-bg`（半透明白 `rgba(255,255,255,.55~.65)`）、`--glass-border`（`rgba(255,255,255,.6)`）、`--glass-highlight`（`inset 0 1px 0 rgba(255,255,255,.55)`）。
- 大容器（`.sidebar` `.card` `.modal` `.toast` `.row` `.empty` `.date-nav` 等）应用 `backdrop-filter: blur(12px) saturate(1.4)` + 高光描边 + 柔和投影，让波光背景透出形成层次。
- 控件（`.btn`、输入框、`.tab`、`.badge`）以半透明填充 + 轻量模糊（或仅半透明、不模糊）为主，保留语义色。
- `@supports not (backdrop-filter: blur(1px))` 下回退为高不透明度（≥.92）填充，保证可读性。
- **备选方案（否决）**：无降级直接使用 —— 旧浏览器内容难以辨认；全部容器强模糊 —— 低端设备滚动卡顿。

### D3: 动画遵循性能与可访问性约束
- 波光动画 `@keyframes`：时长 10~16s、`ease-in-out infinite alternate`，只驱动 `background-position`（轻量）与可选的 `transform`，避免触发布局（layout）属性。
- `@media (prefers-reduced-motion: reduce)` 下 `animation: none`，背景定格为静态渐变。
- 不把 `backdrop-filter` 用在数量庞大的小元素上（避免合成层爆炸）；模糊仅限大容器。

### D4: 保持既有视觉契约
- 不重命名/不改值语义色变量，避免破坏 consult.js 内联 `var(--green)`/`var(--orange)` 及页面脚本中的颜色引用。
- hover / focus / active / disabled 状态保留原触发条件，仅换用玻璃质感样式（如亮度变化、高光移动）。
- 响应式断点（`max-width: 860px` 侧边栏折叠）逻辑不变，仅让玻璃样式在新布局下正常呈现。

## Risks / Trade-offs

- `backdrop-filter` 兼容性（旧 Safari/浏览器不支持）→ `@supports` 回退高不透明度填充，功能与可读性不受影响。
- 半透明容器降低对比度 → 容器填充不透明度控制在 0.55–0.65 且叠加模糊；实现后需逐页目检可读性。
- 大量模糊导致低端设备滚动卡顿 → 模糊仅用于大容器，控件用轻量半透明；动画属性限制为 `background-position`/`transform`。
- 波光动画引发重绘 → 动画缓慢且幅度克制；`prefers-reduced-motion` 关闭；必要时对伪元素使用 `will-change`（实现时按需评估，避免滥用）。
- 唯一改动文件是 style.css，若实施中确需调整 HTML（预期不需要），滚动回退即恢复原样（git 还原）。

## Migration Plan

- 纯样式变更：直接修改 `public/css/style.css` 后刷新页面即可生效，无需数据迁移或后端改动。
- 回滚：还原 style.css（git checkout），页面立即恢复原观感，无残留状态。

## Open Questions

- 波光配色深浅（偏青/偏蓝/更淡雅）属于纯观感微调，可在实现时按视觉效果微调，不影响规格与任务拆分，无需在实施前确认。
