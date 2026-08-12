// 首页总览：一打开就心里有数——5张摘要卡 + 快速备忘
import { getState, mutate } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { emptyEl } from '../components/empty.js';
import { navigate } from '../router.js';
import { computeHomeSummary, dietProgress, formatDate, todayStr, uid } from '../logic.js';

const fmt = n => (Number.isInteger(n) ? n.toLocaleString('zh-CN') : Number(n).toFixed(2));

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

  // ---------- 5 张摘要卡 ----------
  const cards = [
    { route: 'today', icon: '📋', title: '今日计划', big: `完成 ${s.planDone}/${s.planTotal}`, sub: '▶ 去安排' },
    { route: 'dev', icon: '💻', title: '开发工作', big: `${s.devDoing} 个`, sub: `进行中 · 今日日志 ${s.devLogsToday} 条` },
    { route: 'consult', icon: '🤝', title: '咨询工作', big: `${s.consultWeek} 次`, sub: `本周咨询 · 待收 ¥${fmt(s.pendingFees)}` },
    { route: 'diet', icon: '🍚', title: '饮食计划', big: `${s.mealsToday}/4 餐`, sub: '今天已记录' },
    { route: 'money', icon: '💰', title: '账目计划', big: `¥${fmt(s.expenseToday)}`, sub: `今日支出 · 本月结余 ¥${fmt(s.monthBalance)}` }
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
    grid.append(card);
  }
  container.append(grid);

  // ---------- 快速备忘 ----------
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
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-sm btn-primary';
  addBtn.textContent = '+ 添加';
  const doAdd = () => {
    const text = input.value.trim();
    if (!text) return;
    mutate(s => {
      s.memos.push({ id: uid('m'), text, pinned: false, createdAt: new Date().toISOString() });
    });
    input.value = '';
    toast('已添加');
    render(container);
  };
  input.onkeydown = e => { if (e.key === 'Enter') doAdd(); };
  addBtn.onclick = doAdd;
  addRow.append(input, addBtn);
  memoCard.append(addRow);

  const memos = [...(state.memos || [])].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || '').localeCompare(a.createdAt || ''));
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
      const actions = document.createElement('div');
      actions.className = 'row-actions';
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
      actions.append(pinB, delB);
      row.append(actions);
      memoCard.append(row);
    }
  }
  container.append(memoCard);
}
