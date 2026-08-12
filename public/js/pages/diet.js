// 饮食计划：每天4餐记录 + 进度点 + 历史回看
import { getState, mutate } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { openForm } from '../components/modal.js';
import { emptyEl } from '../components/empty.js';
import { dateNav } from '../components/dateNav.js';
import { dietProgress, daysSinceLastMeal, todayStr, uid } from '../logic.js';

let viewDate = todayStr();

const MEALS = [
  { key: 'breakfast', label: '🍳 早餐' },
  { key: 'lunch', label: '🍚 午餐' },
  { key: 'dinner', label: '🍜 晚餐' },
  { key: 'snack', label: '🍪 加餐' }
];

export async function render(container) {
  container.innerHTML = '';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '饮食计划';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '记录每天吃了什么，今天漏没漏顿一眼看出。';
  container.append(title, sub);

  container.append(dateNav({
    mode: 'day', value: viewDate,
    onChange: v => { viewDate = v; render(container); }
  }));

  const state = getState();
  const meals = state.meals || {};

  // 进度点
  const p = dietProgress(meals, viewDate);
  const prog = document.createElement('div');
  prog.className = 'card';
  prog.style.cssText = 'margin-bottom:14px;font-size:14px;';
  const progLine = document.createElement('div');
  progLine.style.cssText = 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;';
  for (const m of MEALS) {
    const dot = document.createElement('span');
    dot.textContent = `${p.dots[m.key] ? '●' : '○'} ${m.label.replace(/^\S+\s/, '')}`;
    dot.style.cssText = `font-weight:600;color:${p.dots[m.key] ? 'var(--green)' : 'var(--text-soft)'};`;
    progLine.append(dot);
  }
  const count = document.createElement('span');
  count.style.cssText = 'margin-left:auto;color:var(--text-soft);font-size:13px;';
  count.textContent = `已记录 ${p.count}/4 餐`;
  progLine.append(count);
  prog.append(progLine);
  container.append(prog);

  // 断档提示（仅今天视角）
  if (viewDate === todayStr()) {
    const gap = daysSinceLastMeal(meals, viewDate);
    if (gap > 3) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:var(--text-soft);font-size:13px;margin-bottom:12px;background:var(--gray-light);padding:8px 12px;border-radius:8px;';
      hint.textContent = gap === Infinity ? '还没有记录过饮食' : `已 ${gap} 天没有记录饮食了`;
      container.append(hint);
    }
  }

  // 4 餐格子
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:12px;';
  for (const m of MEALS) {
    const card = document.createElement('div');
    card.className = 'card';
    const day = meals[viewDate] || {};
    const rec = day[m.key] || null;

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:14px;font-weight:600;';
    label.textContent = m.label;
    head.append(label);

    if (!rec) {
      const add = document.createElement('button');
      add.className = 'btn btn-sm';
      add.textContent = '＋ 记录';
      add.onclick = () => mealModal(m.key, null, container);
      head.append(add);
      card.append(head, emptyEl('还没记录'));
    } else {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:2px;';
      const editB = document.createElement('button');
      editB.className = 'btn-icon';
      editB.textContent = '✏️';
      editB.title = '编辑';
      editB.onclick = () => mealModal(m.key, rec, container);
      const delB = document.createElement('button');
      delB.className = 'btn-icon';
      delB.textContent = '🗑️';
      delB.title = '删除';
      delB.onclick = async () => {
        const ok = await confirmDialog({ title: '删除记录', message: `确定删除${m.label.replace(/^\S+\s/, '')}的记录吗？`, okText: '删除', danger: true });
        if (!ok) return;
        mutate(s => {
          if (!s.meals[viewDate]) s.meals[viewDate] = {};
          s.meals[viewDate][m.key] = null;
        });
        toast('已删除');
        render(container);
      };
      actions.append(editB, delB);
      head.append(actions);
      card.append(head);

      const food = document.createElement('div');
      food.style.cssText = 'font-size:15px;margin-bottom:4px;';
      food.textContent = rec.food;
      card.append(food);
      if (rec.note) {
        const note = document.createElement('div');
        note.style.cssText = 'font-size:12px;color:var(--text-soft);';
        note.textContent = rec.note;
        card.append(note);
      }
    }
    grid.append(card);
  }
  container.append(grid);

  function mealModal(key, rec, ctx) {
    openForm({
      title: rec ? `编辑${MEALS.find(m => m.key === key).label.replace(/^\S+\s/, '')}` : `记录${MEALS.find(m => m.key === key).label.replace(/^\S+\s/, '')}`,
      fields: [
        { key: 'food', label: '吃了什么', type: 'text', required: true, placeholder: '例如：两个鸡蛋 + 牛奶' },
        { key: 'note', label: '备注（可选）', type: 'text' }
      ],
      values: { food: rec?.food || '', note: rec?.note || '' },
      onSubmit: async v => {
        mutate(s => {
          if (!s.meals[viewDate]) s.meals[viewDate] = {};
          s.meals[viewDate][key] = { food: v.food.trim(), note: v.note.trim() };
        });
        toast(rec ? '已保存' : '已记录');
        render(ctx);
      }
    });
  }
}
