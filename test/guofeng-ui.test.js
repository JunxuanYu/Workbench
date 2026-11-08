// 问题：国风 UI/UX 精修（按钮 · 图标美化）静态回归测试
// 纯外观层改动（CSS / 图标字符），不触碰任何交互与功能逻辑；
// 本测试同时充当“只改外观”守卫：结构与路由必须保持原样。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CSS = readFileSync(join(root, 'public/css/style.css'), 'utf8');
const INDEX = readFileSync(join(root, 'public/index.html'), 'utf8');

// ---------- 国风图标：篆印（汉字印章）导航图标 ----------
const SEAL_ICONS = [
  ['home', '览', '首页总览'],
  ['today', '计', '今日计划'],
  ['dev', '匠', '开发工作'],
  ['consult', '具', '工具箱'],
  ['notes', '笔', '个人笔记'],
  ['money', '账', '账目计划'],
  ['settings', '设', '数据与设置'],
];

test('国风图标：导航图标改为篆印汉字（览/计/匠/具/笔/账/设），文案与结构不变', () => {
  for (const [route, char, label] of SEAL_ICONS) {
    const re = new RegExp(
      `<a class="nav-item" data-route="${route}" href="#/${route}"` +
        `><span class="nav-icon">${char}</span>${label}</a>`,
    );
    assert.match(INDEX, re, `导航 ${route} 应为印章字「${char}」且文案仍为「${label}」`);
  }
});

test('国风图标：侧栏导航图标不再使用 emoji（已换为国风印章字）', () => {
  // 覆盖常见 emoji 区段：符号、补充符号、装饰符号
  const emojiLike = /class="nav-icon">[^<]*[\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u;
  const icons = [...INDEX.matchAll(/class="nav-icon">([^<]+)</g)].map((m) => m[1]);
  assert.ok(icons.length >= 7, '应有 7 个导航图标');
  for (const icon of icons) {
    assert.doesNotMatch(icon, emojiLike, `图标「${icon}」不应再是 emoji`);
  }
});

test('国风样式：印章图标 .nav-icon 规则存在（衬线字体 + 印边描色 + 激活态朱砂渐变）', () => {
  // 取样式表中“最后一处” .nav-icon 主规则（国风精修段），避免匹配早期覆盖规则
  const start = CSS.lastIndexOf('\n.nav-icon {');
  const block = CSS.slice(start, CSS.indexOf('}', start));
  assert.ok(block.includes("'Songti SC'"), '印章字体应为衬线（宋体）系');
  assert.ok(block.includes('var(--accent-dark)'), '印字颜色应跟随主题 accent-dark');
  assert.ok(block.includes('color-mix(in srgb, var(--accent)'), '印章描边应随主题强调色变化');
  assert.ok(CSS.includes('.nav-item.active .nav-icon'), '激活态印章样式应存在');
  const activeStart = CSS.indexOf('.nav-item.active .nav-icon {');
  const activeBlock = CSS.slice(activeStart, CSS.indexOf('}', activeStart));
  assert.ok(/linear-gradient\(160deg, #d37a8e/.test(activeBlock), '激活印章应为朱砂渐变');
});

test('国风样式：关闭按钮「阖」印记样式存在（描边小方印）', () => {
  assert.ok(INDEX.includes('<span>阖</span>关闭工作台'), '关闭按钮图标应为「阖」且文案不变');
  assert.match(CSS, /\.close-workbench-btn > span\s*\{/);
  const start = CSS.indexOf('.close-workbench-btn > span {');
  const block = CSS.slice(start, CSS.indexOf('}', start));
  assert.ok(block.includes('border: 1px solid currentColor'), '印记应有描边');
});

test('国风样式：日期导航图标为国风「历」字符（不再是 emoji 📅）', () => {
  assert.match(CSS, /content: '历'/);
  assert.doesNotMatch(CSS, /content: '📅'/);
});

// ---------- 国风按钮：朱砂质感 ----------
test('国风样式：按钮具备朱砂质感（顶部高光 + 主/危险按钮釉面 + 描金 hover）', () => {
  assert.match(CSS, /inset 0 1px 0 rgba\(255, 255, 255, 0\.85\)/, '.btn 顶部高光应存在');
  const glossStart = CSS.indexOf('.btn-primary::after,\n.btn-danger::after {');
  assert.notEqual(glossStart, -1, '主/危险按钮釉面高光规则应存在');
  const glossBlock = CSS.slice(glossStart, CSS.indexOf('}', glossStart));
  assert.ok(glossBlock.includes('pointer-events: none'), '釉面装饰不得拦截点击行为');
  assert.match(CSS, /\.btn:disabled::after\s*\{\s*display: none/, '禁用态应关闭釉面装饰');
  const iconHover = CSS.slice(CSS.indexOf('.btn-icon:hover {'));
  assert.ok(
    iconHover.includes('box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent)'),
    '图标按钮 hover 应有描金内环',
  );
});

test('国风样式：标签页激活态与原生控件的国风点缀存在', () => {
  assert.match(CSS, /\.tab\.active::after\s*\{/);
  const tabStart = CSS.indexOf('.tab.active::after {');
  const tabBlock = CSS.slice(tabStart, CSS.indexOf('}', tabStart));
  assert.ok(tabBlock.includes('pointer-events: none'), '标签页釉面不得拦截点击');
  assert.match(CSS, /accent-color: var\(--accent\)/, '复选框/单选框应使用主题强调色');
});

// ---------- 只改外观守卫 ----------
test('只改外观：路由结构、品牌、关闭按钮、应用挂载点全部保持原样', () => {
  const routes = ['home', 'today', 'dev', 'consult', 'notes', 'money', 'settings'];
  assert.deepEqual(routes.filter((r) => INDEX.includes(`data-route="${r}"`)).length, routes.length);
  for (const [, , label] of SEAL_ICONS) {
    assert.ok(INDEX.includes(label), `导航文案「${label}」应保持不变`);
  }
  assert.ok(INDEX.includes('id="app"'));
  assert.ok(INDEX.includes('close-workbench'));
  assert.ok(INDEX.includes('关闭工作台'));
});
