## 1. 背景波光层

- [ ] 1.1 在 `public/css/style.css` 的 `:root` 增加玻璃变量族：`--glass-bg`（半透明白）、`--glass-bg-strong`（更高不透明度）、`--glass-border`（高光描边色）、`--glass-highlight`（内高光）、`--glass-blur`（模糊半径）
- [ ] 1.2 将 `body` 背景由纯色 `#f7f8fa` 改为水蓝色系渐变基色（`linear-gradient` + `radial-gradient` 叠加，保留背景承载能力）
- [ ] 1.3 添加 `body::before` 波光高光层（`position: fixed; inset: 0; z-index: -1`，大尺寸渐变 + `background-size: 200%`）并编写 `@keyframes` 波光动画（10~16s、`ease-in-out infinite alternate`、仅驱动 `background-position`/`transform`）
- [ ] 1.4 添加 `@media (prefers-reduced-motion: reduce)` 规则：`animation: none`，背景定格为静态渐变
- [ ] 1.5 添加 `@supports not (backdrop-filter: blur(1px))` 回退规则：容器与背景使用高不透明度填充，保证可读性

## 2. 容器玻璃质感

- [ ] 2.1 `.sidebar`：半透明磨砂填充 + `backdrop-filter: blur(...) saturate(...)` + 高光描边 + 柔和投影；`.nav-item` hover/active 改为玻璃高亮反馈（保留 `.active` 主色语义）
- [ ] 2.2 `.card`：磨砂玻璃化（半透明填充 + 背景模糊 + 高光描边 + 投影），保留原有内边距与圆角
- [ ] 2.3 `.modal` 与 `.modal-overlay`：弹窗磨砂玻璃化，遮罩适度加深保证弹窗与背景层次
- [ ] 2.4 `.toast`：磨砂玻璃化（保持深色底对比与半透明动画 `opacity` 逻辑不变）
- [ ] 2.5 `.row`、`.empty`、`.date-nav`、`.tabs` 等辅助容器：统一玻璃质感，保持原有间距、圆角与交互

## 3. 控件玻璃质感

- [ ] 3.1 `.btn` 系列（含 `.btn-primary` `.btn-danger` `.btn-sm` `.btn-ghost` `.btn-icon`）：半透明玻璃化，保留语义色与 hover/disabled 状态行为
- [ ] 3.2 `input/select/textarea`：半透明磨砂填充 + `focus` 主色描边（`border-color: var(--accent)` 逻辑不变）
- [ ] 3.3 `.tab` 与 `.badge` 系列：保留语义色（主/绿/橙/红/灰），仅表面质感玻璃化
- [ ] 3.4 校验 consult.js 内联 `var(--green)`/`var(--orange)` 等颜色引用在新背景下仍可读（若不可读仅微调变量值，不改 JS）

## 4. 可读性与回归验证

- [ ] 4.1 逐页目检（home / today / dev / consult / diet / money / settings）：文字可读性、玻璃层次、无遮挡、无布局位移
- [ ] 4.2 验证窄窗口（≤860px）侧边栏折叠后玻璃效果正常呈现
- [ ] 4.3 验证 `prefers-reduced-motion` 下波光动画关闭、静态背景正常
- [ ] 4.4 功能回归：路由切换、日期切换、增删改查、弹窗确认、Toast、标签页切换等交互与改造前行为一致
- [ ] 4.5 确认改动仅涉及 `public/css/style.css`（预期不动 index.html 与 js；如有意外改动需说明理由）
