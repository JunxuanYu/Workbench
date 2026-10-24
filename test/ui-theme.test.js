// 问题2：工作台视觉升级（桃夭国风）静态回归测试
// 仅验证样式与主题定义，不触碰页面行为；确保“只改外观”的约束可被持续检查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEMES, THEME_DEFAULT, THEME_VARIABLE_KEYS, themeVars } from '../public/js/theme.js';
import { defaultData } from '../public/js/logic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CSS = readFileSync(join(root, 'public/css/style.css'), 'utf8');
const INDEX = readFileSync(join(root, 'public/index.html'), 'utf8');
const SETTINGS = readFileSync(join(root, 'public/js/pages/settings.js'), 'utf8');

test('桃夭主题：默认主题为 peach，且是第一套配色（设置页优先展示）', () => {
  assert.equal(THEME_DEFAULT, 'peach');
  assert.equal(Object.keys(THEMES)[0], 'peach');
  assert.equal(defaultData().settings.theme, 'peach');
  assert.equal(THEMES.peach.label, '桃夭');
  assert.equal(THEMES.peach.swatch, '#e58aa0');
});

test('桃夭主题：九项 CSS 变量齐全，色值属于桃粉/暖白体系', () => {
  const vars = themeVars('peach');
  for (const key of THEME_VARIABLE_KEYS) assert.ok(vars[key], `缺少 ${key}`);
  assert.equal(vars['--accent'], '#c25b72');
  assert.equal(vars['--accent-dark'], '#a8455c');
  assert.equal(vars['--bg'], '#fdf6f5');
  assert.equal(vars['--panel'], '#fffcfc');
  assert.equal(vars['--nav-active'], '#fbe6eb');
});

test('桃夭主题：设置页仍遍历 THEMES，桃夭会作为可选项渲染', () => {
  assert.ok(SETTINGS.includes('Object.entries(THEMES)'));
  assert.ok(SETTINGS.includes('theme-option'));
  assert.ok(SETTINGS.includes('dataset.theme = key'));
});

test('全局样式：默认变量已是桃夭色，且关键变量均有声明', () => {
  const rootBlock = CSS.slice(CSS.indexOf(':root'), CSS.indexOf('}', CSS.indexOf(':root')));
  for (const [key, value] of Object.entries(themeVars('peach'))) {
    assert.ok(rootBlock.includes(`${key}:`) || CSS.includes(`${key}:`), `CSS 未声明 ${key}`);
    assert.ok(CSS.includes(value), `CSS 未使用桃夭色值 ${value}`);
  }
});

test('全局样式：所有 var(--x) 引用都已声明，避免视觉变量拼写错误', () => {
  const declared = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...CSS.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], `存在未声明的 CSS 变量：${missing.join(', ')}`);
});

test('全局样式：桃夭视觉关键规则存在（宣纸背景/侧栏/标题/卡片/主按钮）', () => {
  assert.match(CSS, /body::before/);
  assert.match(CSS, /\.sidebar::before/);
  assert.match(CSS, /\.brand::after/);
  assert.match(CSS, /h1\.page-title::after/);
  assert.match(CSS, /\.nav-item\.active::before/);
  assert.match(CSS, /linear-gradient\(135deg, #d37a8e/);
  assert.match(CSS, /\.card:hover/);
  assert.match(CSS, /\.theme-swatch/);
  assert.match(CSS, /prefers-reduced-motion/);
});

test('全局样式：笔记页样式完整，且窄屏单列适配', () => {
  for (const cls of [
    '.notes-layout',
    '.notes-sidebar',
    '.note-item',
    '.note-outline',
    '.notes-article',
    '.markdown-body',
    '.markdown-body pre',
    '.markdown-body table',
  ]) {
    assert.ok(CSS.includes(cls), `缺少笔记样式 ${cls}`);
  }
  assert.match(CSS, /@media \(max-width: 860px\)[\s\S]*notes-layout[\s\S]*grid-template-columns: 1fr/);
});

test('只改外观：导航结构、笔记入口与核心功能入口保持存在', () => {
  for (const route of ['home', 'today', 'dev', 'consult', 'notes', 'money', 'settings']) {
    assert.ok(INDEX.includes(`data-route="${route}"`), `缺少导航 ${route}`);
  }
  assert.ok(INDEX.includes('id="app"'));
  assert.ok(INDEX.includes('close-workbench'));
});
