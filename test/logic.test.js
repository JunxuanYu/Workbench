// 纯逻辑函数测试（logic.js 不依赖 DOM，Node 直接 import）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultData, validateData,
  todayStr, addDays, formatDate, weekdayOf, monthKey, addMonths,
  weekStartOf, weekEndOf, isInRange,
  assembleToday, overdueItems, planProgress,
  projectCounts, allDevDoing, logsOnDate,
  clientFeeSummary, consultWeekCount, allPendingFees,
  dietProgress, daysSinceLastMeal,
  ledgerMonthStats, expenseToday, categoryRanking,
  computeHomeSummary,
  addCategory, canDeleteCategory
} from '../public/js/logic.js';

// ---------- 日期工具 ----------
test('日期：addDays 跨月/跨年正确', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-08-11', 0), '2026-08-11');
});

test('日期：weekday/formatDate/format 正确', () => {
  assert.equal(weekdayOf('2026-08-10'), '一'); // 2026-08-10 是周一
  assert.equal(weekdayOf('2026-08-16'), '日');
  assert.equal(formatDate('2026-08-11'), '8月11日 周二');
});

test('日期：monthKey/addMonths 正确', () => {
  assert.equal(monthKey('2026-08-31'), '2026-08');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});

test('日期：周以周一开始，weekStart/End 正确', () => {
  assert.equal(weekStartOf('2026-08-12'), '2026-08-10'); // 周三 → 周一
  assert.equal(weekEndOf('2026-08-12'), '2026-08-16');   // 周日
  assert.equal(weekStartOf('2026-08-16'), '2026-08-10'); // 周日也归本周（周一起始）
  assert.equal(isInRange('2026-08-12', '2026-08-10', '2026-08-16'), true);
  assert.equal(isInRange('2026-08-17', '2026-08-10', '2026-08-16'), false);
});

// ---------- 默认数据与校验 ----------
test('默认数据：结构完整、分类7个且全部内置', () => {
  const d = defaultData();
  assert.deepEqual(validateData(d), { ok: true, errors: [] });
  assert.equal(d.categories.length, 7);
  assert.ok(d.categories.every(c => c.builtin));
});

test('校验：非对象/缺version/缺字段 均拒绝', () => {
  assert.equal(validateData(null).ok, false);
  assert.equal(validateData({}).ok, false);
  assert.equal(validateData({ version: 2 }).ok, false);
  const d = defaultData();
  delete d.projects;
  assert.equal(validateData(d).ok, false);
});

test('todayStr 返回本地日期（非UTC）', () => {
  const d = todayStr();
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- P3：今日计划 ----------
test('P3 顺延：看今天=今天自己的+未完成的历史任务，完成的历史任务不出现', () => {
  const plans = {
    '2026-08-09': [{ id: 'a', done: true, important: false, note: '' }],
    '2026-08-10': [{ id: 'b', done: false, important: false, note: '' }, { id: 'c', done: false, important: false, note: '' }],
    '2026-08-11': [{ id: 'd', done: false, important: false, note: '' }]
  };
  const items = assembleToday(plans, '2026-08-11');
  assert.equal(items.length, 3);
  assert.equal(items[0].id, 'd');
  assert.equal(items[0].carried, false);
  assert.equal(items[1].id, 'b');
  assert.equal(items[1].carried, true);
  assert.equal(items[1].origDate, '2026-08-10');
  assert.equal(items[2].id, 'c');
  assert.equal(items[2].carried, true);
});

test('P3 顺延：origDate 缺省时回退到所在日期键', () => {
  const plans = { '2026-08-10': [{ id: 'b', done: false }] };
  const items = assembleToday(plans, '2026-08-11');
  assert.equal(items[0].origDate, '2026-08-10');
});

test('P3 逾期：仅未完成的过期任务，且带原日期', () => {
  const plans = {
    '2026-08-09': [{ id: 'a', done: false }, { id: 'a2', done: true }],
    '2026-08-10': [{ id: 'b', done: false }],
    '2026-08-11': [{ id: 'c', done: false }]
  };
  const items = overdueItems(plans, '2026-08-11');
  assert.deepEqual(items.map(i => i.id).sort(), ['a', 'b']);
  assert.equal(items.find(i => i.id === 'b').date, '2026-08-10');
});

test('P3 顺延：今天自己的已完成任务仍在列表中（供完成区展示）', () => {
  const plans = { '2026-08-11': [{ id: 'd', done: true }] };
  const items = assembleToday(plans, '2026-08-11');
  assert.equal(items.length, 1);
  assert.equal(items[0].done, true);
});

test('P3 进度统计：总数与完成数正确', () => {
  const items = [{ done: true }, { done: true }, { done: false }];
  assert.deepEqual(planProgress(items), { total: 3, done: 2 });
  assert.deepEqual(planProgress([]), { total: 0, done: 0 });
});

// ---------- P4：开发工作 ----------
test('P4 项目任务计数：三状态分别统计', () => {
  const p = {
    tasks: [
      { status: 'todo' }, { status: 'todo' }, { status: 'doing' }, { status: 'done' }
    ]
  };
  assert.deepEqual(projectCounts(p), { todo: 2, doing: 1, done: 1 });
  assert.deepEqual(projectCounts({ tasks: [] }), { todo: 0, doing: 0, done: 0 });
});

test('P4 全部项目进行中任务合计', () => {
  const projects = [
    { tasks: [{ status: 'doing' }, { status: 'doing' }] },
    { tasks: [{ status: 'doing' }, { status: 'done' }] },
    { tasks: [] }
  ];
  assert.equal(allDevDoing(projects), 3);
});

test('P4 今天的工作日志条数（跨项目统计）', () => {
  const projects = [
    { logs: [{ date: '2026-08-11' }, { date: '2026-08-10' }] },
    { logs: [{ date: '2026-08-11' }] }
  ];
  assert.equal(logsOnDate(projects, '2026-08-11'), 2);
  assert.equal(logsOnDate(projects, '2026-08-09'), 0);
});

// ---------- P5：咨询工作 ----------
test('P5 客户费用汇总：已收/待收分别合计', () => {
  const fees = [
    { amount: 500, received: true },
    { amount: 1200, received: false },
    { amount: 300, received: true }
  ];
  assert.deepEqual(clientFeeSummary(fees), { received: 800, pending: 1200 });
  assert.deepEqual(clientFeeSummary([]), { received: 0, pending: 0 });
});

test('P5 本周咨询次数：周一至周日统计', () => {
  const clients = [
    { records: [{ date: '2026-08-10' }, { date: '2026-08-16' }, { date: '2026-08-17' }] },
    { records: [{ date: '2026-08-12' }] },
    { records: [] }
  ];
  assert.equal(consultWeekCount(clients, '2026-08-10', '2026-08-16'), 3);
});

test('P5 全部客户待收费用合计', () => {
  const clients = [
    { fees: [{ amount: 1200, received: false }, { amount: 100, received: true }] },
    { fees: [{ amount: 300, received: false }] }
  ];
  assert.equal(allPendingFees(clients), 1500);
});

// ---------- P6：饮食计划 ----------
test('P6 餐次进度：记了的实心、没记的空心、计数正确', () => {
  const meals = {
    '2026-08-11': { breakfast: { food: '鸡蛋' }, lunch: null, dinner: { food: '米饭', note: '少盐' }, snack: { food: '苹果' } }
  };
  const p = dietProgress(meals, '2026-08-11');
  assert.deepEqual(p.dots, { breakfast: true, lunch: false, dinner: true, snack: true });
  assert.equal(p.count, 3);
  assert.equal(dietProgress(meals, '2026-08-10').count, 0);
});

test('P6 断档提示：距最近记录超过3天返回 true 场景', () => {
  const meals = { '2026-08-01': { breakfast: { food: 'x' } } };
  assert.equal(daysSinceLastMeal(meals, '2026-08-05'), 4); // 超过3天
  assert.equal(daysSinceLastMeal(meals, '2026-08-01'), 0); // 当天有记录
  assert.equal(daysSinceLastMeal({}, '2026-08-11'), Infinity); // 从未记录
  const today = { '2026-08-11': { lunch: { food: 'x' } } };
  assert.equal(daysSinceLastMeal(today, '2026-08-11'), 0);
});

// ---------- P7：账目计划 ----------
test('P7 月度统计：收入/支出/结余 按月过滤', () => {
  const ledger = [
    { date: '2026-08-01', type: 'income', amount: 10000 },
    { date: '2026-08-15', type: 'expense', amount: 35 },
    { date: '2026-08-31', type: 'expense', amount: 65 },
    { date: '2026-07-20', type: 'expense', amount: 999 }
  ];
  assert.deepEqual(ledgerMonthStats(ledger, '2026-08'), { income: 10000, expense: 100, balance: 9900 });
  assert.deepEqual(ledgerMonthStats(ledger, '2026-07'), { income: 0, expense: 999, balance: -999 });
  assert.deepEqual(ledgerMonthStats([], '2026-08'), { income: 0, expense: 0, balance: 0 });
});

test('P7 今日支出：仅当天支出类求和', () => {
  const ledger = [
    { date: '2026-08-11', type: 'expense', amount: 35 },
    { date: '2026-08-11', type: 'income', amount: 500 },
    { date: '2026-08-11', type: 'expense', amount: 15 },
    { date: '2026-08-10', type: 'expense', amount: 100 }
  ];
  assert.equal(expenseToday(ledger, '2026-08-11'), 50);
  assert.equal(expenseToday(ledger, '2026-08-09'), 0);
});

test('P7 类别排行：本月支出按类求和、降序排列', () => {
  const ledger = [
    { date: '2026-08-01', type: 'expense', category: '餐饮', amount: 30 },
    { date: '2026-08-02', type: 'expense', category: '交通', amount: 20 },
    { date: '2026-08-03', type: 'expense', category: '餐饮', amount: 50 },
    { date: '2026-08-04', type: 'income', category: '工资收入', amount: 8000 },
    { date: '2026-07-30', type: 'expense', category: '餐饮', amount: 999 }
  ];
  assert.deepEqual(categoryRanking(ledger, '2026-08'), [
    { name: '餐饮', total: 80 },
    { name: '交通', total: 20 }
  ]);
  assert.deepEqual(categoryRanking(ledger, '2026-07'), [{ name: '餐饮', total: 999 }]);
});

// ---------- P8：首页汇总 ----------
test('P8 首页摘要：各模块数字聚合一致', () => {
  const state = {
    plans: { '2026-08-10': [{ done: false, important: false, note: '' }], '2026-08-11': [{ done: true, important: false, note: '' }] },
    projects: [
      { tasks: [{ status: 'doing' }, { status: 'doing' }, { status: 'done' }], logs: [{ date: '2026-08-11' }] }
    ],
    clients: [
      { records: [{ date: '2026-08-10' }], fees: [{ amount: 1200, received: false }] }
    ],
    meals: { '2026-08-11': { breakfast: { food: 'x' }, lunch: null, dinner: null, snack: null } },
    ledger: [
      { date: '2026-08-11', type: 'expense', amount: 35 },
      { date: '2026-08-05', type: 'income', amount: 8000 }
    ]
  };
  const s = computeHomeSummary(state, '2026-08-11');
  assert.equal(s.planTotal, 2);          // 今天1个 + 顺延1个
  assert.equal(s.planDone, 1);
  assert.equal(s.devDoing, 2);
  assert.equal(s.devLogsToday, 1);
  assert.equal(s.consultWeek, 1);
  assert.equal(s.pendingFees, 1200);
  assert.equal(s.mealsToday, 1);
  assert.equal(s.expenseToday, 35);
  assert.equal(s.monthBalance, 7965);    // 8000 - 35
});

// ---------- P9：分类管理 ----------
test('P9 添加分类：重名拒绝、空名拒绝、成功追加', () => {
  const cats = [{ name: '餐饮', kind: 'expense', builtin: true }];
  assert.deepEqual(addCategory(cats, '餐饮'), { ok: false, error: '分类已存在' });
  assert.deepEqual(addCategory(cats, '  '), { ok: false, error: '分类名不能为空' });
  assert.deepEqual(addCategory(cats, ' 宠物 '), { ok: true });
  assert.equal(cats.length, 2);
  assert.equal(cats[1].name, '宠物');
  assert.equal(cats[1].builtin, false);
});

test('P9 删除分类：默认分类不可删、被使用的自定义分类不可删、空闲自定义可删', () => {
  const cats = [
    { name: '餐饮', kind: 'expense', builtin: true },
    { name: '宠物', kind: 'expense', builtin: false }
  ];
  const ledger = [{ category: '宠物', amount: 10 }];
  assert.equal(canDeleteCategory(cats, '餐饮', ledger).ok, false);
  assert.equal(canDeleteCategory(cats, '宠物', ledger).ok, false);
  assert.equal(canDeleteCategory(cats, '宠物', []).ok, true);
  assert.equal(canDeleteCategory(cats, '不存在', []).ok, false);
});
