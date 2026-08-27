// 工作台外观（主题）模块测试：theme.js + logic.js 中的主题设置逻辑（纯逻辑，Node 可直接 import）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES, THEME_DEFAULT, THEME_VARIABLE_KEYS,
  isThemeKey, normalizeTheme, themeVars, applyTheme
} from '../public/js/theme.js';
import {
  defaultData, validateData, currentTheme, setTheme, isValidTheme
} from '../public/js/logic.js';

// ---------- THEMES 定义（问题1核心） ----------
test('主题：四套预置配色齐全（白色/黄色/蓝色/奶油色）', () => {
  assert.deepEqual(Object.keys(THEMES), ['white', 'yellow', 'blue', 'cream']);
  assert.equal(THEMES.white.label, '白色');
  assert.equal(THEMES.yellow.label, '黄色');
  assert.equal(THEMES.blue.label, '蓝色');
  assert.equal(THEMES.cream.label, '奶油色');
});

test('主题：四套主题的变量键一致且包含基础变量', () => {
  const keys = Object.values(THEMES).map(t => Object.keys(t.vars).sort().join(','));
  const first = keys[0];
  for (const k of keys) assert.equal(k, first, '各主题变量键必须一致');
  for (const k of THEME_VARIABLE_KEYS) assert.ok(first.includes(k), `缺少变量 ${k}`);
});

test('主题：每套主题都提供可用的 swatch / desc', () => {
  for (const t of Object.values(THEMES)) {
    assert.ok(t.swatch, `${t.label} 缺少色块`);
    assert.ok(t.desc, `${t.label} 缺少描述`);
  }
});

test('主题：themeVars 返回对应主题的变量映射', () => {
  assert.equal(themeVars('blue')['--accent'], THEMES.blue.vars['--accent']);
  assert.notEqual(themeVars('blue')['--accent'], themeVars('yellow')['--accent']);
});

test('主题：normalizeTheme 非法键回退默认（白色）', () => {
  assert.equal(normalizeTheme('white'), 'white');
  assert.equal(normalizeTheme('whatever'), THEME_DEFAULT);
  assert.equal(normalizeTheme(null), THEME_DEFAULT);
  assert.equal(isThemeKey('cream'), true);
  assert.equal(isThemeKey('blood-red'), false);
});

test('主题：applyTheme 在无 DOM 元素时静默返回规范化键（Node 安全）', () => {
  assert.equal(applyTheme(null, 'blue'), 'blue');
  assert.equal(applyTheme(null, 'nope'), THEME_DEFAULT);
});

// ---------- 数据层：settings.theme 持久化（问题1逻辑） ----------
test('外观：defaultData 包含 settings.theme 默认白色，且通过校验', () => {
  const d = defaultData();
  assert.equal(d.settings.theme, 'white');
  assert.deepEqual(validateData(d), { ok: true, errors: [] });
});

test('外观：validateData 接受合法主题键 settings.theme', () => {
  for (const key of Object.keys(THEMES)) {
    const d = defaultData();
    d.settings.theme = key;
    assert.deepEqual(validateData(d), { ok: true, errors: [] });
  }
});

test('外观：validateData 拒绝非法 settings.theme', () => {
  const d = defaultData();
  d.settings.theme = 'pink';
  assert.equal(validateData(d).ok, false);
});

test('外观：兼容无 settings 旧数据（缺失/非对象拒绝）', () => {
  const d = defaultData();
  delete d.settings;
  assert.equal(validateData(d).ok, true, '缺 settings 应兼容');
  d.settings = 'oops';
  assert.equal(validateData(d).ok, false, 'settings 非对象应拒绝');
});

test('外观：currentTheme 读取 state.settings.theme，非法回退白色', () => {
  const d = defaultData();
  d.settings.theme = 'cream';
  assert.equal(currentTheme(d), 'cream');
  d.settings.theme = 'bad';
  assert.equal(currentTheme(d), THEME_DEFAULT);
  assert.equal(currentTheme({}), THEME_DEFAULT);
});

test('外观：setTheme 写入合法主题并返回 ok', () => {
  const d = defaultData();
  const r = setTheme(d, 'yellow');
  assert.equal(r.ok, true);
  assert.equal(r.theme, 'yellow');
  assert.equal(d.settings.theme, 'yellow');
});

test('外观：setTheme 拒绝非法主题，不改动 state', () => {
  const d = defaultData();
  d.settings.theme = 'white';
  const r = setTheme(d, 'pink');
  assert.equal(r.ok, false);
  assert.ok(r.error);
  assert.equal(d.settings.theme, 'white');
});

test('外观：setTheme 兼容 settings 缺失的 state（自动重建）', () => {
  const d = defaultData();
  delete d.settings;
  const r = setTheme(d, 'blue');
  assert.equal(r.ok, true);
  assert.equal(d.settings.theme, 'blue');
});

test('外观：isValidTheme 与主题键白名单一致', () => {
  for (const k of Object.keys(THEMES)) assert.equal(isValidTheme(k), true);
  assert.equal(isValidTheme('dark'), false);
});
