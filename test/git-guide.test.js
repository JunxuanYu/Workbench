// Git 使用指南工具测试（Node 可直接运行）
//   1. 数据完整性：分类完整、id 唯一、命令/标题非空
//   2. 查询纯函数：关键字搜索（中英文/多词 AND）、分类过滤、不改动原数据
//   3. 复制文本与工具注册契约
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_CATEGORY,
  GIT_CATEGORIES,
  GIT_COMMANDS,
  categoryLabel,
  countByCategory,
  createGitGuideTool,
  formatCommandText,
  searchCommands,
} from '../public/js/tools/git-guide.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 最小 DOM 桩（用于真实调用 render，验证搜索/分类交互） ----------
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this._text = '';
    this.className = '';
    const cls = new Set();
    this.classList = {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      has: (c) => cls.has(c),
      toggle: (c, on) => {
        const next = on === undefined ? !cls.has(c) : Boolean(on);
        if (next) cls.add(c);
        else cls.delete(c);
      },
    };
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  append(...nodes) {
    for (const n of nodes) {
      if (!n) continue;
      n.parent = this;
      this.children.push(n);
    }
  }
  appendChild(n) {
    this.append(n);
    return n;
  }
  setAttribute(k, v) {
    this[k] = v;
  }
  focus() {}
  select() {}
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
}

function walk(node, out = []) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: (tag) => new El(tag),
    body: new El('body'),
    head: new El('head'),
    getElementById: () => null,
    querySelector: () => null,
  };
}

// ---------- 数据完整性 ----------
test('数据：命令 id 唯一且必填字段完整', () => {
  const ids = GIT_COMMANDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, '存在重复 id');
  for (const item of GIT_COMMANDS) {
    assert.ok(item.id, '缺少 id');
    assert.ok(item.title && item.title.trim(), `${item.id} 缺少 title`);
    assert.ok(item.command && item.command.trim(), `${item.id} 缺少 command`);
    assert.ok(Array.isArray(item.tags) && item.tags.length > 0, `${item.id} 缺少 tags（影响可搜索性）`);
  }
});

test('数据：分类合法、每个分类都有命令、命令互不重复', () => {
  const validCategories = new Set(GIT_CATEGORIES.map((c) => c.id));
  const counts = countByCategory();
  for (const item of GIT_COMMANDS) {
    assert.ok(validCategories.has(item.category), `${item.id} 的分类 ${item.category} 不在 GIT_CATEGORIES 中`);
    assert.equal(counts[item.category] > 0, true, `分类 ${item.category} 统计为 0`);
  }
  assert.equal(counts[ALL_CATEGORY], GIT_COMMANDS.length);
  const sum = GIT_CATEGORIES.reduce((n, c) => n + counts[c.id], 0);
  assert.equal(sum, GIT_COMMANDS.length, '分类计数之和应等于命令总数');

  const commands = GIT_COMMANDS.map((c) => c.command);
  assert.equal(new Set(commands).size, commands.length, '存在完全重复的命令');
});

test('数据：所有命令都以 git 开头（可直接粘贴执行）', () => {
  for (const item of GIT_COMMANDS) {
    assert.match(item.command, /^git\s/, `${item.id} 的命令不是 git 子命令：${item.command}`);
  }
  assert.ok(GIT_COMMANDS.length >= 40, `命令数量偏少（当前 ${GIT_COMMANDS.length}），不足以覆盖日常工作`);
});

test('数据：危险命令有警示标记与说明', () => {
  const dangerous = GIT_COMMANDS.filter((c) => c.danger);
  assert.ok(dangerous.length >= 3, '应有若干条不可逆命令被标记');
  for (const item of dangerous) {
    assert.ok(item.note, `${item.id} 标记为危险但未给出提示说明`);
  }
});

test('分类名映射：已知 id 返回中文名，未知 id 原样返回', () => {
  assert.equal(categoryLabel('undo'), '撤销回滚');
  assert.equal(categoryLabel('branch'), '分支合并');
  assert.equal(categoryLabel('nope'), 'nope');
});

// ---------- 搜索纯函数 ----------
test('搜索：空查询返回全部命令', () => {
  assert.equal(searchCommands('').length, GIT_COMMANDS.length);
  assert.equal(searchCommands('   ').length, GIT_COMMANDS.length);
  assert.equal(searchCommands(null).length, GIT_COMMANDS.length);
});

test('搜索：中文场景词命中（撤销 / 冲突）', () => {
  const undoIds = searchCommands('撤销').map((c) => c.id);
  assert.ok(undoIds.includes('reset-soft'), '「撤销」应命中撤销提交');
  assert.ok(undoIds.includes('revert'), '「撤销」应命中 revert');
  const conflictIds = searchCommands('冲突').map((c) => c.id);
  assert.ok(conflictIds.includes('conflict'));
});

test('搜索：英文命令不区分大小写', () => {
  const lower = searchCommands('rebase').map((c) => c.id);
  const upper = searchCommands('REBASE').map((c) => c.id);
  assert.deepEqual(upper, lower);
  assert.ok(lower.includes('rebase'));
  assert.ok(lower.includes('rebase-i'));
});

test('搜索：多个词需同时命中（AND），顺序无关', () => {
  const a = searchCommands('分支 删除').map((c) => c.id);
  const b = searchCommands('删除 分支').map((c) => c.id);
  assert.deepEqual(b, a, '词序不应影响结果');
  assert.ok(a.includes('branch-delete'), '「分支 删除」应命中删除分支');
  // 性质断言：每条结果都必须同时包含两个词（含分类名/标签）
  for (const id of a) {
    const item = GIT_COMMANDS.find((c) => c.id === id);
    const hay = [
      item.title,
      item.command,
      item.example || '',
      item.note || '',
      item.tags.join(' '),
      categoryLabel(item.category),
    ]
      .join(' ')
      .toLowerCase();
    assert.ok(hay.includes('分支') && hay.includes('删除'), `${id} 未同时包含两个检索词`);
  }
  assert.ok(!a.includes('commit'), '不含「分支/删除」的提交命令应被过滤');
});

test('搜索：按分类过滤，且可与关键词组合', () => {
  const branchOnly = searchCommands('', 'branch');
  assert.ok(branchOnly.length > 0);
  assert.ok(branchOnly.every((c) => c.category === 'branch'));
  const inUndo = searchCommands('git', 'undo');
  assert.ok(inUndo.every((c) => c.category === 'undo'));
  assert.equal(inUndo.length, countByCategory().undo);
});

test('搜索：无匹配返回空数组（不抛错）', () => {
  assert.deepEqual(searchCommands('这个命令一定不存在xyz'), []);
  assert.deepEqual(searchCommands('zzzz', 'tag'), []);
});

test('搜索：不修改原数据（无副作用）', () => {
  const snapshot = JSON.stringify(GIT_COMMANDS);
  const result = searchCommands('rebase', 'branch');
  result.push({ id: 'mutated' });
  searchCommands('撤销');
  assert.equal(JSON.stringify(GIT_COMMANDS), snapshot, '搜索不应改动共享数据');
});

test('搜索：可注入自定义列表（便于扩展与测试）', () => {
  const custom = [{ id: 'x', category: 'basic', title: '测试条目', command: 'git x', tags: ['测试'] }];
  assert.equal(searchCommands('测试', ALL_CATEGORY, custom).length, 1);
  assert.equal(searchCommands('不存在', ALL_CATEGORY, custom).length, 0);
});

// ---------- 复制文本 ----------
test('复制文本：去掉 $ 前缀与首尾空白，空值安全', () => {
  assert.equal(formatCommandText('  git status  '), 'git status');
  assert.equal(formatCommandText('$ git log --oneline'), 'git log --oneline');
  assert.equal(formatCommandText(''), '');
  assert.equal(formatCommandText(null), '');
  assert.equal(formatCommandText(undefined), '');
});

// ---------- 工具注册 ----------
test('工具入口：createGitGuideTool 返回正确结构', () => {
  const tool = createGitGuideTool();
  assert.equal(tool.id, 'git-guide');
  assert.equal(tool.name, 'Git 指南');
  assert.equal(tool.icon, '🌿');
  assert.equal(typeof tool.render, 'function');
});

test('工具注册：工具箱已自动注册 Git 指南，且 PDF 仍为首个工具', async () => {
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
      createElement() {
        return { style: {}, classList: { add() {} }, append() {}, setAttribute() {} };
      },
      head: { append() {} },
      querySelector() {
        return null;
      },
    };
  }
  const mod = await import('../public/js/pages/consult.js');
  const tools = mod.getTools();
  const ids = tools.map((t) => t.id);
  assert.ok(ids.includes('git-guide'), 'git-guide 应已注册');
  assert.equal(ids[0], 'pdf-convert', 'PDF 转换仍应为默认选中的首个工具');
  assert.equal(new Set(ids).size, ids.length, '不应重复注册');
});

// ---------- 实现约束 ----------
test('实现：动态内容用 textContent，条目样式走 CSS 类而非内联硬编码', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tools', 'git-guide.js'), 'utf8');
  assert.ok(src.includes('navigator.clipboard'), '复制应使用 navigator.clipboard');
  assert.ok(src.includes('document.execCommand'), '应提供剪贴板兜底方案');
  assert.ok(src.includes('textContent = formatCommandText'), '命令文本应通过 textContent 写入（防注入）');
  assert.ok(src.includes("entry.className = 'git-entry'"), '条目应使用 .git-entry 类');
  assert.ok(!src.includes('dangerouslySetInnerHTML') && !src.includes('.innerHTML = `'), '不得拼接 HTML');
});

// ---------- 渲染冒烟（真实调用 render，验证搜索框与分类页签的联动） ----------
function renderInto() {
  const container = new El('div');
  createGitGuideTool().render(container);
  const nodes = walk(container);
  return {
    container,
    nodes,
    list: nodes.find((n) => n.className === 'git-list'),
    meta: nodes.find((n) => n.tagName === 'DIV' && /共 \d+ 条命令|没有匹配/.test(n._text)),
    search: nodes.find((n) => n.tagName === 'INPUT'),
    tab: (id) => nodes.find((n) => n.dataset && n.dataset.category === id),
  };
}

test('渲染：初始展示全部命令，每条含命令文本，搜索框已绑定输入事件', () => {
  const ui = renderInto();
  assert.ok(ui.list.children.length >= 40, `初始应列出全部命令，实际 ${ui.list.children.length} 条`);
  assert.equal(ui.list.children.length, GIT_COMMANDS.length);
  assert.equal(typeof ui.search.oninput, 'function', '搜索框必须绑定 oninput，否则输入不生效');
  const firstCmd = walk(ui.list.children[0]).find((n) => n.tagName === 'CODE');
  assert.match(firstCmd.textContent, /^git\s/);
});

test('渲染：输入关键词后列表实时过滤，清空后恢复全部', () => {
  const ui = renderInto();
  ui.search.value = 'rebase';
  ui.search.oninput();
  assert.ok(ui.list.children.length > 0 && ui.list.children.length < GIT_COMMANDS.length, '应按关键词收敛结果');
  const texts = walk(ui.list)
    .map((n) => n._text)
    .join(' ');
  assert.match(texts, /rebase/i);
  ui.search.value = '';
  ui.search.oninput();
  assert.equal(ui.list.children.length, GIT_COMMANDS.length, '清空关键词应恢复全部');
});

test('渲染：点击分类页签只显示该分类，页签高亮互斥', () => {
  const ui = renderInto();
  const undo = ui.tab('undo');
  undo.onclick();
  assert.equal(ui.list.children.length, countByCategory().undo);
  assert.ok(undo.classList.has('active'), '当前分类页签应高亮');
  assert.ok(!ui.tab(ALL_CATEGORY).classList.has('active'), '「全部」页签应取消高亮');
  assert.match(ui.meta._text, /撤销回滚/);
});

test('渲染：无匹配时给出引导文案而不是空白', () => {
  const ui = renderInto();
  ui.search.value = '不存在的命令zzz';
  ui.search.oninput();
  assert.equal(ui.list.children.length, 0);
  assert.match(ui.meta._text, /没有匹配/);
});

test('渲染：危险命令带「不可逆」警示徽章', () => {
  const ui = renderInto();
  const badges = walk(ui.list).filter((n) => n.className === 'badge badge-red');
  assert.ok(badges.length >= 3, '危险命令应有红色警示徽章');
  assert.ok(walk(ui.list).some((n) => n._text === '⚠ 不可逆'));
});
