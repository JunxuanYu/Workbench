// 纯逻辑函数测试（logic.js 不依赖 DOM，Node 直接 import）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultData, validateData,
  todayStr, addDays, formatDate, weekdayOf, monthKey, addMonths,
  weekStartOf, weekEndOf, isInRange,
  assembleToday, overdueItems, planProgress, formatPlanTime, validateTimeRange, buildPlanFromRow,
  projectCounts, allDevDoing, logsOnDate, moveTask, moveProject, reorderPlansBySequence,
  dietProgress, daysSinceLastMeal,
  ledgerMonthStats, expenseToday, categoryRanking, categoryPercentages,
  monthBudget, setMonthBudget, budgetStatus,
  computeHomeSummary,
  formatMemoTime, parseMemoTime, memoIsDue, sortMemos,
  pendingPlanPreview, doingTasksPreview, mealEntriesOn, recentLedger,
  addCategory, canDeleteCategory,
  normalizeRepoUrl,
  normalizeHttpUrl, docLinkTitle, parseDocLinks, formatDocLinks,
  normalizeLocalPath, isWebLink, docFileTitle
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
test('默认数据：结构完整、分类7个且全部内置、vault 未设置', () => {
  const d = defaultData();
  assert.deepEqual(validateData(d), { ok: true, errors: [] });
  assert.equal(d.categories.length, 7);
  assert.ok(d.categories.every(c => c.builtin));
  assert.equal(d.vault, null, '密码箱默认未设置');
});

test('校验：非对象/缺version/缺字段 均拒绝', () => {
  assert.equal(validateData(null).ok, false);
  assert.equal(validateData({}).ok, false);
  assert.equal(validateData({ version: 2 }).ok, false);
  const d = defaultData();
  delete d.projects;
  assert.equal(validateData(d).ok, false);
});

test('校验：vault 可选字段，null 合法、非法结构拒绝、合法结构通过', () => {
  const d = defaultData();
  delete d.vault;
  assert.equal(validateData(d).ok, true, '旧数据没有 vault 也应通过');
  d.vault = [];
  assert.equal(validateData(d).ok, false, '数组不是合法 vault');
  d.vault = { salt: 'c2FsdA==', iterations: 1000, data: 'aWF2Y2lwaGVy' };
  assert.equal(validateData(d).ok, true, '合法加密结构应通过');
  d.vault = { salt: 'x' };
  assert.equal(validateData(d).ok, false, '缺 iterations/data 应拒绝');
});

test('校验：budgets 为可选字段（兼容旧数据），存在时必须是对象', () => {
  const d = defaultData();
  delete d.budgets;
  assert.equal(validateData(d).ok, true, '旧数据没有 budgets 也应通过');
  d.budgets = [];
  assert.equal(validateData(d).ok, false, '数组不是合法 budgets');
  d.budgets = { '2026-08': 3000 };
  assert.equal(validateData(d).ok, true);
});

test('todayStr 返回本地日期（非UTC）', () => {
  const d = todayStr();
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- 远程仓库链接 ----------
test('远程仓库：normalizeRepoUrl 归一化/拒绝', () => {
  assert.equal(normalizeRepoUrl(''), '');
  assert.equal(normalizeRepoUrl('   '), '');
  assert.equal(normalizeRepoUrl(undefined), '');
  assert.equal(normalizeRepoUrl('github.com/user/repo'), 'https://github.com/user/repo');
  assert.equal(normalizeRepoUrl('https://github.com/user/repo'), 'https://github.com/user/repo');
  assert.equal(normalizeRepoUrl('http://example.com/a/'), 'http://example.com/a');
  assert.equal(normalizeRepoUrl('not a url'), null);
  assert.equal(normalizeRepoUrl('ftp://x.com'), null);
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

test('P3 时间段：formatPlanTime 组合开始/结束时间，单边与空值正确', () => {
  assert.equal(formatPlanTime({ timeStart: '09:00', timeEnd: '10:30' }), '09:00–10:30');
  assert.equal(formatPlanTime({ timeStart: '09:00' }), '09:00');
  assert.equal(formatPlanTime({ timeEnd: '10:30' }), '10:30');
  assert.equal(formatPlanTime({ timeStart: ' 09:00 ' }), '09:00');
  assert.equal(formatPlanTime({}), null);
  assert.equal(formatPlanTime({ timeStart: '', timeEnd: '' }), null);
  assert.equal(formatPlanTime(null), null);
});

test('P3 时间段：validateTimeRange 校验格式与先后顺序', () => {
  assert.deepEqual(validateTimeRange('09:00', '10:30'), { ok: true });
  assert.deepEqual(validateTimeRange('', ''), { ok: true });
  assert.deepEqual(validateTimeRange('09:00', ''), { ok: true });
  assert.deepEqual(validateTimeRange('', '10:30'), { ok: true });
  assert.deepEqual(validateTimeRange('09:00', '08:00'), { ok: false, error: '结束时间不能早于开始时间' });
  assert.deepEqual(validateTimeRange('9:00', ''), { ok: false, error: '开始时间格式不正确' });
  assert.deepEqual(validateTimeRange('', '25:00'), { ok: false, error: '结束时间格式不正确' });
});

test('P3 表格式添加：buildPlanFromRow 内容/日期必填校验', () => {
  assert.deepEqual(buildPlanFromRow({ text: '   ', date: '2026-08-11' }), { ok: false, error: '请填写内容' });
  assert.deepEqual(buildPlanFromRow({ text: '写周报', date: '' }), { ok: false, error: '请选择日期' });
  assert.deepEqual(buildPlanFromRow({}), { ok: false, error: '请填写内容' }, '整行全空应拒绝');
  assert.equal(buildPlanFromRow(null).ok, false, '入参为空对象/缺省时应拒绝而非抛错');
});

test('P3 表格式添加：buildPlanFromRow 复用时间段校验', () => {
  assert.deepEqual(
    buildPlanFromRow({ text: '开会', date: '2026-08-11', timeStart: '9:00', timeEnd: '' }),
    { ok: false, error: '开始时间格式不正确' }
  );
  assert.deepEqual(
    buildPlanFromRow({ text: '开会', date: '2026-08-11', timeStart: '10:00', timeEnd: '09:00' }),
    { ok: false, error: '结束时间不能早于开始时间' }
  );
});

test('P3 表格式添加：buildPlanFromRow 合法行构造完整计划项', () => {
  const r = buildPlanFromRow({
    text: '  写周报  ', date: '2026-08-12',
    timeStart: '09:00', timeEnd: '10:30', important: true, note: '  提交给领导 '
  });
  assert.equal(r.ok, true);
  const it = r.item;
  assert.ok(it.id.startsWith('p_'), 'id 应以 p_ 前缀生成');
  assert.equal(it.text, '写周报', '内容两端空白应去除');
  assert.equal(it.done, false);
  assert.equal(it.important, true);
  assert.equal(it.note, '提交给领导', '备注两端空白应去除');
  assert.equal(it.origDate, '2026-08-12');
  assert.equal(it.timeStart, '09:00');
  assert.equal(it.timeEnd, '10:30');
  // 与快捷添加的历史数据结构一致：不含 links 字段
  assert.equal('links' in it, false);
  const r2 = buildPlanFromRow({ text: '散步', date: '2026-08-12', timeStart: ' 09:05 ', timeEnd: '' });
  assert.equal(r2.item.timeStart, '09:05', '时间值两端空白应去除');
  assert.equal(r2.item.timeEnd, '');
});

test('P3 表格式添加：buildPlanFromRow 缺省字段取默认值', () => {
  const r = buildPlanFromRow({ text: '读书', date: '2026-08-13' });
  assert.equal(r.ok, true);
  assert.equal(r.item.important, false, '优先级默认普通');
  assert.equal(r.item.note, '', '备注默认空');
  assert.equal(r.item.timeStart, '', '开始时间默认空');
  assert.equal(r.item.timeEnd, '', '结束时间默认空');
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

test('P4 拖拽：跨列移动并重排目标列 order', () => {
  const p = {
    tasks: [
      { id: 'a', title: 'A', status: 'todo' },
      { id: 'b', title: 'B', status: 'todo' },
      { id: 'c', title: 'C', status: 'doing', order: 0 }
    ]
  };
  const r = moveTask(p, 'a', 'doing', 0);
  assert.equal(r.from, 'todo');
  assert.equal(r.to, 'doing');
  assert.equal(p.tasks.find(t => t.id === 'a').status, 'doing');
  const doing = p.tasks.filter(t => t.status === 'doing').sort((x, y) => x.order - y.order);
  assert.deepEqual(doing.map(t => t.id), ['a', 'c']);
  assert.deepEqual(doing.map(t => t.order), [0, 1]);
  const todo = p.tasks.filter(t => t.status === 'todo');
  assert.deepEqual(todo.map(t => t.id), ['b'], '原列其余任务不受影响');
});

test('P4 拖拽：同列重排（拖到列首）', () => {
  const p = { tasks: [
    { id: 'a', status: 'todo', order: 0 },
    { id: 'b', status: 'todo', order: 1 },
    { id: 'c', status: 'todo', order: 2 }
  ] };
  moveTask(p, 'c', 'todo', 0);
  const todo = p.tasks.filter(t => t.status === 'todo').sort((x, y) => x.order - y.order);
  assert.deepEqual(todo.map(t => t.id), ['c', 'a', 'b']);
});

test('P4 拖拽：目标索引越界收拢到边界', () => {
  const p = { tasks: [
    { id: 'a', status: 'todo', order: 0 },
    { id: 'b', status: 'todo', order: 1 }
  ] };
  moveTask(p, 'a', 'todo', 99);
  const todo = p.tasks.filter(t => t.status === 'todo').sort((x, y) => x.order - y.order);
  assert.deepEqual(todo.map(t => t.id), ['b', 'a']);
});

test('P4 拖拽：任务不存在时不做任何修改', () => {
  const p = { tasks: [{ id: 'a', status: 'todo' }] };
  const r = moveTask(p, 'nope', 'doing', 0);
  assert.equal(r.changed, false);
  assert.equal(p.tasks[0].status, 'todo');
});

test('P4 项目排序：移动项目到指定位置', () => {
  const projects = [
    { id: 'p1', name: 'A' },
    { id: 'p2', name: 'B' },
    { id: 'p3', name: 'C' }
  ];
  const r = moveProject(projects, 'p1', 2);
  assert.equal(r.changed, true);
  assert.equal(r.index, 2);
  assert.deepEqual(projects.map(p => p.id), ['p2', 'p3', 'p1']);
});

test('P4 项目排序：移动项目到列首', () => {
  const projects = [
    { id: 'p1', name: 'A' },
    { id: 'p2', name: 'B' },
    { id: 'p3', name: 'C' }
  ];
  moveProject(projects, 'p3', 0);
  assert.deepEqual(projects.map(p => p.id), ['p3', 'p1', 'p2']);
});

test('P4 项目排序：目标索引越界收拢到边界', () => {
  const projects = [
    { id: 'p1', name: 'A' },
    { id: 'p2', name: 'B' }
  ];
  moveProject(projects, 'p1', 99);
  assert.deepEqual(projects.map(p => p.id), ['p2', 'p1'], '超出末尾应移到最后');
  moveProject(projects, 'p2', -5);
  assert.deepEqual(projects.map(p => p.id), ['p2', 'p1'], '负数应移到最前');
});

test('P4 项目排序：项目不存在时不做任何修改', () => {
  const projects = [{ id: 'p1', name: 'A' }];
  const r = moveProject(projects, 'nope', 0);
  assert.equal(r.changed, false);
  assert.equal(r.index, -1);
  assert.deepEqual(projects.map(p => p.id), ['p1']);
});

// ---------- P2：今日计划拖拽排序 ----------
test('P2 拖拽排序：同一天内重排多个未完成项', () => {
  const plans = {
    '2026-08-31': [
      { id: 'p1', text: 'A', done: false },
      { id: 'p2', text: 'B', done: false },
      { id: 'p3', text: 'C', done: false }
    ]
  };
  // 把 p3 拖到最前
  const changed = reorderPlansBySequence(plans, [
    { date: '2026-08-31', id: 'p3' },
    { date: '2026-08-31', id: 'p1' },
    { date: '2026-08-31', id: 'p2' }
  ]);
  assert.equal(changed, true);
  assert.deepEqual(plans['2026-08-31'].map(p => p.id), ['p3', 'p1', 'p2']);
});

test('P2 拖拽排序：已完成项保持原相对顺序附在末尾', () => {
  const plans = {
    '2026-08-31': [
      { id: 'p1', text: 'A', done: false },
      { id: 'p2', text: 'B', done: false },
      { id: 'p3', text: 'C', done: true },
      { id: 'p4', text: 'D', done: true }
    ]
  };
  reorderPlansBySequence(plans, [
    { date: '2026-08-31', id: 'p2' },
    { date: '2026-08-31', id: 'p1' }
  ]);
  const ids = plans['2026-08-31'].map(p => p.id);
  assert.deepEqual(ids, ['p2', 'p1', 'p3', 'p4'], '已完成项 p3/p4 保持原顺序排在末尾');
});

test('P2 拖拽排序：跨日期（顺延项）也能按展示顺序持久化', () => {
  const plans = {
    '2026-08-31': [
      { id: 't1', text: '今天任务', done: false },
      { id: 't2', text: '今天次要', done: false }
    ],
    '2026-08-30': [
      { id: 'c1', text: '昨日顺延', done: false }
    ]
  };
  // 拖拽：把昨日顺延 c1 拖到今天的 t2 之后
  reorderPlansBySequence(plans, [
    { date: '2026-08-31', id: 't1' },
    { date: '2026-08-31', id: 't2' },
    { date: '2026-08-30', id: 'c1' }
  ]);
  assert.deepEqual(plans['2026-08-31'].map(p => p.id), ['t1', 't2']);
  assert.deepEqual(plans['2026-08-30'].map(p => p.id), ['c1']);
});

test('P2 拖拽排序：未变化的顺序返回 changed=false 且数组不变', () => {
  const plans = {
    '2026-08-31': [
      { id: 'p1', text: 'A', done: false },
      { id: 'p2', text: 'B', done: false }
    ]
  };
  const before = JSON.stringify(plans);
  const changed = reorderPlansBySequence(plans, [
    { date: '2026-08-31', id: 'p1' },
    { date: '2026-08-31', id: 'p2' }
  ]);
  assert.equal(changed, false);
  assert.equal(JSON.stringify(plans), before);
});

test('P2 拖拽排序：seq 含未知 id 或非法项时安全跳过', () => {
  const plans = {
    '2026-08-31': [
      { id: 'p1', text: 'A', done: false },
      { id: 'p2', text: 'B', done: false }
    ]
  };
  reorderPlansBySequence(plans, [
    { date: '2026-08-31', id: 'ghost' },
    { date: '2026-08-31', id: 'p2' },
    { id: 'p1' } // 缺 date，忽略
  ]);
  // ghost 不存在被忽略；p1 缺 date 不参与排序，仅在 seq 之外的项按原顺序附后
  assert.deepEqual(plans['2026-08-31'].map(p => p.id), ['p2', 'p1']);
});

test('P2 拖拽排序：空 seq / 无对应日期 / plans 为空 均安全', () => {
  const plans = { '2026-08-31': [{ id: 'p1', text: 'A', done: false }] };
  assert.equal(reorderPlansBySequence(plans, []), false);
  assert.equal(reorderPlansBySequence(plans, [{ date: '2026-09-01', id: 'p1' }]), false);
  assert.equal(reorderPlansBySequence(null, [{ date: '2026-08-31', id: 'x' }]), false);
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

test('P7 预算：monthBudget 按月读取，未设置/空对象为 0', () => {
  assert.equal(monthBudget({ '2026-08': 3000 }, '2026-08'), 3000);
  assert.equal(monthBudget({ '2026-08': 3000 }, '2026-07'), 0);
  assert.equal(monthBudget({}, '2026-08'), 0);
  assert.equal(monthBudget(undefined, '2026-08'), 0);
});

test('P7 预算：setMonthBudget 设置/清零/非法值拒绝', () => {
  assert.deepEqual(setMonthBudget({}, '2026-08', 3000), { ok: true, budgets: { '2026-08': 3000 } });
  assert.deepEqual(setMonthBudget({ '2026-08': 3000 }, '2026-08', 0), { ok: true, budgets: {} });
  assert.deepEqual(setMonthBudget({}, '2026-08', 12.345), { ok: true, budgets: { '2026-08': 12.35 } });
  assert.deepEqual(setMonthBudget({}, '2026-08', -5), { ok: false, error: '预算必须是大于等于0的数字' });
  assert.deepEqual(setMonthBudget({}, '2026-08', 'abc'), { ok: false, error: '预算必须是大于等于0的数字' });
});

test('P7 预算：budgetStatus 计算使用率/剩余/超支', () => {
  assert.deepEqual(budgetStatus(500, 1000), { hasBudget: true, pct: 50, remaining: 500, over: false });
  assert.deepEqual(budgetStatus(1200, 1000), { hasBudget: true, pct: 100, remaining: -200, over: true });
  assert.deepEqual(budgetStatus(0, 0), { hasBudget: false, pct: 0, remaining: 0, over: false });
  assert.deepEqual(budgetStatus(300, 1000), { hasBudget: true, pct: 30, remaining: 700, over: false });
  assert.equal(budgetStatus(1000, 1000).pct, 100, '恰好用完为100%');
});

test('P7 预算：categoryPercentages 支出占比总和为100', () => {
  const ranking = [{ name: '餐饮', total: 80 }, { name: '交通', total: 20 }];
  assert.deepEqual(categoryPercentages(ranking), [
    { name: '餐饮', total: 80, pct: 80 },
    { name: '交通', total: 20, pct: 20 }
  ]);
  assert.deepEqual(categoryPercentages([]), []);
});

// ---------- P8：首页汇总 ----------
test('P8 首页摘要：各模块数字聚合一致', () => {
  const state = {
    plans: { '2026-08-10': [{ done: false, important: false, note: '' }], '2026-08-11': [{ done: true, important: false, note: '' }] },
    projects: [
      { tasks: [{ status: 'doing' }, { status: 'doing' }, { status: 'done' }], logs: [{ date: '2026-08-11' }] }
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
  assert.equal(s.mealsToday, 1);
  assert.equal(s.expenseToday, 35);
  assert.equal(s.monthBalance, 7965);    // 8000 - 35
});

// ---------- P8：首页备忘 ----------
test('P8 备忘时间：parseMemoTime 组合日期与时间', () => {
  const d = parseMemoTime({ date: '2026-08-12', time: '15:30' });
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7); // 8月
  assert.equal(d.getDate(), 12);
  assert.equal(d.getHours(), 15);
  assert.equal(d.getMinutes(), 30);
  assert.equal(parseMemoTime({ date: '2026-08-12' }).getHours(), 0, '只有日期时时刻为零点');
  assert.equal(parseMemoTime({}), null);
  assert.equal(parseMemoTime(null), null);
});

test('P8 备忘时间：formatMemoTime 展示文本', () => {
  assert.equal(formatMemoTime({ date: '2026-08-12', time: '15:30' }), '8月12日 周三 15:30');
  assert.equal(formatMemoTime({ date: '2026-08-12' }), '8月12日 周三');
  assert.equal(formatMemoTime({}), null);
  assert.equal(formatMemoTime(null), null);
});

test('P8 备忘时间：memoIsDue 判定日期/时刻是否已过', () => {
  const now = new Date(2026, 7, 12, 12, 0, 0); // 2026-08-12 12:00
  assert.equal(memoIsDue({ date: '2026-08-11' }, now), true, '昨天已过');
  assert.equal(memoIsDue({ date: '2026-08-12', time: '11:00' }, now), true, '今天时刻已过');
  assert.equal(memoIsDue({ date: '2026-08-12', time: '13:00' }, now), false, '今天时刻未到');
  assert.equal(memoIsDue({ date: '2026-08-12' }, now), false, '今天全天任务不算过期');
  assert.equal(memoIsDue({ date: '2026-08-13' }, now), false, '明天未到');
  assert.equal(memoIsDue({}, now), false);
  assert.equal(memoIsDue(null, now), false);
});

test('P8 备忘排序：置顶 → 提醒时间升序 → 无时间按创建倒序', () => {
  const memos = [
    { id: 'a', pinned: false, createdAt: '2026-08-12T09:00:00Z', date: '2026-08-15' },
    { id: 'b', pinned: true, createdAt: '2026-08-11T09:00:00Z' },
    { id: 'c', pinned: false, createdAt: '2026-08-12T08:00:00Z', date: '2026-08-13', time: '10:00' },
    { id: 'd', pinned: false, createdAt: '2026-08-10T09:00:00Z', date: '2026-08-13', time: '09:00' },
    { id: 'e', pinned: false, createdAt: '2026-08-12T07:00:00Z' }
  ];
  const ids = sortMemos(memos).map(m => m.id);
  assert.deepEqual(ids, ['b', 'd', 'c', 'a', 'e']);
  assert.deepEqual(sortMemos([]), []);
  assert.deepEqual(sortMemos(undefined), []);
});

// ---------- P8：首页五卡概要 ----------
test('P8 概要：今日待办预览取前 N 条未完成（含顺延）', () => {
  const plans = {
    '2026-08-10': [{ id: 'a', text: '旧任务', done: false, important: false, note: '' }],
    '2026-08-11': [
      { id: 'b', text: '任务B', done: false, important: true, note: '' },
      { id: 'c', text: '任务C', done: true, important: false, note: '' },
      { id: 'd', text: '任务D', done: false, important: false, note: '' }
    ]
  };
  assert.deepEqual(pendingPlanPreview(plans, '2026-08-11', 2), [
    { text: '任务B', important: true },
    { text: '任务D', important: false }
  ]);
  assert.deepEqual(pendingPlanPreview({}, '2026-08-11', 3), []);
});

test('P8 概要：进行中任务预览跨项目取前 N 条', () => {
  const projects = [
    { name: 'A', tasks: [{ title: 'T1', status: 'doing' }, { title: 'T2', status: 'todo' }] },
    { name: 'B', tasks: [{ title: 'T3', status: 'doing' }, { title: 'T4', status: 'doing' }] },
    { name: 'C', tasks: [{ title: 'T5', status: 'doing' }] }
  ];
  assert.deepEqual(doingTasksPreview(projects, 3), [
    { project: 'A', title: 'T1' },
    { project: 'B', title: 'T3' },
    { project: 'B', title: 'T4' }
  ]);
  assert.deepEqual(doingTasksPreview([], 3), []);
});

test('P8 概要：当日饮食条目按餐次顺序输出', () => {
  const meals = { '2026-08-11': { dinner: { food: '米饭' }, breakfast: { food: '鸡蛋' }, snack: null, lunch: { food: '面' } } };
  assert.deepEqual(mealEntriesOn(meals, '2026-08-11'), [
    { key: 'breakfast', food: '鸡蛋' },
    { key: 'lunch', food: '面' },
    { key: 'dinner', food: '米饭' }
  ]);
  assert.deepEqual(mealEntriesOn({}, '2026-08-11'), []);
  assert.deepEqual(mealEntriesOn(undefined, '2026-08-11'), []);
});

test('P8 概要：最近账目按日期倒序取前 N 条', () => {
  const ledger = [
    { date: '2026-08-10', category: '餐饮', type: 'expense', amount: 20 },
    { date: '2026-08-12', category: '工资', type: 'income', amount: 500 },
    { date: '2026-08-11', category: '交通', type: 'expense', amount: 5 }
  ];
  assert.deepEqual(recentLedger(ledger, 2), [
    { date: '2026-08-12', category: '工资', type: 'income', amount: 500 },
    { date: '2026-08-11', category: '交通', type: 'expense', amount: 5 }
  ]);
  assert.deepEqual(recentLedger([], 3), []);
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

// ---------- P10：备注关联文档（开发工作/今日计划共用） ----------
test('P10 关联文档：parseDocLinks 解析纯链接/标题|链接/空行混合', () => {
  assert.deepEqual(parseDocLinks(''), { ok: true, links: [] });
  assert.deepEqual(parseDocLinks('   \n  '), { ok: true, links: [] });
  const r = parseDocLinks('https://github.com/user/repo\n\n需求文档 | https://example.com/prd\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.links, [
    { title: 'repo', url: 'https://github.com/user/repo' },
    { title: '需求文档', url: 'https://example.com/prd' }
  ]);
});

test('P10 关联文档：无协议自动补 https、末尾斜杠去除', () => {
  const r = parseDocLinks('docs.example.com/api/');
  assert.equal(r.ok, true);
  assert.deepEqual(r.links, [{ title: 'api', url: 'https://docs.example.com/api' }]);
});

test('P10 关联文档：非法/缺失链接整体拒绝并提示行号', () => {
  assert.equal(parseDocLinks('not a url').ok, false);
  assert.match(parseDocLinks('not a url').error, /第 1 行/);
  assert.match(parseDocLinks('https://ok.com\nftp://bad.com').error, /第 2 行/);
  assert.match(parseDocLinks('只有标题|').error, /缺少链接/);
});

test('P10 关联文档：formatDocLinks 序列化且与 parse 往返一致', () => {
  assert.equal(formatDocLinks([]), '');
  assert.equal(formatDocLinks(undefined), '');
  const links = [
    { title: 'PRD', url: 'https://example.com/prd' },
    { title: '', url: 'https://github.com/u/r' }
  ];
  assert.equal(formatDocLinks(links), 'PRD|https://example.com/prd\nhttps://github.com/u/r');
  const r = parseDocLinks(formatDocLinks([{ title: 'PRD', url: 'https://example.com/prd' }]));
  assert.deepEqual(r.links, [{ title: 'PRD', url: 'https://example.com/prd' }], 'format → parse 应还原相同结构');
});

test('P10 关联文档：docLinkTitle 从路径段/主机名推导默认标题', () => {
  assert.equal(docLinkTitle('https://github.com/u/repo/blob/main/README.md'), 'README');
  assert.equal(docLinkTitle('https://docs.example.com/api/%E6%8C%87%E5%8D%97.pdf'), '指南');
  assert.equal(docLinkTitle('https://example.com'), 'example.com');
});

test('P10 数据兼容：项目任务带 links 数组可通过 validateData（服务端不拒绝新字段）', () => {
  const d = defaultData();
  d.projects.push({
    id: 'p1', name: 'X', desc: '', repoUrl: '',
    tasks: [{ id: 't1', title: '任务A', status: 'todo', priority: 'normal', note: '', links: [{ title: 'PRD', url: 'https://example.com/prd' }] }],
    logs: []
  });
  assert.deepEqual(validateData(d), { ok: true, errors: [] });
});

test('P10 数据兼容：今日计划项带 links 数组可通过 validateData（服务端不拒绝新字段）', () => {
  const d = defaultData();
  d.plans['2026-08-23'] = [
    { id: 'pl1', text: '写周报', done: false, important: false, note: '', origDate: '2026-08-23',
      links: [{ title: '会议纪要', url: 'https://docs.example.com/notes' }, { title: '周报模板', url: 'https://example.com/tpl' }] }
  ];
  assert.deepEqual(validateData(d), { ok: true, errors: [] });
  // 旧数据无 links 字段依旧通过
  const old = defaultData();
  old.plans['2026-08-23'] = [{ id: 'pl2', text: '旧条目', done: false, important: false, note: '' }];
  assert.deepEqual(validateData(old), { ok: true, errors: [] });
});

test('P10 关联文档：Windows CRLF 换行可正常解析（textarea 常见输入）', () => {
  const r = parseDocLinks('需求 | https://a.com/x\r\nhttps://b.com/y\r\n\r\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.links, [
    { title: '需求', url: 'https://a.com/x' },
    { title: 'y', url: 'https://b.com/y' }
  ]);
});

// ---------- P11：关联文档支持本地文件/文件夹路径 ----------
test('P11 本地路径：normalizeLocalPath 识别盘符/UNC/POSIX、去引号、拒绝相对路径与网页', () => {
  assert.equal(normalizeLocalPath(''), '');
  assert.equal(normalizeLocalPath('   '), '');
  assert.equal(normalizeLocalPath('C:\\docs\\PRD.md'), 'C:\\docs\\PRD.md');
  assert.equal(normalizeLocalPath('C:/docs/PRD.md'), 'C:/docs/PRD.md');
  assert.equal(normalizeLocalPath('"D:\\path with space\\a.md"'), 'D:\\path with space\\a.md', '去掉复制文件地址带的引号');
  assert.equal(normalizeLocalPath("'E:\\x.txt'"), 'E:\\x.txt');
  assert.equal(normalizeLocalPath('\\\\server\\share\\docs'), '\\\\server\\share\\docs');
  assert.equal(normalizeLocalPath('/home/user/readme.md'), '/home/user/readme.md');
  assert.equal(normalizeLocalPath('https://example.com'), null, '网页链接不是本地路径');
  assert.equal(normalizeLocalPath('notes.md'), null, '相对路径有歧义不支持');
  assert.equal(normalizeLocalPath('docs.example.com/api'), null, '域名走网页逻辑');
});

test('P11 本地路径：parseDocLinks 混合解析本地与网页、默认取文件名做标题、支持带引号整行', () => {
  const r = parseDocLinks('需求文档 | D:\\资料\\需求.docx\nhttps://github.com/u/r\n"C:\\会议纪要\\2026-08-周会.docx"');
  assert.equal(r.ok, true);
  assert.deepEqual(r.links, [
    { title: '需求文档', url: 'D:\\资料\\需求.docx' },
    { title: 'r', url: 'https://github.com/u/r' },
    { title: '2026-08-周会.docx', url: 'C:\\会议纪要\\2026-08-周会.docx' }
  ]);
});

test('P11 本地路径：含反斜杠的非法输入给出针对性错误提示（不误判为域名）', () => {
  const r = parseDocLinks('docs\\readme.md');
  assert.equal(r.ok, false);
  assert.match(r.error, /不是有效的本地绝对路径/);
  assert.match(parseDocLinks('标题|notes\\a.pdf').error, /第 1 行/);
});

test('P11 本地路径：isWebLink 区分网页与本地；docFileTitle 取末段文件名', () => {
  assert.equal(isWebLink('https://a.com'), true);
  assert.equal(isWebLink('http://a.com/x'), true);
  assert.equal(isWebLink('D:\\a.md'), false);
  assert.equal(isWebLink('\\\\s\\share'), false);
  assert.equal(isWebLink(''), false);
  assert.equal(docFileTitle('D:\\docs\\PRD.md'), 'PRD.md');
  assert.equal(docFileTitle('/home/u/报告.pdf'), '报告.pdf');
  assert.equal(docFileTitle('D:\\资料\\'), '资料', '尾部分隔符去除');
  assert.equal(docFileTitle('\\\\server\\share'), 'share');
});

test('P11 本地路径：format → parse 往返保留本地路径，空标题由文件名推导', () => {
  const src = [{ title: 'PRD', url: 'D:\\docs\\PRD.md' }, { title: '', url: 'C:\\a.md' }];
  const r = parseDocLinks(formatDocLinks(src));
  assert.deepEqual(r.links, [
    { title: 'PRD', url: 'D:\\docs\\PRD.md' },
    { title: 'a.md', url: 'C:\\a.md' }
  ]);
});
