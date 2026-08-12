// 首页总览：一打开就心里有数——5张摘要卡（含概要导航）+ 快速备忘（可设提醒日期时间）
import { getState, mutate } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { openForm } from '../components/modal.js';
import { emptyEl } from '../components/empty.js';
import { navigate } from '../router.js';
import {
  computeHomeSummary, formatDate, todayStr, uid, formatMemoTime, memoIsDue, sortMemos,
  weekStartOf, weekEndOf, pendingPlanPreview, doingTasksPreview, consultRecordsInRange,
  mealEntriesOn, recentLedger
} from '../logic.js';

const fmt = n => (Number.isInteger(n) ? n.toLocaleString('zh-CN') : Number(n).toFixed(2));
const MEAL_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };

export async function render(container) {
  container.innerHTML = '';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '首页总览';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '今天的工作与生活，一眼看全。';
  container.append(title, sub);

  const state = getState();
  const today = todayStr();
  const s = computeHomeSummary(state, today);

  // ---------- 顶部概括 ----------
  const head = document.createElement('div');
  head.className = 'card';
  head.style.cssText = 'margin-bottom:14px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;';
  const dateTxt = document.createElement('div');
  dateTxt.style.cssText = 'font-size:17px;font-weight:700;';
  dateTxt.textContent = formatDate(today);
  const summary = document.createElement('div');
  summary.style.cssText = 'font-size:14px;color:var(--text-soft);';
  summary.textContent = `今天 ${s.planTotal} 件事，完成 ${s.planDone} 件`;
  head.append(dateTxt, summary);
  container.append(head);

  // ---------- 5 张摘要卡（带概要内容导航） ----------
  const weekStart = weekStartOf(today);
  const weekEnd = weekEndOf(today);
  const cards = [
    {
      route: 'today', icon: '📋', title: '今日计划', big: `完成 ${s.planDone}/${s.planTotal}`, sub: '▶ 去安排',
      items: pendingPlanPreview(state.plans, today, 3).map(i => `${i.important ? '⭐ ' : ''}${i.text}`)
    },
    {
      route: 'dev', icon: '💻', title: '开发工作', big: `${s.devDoing} 个`, sub: `进行中 · 今日日志 ${s.devLogsToday} 条`,
      items: doingTasksPreview(state.projects, 3).map(i => `${i.project}：${i.title}`)
    },
    {
      route: 'consult', icon: '🤝', title: '咨询工作', big: `${s.consultWeek} 次`, sub: `本周咨询 · 待收 ¥${fmt(s.pendingFees)}`,
      items: consultRecordsInRange(state.clients, weekStart, weekEnd, 3).map(i => `${i.date.slice(5)} ${i.client}${i.content ? ` · ${i.content}` : ''}`)
    },
    {
      route: 'diet', icon: '🍚', title: '饮食计划', big: `${s.mealsToday}/4 餐`, sub: '今天已记录',
      items: mealEntriesOn(state.meals, today).map(i => `${MEAL_LABELS[i.key] || i.key}：${i.food}`)
    },
    {
      route: 'money', icon: '💰', title: '账目计划', big: `¥${fmt(s.expenseToday)}`, sub: `今日支出 · 本月结余 ¥${fmt(s.monthBalance)}`,
      items: recentLedger(state.ledger, 3).map(i => `${i.date.slice(5)} ${i.category} ${i.type === 'expense' ? '-' : '+'}¥${fmt(i.amount)}`)
    }
  ];
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;';
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'cursor:pointer;transition:transform .12s,box-shadow .12s;';
    card.onmouseenter = () => { card.style.transform = 'translateY(-2px)'; card.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)'; };
    card.onmouseleave = () => { card.style.transform = ''; card.style.boxShadow = ''; };
    card.onclick = () => navigate(c.route);
    const headRow = document.createElement('div');
    headRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600;margin-bottom:8px;';
    headRow.textContent = `${c.icon} ${c.title}`;
    const big = document.createElement('div');
    big.style.cssText = 'font-size:22px;font-weight:700;margin-bottom:4px;';
    big.textContent = c.big;
    const subEl = document.createElement('div');
    subEl.style.cssText = 'font-size:12px;color:var(--text-soft);';
    subEl.textContent = c.sub;
    card.append(headRow, big, subEl);
    // 概要内容导航
    if (c.items.length) {
      const list = document.createElement('div');
      list.style.cssText = 'margin-top:10px;border-top:1px dashed var(--border);padding-top:8px;display:flex;flex-direction:column;gap:4px;';
      for (const it of c.items) {
        const line = document.createElement('div');
        line.style.cssText = 'font-size:12px;color:var(--text-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;transition:color .12s;';
        line.textContent = it;
        line.title = it;
        line.onmouseenter = () => { line.style.color = 'var(--accent)'; };
        line.onmouseleave = () => { line.style.color = ''; };
        line.onclick = e => { e.stopPropagation(); navigate(c.route); };
        list.append(line);
      }
      card.append(list);
    } else {
      const emptyHint = document.createElement('div');
      emptyHint.style.cssText = 'margin-top:10px;font-size:12px;color:var(--text-soft);opacity:.7;';
      emptyHint.textContent = '暂无概要内容';
      card.append(emptyHint);
    }
    grid.append(card);
  }
  container.append(grid);

  // ---------- 快速备忘（可选提醒日期/时间） ----------
  const memoCard = document.createElement('div');
  memoCard.className = 'card';
  const memoTitle = document.createElement('div');
  memoTitle.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:10px;';
  memoTitle.textContent = '📝 快速备忘';
  memoCard.append(memoTitle);

  const addRow = document.createElement('div');
  addRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '记一句... 回车添加';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.title = '提醒日期（可选）';
  dateInput.style.cssText = 'width:136px;flex-shrink:0;';
  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.title = '提醒时间（可选，填了时间没填日期则默认今天）';
  timeInput.style.cssText = 'width:96px;flex-shrink:0;';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-sm btn-primary';
  addBtn.textContent = '+ 添加';
  const doAdd = () => {
    const text = input.value.trim();
    if (!text) return;
    let date = dateInput.value;
    const time = timeInput.value;
    if (time && !date) date = todayStr(); // 有提醒时间无日期 → 默认今天
    mutate(s => {
      const memo = { id: uid('m'), text, pinned: false, createdAt: new Date().toISOString() };
      if (date) memo.date = date;
      if (time) memo.time = time;
      s.memos.push(memo);
    });
    input.value = '';
    dateInput.value = '';
    timeInput.value = '';
    toast('已添加');
    render(container);
  };
  input.onkeydown = e => { if (e.key === 'Enter') doAdd(); };
  addBtn.onclick = doAdd;
  addRow.append(input, dateInput, timeInput, addBtn);
  memoCard.append(addRow);

  const memos = sortMemos(state.memos);
  if (!memos.length) {
    memoCard.append(emptyEl('还没有备忘，记一句吧'));
  } else {
    for (const m of memos) {
      const row = document.createElement('div');
      row.className = 'row';
      const text = document.createElement('span');
      text.className = 'row-text';
      text.textContent = m.text;
      row.append(text);
      if (m.pinned) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-orange';
        badge.textContent = '置顶';
        row.append(badge);
      }
      const mTime = formatMemoTime(m);
      if (mTime) {
        const badge = document.createElement('span');
        badge.className = 'badge ' + (memoIsDue(m) ? 'badge-red' : 'badge-blue');
        badge.textContent = `🕐 ${mTime}`;
        badge.title = memoIsDue(m) ? '已到提醒时间' : '提醒时间';
        row.append(badge);
      }
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const editB = document.createElement('button');
      editB.className = 'btn-icon';
      editB.textContent = '✏️';
      editB.title = '编辑';
      editB.onclick = () => editMemoModal(m, container);
      const pinB = document.createElement('button');
      pinB.className = 'btn-icon';
      pinB.textContent = m.pinned ? '⭐' : '☆';
      pinB.title = m.pinned ? '取消置顶' : '置顶';
      pinB.onclick = () => {
        mutate(s => {
          const item = s.memos.find(x => x.id === m.id);
          if (item) item.pinned = !item.pinned;
        });
        toast('已更新');
        render(container);
      };
      const delB = document.createElement('button');
      delB.className = 'btn-icon';
      delB.textContent = '🗑️';
      delB.title = '删除';
      delB.onclick = async () => {
        const ok = await confirmDialog({ title: '删除备忘', message: `确定删除「${m.text}」吗？`, okText: '删除', danger: true });
        if (!ok) return;
        mutate(s => { s.memos = s.memos.filter(x => x.id !== m.id); });
        toast('已删除');
        render(container);
      };
      actions.append(editB, pinB, delB);
      row.append(actions);
      memoCard.append(row);
    }
  }
  container.append(memoCard);
}

function editMemoModal(m, ctx) {
  openForm({
    title: '编辑备忘',
    fields: [
      { key: 'text', label: '内容', type: 'text', required: true },
      { key: 'date', label: '提醒日期（可选）', type: 'date' },
      { key: 'time', label: '提醒时间（可选）', type: 'time' },
      { key: 'pinned', label: '置顶', type: 'select', options: [{ value: '1', label: '⭐ 置顶' }, { value: '0', label: '普通' }] }
    ],
    values: { text: m.text, date: m.date || '', time: m.time || '', pinned: m.pinned ? '1' : '0' },
    onSubmit: async v => {
      let date = v.date;
      if (v.time && !date) date = todayStr();
      mutate(s => {
        const item = s.memos.find(x => x.id === m.id);
        if (!item) return;
        item.text = v.text.trim();
        item.pinned = v.pinned === '1';
        if (date) item.date = date; else delete item.date;
        if (v.time) item.time = v.time; else delete item.time;
      });
      toast('已保存');
      render(ctx);
    }
  });
}
