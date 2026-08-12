// 今日计划：按日期管理待办；逾期自动顺延（计算视图，不改存储）
import { getState, mutate } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { openForm } from '../components/modal.js';
import { emptyEl } from '../components/empty.js';
import { dateNav } from '../components/dateNav.js';
import { assembleToday, overdueItems, todayStr, addDays, uid } from '../logic.js';

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

  // 添加框：明天标签下默认加到明天
  const addRow = document.createElement('div');
  addRow.style.cssText = 'display:flex;gap:8px;margin-bottom:14px;';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = tab === 'tomorrow' ? '加一件明天的事，回车即添加...' : '加一件事，回车即添加...';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = '+ 添加';
  const doAdd = () => {
    const text = input.value.trim();
    if (!text) return;
    const targetDate = tab === 'tomorrow' ? addDays(viewDate, 1) : viewDate;
    mutate(s => {
      if (!s.plans[targetDate]) s.plans[targetDate] = [];
      s.plans[targetDate].push({ id: uid('p'), text, done: false, important: false, note: '', origDate: targetDate });
    });
    input.value = '';
    toast('已添加');
    render(container);
  };
  input.onkeydown = e => { if (e.key === 'Enter') doAdd(); };
  addBtn.onclick = doAdd;
  addRow.append(input, addBtn);
  container.append(addRow);

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
            { key: 'important', label: '优先级', type: 'select', options: [{ value: '1', label: '⭐ 重要' }, { value: '0', label: '普通' }] },
            { key: 'note', label: '备注', type: 'text' }
          ],
          values: { text: it.text, date: it._src, important: it.important ? '1' : '0', note: it.note || '' },
          onSubmit: async v => {
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
                origDate: v.date
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
