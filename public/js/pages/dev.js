// 开发工作：项目管理 + 三栏任务看板 + 工作日志
import { getState, mutate } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { openForm } from '../components/modal.js';
import { emptyEl } from '../components/empty.js';
import { projectCounts, todayStr, uid } from '../logic.js';

let selectedId = null;
const STATUSES = [
  { key: 'todo', label: '待办' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完成' }
];
const NEXT = { todo: 'doing', doing: 'done', done: null };

export async function render(container) {
  container.innerHTML = '';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '开发工作';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '管理你的开发项目：任务三栏看板 + 每项目的专属工作日志。';
  container.append(title, sub);

  const state = getState();
  const projects = state.projects || [];
  if (!projects.some(p => p.id === selectedId)) selectedId = projects[0]?.id || null;
  const project = projects.find(p => p.id === selectedId) || null;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:16px;align-items:flex-start;';

  // ---------- 左栏：项目列表 ----------
  const left = document.createElement('div');
  left.style.cssText = 'width:230px;flex-shrink:0;';
  const leftCard = document.createElement('div');
  leftCard.className = 'card';
  leftCard.style.cssText = 'padding:10px;';
  const leftHead = document.createElement('div');
  leftHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
  const leftTitle = document.createElement('div');
  leftTitle.style.fontSize = '14px';
  leftTitle.style.fontWeight = '600';
  leftTitle.textContent = `项目（${projects.length}）`;
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-sm btn-primary';
  addBtn.textContent = '+ 新建';
  addBtn.onclick = async () => {
    const res = await openForm({
      title: '新建项目',
      fields: [
        { key: 'name', label: '项目名称', type: 'text', required: true, placeholder: '例如：WorkLift' },
        { key: 'desc', label: '一句话说明（可选）', type: 'text' }
      ],
      onSubmit: async v => {
        if (projects.some(p => p.name === v.name.trim())) throw new Error('项目名已存在');
        mutate(s => {
          s.projects.push({ id: uid('pr'), name: v.name.trim(), desc: v.desc.trim(), tasks: [], logs: [] });
          selectedId = s.projects[s.projects.length - 1].id;
        });
        toast('已创建');
        render(container);
      }
    });
  };
  leftHead.append(leftTitle, addBtn);
  leftCard.append(leftHead);

  if (!projects.length) {
    leftCard.append(emptyEl('还没有项目'));
  } else {
    for (const p of projects) {
      const c = projectCounts(p);
      const item = document.createElement('div');
      item.className = 'row';
      item.style.cssText = 'cursor:pointer;' + (p.id === selectedId ? 'border-color:var(--accent);background:#eef1fe;' : '');
      item.onclick = () => { selectedId = p.id; render(container); };
      const name = document.createElement('div');
      name.style.cssText = 'font-weight:600;font-size:13px;';
      name.textContent = p.name;
      const count = document.createElement('div');
      count.style.cssText = 'font-size:11px;color:var(--text-soft);';
      count.textContent = `待办${c.todo} · 进行中${c.doing}`;
      const inner = document.createElement('div');
      inner.append(name, count);
      item.append(inner);
      leftCard.append(item);
    }
  }
  left.append(leftCard);
  wrap.append(left);

  // ---------- 右栏：选中项目 ----------
  const right = document.createElement('div');
  right.style.cssText = 'flex:1;min-width:0;';
  if (!project) {
    right.append(emptyEl('还没有项目，点击左侧「+ 新建」开始'));
  } else {
    // 项目头
    const head = document.createElement('div');
    head.className = 'card';
    head.style.cssText = 'margin-bottom:14px;';
    const headRow = document.createElement('div');
    headRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    const hName = document.createElement('h2');
    hName.style.fontSize = '17px';
    hName.textContent = project.name;
    const hDesc = document.createElement('span');
    hDesc.style.cssText = 'color:var(--text-soft);font-size:13px;';
    hDesc.textContent = project.desc || '';
    const headActions = document.createElement('div');
    headActions.style.cssText = 'margin-left:auto;display:flex;gap:6px;';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm';
    editBtn.textContent = '编辑项目';
    editBtn.onclick = async () => {
      await openForm({
        title: '编辑项目',
        fields: [
          { key: 'name', label: '项目名称', type: 'text', required: true },
          { key: 'desc', label: '一句话说明', type: 'text' }
        ],
        values: { name: project.name, desc: project.desc },
        onSubmit: async v => {
          if (projects.some(p => p.id !== project.id && p.name === v.name.trim())) throw new Error('项目名已存在');
          mutate(s => {
            const p = s.projects.find(x => x.id === project.id);
            p.name = v.name.trim();
            p.desc = v.desc.trim();
          });
          toast('已保存');
          render(container);
        }
      });
    };
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = '删除项目';
    delBtn.onclick = async () => {
      const ok = await confirmDialog({
        title: '删除项目',
        message: `确定删除项目「${project.name}」吗？\n项目下的任务和工作日志将一并删除。`,
        okText: '删除', danger: true
      });
      if (!ok) return;
      mutate(s => { s.projects = s.projects.filter(x => x.id !== project.id); });
      selectedId = null;
      toast('已删除');
      render(container);
    };
    headActions.append(editBtn, delBtn);
    headRow.append(hName, hDesc, headActions);
    head.append(headRow);
    right.append(head);

    // 三栏看板
    const board = document.createElement('div');
    board.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px;';
    for (const st of STATUSES) {
      const col = document.createElement('div');
      col.className = 'card';
      col.style.cssText = 'padding:12px;';
      const colTasks = (project.tasks || []).filter(t => t.status === st.key);
      const colHead = document.createElement('div');
      colHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
      const colTitle = document.createElement('div');
      colTitle.style.cssText = 'font-size:13px;font-weight:600;';
      colTitle.textContent = `${st.label}（${colTasks.length}）`;
      const addTask = document.createElement('button');
      addTask.className = 'btn btn-sm';
      addTask.textContent = '＋ 加任务';
      addTask.onclick = () => addTaskModal(project.id, st.key, container);
      colHead.append(colTitle, addTask);
      col.append(colHead);

      if (!colTasks.length) {
        col.append(emptyEl('空'));
      } else {
        for (const t of colTasks) col.append(taskRow(project.id, t, container));
      }
      board.append(col);
    }
    right.append(board);

    // 工作日志
    const logCard = document.createElement('div');
    logCard.className = 'card';
    const logHead = document.createElement('div');
    logHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    const logTitle = document.createElement('div');
    logTitle.style.cssText = 'font-size:14px;font-weight:600;';
    logTitle.textContent = '⏱ 工作日志';
    const addLog = document.createElement('button');
    addLog.className = 'btn btn-sm btn-primary';
    addLog.textContent = '＋ 记一笔';
    addLog.onclick = () => addLogModal(project.id, container);
    logHead.append(logTitle, addLog);
    logCard.append(logHead);

    const logs = [...(project.logs || [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!logs.length) {
      logCard.append(emptyEl('还没有日志，记一笔今天的进展吧'));
    } else {
      for (const l of logs) {
        const row = document.createElement('div');
        row.className = 'row';
        const inner = document.createElement('div');
        inner.style.cssText = 'flex:1;min-width:0;';
        const date = document.createElement('div');
        date.style.cssText = 'font-size:11px;color:var(--text-soft);';
        date.textContent = l.date;
        const content = document.createElement('div');
        content.style.cssText = 'font-size:14px;';
        content.textContent = l.content;
        inner.append(date, content);
        row.append(inner);
        if (l.hours) {
          const h = document.createElement('span');
          h.className = 'badge badge-blue';
          h.textContent = l.hours;
          row.append(h);
        }
        const del = document.createElement('button');
        del.className = 'btn-icon';
        del.textContent = '🗑️';
        del.title = '删除日志';
        del.onclick = async () => {
          const ok = await confirmDialog({ title: '删除日志', message: '确定删除这条日志吗？', okText: '删除', danger: true });
          if (!ok) return;
          mutate(s => {
            const p = s.projects.find(x => x.id === project.id);
            p.logs = p.logs.filter(x => x.id !== l.id);
          });
          toast('已删除');
          render(container);
        };
        row.append(del);
        logCard.append(row);
      }
    }
    right.append(logCard);
  }
  wrap.append(right);
  container.append(wrap);

  // ---------- 内部函数 ----------
  function taskRow(projId, t, ctx) {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.cssText = 'cursor:pointer;flex-wrap:wrap;';
    const inner = document.createElement('div');
    inner.style.cssText = 'flex:1;min-width:0;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px;';
    title.textContent = t.title;
    inner.append(title);
    if (t.note) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:var(--text-soft);';
      note.textContent = t.note;
      inner.append(note);
    }
    row.append(inner);
    if (t.priority === 'important') {
      const star = document.createElement('span');
      star.className = 'badge badge-orange';
      star.textContent = '⭐';
      row.append(star);
    }
    if (NEXT[t.status]) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn btn-sm';
      nextBtn.textContent = '→';
      nextBtn.title = `移到「${STATUSES.find(s => s.key === NEXT[t.status]).label}」`;
      nextBtn.onclick = e => {
        e.stopPropagation();
        mutate(s => {
          const p = s.projects.find(x => x.id === projId);
          const task = (p.tasks || []).find(x => x.id === t.id);
          if (task) task.status = NEXT[t.status];
        });
        toast('已移动');
        render(ctx);
      };
      row.append(nextBtn);
    }
    row.onclick = () => editTaskModal(projId, t, ctx);
    return row;
  }

  function addTaskModal(projId, status, ctx) {
    openForm({
      title: `在「${STATUSES.find(s => s.key === status).label}」加任务`,
      fields: [
        { key: 'title', label: '任务标题', type: 'text', required: true },
        { key: 'priority', label: '优先级', type: 'select', options: [{ value: 'normal', label: '普通' }, { value: 'important', label: '⭐ 重要' }] },
        { key: 'note', label: '备注（可选）', type: 'text' }
      ],
      values: { priority: 'normal' },
      onSubmit: async v => {
        mutate(s => {
          const p = s.projects.find(x => x.id === projId);
          if (!p.tasks) p.tasks = [];
          p.tasks.push({ id: uid('t'), title: v.title.trim(), status, priority: v.priority, note: v.note.trim() });
        });
        toast('已添加');
        render(ctx);
      }
    });
  }

  function editTaskModal(projId, t, ctx) {
    openForm({
      title: '编辑任务',
      fields: [
        { key: 'title', label: '任务标题', type: 'text', required: true },
        { key: 'status', label: '状态', type: 'select', options: STATUSES.map(s => ({ value: s.key, label: s.label })) },
        { key: 'priority', label: '优先级', type: 'select', options: [{ value: 'normal', label: '普通' }, { value: 'important', label: '⭐ 重要' }] },
        { key: 'note', label: '备注', type: 'text' }
      ],
      values: { title: t.title, status: t.status, priority: t.priority || 'normal', note: t.note || '' },
      onSubmit: async v => {
        mutate(s => {
          const p = s.projects.find(x => x.id === projId);
          const task = (p.tasks || []).find(x => x.id === t.id);
          Object.assign(task, { title: v.title.trim(), status: v.status, priority: v.priority, note: v.note.trim() });
        });
        toast('已保存');
        render(ctx);
      }
    });
  }

  function addLogModal(projId, ctx) {
    openForm({
      title: '记一笔工作日志',
      fields: [
        { key: 'date', label: '日期', type: 'date', required: true },
        { key: 'content', label: '干了什么', type: 'textarea', required: true, placeholder: '例如：完成了首页设计' },
        { key: 'hours', label: '花了多久（可选）', type: 'text', placeholder: '例如：2小时' }
      ],
      values: { date: todayStr() },
      onSubmit: async v => {
        mutate(s => {
          const p = s.projects.find(x => x.id === projId);
          if (!p.logs) p.logs = [];
          p.logs.push({ id: uid('l'), date: v.date, content: v.content.trim(), hours: v.hours.trim() });
        });
        toast('已记录');
        render(ctx);
      }
    });
  }
}
