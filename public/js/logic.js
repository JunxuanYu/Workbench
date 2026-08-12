// WorkLift 纯逻辑模块：不依赖 DOM，浏览器与 Node 共用（测试直接 import）
// 所有日期均为本地日期字符串 YYYY-MM-DD（避免 UTC 时区差一天）

export function pad2(n) { return String(n).padStart(2, '0'); }

export function dateStrFrom(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayStr(now = new Date()) { return dateStrFrom(now); }

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStrFrom(d);
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export function weekdayOf(s) { return WEEK[parseDate(s).getDay()]; }

export function formatDate(s) {
  const [, m, d] = s.split('-').map(Number);
  return `${m}月${d}日 周${weekdayOf(s)}`;
}

export function formatMonth(s) {
  const [y, m] = s.split('-').map(Number);
  return `${y}年${m}月`;
}

export function monthKey(s) { return s.slice(0, 7); }

export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

export function addMonths(s, n) {
  const [y, m] = s.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// 周一为一周起点
export function weekStartOf(s) {
  const d = parseDate(s);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return dateStrFrom(d);
}

export function weekEndOf(s) { return addDays(weekStartOf(s), 6); }

export function isInRange(s, start, end) { return s >= start && s <= end; }

// ---------- 默认数据 ----------
export function defaultData() {
  return {
    version: 1,
    updatedAt: null,
    memos: [],
    plans: {},
    projects: [],
    clients: [],
    meals: {},
    ledger: [],
    budgets: {},
    categories: [
      { name: '餐饮', kind: 'expense', builtin: true },
      { name: '交通', kind: 'expense', builtin: true },
      { name: '购物', kind: 'expense', builtin: true },
      { name: '住房', kind: 'expense', builtin: true },
      { name: '医疗', kind: 'expense', builtin: true },
      { name: '其他', kind: 'expense', builtin: true },
      { name: '工资收入', kind: 'income', builtin: true }
    ]
  };
}

// ---------- 数据校验 ----------
export function validateData(o) {
  const errors = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    errors.push('数据必须是对象');
    return { ok: false, errors };
  }
  if (o.version !== 1) errors.push('version 必须为 1');
  for (const k of ['memos', 'projects', 'clients', 'ledger', 'categories']) {
    if (!Array.isArray(o[k])) errors.push(`缺少数组字段 ${k}`);
  }
  for (const k of ['plans', 'meals']) {
    if (!o[k] || typeof o[k] !== 'object' || Array.isArray(o[k])) errors.push(`缺少对象字段 ${k}`);
  }
  // budgets 为可选字段（兼容旧数据），但一旦存在必须是对象
  if ('budgets' in o && (o.budgets === null || typeof o.budgets !== 'object' || Array.isArray(o.budgets))) {
    errors.push('budgets 必须是对象');
  }
  return { ok: errors.length === 0, errors };
}

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- 今日计划 ----------
// 看"今天"时的有效列表 = 今天自己的 + 所有未完成的过期任务（顺延）
export function assembleToday(plans, today) {
  const own = (plans[today] || []).map(it => ({ ...it, carried: false }));
  const carried = [];
  for (const key of Object.keys(plans)) {
    if (key < today) {
      for (const it of plans[key]) {
        if (!it.done) carried.push({ ...it, carried: true, origDate: it.origDate || key });
      }
    }
  }
  return [...own, ...carried];
}

export function overdueItems(plans, today) {
  const out = [];
  for (const key of Object.keys(plans)) {
    if (key < today) {
      for (const it of plans[key]) {
        if (!it.done) out.push({ ...it, date: key, origDate: it.origDate || key });
      }
    }
  }
  return out;
}

export function planProgress(items) {
  const total = items.length;
  const done = items.filter(i => i.done).length;
  return { total, done };
}

// 计划时间段：开始+结束时间（HH:mm，可只填一端），组装成展示文本；都没有返回 null
export function formatPlanTime(it) {
  const s = it && it.timeStart ? String(it.timeStart).trim() : '';
  const e = it && it.timeEnd ? String(it.timeEnd).trim() : '';
  if (!s && !e) return null;
  if (s && e) return `${s}–${e}`;
  return s || e;
}

// 校验时间段：格式必须 HH:mm（00-23/00-59），且结束不早于开始
export function validateTimeRange(start, end) {
  const s = String(start || '').trim();
  const e = String(end || '').trim();
  if (!s && !e) return { ok: true };
  const okTime = t => /^\d{2}:\d{2}$/.test(t) && Number(t.slice(0, 2)) <= 23 && Number(t.slice(3, 5)) <= 59;
  if (s && !okTime(s)) return { ok: false, error: '开始时间格式不正确' };
  if (e && !okTime(e)) return { ok: false, error: '结束时间格式不正确' };
  if (s && e && s > e) return { ok: false, error: '结束时间不能早于开始时间' };
  return { ok: true };
}

// ---------- 开发工作 ----------
export function projectCounts(project) {
  const c = { todo: 0, doing: 0, done: 0 };
  for (const t of project.tasks || []) c[t.status] = (c[t.status] || 0) + 1;
  return c;
}

export function allDevDoing(projects) {
  return projects.reduce((n, p) => n + projectCounts(p).doing, 0);
}

export function logsOnDate(projects, date) {
  let n = 0;
  for (const p of projects) for (const l of p.logs || []) if (l.date === date) n++;
  return n;
}

// 拖拽移动任务：改状态 + 在目标列按 order 重新编号排序（同列拖动也可重排）
// targetIndex 为目标列排序后的插入位置，越界自动收拢到边界
export function moveTask(project, taskId, status, targetIndex) {
  const tasks = project.tasks || [];
  const i = tasks.findIndex(t => t.id === taskId);
  if (i === -1) return { from: null, to: null, index: -1, changed: false };
  const task = tasks[i];
  const from = task.status;
  task.status = status;
  const group = tasks.filter(t => t.status === status)
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  const idx = Math.max(0, Math.min(targetIndex, group.length - 1));
  const ordered = group.filter(t => t.id !== taskId);
  ordered.splice(idx, 0, task);
  ordered.forEach((t, n) => { t.order = n; });
  return { from, to: status, index: idx, changed: true };
}

// ---------- 咨询工作 ----------
export function clientFeeSummary(fees) {
  let received = 0, pending = 0;
  for (const f of fees || []) {
    const amt = Number(f.amount) || 0;
    if (f.received) received += amt; else pending += amt;
  }
  return { received, pending };
}

export function consultWeekCount(clients, start, end) {
  let n = 0;
  for (const c of clients) for (const r of c.records || []) if (isInRange(r.date, start, end)) n++;
  return n;
}

export function allPendingFees(clients) {
  let s = 0;
  for (const c of clients) s += clientFeeSummary(c.fees).pending;
  return s;
}

// ---------- 饮食计划 ----------
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
export function dietProgress(meals, date) {
  const day = meals[date] || {};
  const dots = {};
  let count = 0;
  for (const m of MEALS) {
    const has = !!(day[m] && day[m].food);
    dots[m] = has;
    if (has) count++;
  }
  return { dots, count };
}

// 距最近一次有记录的日期隔了多少天（当天有记录返回 0，从未记录返回 Infinity）
export function daysSinceLastMeal(meals, today) {
  let latest = null;
  for (const key of Object.keys(meals)) {
    if (key <= today && dietProgress(meals, key).count > 0) {
      if (!latest || key > latest) latest = key;
    }
  }
  if (!latest) return Infinity;
  return Math.round((parseDate(today) - parseDate(latest)) / 86400000);
}

// ---------- 账目计划 ----------
export function ledgerMonthStats(ledger, mk) {
  let income = 0, expense = 0;
  for (const e of ledger) {
    if (monthKey(e.date) !== mk) continue;
    const amt = Number(e.amount) || 0;
    if (e.type === 'income') income += amt; else expense += amt;
  }
  return { income, expense, balance: income - expense };
}

export function expenseToday(ledger, date) {
  let s = 0;
  for (const e of ledger) if (e.date === date && e.type === 'expense') s += Number(e.amount) || 0;
  return s;
}

export function categoryRanking(ledger, mk) {
  const m = new Map();
  for (const e of ledger) {
    if (monthKey(e.date) !== mk || e.type !== 'expense') continue;
    m.set(e.category, (m.get(e.category) || 0) + (Number(e.amount) || 0));
  }
  return [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

// 月度预算：budgets = { 'YYYY-MM': 金额 }，未设置为 0
export function monthBudget(budgets, mk) {
  return Number((budgets || {})[mk]) || 0;
}

// 设置月度预算：金额 0 表示取消该月预算
export function setMonthBudget(budgets, mk, amount) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) return { ok: false, error: '预算必须是大于等于0的数字' };
  const next = { ...budgets };
  if (amt === 0) delete next[mk];
  else next[mk] = Math.round(amt * 100) / 100;
  return { ok: true, budgets: next };
}

// 预算使用情况：pct 为已用百分比（超支封顶100），over 表示超支
export function budgetStatus(expense, budget) {
  const b = Number(budget) || 0;
  const e = Number(expense) || 0;
  if (b <= 0) return { hasBudget: false, pct: 0, remaining: 0, over: false };
  return { hasBudget: true, pct: Math.min(100, Math.round(e / b * 10000) / 100), remaining: b - e, over: b - e < 0 };
}

// 支出类别占比（用于环形图）：返回 [{ name, total, pct }]，pct 为该类占总支出的百分比
export function categoryPercentages(ranking) {
  const total = ranking.reduce((n, r) => n + r.total, 0);
  if (!total) return [];
  return ranking.map(r => ({ name: r.name, total: r.total, pct: Math.round(r.total / total * 10000) / 100 }));
}

// ---------- 备忘 ----------
// 备忘提醒时间：date（YYYY-MM-DD）必填才生效，time（HH:mm）可选
export function parseMemoTime(m) {
  if (!m || !m.date) return null;
  const d = parseDate(m.date);
  if (m.time && /^\d{2}:\d{2}$/.test(String(m.time))) {
    const [h, min] = m.time.split(':').map(Number);
    d.setHours(h, min, 0, 0);
  }
  return d;
}

export function formatMemoTime(m) {
  if (!m || !m.date) return null;
  const base = formatDate(m.date);
  return m.time ? `${base} ${m.time}` : base;
}

// 备忘是否已到提醒时间：日期已过 → 是；今天且有时刻且时刻已到 → 是；其余否
export function memoIsDue(m, now = new Date()) {
  if (!m || !m.date) return false;
  const today = dateStrFrom(now);
  if (m.date < today) return true;
  if (m.date > today) return false;
  if (!m.time) return false;
  return String(m.time) <= `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

// 备忘排序：置顶 → 有提醒时间的按时间升序（最早的在最前）→ 其余按创建时间倒序
export function sortMemos(memos) {
  const t = m => {
    const d = parseMemoTime(m);
    return d ? d.getTime() : Infinity;
  };
  return [...(memos || [])].sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
    t(a) - t(b) ||
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
}

// ---------- 首页汇总 ----------
export function computeHomeSummary(state, today) {
  const items = assembleToday(state.plans || {}, today);
  const { total, done } = planProgress(items);
  return {
    planTotal: total,
    planDone: done,
    devDoing: allDevDoing(state.projects || []),
    devLogsToday: logsOnDate(state.projects || [], today),
    consultWeek: consultWeekCount(state.clients || [], weekStartOf(today), weekEndOf(today)),
    pendingFees: allPendingFees(state.clients || []),
    mealsToday: dietProgress(state.meals || {}, today).count,
    expenseToday: expenseToday(state.ledger || [], today),
    monthBalance: ledgerMonthStats(state.ledger || [], monthKey(today)).balance
  };
}

// ---------- 首页五卡概要预览 ----------
// 今日待办预览：取前 N 条未完成的计划（含顺延）
export function pendingPlanPreview(plans, today, limit = 3) {
  return assembleToday(plans || {}, today)
    .filter(i => !i.done)
    .slice(0, limit)
    .map(i => ({ text: i.text, important: !!i.important }));
}

// 开发工作预览：跨项目取前 N 条「进行中」任务
export function doingTasksPreview(projects, limit = 3) {
  const out = [];
  for (const p of projects || []) {
    for (const t of p.tasks || []) {
      if (t.status === 'doing') {
        out.push({ project: p.name, title: t.title });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

// 咨询工作预览：指定日期范围内（本周）的记录，按日期倒序取前 N 条
export function consultRecordsInRange(clients, start, end, limit = 3) {
  const out = [];
  for (const c of clients || []) {
    for (const r of c.records || []) {
      if (isInRange(r.date, start, end)) out.push({ client: c.name, date: r.date, content: r.content || '' });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

// 饮食预览：当天有记录的餐次，按早餐→午餐→晚餐→加餐顺序
const MEAL_ORDER = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
export function mealEntriesOn(meals, date) {
  const day = meals?.[date] || {};
  return Object.entries(day)
    .filter(([, v]) => v && v.food)
    .map(([key, v]) => ({ key, food: v.food }))
    .sort((a, b) => (MEAL_ORDER[a.key] ?? 9) - (MEAL_ORDER[b.key] ?? 9));
}

// 账目预览：最近 N 条账目（按日期倒序）
export function recentLedger(ledger, limit = 3) {
  return [...(ledger || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

// ---------- 分类管理 ----------
export function normalizeCategoryName(n) { return String(n || '').trim(); }

export function addCategory(categories, name) {
  const n = normalizeCategoryName(name);
  if (!n) return { ok: false, error: '分类名不能为空' };
  if (categories.some(c => c.name === n)) return { ok: false, error: '分类已存在' };
  categories.push({ name: n, kind: 'both', builtin: false });
  return { ok: true };
}

export function canDeleteCategory(categories, name, ledger) {
  const cat = categories.find(c => c.name === name);
  if (!cat) return { ok: false, error: '分类不存在' };
  if (cat.builtin) return { ok: false, error: '默认分类不可删除' };
  if ((ledger || []).some(e => e.category === name)) return { ok: false, error: '该分类下已有账目，请先修改账目' };
  return { ok: true };
}
