// 账目计划：按月记账，预算设置 + 环形图/条形排行 + 明细筛选
import { getState, mutate } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { openForm } from '../components/modal.js';
import { emptyEl } from '../components/empty.js';
import { dateNav } from '../components/dateNav.js';
import {
  ledgerMonthStats, categoryRanking, categoryPercentages,
  monthBudget, setMonthBudget, budgetStatus,
  todayStr, monthKey, currentMonthKey, uid
} from '../logic.js';

let viewMonth = currentMonthKey(); // YYYY-MM
let filter = 'all'; // all | expense | income
let filterCat = ''; // 分类名，'' 表示不限

const fmt = n => (Number.isInteger(n) ? n.toLocaleString('zh-CN') : Number(n).toFixed(2));
const DONUT_COLORS = ['#4a6cf7', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

export async function render(container) {
  container.innerHTML = '';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '账目计划';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '记每一笔收支，月底知道钱花哪了、结余多少。';
  container.append(title, sub);

  container.append(dateNav({
    mode: 'month', value: viewMonth,
    onChange: v => { viewMonth = v; render(container); }
  }));

  const state = getState();
  const ledger = state.ledger || [];
  const cats = state.categories || [];
  const stats = ledgerMonthStats(ledger, viewMonth);
  const budget = monthBudget(state.budgets, viewMonth);

  // ---------- 顶部四卡 ----------
  const cards = document.createElement('div');
  cards.style.cssText = 'display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;';
  for (const [label, value, cls, extra] of [
    ['本月收入', stats.income, 'var(--green)'],
    ['本月支出', stats.expense, 'var(--orange)'],
    ['本月预算', budget, 'var(--accent)', true],
    ['本月结余', stats.balance, 'var(--text)']
  ]) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'flex:1;min-width:140px;text-align:center;';
    const num = document.createElement('div');
    num.style.cssText = `font-size:24px;font-weight:700;color:${cls};`;
    num.textContent = extra ? (budget ? `¥${fmt(budget)}` : '未设置') : `¥${fmt(value)}`;
    const lab = document.createElement('div');
    lab.style.cssText = 'font-size:13px;color:var(--text-soft);margin-top:4px;';
    lab.textContent = label;
    card.append(num, lab);
    if (extra) {
      const setBtn = document.createElement('button');
      setBtn.className = 'btn btn-sm';
      setBtn.style.cssText = 'margin-top:8px;';
      setBtn.textContent = '⚙ 设置';
      setBtn.onclick = () => budgetModal(container);
      card.append(setBtn);
    }
    cards.append(card);
  }
  container.append(cards);

  // ---------- 操作行：记一笔 + 预算进度 + 可视化 ----------
  const rowWrap = document.createElement('div');
  rowWrap.style.cssText = 'display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;';

  // 记一笔
  const addCard = document.createElement('div');
  addCard.className = 'card';
  addCard.style.cssText = 'flex:1;min-width:220px;';
  const addHead = document.createElement('div');
  addHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
  const addTitle = document.createElement('div');
  addTitle.style.cssText = 'font-size:14px;font-weight:600;';
  addTitle.textContent = '记一笔';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-sm btn-primary';
  addBtn.textContent = '＋ 记一笔';
  addBtn.onclick = () => entryModal(null, container);
  addHead.append(addTitle, addBtn);
  addCard.append(addHead);

  // 类别条形（支出排行）
  const ranking = categoryRanking(ledger, viewMonth);
  if (!ranking.length) {
    addCard.append(emptyEl('本月还没有支出'));
  } else {
    const max = ranking[0].total;
    for (const r of ranking.slice(0, 6)) {
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
      const name = document.createElement('div');
      name.style.cssText = 'font-size:12px;width:52px;flex-shrink:0;text-align:right;color:var(--text-soft);';
      name.textContent = r.name;
      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'flex:1;height:14px;background:var(--gray-light);border-radius:7px;overflow:hidden;';
      const bar = document.createElement('div');
      bar.style.cssText = `height:100%;width:${Math.round(r.total / max * 100)}%;background:var(--accent);border-radius:7px;`;
      barWrap.append(bar);
      const val = document.createElement('div');
      val.style.cssText = 'font-size:12px;width:64px;flex-shrink:0;font-weight:600;';
      val.textContent = `¥${fmt(r.total)}`;
      line.append(name, barWrap, val);
      addCard.append(line);
    }
  }
  rowWrap.append(addCard);

  // 预算进度
  const budgetCard = document.createElement('div');
  budgetCard.className = 'card';
  budgetCard.style.cssText = 'flex:1;min-width:220px;';
  const budgetHead = document.createElement('div');
  budgetHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
  const budgetTitle = document.createElement('div');
  budgetTitle.style.cssText = 'font-size:14px;font-weight:600;';
  budgetTitle.textContent = '🎯 预算进度';
  const budgetBtn = document.createElement('button');
  budgetBtn.className = 'btn btn-sm';
  budgetBtn.textContent = budget ? '修改预算' : '设置预算';
  budgetBtn.onclick = () => budgetModal(container);
  budgetHead.append(budgetTitle, budgetBtn);
  budgetCard.append(budgetHead);

  const bs = budgetStatus(stats.expense, budget);
  if (!bs.hasBudget) {
    budgetCard.append(emptyEl('本月未设置预算，点「设置预算」开始'));
  } else {
    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'height:16px;background:var(--gray-light);border-radius:8px;overflow:hidden;margin-bottom:8px;';
    const bar = document.createElement('div');
    bar.style.cssText = `height:100%;width:${bs.pct}%;background:${bs.over ? 'var(--red)' : 'var(--accent)'};border-radius:8px;transition:width .3s;`;
    barWrap.append(bar);
    budgetCard.append(barWrap);
    const used = document.createElement('div');
    used.style.cssText = 'font-size:13px;';
    used.textContent = `已用 ¥${fmt(stats.expense)} / ¥${fmt(budget)}（${bs.pct}%）`;
    budgetCard.append(used);
    const remain = document.createElement('div');
    remain.style.cssText = `font-size:13px;color:${bs.over ? 'var(--red)' : 'var(--green)'};`;
    remain.textContent = bs.over ? `⚠ 已超支 ¥${fmt(-bs.remaining)}` : `剩余 ¥${fmt(bs.remaining)}`;
    budgetCard.append(remain);
  }
  rowWrap.append(budgetCard);

  // 支出分布环形图
  const segs = categoryPercentages(ranking);
  if (segs.length) {
    const donutCard = document.createElement('div');
    donutCard.className = 'card';
    donutCard.style.cssText = 'flex:1;min-width:240px;';
    const donutHead = document.createElement('div');
    donutHead.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:10px;';
    donutHead.textContent = '📊 支出分布';
    donutCard.append(donutHead);
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;align-items:center;gap:16px;';
    const pie = document.createElement('div');
    pie.style.cssText = `position:relative;width:110px;height:110px;border-radius:50%;flex-shrink:0;background:conic-gradient(${donutStops(segs)});`;
    const hole = document.createElement('div');
    hole.style.cssText = 'position:absolute;inset:22px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-soft);text-align:center;line-height:1.3;';
    hole.textContent = `本月支出\n¥${fmt(stats.expense)}`;
    pie.append(hole);
    body.append(pie);
    const legend = document.createElement('div');
    legend.style.cssText = 'flex:1;min-width:0;font-size:12px;';
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px;';
      const dot = document.createElement('span');
      dot.style.cssText = `width:10px;height:10px;border-radius:3px;flex-shrink:0;background:${DONUT_COLORS[i % DONUT_COLORS.length]};`;
      const name = document.createElement('span');
      name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-soft);';
      name.textContent = s.name;
      const val = document.createElement('span');
      val.style.cssText = 'font-weight:600;';
      val.textContent = `${s.pct}%`;
      line.append(dot, name, val);
      legend.append(line);
    }
    body.append(legend);
    donutCard.append(body);
    rowWrap.append(donutCard);
  }
  container.append(rowWrap);

  // ---------- 筛选 + 明细 ----------
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  for (const [key, label] of [['all', '全部'], ['expense', '支出'], ['income', '收入']]) {
    const b = document.createElement('button');
    b.className = 'tab' + (filter === key ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { filter = key; render(container); };
    tabs.append(b);
  }
  const catSel = document.createElement('select');
  catSel.style.cssText = 'width:auto;margin-left:auto;';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = '全部分类';
  allOpt.selected = !filterCat;
  catSel.append(allOpt);
  for (const c of cats) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    opt.selected = filterCat === c.name;
    catSel.append(opt);
  }
  catSel.onchange = () => { filterCat = catSel.value; render(container); };
  tabs.append(catSel);
  container.append(tabs);

  let items = ledger.filter(e => monthKey(e.date) === viewMonth);
  if (filter !== 'all') items = items.filter(e => e.type === filter);
  if (filterCat) items = items.filter(e => e.category === filterCat);
  items = items.slice().sort((a, b) => b.date.localeCompare(a.date));

  const listEl = document.createElement('div');
  if (!items.length) {
    listEl.append(emptyEl('本月还没有账目，点「＋ 记一笔」开始'));
  } else {
    for (const e of items) listEl.append(rowEl(e, container));
  }
  container.append(listEl);

  // ---------- 内部函数 ----------
  // 环形图渐变断点：按占比累加生成 conic-gradient 各段
  function donutStops(segs) {
    let acc = 0;
    return segs.map((s, i) => {
      const from = acc;
      acc += s.pct;
      return `${DONUT_COLORS[i % DONUT_COLORS.length]} ${from}% ${acc}%`;
    }).join(',');
  }

  function budgetModal(ctx) {
    openForm({
      title: '设置本月预算',
      fields: [
        { key: 'amount', label: '预算金额（元）', type: 'number', required: true, placeholder: '输入 0 取消本月预算' }
      ],
      values: { amount: budget || '' },
      onSubmit: async v => {
        const r = setMonthBudget(state.budgets || {}, viewMonth, v.amount);
        if (!r.ok) throw new Error(r.error);
        mutate(s => { s.budgets = r.budgets; });
        toast(v.amount === 0 ? '已取消预算' : '预算已保存');
        render(ctx);
      }
    });
  }

  function entryModal(entry, ctx) {
    const isExpense = (entry ? entry.type : 'expense') === 'expense';
    const opts = cats.map(c => ({ value: c.name, label: `${c.name} (${c.kind === 'income' ? '收入' : '支出'})` }));
    openForm({
      title: entry ? '编辑账目' : '记一笔',
      fields: [
        { key: 'type', label: '类型', type: 'select', options: [{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }] },
        { key: 'amount', label: '金额（元）', type: 'number', required: true },
        { key: 'category', label: '分类', type: 'select', options: opts, required: true },
        { key: 'date', label: '日期', type: 'date', required: true },
        { key: 'note', label: '备注', type: 'text' }
      ],
      values: {
        type: entry ? entry.type : 'expense',
        amount: entry ? entry.amount : '',
        category: entry ? entry.category : (isExpense ? (cats.find(c => c.kind !== 'income')?.name || '') : ''),
        date: entry ? entry.date : todayStr(),
        note: entry ? entry.note || '' : ''
      },
      onSubmit: async v => {
        if (!v.amount || Number(v.amount) <= 0) throw new Error('金额必须大于0');
        const cat = cats.find(c => c.name === v.category);
        const kind = cat?.kind || 'both';
        const okKind = v.type === 'expense' ? (kind === 'expense' || kind === 'both') : (kind === 'income' || kind === 'both');
        if (!okKind) throw new Error(v.type === 'expense' ? '该分类属于收入类，请重新选择' : '该分类属于支出类，请重新选择');
        mutate(s => {
          const item = { id: entry ? entry.id : uid('e'), type: v.type, amount: Number(v.amount), category: v.category, date: v.date, note: v.note.trim() };
          if (entry) {
            const i = s.ledger.findIndex(x => x.id === entry.id);
            if (i !== -1) s.ledger[i] = item;
          } else {
            s.ledger.push(item);
          }
        });
        toast(entry ? '已保存' : '已记录');
        render(ctx);
      }
    });
  }

  function rowEl(e, ctx) {
    const row = document.createElement('div');
    row.className = 'row';
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    const date = document.createElement('div');
    date.style.cssText = 'font-size:11px;color:var(--text-soft);';
    date.textContent = e.date;
    const line = document.createElement('div');
    line.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const cat = document.createElement('span');
    cat.className = 'badge badge-gray';
    cat.textContent = e.category;
    line.append(cat);
    if (e.note) {
      const note = document.createElement('span');
      note.style.cssText = 'font-size:12px;color:var(--text-soft);';
      note.textContent = e.note;
      line.append(note);
    }
    info.append(date, line);
    row.append(info);

    const amt = document.createElement('span');
    amt.style.cssText = `font-weight:700;font-size:15px;color:${e.type === 'expense' ? 'var(--orange)' : 'var(--green)'};`;
    amt.textContent = `${e.type === 'expense' ? '-' : '+'}¥${fmt(e.amount)}`;
    row.append(amt);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const editB = document.createElement('button');
    editB.className = 'btn-icon';
    editB.textContent = '✏️';
    editB.title = '编辑';
    editB.onclick = () => entryModal(e, ctx);
    const delB = document.createElement('button');
    delB.className = 'btn-icon';
    delB.textContent = '🗑️';
    delB.title = '删除';
    delB.onclick = async () => {
      const ok = await confirmDialog({
        title: '删除账目',
        message: `确定删除这笔 ¥${fmt(e.amount)} 的账目吗？`,
        okText: '删除', danger: true
      });
      if (!ok) return;
      mutate(s => { s.ledger = s.ledger.filter(x => x.id !== e.id); });
      toast('已删除');
      render(ctx);
    };
    actions.append(editB, delB);
    row.append(actions);
    return row;
  }
}
