// 数据与设置：备份/恢复/清空 + 账目分类管理
import { getState, mutate, replaceState } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { openForm } from '../components/modal.js';
import { emptyEl } from '../components/empty.js';
import { getInfo, downloadBackup } from '../api.js';
import { defaultData, validateData, canDeleteCategory } from '../logic.js';

const KIND_LABEL = { expense: '支出', income: '收入', both: '通用' };

export async function render(container) {
  container.innerHTML = '';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '数据与设置';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '备份、恢复、清空数据，管理账目分类。';
  container.append(title, sub);

  const state = getState();

  // ---------- 数据文件信息 ----------
  const infoCard = document.createElement('div');
  infoCard.className = 'card';
  infoCard.style.cssText = 'margin-bottom:14px;';
  infoCard.append(sectionTitle('数据文件'));
  const infoWrap = document.createElement('div');
  infoWrap.style.cssText = 'font-size:13px;line-height:1.8;';
  infoWrap.textContent = '读取中...';
  infoCard.append(infoWrap);
  container.append(infoCard);

  try {
    const info = await getInfo();
    const sizeKB = (info.size / 1024).toFixed(1);
    const saved = info.updatedAt ? new Date(info.updatedAt).toLocaleString('zh-CN') : '（尚未保存）';
    infoWrap.innerHTML = '';
    const line = (label, val) => {
      const d = document.createElement('div');
      const l = document.createElement('span');
      l.style.cssText = 'color:var(--text-soft);';
      l.textContent = `${label}：`;
      const v = document.createElement('span');
      v.style.cssText = 'word-break:break-all;';
      v.textContent = val;
      d.append(l, v);
      return d;
    };
    infoWrap.append(
      line('文件位置', info.filePath),
      line('大小', `${sizeKB} KB`),
      line('上次保存', saved)
    );
  } catch (e) {
    infoWrap.textContent = '读取数据信息失败';
  }

  // ---------- 备份 / 恢复 / 清空 ----------
  const opsCard = document.createElement('div');
  opsCard.className = 'card';
  opsCard.style.cssText = 'margin-bottom:14px;';
  opsCard.append(sectionTitle('备份与恢复'));

  const opsRow = document.createElement('div');
  opsRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;';

  const backupBtn = document.createElement('button');
  backupBtn.className = 'btn btn-primary';
  backupBtn.textContent = '💾 一键备份';
  backupBtn.onclick = () => { downloadBackup(); toast('备份已开始'); };
  opsRow.append(backupBtn);

  const restoreInput = document.createElement('input');
  restoreInput.type = 'file';
  restoreInput.accept = '.json,application/json';
  restoreInput.style.display = 'none';
  restoreInput.onchange = () => restoreFlow(restoreInput, container);
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'btn';
  restoreBtn.textContent = '↩ 从备份恢复';
  restoreBtn.onclick = () => restoreInput.click();
  opsRow.append(restoreBtn, restoreInput);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-danger';
  clearBtn.textContent = '🧹 清空全部数据';
  clearBtn.onclick = () => clearFlow(container);
  opsRow.append(clearBtn);

  opsCard.append(opsRow);
  container.append(opsCard);

  // ---------- 分类管理 ----------
  const catCard = document.createElement('div');
  catCard.className = 'card';
  const catHead = document.createElement('div');
  catHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
  const catTitle = document.createElement('div');
  catTitle.style.cssText = 'font-size:14px;font-weight:600;';
  catTitle.textContent = '账目分类';
  const addCatBtn = document.createElement('button');
  addCatBtn.className = 'btn btn-sm btn-primary';
  addCatBtn.textContent = '＋ 添加分类';
  addCatBtn.onclick = () => addCategoryFlow(container);
  catHead.append(catTitle, addCatBtn);
  catCard.append(catHead);

  const cats = state.categories || [];
  if (!cats.length) {
    catCard.append(emptyEl('还没有分类'));
  } else {
    for (const c of cats) {
      const row = document.createElement('div');
      row.className = 'row';
      const inner = document.createElement('div');
      inner.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
      const name = document.createElement('span');
      name.style.cssText = 'font-size:14px;font-weight:600;';
      name.textContent = c.name;
      inner.append(name);
      const kindBadge = document.createElement('span');
      kindBadge.className = 'badge ' + (c.kind === 'income' ? 'badge-green' : c.kind === 'both' ? 'badge-gray' : 'badge-blue');
      kindBadge.textContent = KIND_LABEL[c.kind] || c.kind;
      inner.append(kindBadge);
      if (c.builtin) {
        const builtinBadge = document.createElement('span');
        builtinBadge.className = 'badge badge-gray';
        builtinBadge.textContent = '默认';
        inner.append(builtinBadge);
      }
      row.append(inner);
      if (!c.builtin) {
        const delB = document.createElement('button');
        delB.className = 'btn-icon';
        delB.textContent = '🗑️';
        delB.title = '删除分类';
        delB.onclick = async () => {
          const check = canDeleteCategory(state.categories, c.name, state.ledger || []);
          if (!check.ok) { toast(check.error); return; }
          const ok = await confirmDialog({ title: '删除分类', message: `确定删除分类「${c.name}」吗？`, okText: '删除', danger: true });
          if (!ok) return;
          mutate(s => { s.categories = s.categories.filter(x => x.name !== c.name); });
          toast('已删除');
          render(container);
        };
        row.append(delB);
      }
      catCard.append(row);
    }
  }
  container.append(catCard);

  // ---------- 内部函数 ----------
  function sectionTitle(text) {
    const d = document.createElement('div');
    d.style.cssText = 'font-weight:600;margin-bottom:10px;';
    d.textContent = text;
    return d;
  }

  async function restoreFlow(input, ctx) {
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = '';
    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch (e) {
      toast('备份文件不是有效的 JSON');
      return;
    }
    const check = validateData(obj);
    if (!check.ok) { toast('备份文件格式不正确：' + check.errors[0]); return; }
    const ok1 = await confirmDialog({
      title: '恢复备份',
      message: '恢复将覆盖当前所有数据，且不可撤销。确定继续吗？',
      okText: '继续', danger: true
    });
    if (!ok1) return;
    const ok2 = await confirmDialog({
      title: '最终确认',
      message: '请再次确认，输入「确认」两字以执行恢复。',
      okText: '执行恢复', danger: true, requireText: '确认'
    });
    if (!ok2) return;
    replaceState(obj);
    toast('已恢复');
    await render(ctx);
  }

  async function clearFlow(ctx) {
    const ok1 = await confirmDialog({
      title: '清空全部数据',
      message: '此操作将删除全部数据且不可恢复。确定继续吗？',
      okText: '继续', danger: true
    });
    if (!ok1) return;
    const ok2 = await confirmDialog({
      title: '最终确认',
      message: '请再次确认，输入「确认」两字以清空全部数据。',
      okText: '清空', danger: true, requireText: '确认'
    });
    if (!ok2) return;
    replaceState(defaultData());
    toast('已清空');
    await render(ctx);
  }

  function addCategoryFlow(ctx) {
    openForm({
      title: '添加分类',
      fields: [
        { key: 'name', label: '分类名', type: 'text', required: true },
        { key: 'kind', label: '用途', type: 'select', options: [
          { value: 'expense', label: '支出' },
          { value: 'income', label: '收入' },
          { value: 'both', label: '支出与收入' }
        ] }
      ],
      values: { kind: 'expense' },
      onSubmit: async v => {
        const name = String(v.name).trim();
        if (!name) throw new Error('分类名不能为空');
        if ((state.categories || []).some(c => c.name === name)) throw new Error('分类已存在');
        mutate(s => { s.categories.push({ name, kind: v.kind, builtin: false }); });
        toast('已添加');
        render(ctx);
      }
    });
  }
}
