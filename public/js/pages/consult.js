// 工具箱：通用工具注册框架 — 左栏工具列表 + 右栏渲染区
import { emptyEl } from '../components/empty.js';
import { createPdfConvertTool } from '../tools/pdf-convert.js';
import { createJsonConvertTool } from '../tools/json-convert.js';

// ---------- 工具注册表 ----------
const tools = [];

/**
 * 注册一个工具到工具箱
 * @param {{ id: string, name: string, icon: string, render: (container: HTMLElement) => void | Promise<void> }} tool
 */
export function registerTool(tool) {
  if (!tool || !tool.id || !tool.name || typeof tool.render !== 'function') {
    throw new Error('工具必须包含 id、name 和 render 函数');
  }
  if (tools.some(t => t.id === tool.id)) {
    throw new Error(`工具 "${tool.id}" 已注册`);
  }
  tools.push(tool);
}

/** 获取所有已注册工具（只读） */
export function getTools() {
  return [...tools];
}

// ---------- 内置工具注册 ----------
registerTool(createPdfConvertTool());
registerTool(createJsonConvertTool());

// ---------- 页面状态 ----------
let selectedId = null;

// ---------- 页面渲染 ----------
export async function render(container) {
  container.innerHTML = '';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '工具箱';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '常用小工具集合，按需扩展。';
  container.append(title, sub);

  // 选中校验
  if (!tools.some(t => t.id === selectedId)) {
    selectedId = tools[0]?.id || null;
  }

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:16px;align-items:flex-start;';

  // ---------- 左栏：工具列表 ----------
  const left = document.createElement('div');
  left.style.cssText = 'width:200px;flex-shrink:0;';
  const leftCard = document.createElement('div');
  leftCard.className = 'card';
  leftCard.style.cssText = 'padding:10px;';
  const leftHead = document.createElement('div');
  leftHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
  const leftTitle = document.createElement('div');
  leftTitle.style.cssText = 'font-size:14px;font-weight:600;';
  leftTitle.textContent = `工具（${tools.length}）`;
  leftHead.append(leftTitle);
  leftCard.append(leftHead);

  if (!tools.length) {
    leftCard.append(emptyEl('暂无工具'));
  } else {
    for (const t of tools) {
      const item = document.createElement('div');
      item.className = 'row';
      item.style.cssText = 'cursor:pointer;' + (t.id === selectedId ? 'border-color:var(--accent);background:#eef1fe;' : '');
      item.onclick = () => { selectedId = t.id; render(container); };
      const label = document.createElement('div');
      label.style.cssText = 'font-weight:600;font-size:13px;';
      label.textContent = `${t.icon || '🔧'} ${t.name}`;
      item.append(label);
      leftCard.append(item);
    }
  }
  left.append(leftCard);
  wrap.append(left);

  // ---------- 右栏：工具渲染区 ----------
  const right = document.createElement('div');
  right.style.cssText = 'flex:1;min-width:0;';

  const tool = tools.find(t => t.id === selectedId) || null;
  if (!tool) {
    right.append(emptyEl('暂无工具，可通过 registerTool() 注册'));
  } else {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:16px;';
    right.append(card);
    await tool.render(card);
  }

  wrap.append(right);
  container.append(wrap);
}
