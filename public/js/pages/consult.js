// 咨询工作：客户管理 + 咨询记录/待办/费用 三标签页
import { getState, mutate } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { openForm } from '../components/modal.js';
import { emptyEl } from '../components/empty.js';
import { clientFeeSummary, todayStr, uid } from '../logic.js';

let selectedId = null;
let tab = 'records'; // records | todos | fees

const STATUS = {
  potential: { label: '潜在', cls: 'badge-gray' },
  active: { label: '进行中', cls: 'badge-blue' },
  done: { label: '已结束', cls: 'badge-green' }
};

export async function render(container) {
  container.innerHTML = '';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '咨询工作';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '管理客户、每次咨询的记录、客户相关待办与费用。';
  container.append(title, sub);

  const state = getState();
  const clients = state.clients || [];
  if (!clients.some(c => c.id === selectedId)) selectedId = clients[0]?.id || null;
  const client = clients.find(c => c.id === selectedId) || null;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:16px;align-items:flex-start;';

  // ---------- 左栏：客户列表 ----------
  const left = document.createElement('div');
  left.style.cssText = 'width:230px;flex-shrink:0;';
  const leftCard = document.createElement('div');
  leftCard.className = 'card';
  leftCard.style.cssText = 'padding:10px;';
  const leftHead = document.createElement('div');
  leftHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
  const leftTitle = document.createElement('div');
  leftTitle.style.cssText = 'font-size:14px;font-weight:600;';
  leftTitle.textContent = `客户（${clients.length}）`;
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-sm btn-primary';
  addBtn.textContent = '+ 新建';
  addBtn.onclick = () => addClientModal(container);
  leftHead.append(leftTitle, addBtn);
  leftCard.append(leftHead);

  if (!clients.length) {
    leftCard.append(emptyEl('还没有客户'));
  } else {
    for (const c of clients) {
      const item = document.createElement('div');
      item.className = 'row';
      item.style.cssText = 'cursor:pointer;' + (c.id === selectedId ? 'border-color:var(--accent);background:#eef1fe;' : '');
      item.onclick = () => { selectedId = c.id; render(container); };
      const inner = document.createElement('div');
      inner.style.cssText = 'flex:1;min-width:0;';
      const name = document.createElement('div');
      name.style.cssText = 'font-weight:600;font-size:13px;';
      name.textContent = c.name;
      const meta = document.createElement('div');
      meta.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:2px;';
      const badge = document.createElement('span');
      badge.className = `badge ${STATUS[c.status]?.cls || 'badge-gray'}`;
      badge.textContent = STATUS[c.status]?.label || c.status;
      meta.append(badge);
      inner.append(name, meta);
      item.append(inner);
      leftCard.append(item);
    }
  }
  left.append(leftCard);
  wrap.append(left);

  // ---------- 右栏：选中客户 ----------
  const right = document.createElement('div');
  right.style.cssText = 'flex:1;min-width:0;';
  if (!client) {
    right.append(emptyEl('还没有客户，点击左侧「+ 新建」开始'));
  } else {
    // 客户头
    const head = document.createElement('div');
    head.className = 'card';
    head.style.cssText = 'margin-bottom:12px;';
    const headRow = document.createElement('div');
    headRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    const hName = document.createElement('h2');
    hName.style.fontSize = '17px';
    hName.textContent = client.name;
    const statusSel = document.createElement('select');
    statusSel.style.cssText = 'width:auto;padding:4px 8px;font-size:13px;';
    for (const [k, v] of Object.entries(STATUS)) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = v.label;
      opt.selected = client.status === k;
      statusSel.append(opt);
    }
    statusSel.onchange = () => {
      mutate(s => { s.clients.find(x => x.id === client.id).status = statusSel.value; });
      toast('状态已更新');
      render(container);
    };
    const feeSummary = clientFeeSummary(client.fees);
    const feeInfo = document.createElement('span');
    feeInfo.style.cssText = 'font-size:13px;';
    feeInfo.innerHTML = `已收 <b style="color:var(--green)">¥${feeSummary.received}</b> · 待收 <b style="color:var(--orange)">¥${feeSummary.pending}</b>`;
    const headActions = document.createElement('div');
    headActions.style.cssText = 'margin-left:auto;display:flex;gap:6px;';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm';
    editBtn.textContent = '编辑';
    editBtn.onclick = () => editClientModal(client, container);
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = '删除';
    delBtn.onclick = async () => {
      const ok = await confirmDialog({
        title: '删除客户',
        message: `确定删除客户「${client.name}」吗？\n其咨询记录、待办、费用将一并删除。`,
        okText: '删除', danger: true
      });
      if (!ok) return;
      mutate(s => { s.clients = s.clients.filter(x => x.id !== client.id); });
      selectedId = null;
      toast('已删除');
      render(container);
    };
    headActions.append(editBtn, delBtn);
    headRow.append(hName, statusSel, feeInfo, headActions);
    head.append(headRow);
    if (client.phone) {
      const phone = document.createElement('div');
      phone.style.cssText = 'font-size:13px;color:var(--text-soft);margin-top:6px;';
      phone.textContent = `电话：${client.phone}`;
      head.append(phone);
    }
    if (client.note) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:13px;color:var(--text-soft);margin-top:4px;';
      note.textContent = `备注：${client.note}`;
      head.append(note);
    }
    right.append(head);

    // 标签页
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    for (const [key, label] of [['records', '咨询记录'], ['todos', '待办事项'], ['fees', '费用记录']]) {
      const b = document.createElement('button');
      b.className = 'tab' + (tab === key ? ' active' : '');
      b.textContent = label;
      b.onclick = () => { tab = key; render(container); };
      tabs.append(b);
    }
    right.append(tabs);

    if (tab === 'records') right.append(recordsPanel(client, container));
    else if (tab === 'todos') right.append(todosPanel(client, container));
    else right.append(feesPanel(client, container));
  }
  wrap.append(right);
  container.append(wrap);

  // ---------- 内部函数 ----------
  function addClientModal(ctx) {
    openForm({
      title: '新建客户',
      fields: [
        { key: 'name', label: '姓名/称呼', type: 'text', required: true },
        { key: 'phone', label: '电话（可选）', type: 'text' },
        { key: 'status', label: '状态', type: 'select', options: Object.entries(STATUS).map(([k, v]) => ({ value: k, label: v.label })) },
        { key: 'note', label: '备注（可选）', type: 'text' }
      ],
      values: { status: 'potential' },
      onSubmit: async v => {
        if (clients.some(c => c.name === v.name.trim())) throw new Error('客户名已存在');
        mutate(s => {
          s.clients.push({ id: uid('c'), name: v.name.trim(), phone: v.phone.trim(), status: v.status, note: v.note.trim(), records: [], todos: [], fees: [] });
          selectedId = s.clients[s.clients.length - 1].id;
        });
        toast('已创建');
        render(ctx);
      }
    });
  }

  function editClientModal(c, ctx) {
    openForm({
      title: '编辑客户',
      fields: [
        { key: 'name', label: '姓名/称呼', type: 'text', required: true },
        { key: 'phone', label: '电话', type: 'text' },
        { key: 'status', label: '状态', type: 'select', options: Object.entries(STATUS).map(([k, v]) => ({ value: k, label: v.label })) },
        { key: 'note', label: '备注', type: 'text' }
      ],
      values: { name: c.name, phone: c.phone || '', status: c.status, note: c.note || '' },
      onSubmit: async v => {
        if (clients.some(x => x.id !== c.id && x.name === v.name.trim())) throw new Error('客户名已存在');
        mutate(s => {
          const cl = s.clients.find(x => x.id === c.id);
          Object.assign(cl, { name: v.name.trim(), phone: v.phone.trim(), status: v.status, note: v.note.trim() });
        });
        toast('已保存');
        render(ctx);
      }
    });
  }

  function recordsPanel(c, ctx) {
    const box = document.createElement('div');
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:10px;';
    const addR = document.createElement('button');
    addR.className = 'btn btn-sm btn-primary';
    addR.textContent = '＋ 记一条咨询';
    addR.onclick = () => {
      openForm({
        title: '记录咨询',
        fields: [
          { key: 'date', label: '日期', type: 'date', required: true },
          { key: 'content', label: '聊了什么', type: 'textarea', required: true }
        ],
        values: { date: todayStr() },
        onSubmit: async v => {
          mutate(s => {
            const cl = s.clients.find(x => x.id === c.id);
            cl.records.push({ id: uid('r'), date: v.date, content: v.content.trim() });
          });
          toast('已记录');
          render(ctx);
        }
      });
    };
    head.append(addR);
    box.append(head);

    const records = [...(c.records || [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!records.length) {
      box.append(emptyEl('还没有咨询记录，点右上角记一条'));
    } else {
      for (const r of records) {
        const row = document.createElement('div');
        row.className = 'row';
        const inner = document.createElement('div');
        inner.style.cssText = 'flex:1;min-width:0;';
        const date = document.createElement('div');
        date.style.cssText = 'font-size:11px;color:var(--text-soft);';
        date.textContent = r.date;
        const content = document.createElement('div');
        content.style.cssText = 'font-size:14px;white-space:pre-line;';
        content.textContent = r.content;
        inner.append(date, content);
        row.append(inner);
        const del = document.createElement('button');
        del.className = 'btn-icon';
        del.textContent = '🗑️';
        del.title = '删除记录';
        del.onclick = async () => {
          const ok = await confirmDialog({ title: '删除记录', message: '确定删除这条咨询记录吗？', okText: '删除', danger: true });
          if (!ok) return;
          mutate(s => {
            const cl = s.clients.find(x => x.id === c.id);
            cl.records = cl.records.filter(x => x.id !== r.id);
          });
          toast('已删除');
          render(ctx);
        };
        row.append(del);
        box.append(row);
      }
    }
    return box;
  }

  function todosPanel(c, ctx) {
    const box = document.createElement('div');
    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '加一件客户相关待办，回车添加...';
    const addB = document.createElement('button');
    addB.className = 'btn btn-sm btn-primary';
    addB.textContent = '＋ 添加';
    const doAdd = () => {
      const text = input.value.trim();
      if (!text) return;
      mutate(s => {
        const cl = s.clients.find(x => x.id === c.id);
        cl.todos.push({ id: uid('ct'), text, done: false });
      });
      input.value = '';
      toast('已添加');
      render(ctx);
    };
    input.onkeydown = e => { if (e.key === 'Enter') doAdd(); };
    addB.onclick = doAdd;
    addRow.append(input, addB);
    box.append(addRow);

    const todos = c.todos || [];
    if (!todos.length) {
      box.append(emptyEl('还没有待办事项'));
    } else {
      const pending = todos.filter(t => !t.done);
      const done = todos.filter(t => t.done);
      const section = (arr, isDone) => {
        for (const t of arr) {
          const row = document.createElement('div');
          row.className = 'row' + (isDone ? ' done' : '');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = isDone;
          cb.style.cssText = 'width:16px;height:16px;flex-shrink:0;cursor:pointer;';
          cb.onchange = () => {
            mutate(s => {
              const cl = s.clients.find(x => x.id === c.id);
              const item = cl.todos.find(x => x.id === t.id);
              if (item) item.done = cb.checked;
            });
            toast('已更新');
            render(ctx);
          };
          const text = document.createElement('span');
          text.className = 'row-text';
          text.textContent = t.text;
          const del = document.createElement('button');
          del.className = 'btn-icon';
          del.textContent = '🗑️';
          del.title = '删除';
          del.onclick = async () => {
            const ok = await confirmDialog({ title: '删除待办', message: `确定删除「${t.text}」吗？`, okText: '删除', danger: true });
            if (!ok) return;
            mutate(s => {
              const cl = s.clients.find(x => x.id === c.id);
              cl.todos = cl.todos.filter(x => x.id !== t.id);
            });
            toast('已删除');
            render(ctx);
          };
          row.append(cb, text, del);
          box.append(row);
        }
      };
      section(pending, false);
      if (done.length) {
        const sep = document.createElement('div');
        sep.style.cssText = 'color:var(--text-soft);font-size:12px;margin:12px 0 8px;';
        sep.textContent = `—— 已完成（${done.length}）——`;
        box.append(sep);
        section(done, true);
      }
    }
    return box;
  }

  function feesPanel(c, ctx) {
    const box = document.createElement('div');
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:10px;';
    const addF = document.createElement('button');
    addF.className = 'btn btn-sm btn-primary';
    addF.textContent = '＋ 记一笔费用';
    addF.onclick = () => {
      openForm({
        title: '记录费用',
        fields: [
          { key: 'amount', label: '金额（元）', type: 'number', required: true },
          { key: 'date', label: '日期', type: 'date', required: true },
          { key: 'received', label: '收款状态', type: 'select', options: [{ value: '0', label: '待收' }, { value: '1', label: '已收' }] }
        ],
        values: { date: todayStr(), received: '0' },
        onSubmit: async v => {
          if (v.amount <= 0) throw new Error('金额必须大于0');
          mutate(s => {
            const cl = s.clients.find(x => x.id === c.id);
            cl.fees.push({ id: uid('f'), amount: v.amount, date: v.date, received: v.received === '1' });
          });
          toast('已记录');
          render(ctx);
        }
      });
    };
    head.append(addF);
    box.append(head);

    const fees = [...(c.fees || [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!fees.length) {
      box.append(emptyEl('还没有费用记录'));
    } else {
      for (const f of fees) {
        const row = document.createElement('div');
        row.className = 'row';
        const inner = document.createElement('div');
        inner.style.cssText = 'flex:1;min-width:0;';
        const date = document.createElement('div');
        date.style.cssText = 'font-size:11px;color:var(--text-soft);';
        date.textContent = f.date;
        inner.append(date);
        row.append(inner);
        const amt = document.createElement('b');
        amt.style.cssText = 'font-size:15px;';
        amt.textContent = `¥${f.amount}`;
        row.append(amt);
        const badge = document.createElement('span');
        badge.className = f.received ? 'badge badge-green' : 'badge badge-orange';
        badge.textContent = f.received ? '已收' : '待收';
        row.append(badge);
        if (!f.received) {
          const rec = document.createElement('button');
          rec.className = 'btn btn-sm';
          rec.textContent = '标记已收';
          rec.onclick = () => {
            mutate(s => {
              const cl = s.clients.find(x => x.id === c.id);
              const fee = cl.fees.find(x => x.id === f.id);
              if (fee) fee.received = true;
            });
            toast('已收');
            render(ctx);
          };
          row.append(rec);
        }
        const editB = document.createElement('button');
        editB.className = 'btn-icon';
        editB.textContent = '✏️';
        editB.title = '编辑';
        editB.onclick = () => {
          openForm({
            title: '编辑费用',
            fields: [
              { key: 'amount', label: '金额（元）', type: 'number', required: true },
              { key: 'date', label: '日期', type: 'date', required: true },
              { key: 'received', label: '收款状态', type: 'select', options: [{ value: '0', label: '待收' }, { value: '1', label: '已收' }] }
            ],
            values: { amount: f.amount, date: f.date, received: f.received ? '1' : '0' },
            onSubmit: async v => {
              if (v.amount <= 0) throw new Error('金额必须大于0');
              mutate(s => {
                const cl = s.clients.find(x => x.id === c.id);
                const fee = cl.fees.find(x => x.id === f.id);
                Object.assign(fee, { amount: v.amount, date: v.date, received: v.received === '1' });
              });
              toast('已保存');
              render(ctx);
            }
          });
        };
        const delB = document.createElement('button');
        delB.className = 'btn-icon';
        delB.textContent = '🗑️';
        delB.title = '删除';
        delB.onclick = async () => {
          const ok = await confirmDialog({ title: '删除费用', message: `确定删除这笔 ¥${f.amount} 吗？`, okText: '删除', danger: true });
          if (!ok) return;
          mutate(s => {
            const cl = s.clients.find(x => x.id === c.id);
            cl.fees = cl.fees.filter(x => x.id !== f.id);
          });
          toast('已删除');
          render(ctx);
        };
        row.append(editB, delB);
        box.append(row);
      }
    }
    return box;
  }
}
