// 今日计划：按日期管理待办；逾期自动顺延（计算视图，不改存储）
import { getState, mutate } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { openForm } from '../components/modal.js';
import { emptyEl } from '../components/empty.js';
import { dateNav } from '../components/dateNav.js';
import { assembleToday, overdueItems, todayStr, addDays, formatPlanTime, validateTimeRange, buildPlanFromRow, parseDocLinks, formatDocLinks, isWebLink } from '../logic.js';
import { esc } from '../components/util.js';
import { openLocalPath } from '../api.js';

let viewDate = todayStr();
let tab = 'all'; // all | today | tomorrow | overdue

export async function render(container) {
  container.innerHTML = '';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '今日计划';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '安排每天要做的事；没做完的会自动顺延到新的一天，不会消失。';
  container.append(title, sub);

  container.append(dateNav({
    mode: 'day', value: viewDate,
    onChange: v => { viewDate = v; render(container); }
  }));

  // 卡片式添加：点按钮弹出与「编辑」一致的表单卡片；「明天」标签下日期默认填次日
  const defaultDate = () => (tab === 'tomorrow' ? addDays(viewDate, 1) : viewDate);
  const addRow = document.createElement('div');
  addRow.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:14px;';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = '+ 添加计划';
  addBtn.onclick = showAddForm;
  const addHint = document.createElement('span');
  addHint.style.cssText = 'font-size:13px;color:var(--text-soft);';
  addHint.textContent = tab === 'tomorrow' ? '日期默认填明天，可修改' : '';
  addRow.append(addBtn);
  if (addHint.textContent) addRow.append(addHint);
  container.append(addRow);

  // 添加计划表单：字段与「编辑计划」一致；提交经 buildPlanFromRow 校验并构造
  function showAddForm() {
    openForm({
      title: '添加计划',
      fields: [
        { key: 'text', label: '内容', type: 'text', required: true },
        { key: 'date', label: '日期', type: 'date', required: true },
        { key: 'timeStart', label: '开始时间（可选）', type: 'time' },
        { key: 'timeEnd', label: '结束时间（可选）', type: 'time' },
        { key: 'important', label: '优先级', type: 'select', options: [{ value: '1', label: '⭐ 重要' }, { value: '0', label: '普通' }] },
        { key: 'note', label: '备注', type: 'text' },
        { key: 'links', label: '关联文档（每行一条：链接 或 标题|链接，支持本地路径）', type: 'textarea', placeholder: '例如：\n会议纪要 | https://docs.example.com/notes\n周报模板 | D:\\资料\\周报.docx' }
      ],
      values: { text: '', date: defaultDate(), timeStart: '', timeEnd: '', important: '0', note: '', links: '' },
      onSubmit: async v => {
        const check = validateTimeRange(v.timeStart, v.timeEnd);
        if (!check.ok) throw new Error(check.error);
        const parsed = parseDocLinks(v.links);
        if (!parsed.ok) throw new Error(parsed.error);
        const r = buildPlanFromRow({ text: v.text, date: v.date, timeStart: v.timeStart, timeEnd: v.timeEnd, important: v.important === '1', note: v.note });
        if (!r.ok) throw new Error(r.error);
        mutate(s => {
          const d = r.item.origDate;
          if (!s.plans[d]) s.plans[d] = [];
          s.plans[d].push({ ...r.item, links: parsed.links });
        });
        toast('已添加');
        render(container);
      }
    });
  }

  // 标签
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  for (const [key, label] of [['all', '全部'], ['today', '今天'], ['tomorrow', '明天'], ['overdue', '逾期']]) {
    const b = document.createElement('button');
    b.className = 'tab' + (tab === key ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { tab = key; render(container); };
    tabs.append(b);
  }
  container.append(tabs);

  // 取当前标签的数据（带 _src 指向原存储日期，供增删改定位）
  const state = getState();
  let items = [];
  if (tab === 'all') {
    items = assembleToday(state.plans || {}, viewDate).map(it => ({ ...it, _src: it.carried ? it.origDate : viewDate }));
  } else if (tab === 'today') {
    items = (state.plans[viewDate] || []).map(it => ({ ...it, carried: false, _src: viewDate }));
  } else if (tab === 'tomorrow') {
    items = (state.plans[addDays(viewDate, 1)] || []).map(it => ({ ...it, carried: false, _src: addDays(viewDate, 1) }));
  } else {
    items = overdueItems(state.plans || {}, viewDate).map(it => ({ ...it, carried: true, _src: it.date }));
  }

  const listEl = document.createElement('div');
  if (!items.length) {
    const hint = tab === 'all' ? '今天还没有安排，写第一件事吧' : '这里还没有内容';
    listEl.append(emptyEl(hint));
  } else {
    const pending = items.filter(i => !i.done);
    const done = items.filter(i => i.done);
    for (const it of pending) listEl.append(buildRow(it, false, container));
    if (done.length) {
      const sep = document.createElement('div');
      sep.style.cssText = 'color:var(--text-soft);font-size:12px;margin:14px 0 8px;';
      sep.textContent = `—— 已完成（${done.length}）——`;
      listEl.append(sep);
      for (const it of done) listEl.append(buildRow(it, true, container));
    }
  }
  container.append(listEl);

  function buildRow(it, isDone, ctx) {
    const row = document.createElement('div');
    row.className = 'row' + (isDone ? ' done' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!it.done;
    cb.style.cssText = 'width:17px;height:17px;flex-shrink:0;cursor:pointer;';
    cb.onchange = () => {
      mutate(s => {
        const arr = s.plans[it._src] || [];
        const item = arr.find(x => x.id === it.id);
        if (item) item.done = cb.checked;
      });
      toast(cb.checked ? '已完成' : '已恢复');
      render(ctx);
    };
    row.append(cb);

    const text = document.createElement('span');
    text.className = 'row-text';
    text.textContent = it.text;
    row.append(text);

    const t = formatPlanTime(it);
    if (t) {
      const timeBadge = document.createElement('span');
      timeBadge.className = 'badge badge-blue';
      timeBadge.textContent = `🕐 ${t}`;
      row.append(timeBadge);
    }

    if (it.important && !isDone) {
      const star = document.createElement('span');
      star.className = 'badge badge-orange';
      star.textContent = '⭐ 重要';
      row.append(star);
    }
    if (it.carried && !isDone) {
      const tag = document.createElement('span');
      tag.className = 'badge badge-red';
      const [, m, d] = it.origDate.split('-');
      tag.textContent = `昨·未完成（原${m}月${d}日）`;
      row.append(tag);
    }
    if (it.note) {
      const note = document.createElement('span');
      note.className = 'badge badge-gray';
      note.textContent = it.note;
      note.title = it.note;
      row.append(note);
    }
    const links = it.links || [];
    if (links.length) {
      const lb = document.createElement('span');
      lb.className = 'badge badge-blue';
      lb.textContent = `📎 ${links.length}`;
      lb.style.cursor = 'pointer';
      lb.title = `关联文档（点击查阅）：${links.map(l => l.title).join('、')}`;
      lb.onclick = () => openDocsViewer(it.text, links);
      row.append(lb);
    }

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const btnIcon = (txt, title, fn) => {
      const b = document.createElement('button');
      b.className = 'btn-icon';
      b.textContent = txt;
      b.title = title;
      b.onclick = fn;
      return b;
    };
    actions.append(
      btnIcon(it.important ? '⭐' : '☆', '标记重要', async () => {
        mutate(s => {
          const arr = s.plans[it._src] || [];
          const item = arr.find(x => x.id === it.id);
          if (item) item.important = !item.important;
        });
        toast('已更新');
        render(ctx);
      }),
      btnIcon('✏️', '编辑', async () => {
        const res = await openForm({
          title: '编辑计划',
          fields: [
            { key: 'text', label: '内容', type: 'text', required: true },
            { key: 'date', label: '日期', type: 'date', required: true },
            { key: 'timeStart', label: '开始时间（可选）', type: 'time' },
            { key: 'timeEnd', label: '结束时间（可选）', type: 'time' },
            { key: 'important', label: '优先级', type: 'select', options: [{ value: '1', label: '⭐ 重要' }, { value: '0', label: '普通' }] },
            { key: 'note', label: '备注', type: 'text' },
            { key: 'links', label: '关联文档（每行一条：链接 或 标题|链接，支持本地路径）', type: 'textarea', placeholder: '例如：\n会议纪要 | https://docs.example.com/notes\n周报模板 | D:\\资料\\周报.docx' }
          ],
          values: { text: it.text, date: it._src, timeStart: it.timeStart || '', timeEnd: it.timeEnd || '', important: it.important ? '1' : '0', note: it.note || '', links: formatDocLinks(it.links) },
          onSubmit: async v => {
            const check = validateTimeRange(v.timeStart, v.timeEnd);
            if (!check.ok) throw new Error(check.error);
            const parsed = parseDocLinks(v.links);
            if (!parsed.ok) throw new Error(parsed.error);
            mutate(s => {
              const arr = s.plans[it._src] || [];
              const idx = arr.findIndex(x => x.id === it.id);
              if (idx === -1) return;
              const [item] = arr.splice(idx, 1);
              const newItem = {
                ...item,
                text: v.text.trim(),
                important: v.important === '1',
                note: v.note.trim(),
                links: parsed.links,
                origDate: v.date,
                timeStart: v.timeStart,
                timeEnd: v.timeEnd
              };
              if (!s.plans[v.date]) s.plans[v.date] = [];
              s.plans[v.date].push(newItem);
              if (arr.length === 0 && it._src !== v.date) delete s.plans[it._src];
            });
            toast('已保存');
            render(ctx);
          }
        });
      }),
      btnIcon('🗑️', '删除', async () => {
        const ok = await confirmDialog({
          title: '删除计划',
          message: `确定删除「${it.text}」吗？`,
          okText: '删除', danger: true
        });
        if (!ok) return;
        mutate(s => {
          const arr = s.plans[it._src] || [];
          const idx = arr.findIndex(x => x.id === it.id);
          if (idx !== -1) arr.splice(idx, 1);
          if (arr.length === 0) delete s.plans[it._src];
        });
        toast('已删除');
        render(ctx);
      })
    );
    row.append(actions);
    return row;
  }
}

// 文档查阅弹窗：列出计划项关联的文档；网页链接在新标签页打开，本地文件/文件夹由本机服务调系统默认程序打开
function openDocsViewer(itemText, links) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const rowStyle = 'text-decoration:none;color:inherit;';
  const infoStyle = 'flex:1;min-width:0;';
  const urlStyle = 'font-size:11px;color:var(--text-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const listHtml = links.map(l => {
    if (isWebLink(l.url)) {
      return `
    <a class="row doc-view-row" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" style="${rowStyle}">
      <div style="${infoStyle}">
        <div style="font-size:13px;font-weight:600;">🔗 ${esc(l.title)}</div>
        <div style="${urlStyle}">${esc(l.url)}</div>
      </div>
      <span class="badge badge-blue">打开 ↗</span>
    </a>`;
    }
    return `
    <a class="row doc-view-row doc-view-local" href="#" data-path="${esc(l.url)}" style="${rowStyle}">
      <div style="${infoStyle}">
        <div style="font-size:13px;font-weight:600;">📄 ${esc(l.title)}</div>
        <div style="${urlStyle}">${esc(l.url)}</div>
      </div>
      <span class="badge badge-gray">系统打开</span>
    </a>`;
  }).join('');
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">📎 关联文档</div>
      <div class="modal-body">
        <p class="confirm-msg">${esc(itemText)}</p>
        <div>${listHtml}</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" data-act="close">关闭</button>
      </div>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').onclick = close;
  // 网页行：正常新标签跳转，不触发遮罩关闭
  overlay.querySelectorAll('.doc-view-row:not(.doc-view-local)').forEach(a => a.addEventListener('click', e => e.stopPropagation()));
  // 本地行：调本机服务用系统默认程序打开
  overlay.querySelectorAll('.doc-view-local').forEach(a => {
    a.addEventListener('click', async e => {
      e.preventDefault();
      try { await openLocalPath(a.dataset.path); toast('已打开'); }
      catch (err) { toast(err.message); }
    });
  });
  root.appendChild(overlay);
}
