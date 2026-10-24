// 个人笔记：上传 Markdown → 安全渲染 → 一级标题目录（侧边栏）导航
import { getState, mutate } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { emptyEl } from '../components/empty.js';
import { uid } from '../logic.js';
import { extractH1, renderMarkdown } from '../markdown.js';

// 单篇笔记上限 1 MiB：数据统一保存在单个 JSON 中，避免一次误传大文件拖垮保存
const MAX_NOTE_BYTES = 1024 * 1024;
let selectedId = null;

function noteDate(note) {
  const raw = note.updatedAt || note.createdAt;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN');
}

function validNoteName(name) {
  return /\.(md|markdown|txt)$/i.test(String(name || ''));
}

async function importFiles(files, container) {
  let added = 0;
  for (const file of files) {
    const name = file && file.name ? file.name : '';
    if (!validNoteName(name)) {
      toast(`「${name || '未知文件'}」不是 Markdown 文件`);
      continue;
    }
    if (!file.size) {
      toast(`「${name}」是空文件`);
      continue;
    }
    if (file.size > MAX_NOTE_BYTES) {
      toast(`「${name}」超过 1MB，无法导入`);
      continue;
    }
    let content;
    try {
      content = await file.text();
    } catch {
      toast(`读取「${name}」失败`);
      continue;
    }
    if (!content.trim()) {
      toast(`「${name}」没有可显示的内容`);
      continue;
    }
    const firstH1 = extractH1(content)[0];
    const fallbackTitle = name.replace(/\.[^.]+$/, '').trim();
    const now = new Date().toISOString();
    const note = {
      id: uid('note'),
      title: (firstH1 && firstH1.text) || fallbackTitle || '未命名笔记',
      fileName: name,
      content,
      createdAt: now,
      updatedAt: now,
    };
    mutate((s) => {
      if (!Array.isArray(s.notes)) s.notes = [];
      s.notes.push(note);
    });
    selectedId = note.id;
    added += 1;
  }
  if (added > 0) {
    toast(added === 1 ? '已导入 1 篇笔记' : `已导入 ${added} 篇笔记`);
    await render(container);
  }
}

function noteRow(note, active, container) {
  const row = document.createElement('div');
  row.className = 'note-item' + (active ? ' active' : '');

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'note-open';
  const title = document.createElement('span');
  title.className = 'note-item-title';
  title.textContent = note.title || '未命名笔记';
  title.title = note.title || '未命名笔记';
  const meta = document.createElement('span');
  meta.className = 'note-item-date';
  meta.textContent = noteDate(note);
  open.append(title, meta);
  open.onclick = () => {
    selectedId = note.id;
    render(container);
  };

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn-icon note-delete';
  del.textContent = '🗑️';
  del.title = '删除笔记';
  del.onclick = async (event) => {
    event.stopPropagation();
    const ok = await confirmDialog({
      title: '删除笔记',
      message: `确定删除「${note.title || note.fileName || '这篇笔记'}」吗？此操作不可撤销。`,
      okText: '删除',
      danger: true,
    });
    if (!ok) return;
    mutate((s) => {
      s.notes = (s.notes || []).filter((item) => item.id !== note.id);
    });
    selectedId = null;
    toast('已删除');
    await render(container);
  };

  row.append(open, del);
  return row;
}

function outlineEl(article, note) {
  const wrap = document.createElement('div');
  wrap.className = 'note-outline';
  const title = document.createElement('div');
  title.className = 'note-outline-title';
  title.textContent = '目录 · H1';
  wrap.append(title);

  const headings = extractH1(note.content);
  if (!headings.length) {
    const empty = document.createElement('div');
    empty.className = 'note-outline-empty';
    empty.textContent = '这篇笔记没有一级标题';
    wrap.append(empty);
    return wrap;
  }

  for (const heading of headings) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'note-outline-item';
    item.textContent = heading.text;
    item.title = heading.text;
    item.onclick = () => {
      const target = article.querySelector(`[id="${CSS.escape(heading.id)}"]`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      wrap.querySelectorAll('.note-outline-item').forEach((el) => el.classList.remove('active'));
      item.classList.add('active');
    };
    wrap.append(item);
  }
  return wrap;
}

function articleEl(note) {
  const article = document.createElement('article');
  article.className = 'card notes-article';

  const meta = document.createElement('div');
  meta.className = 'notes-meta';
  const file = document.createElement('span');
  file.className = 'badge badge-gray';
  file.textContent = note.fileName || 'Markdown';
  file.title = note.fileName || 'Markdown';
  const updated = document.createElement('span');
  updated.textContent = noteDate(note) ? `更新于 ${noteDate(note)}` : '';
  meta.append(file, updated);
  article.append(meta);

  const body = document.createElement('div');
  body.className = 'markdown-body';
  const rendered = renderMarkdown(note.content);
  if (!rendered.headings.some((heading) => heading.level === 1)) {
    const fallback = document.createElement('h1');
    fallback.textContent = note.title || '未命名笔记';
    body.append(fallback);
  }
  // renderMarkdown 已转义全部用户内容并过滤危险链接，可安全写入
  body.insertAdjacentHTML('beforeend', rendered.html);
  article.append(body);
  return article;
}

export async function render(container) {
  container.innerHTML = '';
  const state = getState();
  const notes = Array.isArray(state.notes) ? state.notes : [];
  if (!notes.some((note) => note.id === selectedId)) {
    selectedId = notes[0] ? notes[0].id : null;
  }

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '个人笔记';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '导入 Markdown 文件，在本地安全渲染；一级标题会自动收进侧边栏目录。';
  container.append(title, sub);

  const uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.accept = '.md,.markdown,.txt,text/markdown,text/plain';
  uploadInput.multiple = true;
  uploadInput.hidden = true;

  const toolbar = document.createElement('div');
  toolbar.className = 'notes-toolbar';
  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'btn btn-primary';
  uploadBtn.textContent = '📄 上传 Markdown';
  uploadBtn.onclick = () => uploadInput.click();
  const hint = document.createElement('span');
  hint.className = 'notes-upload-hint';
  hint.textContent = '支持 .md / .markdown / .txt，单篇不超过 1MB';
  toolbar.append(uploadBtn, uploadInput, hint);
  container.append(toolbar);

  uploadInput.onchange = async () => {
    const files = Array.from(uploadInput.files || []);
    uploadInput.value = '';
    if (files.length) await importFiles(files, container);
  };

  if (!notes.length) {
    const empty = emptyEl('还没有笔记，点击上传 Markdown 文件开始');
    empty.classList.add('notes-empty');
    empty.onclick = () => uploadInput.click();
    container.append(empty);
    return;
  }

  const note = notes.find((item) => item.id === selectedId) || notes[0];
  const layout = document.createElement('div');
  layout.className = 'notes-layout';

  const sidebar = document.createElement('aside');
  sidebar.className = 'notes-sidebar';
  const listTitle = document.createElement('div');
  listTitle.className = 'notes-sidebar-title';
  listTitle.textContent = `笔记库 · ${notes.length}`;
  sidebar.append(listTitle);

  const list = document.createElement('div');
  list.className = 'note-list';
  for (const item of notes) list.append(noteRow(item, item.id === note.id, container));
  sidebar.append(list);

  const article = articleEl(note);
  sidebar.append(outlineEl(article, note));
  layout.append(sidebar, article);
  container.append(layout);
}
