// 数据与设置 -> 工作台外观(问题1) 与 左栏关闭按钮(问题2) 功能测试
// 纯逻辑/静态结构断言，Node 可直接运行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEMES } from '../public/js/theme.js';
import { runCloseFlow, closeWorkbench, CLOSE_MESSAGE, MANUAL_MESSAGE } from '../public/js/close-workbench.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SETTINGS_JS = readFileSync(join(__dirname, '..', 'public', 'js', 'pages', 'settings.js'), 'utf8');

// ---------- 问题1：页面外观选择 UI ----------
test('外观设置：settings.js 渲染了 THEMES 中全部主题色块', () => {
  for (const key of Object.keys(THEMES)) {
    assert.ok(SETTINGS_JS.includes(`dataset.theme = key`), '主题项应写入 dataset.theme');
  }
});

test('外观设置：主题选择调用 mutate 与 applyTheme（即时生效+自动保存）', () => {
  assert.ok(SETTINGS_JS.includes("s.settings.theme = key"), '点击后应写入 state.settings.theme');
  assert.ok(SETTINGS_JS.includes('applyTheme(document.body, key)'), '点击后应应用主题');
  assert.ok(SETTINGS_JS.includes("s.settings = s.settings || {}"), '应兼容 settings 缺失');
});

test('外观设置：settings.js 已引入 THEMES 与 applyTheme', () => {
  assert.ok(SETTINGS_JS.includes("import { THEMES, applyTheme } from '../theme.js'") ||
          SETTINGS_JS.includes("THEMES, applyTheme"));
});

// ---------- 问题2：左栏底部关闭按钮 ----------
test('关闭按钮：index.html 底部包含关闭工作台按钮（左下角）', () => {
  assert.match(INDEX_HTML, /sidebar-bottom/);
  assert.match(INDEX_HTML, /close-workbench/);
  assert.match(INDEX_HTML, /整理关闭工作台|关闭工作台/);
});

test('关闭按钮：按钮位于导航之后（sidebar 底部，margin-top:auto 下推）', () => {
  const navIdx = INDEX_HTML.indexOf('</nav>');
  const bottomIdx = INDEX_HTML.indexOf('sidebar-bottom');
  assert.ok(navIdx !== -1 && bottomIdx !== -1, 'nav 与 sidebar-bottom 均存在');
  assert.ok(bottomIdx > navIdx, '关闭按钮应位于导航之后');
});

test('关闭流程：用户取消 → cancelled 且不调用 shutdown/window.close', async () => {
  let shutdownCalled = 0;
  let closeCalled = 0;
  const r = await runCloseFlow({
    confirm: async () => false,
    shutdown: async () => { shutdownCalled++; },
    closeWindow: () => { closeCalled++; return true; }
  });
  assert.equal(r.status, 'cancelled');
  assert.equal(r.message, null);
  assert.equal(shutdownCalled, 0);
  assert.equal(closeCalled, 0);
});

test('关闭流程：确认后调用 shutdown 并 notify 成功提示', async () => {
  let shutdownCalled = 0;
  let notified = null;
  const r = await runCloseFlow({
    confirm: async () => true,
    shutdown: async () => { shutdownCalled++; },
    closeWindow: () => true,
    notify: (m) => { notified = m; }
  });
  assert.equal(shutdownCalled, 1);
  assert.equal(r.status, 'closed');
  assert.equal(notified, CLOSE_MESSAGE);
});

test('关闭流程：shutdown 失败且 window.close 成功 → window-closed', async () => {
  const r = await runCloseFlow({
    confirm: async () => true,
    shutdown: async () => { throw new Error('shutdown unsupported'); },
    closeWindow: () => true,
    notify: () => {}
  });
  assert.equal(r.status, 'window-closed');
});

test('关闭流程：shutdown 失败且 window.close 不可用 → manual', async () => {
  let notified = null;
  const r = await runCloseFlow({
    confirm: async () => true,
    shutdown: async () => { throw new Error('shutdown unsupported'); },
    closeWindow: () => false,
    notify: (m) => { notified = m; }
  });
  assert.equal(r.status, 'manual');
  assert.equal(notified, MANUAL_MESSAGE);
});

test('关闭流程：shutdown 成功 + window 不可关 → closed-keep（服务已关但标签页未关，提示手动关）', async () => {
  let closeCalled = 0;
  const r = await runCloseFlow({
    confirm: async () => true,
    shutdown: async () => {},
    closeWindow: () => { closeCalled++; return false; }
  });
  assert.equal(r.status, 'closed-keep');
  assert.equal(closeCalled, 1);
});

test('关闭流程：closeWorkbench 浏览器包装（shutdown 成功 + 无 window）→ closed-keep', async () => {
  const r = await closeWorkbench({
    confirm: async () => true,
    flushSave: async () => {},
    shutdown: async () => {},
    window: null
  }, () => {});
  assert.equal(r.status, 'closed-keep');
});

test('关闭流程：closeWorkbench 浏览器包装（shutdown 失败 + 无 window 可关）→ manual', async () => {
  const r = await closeWorkbench({
    confirm: async () => true,
    flushSave: async () => {},
    shutdown: async () => { throw new Error('down'); },
    window: null
  }, () => {});
  assert.equal(r.status, 'manual');
});
