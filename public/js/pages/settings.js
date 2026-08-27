// 数据与设置：密码箱 + 备份/恢复/清空 + 账目分类管理
import { getState, mutate, replaceState } from '../store.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';
import { openForm } from '../components/modal.js';
import { emptyEl } from '../components/empty.js';
import { getInfo, downloadBackup } from '../api.js';
import { defaultData, validateData, canDeleteCategory } from '../logic.js';
import {
  isVaultConfigured, createVault, unlockVault, sealVault,
  validateMasterPassword, addVaultEntry, updateVaultEntry, removeVaultEntry
} from '../vault.js';
import { THEMES, applyTheme } from '../theme.js';

const KIND_LABEL = { expense: '支出', income: '收入', both: '通用' };

// 密码箱解锁会话：明文仅存于内存，切换页面或手动锁定时清除
let vaultSession = null;
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => { vaultSession = null; });
}

export async function render(container) {
  container.innerHTML = '';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '数据与设置';
  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = '密码箱、备份、恢复、清空数据，管理账目分类。';
  container.append(title, sub);

  const state = getState();

  // ---------- 页面外观（工作台主题） ----------
  const appearanceCard = document.createElement('div');
  appearanceCard.className = 'card';
  appearanceCard.style.cssText = 'margin-bottom:14px;';
  appearanceCard.append(sectionTitle('🎨 工作台外观'));
  const appearTip = document.createElement('p');
  appearTip.style.cssText = 'font-size:13px;line-height:1.8;color:var(--text-soft);margin-bottom:12px;';
  appearTip.textContent = '选择工作台整体配色，即刻生效并自动保存。';
  appearanceCard.append(appearTip);
  const activeTheme = state.settings ? state.settings.theme : 'white';
  const grid = document.createElement('div');
  grid.className = 'appearance-grid';
  for (const [key, def] of Object.entries(THEMES)) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'theme-option' + (key === activeTheme ? ' active' : '');
    opt.dataset.theme = key;
    opt.title = def.desc;
    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    swatch.style.background = def.swatch;
    const label = document.createElement('span');
    label.className = 'theme-label';
    label.textContent = def.label;
    const desc = document.createElement('span');
    desc.className = 'theme-desc';
    desc.textContent = def.desc;
    opt.append(swatch, label, desc);
    opt.onclick = () => {
      mutate(s => { s.settings = s.settings || {}; s.settings.theme = key; });
      applyTheme(document.body, key);
      render(container);
    };
    grid.append(opt);
  }
  appearanceCard.append(grid);
  container.append(appearanceCard);

  // ---------- 密码箱 ----------
  const vaultCard = document.createElement('div');
  vaultCard.className = 'card';
  vaultCard.style.cssText = 'margin-bottom:14px;';
  vaultCard.append(sectionTitle('🔐 密码箱'));
  container.append(vaultCard);

  if (!isVaultConfigured(state.vault)) {
    const tip = document.createElement('p');
    tip.style.cssText = 'font-size:13px;line-height:1.8;color:var(--text-soft);margin-bottom:10px;';
    tip.textContent = '加密存储密码、密钥等重要信息。内容使用主密码加密后保存在本地数据文件中，数据文件里不含明文。';
    const setupBtn = document.createElement('button');
    setupBtn.className = 'btn btn-primary';
    setupBtn.textContent = '🔑 设置密码箱';
    setupBtn.onclick = () => setupVaultFlow(container);
    vaultCard.append(tip, setupBtn);
  } else if (!vaultSession) {
    const line = document.createElement('div');
    line.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    const badge = document.createElement('span');
    badge.className = 'badge badge-gray';
    badge.textContent = '🔒 已加密锁定';
    const tip = document.createElement('span');
    tip.style.cssText = 'font-size:13px;color:var(--text-soft);';
    tip.textContent = '条目已隐藏，输入主密码解锁查看。';
    const unlockBtn = document.createElement('button');
    unlockBtn.className = 'btn btn-primary';
    unlockBtn.textContent = '🔓 解锁';
    unlockBtn.onclick = () => unlockVaultFlow(container);
    line.append(badge, tip, unlockBtn);
    vaultCard.append(line);
  } else {
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;';
    const headLeft = document.createElement('div');
    headLeft.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const badge = document.createElement('span');
    badge.className = 'badge badge-green';
    badge.textContent = `🔓 已解锁（${vaultSession.entries.length} 条）`;
    headLeft.append(badge);
    const headRight = document.createElement('div');
    headRight.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm btn-primary';
    addBtn.textContent = '＋ 添加条目';
    addBtn.onclick = () => addEntryFlow(container);
    const changeBtn = document.createElement('button');
    changeBtn.className = 'btn btn-sm';
    changeBtn.textContent = '🔑 修改主密码';
    changeBtn.onclick = () => changePasswordFlow(container);
    const lockBtn = document.createElement('button');
    lockBtn.className = 'btn btn-sm';
    lockBtn.textContent = '🔒 锁定';
    lockBtn.onclick = () => { vaultSession = null; render(container); };
    headRight.append(addBtn, changeBtn, lockBtn);
    head.append(headLeft, headRight);
    vaultCard.append(head);

    if (!vaultSession.entries.length) {
      const empty = emptyEl('还没有条目，点击此处添加');
      empty.onclick = () => addEntryFlow(container);
      vaultCard.append(empty);
    } else {
      for (const e of vaultSession.entries) vaultCard.append(entryRowEl(e, container));
    }
  }

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

  // ---------- 密码箱流程 ----------
  async function setupVaultFlow(ctx) {
    const done = await openForm({
      title: '设置密码箱',
      fields: [
        { key: 'pw', label: '主密码', type: 'password', required: true, placeholder: '至少 6 位' },
        { key: 'pw2', label: '确认主密码', type: 'password', required: true }
      ],
      onSubmit: async v => {
        if (v.pw !== v.pw2) throw new Error('两次输入的主密码不一致');
        const ck = validateMasterPassword(v.pw);
        if (!ck.ok) throw new Error(ck.error);
        const r = await createVault(v.pw);
        if (!r.ok) throw new Error(r.error);
        mutate(s => { s.vault = r.vault; });
        const u = await unlockVault(r.vault, v.pw);
        vaultSession = u.ok ? { entries: u.entries, password: v.pw } : null;
        toast('密码箱已创建');
      }
    });
    if (done) render(ctx);
  }

  async function unlockVaultFlow(ctx) {
    const done = await openForm({
      title: '解锁密码箱',
      fields: [{ key: 'pw', label: '主密码', type: 'password', required: true }],
      onSubmit: async v => {
        const r = await unlockVault(state.vault, v.pw);
        if (!r.ok) throw new Error(r.error);
        vaultSession = { entries: r.entries, password: v.pw };
        toast('已解锁');
      }
    });
    if (done) render(ctx);
  }

  async function addEntryFlow(ctx) {
    const done = await openForm({
      title: '添加条目',
      fields: [
        { key: 'name', label: '名称', type: 'text', required: true, placeholder: '如：GitHub、Wi-Fi、银行卡' },
        { key: 'account', label: '账号', type: 'text', placeholder: '用户名 / 邮箱 / 密钥ID' },
        { key: 'secret', label: '密码 / 密钥', type: 'password', placeholder: '密钥可粘贴整段内容' },
        { key: 'notes', label: '备注', type: 'textarea', placeholder: '可选' }
      ],
      onSubmit: async v => {
        const r = addVaultEntry(vaultSession.entries, v);
        if (!r.ok) throw new Error(r.error);
        const sealed = await sealVault(r.entries, vaultSession.password, { salt: state.vault.salt, iterations: state.vault.iterations });
        if (!sealed.ok) throw new Error(sealed.error);
        mutate(s => { s.vault = sealed.vault; });
        vaultSession.entries = r.entries;
        toast('已添加');
      }
    });
    if (done) render(ctx);
  }

  async function editEntryFlow(entry, ctx) {
    const done = await openForm({
      title: '编辑条目',
      fields: [
        { key: 'name', label: '名称', type: 'text', required: true, placeholder: '如：GitHub、Wi-Fi、银行卡' },
        { key: 'account', label: '账号', type: 'text', placeholder: '用户名 / 邮箱 / 密钥ID' },
        { key: 'secret', label: '密码 / 密钥', type: 'password', placeholder: '密钥可粘贴整段内容' },
        { key: 'notes', label: '备注', type: 'textarea', placeholder: '可选' }
      ],
      values: { name: entry.name, account: entry.account, secret: entry.secret, notes: entry.notes },
      onSubmit: async v => {
        const r = updateVaultEntry(vaultSession.entries, entry.id, v);
        if (!r.ok) throw new Error(r.error);
        const sealed = await sealVault(r.entries, vaultSession.password, { salt: state.vault.salt, iterations: state.vault.iterations });
        if (!sealed.ok) throw new Error(sealed.error);
        mutate(s => { s.vault = sealed.vault; });
        vaultSession.entries = r.entries;
        toast('已保存');
      }
    });
    if (done) render(ctx);
  }

  async function deleteEntryFlow(entry, ctx) {
    const ok = await confirmDialog({
      title: '删除条目',
      message: `确定删除「${entry.name}」吗？此操作不可撤销。`,
      okText: '删除', danger: true
    });
    if (!ok) return;
    const r = removeVaultEntry(vaultSession.entries, entry.id);
    if (!r.ok) { toast(r.error); return; }
    const sealed = await sealVault(r.entries, vaultSession.password, { salt: state.vault.salt, iterations: state.vault.iterations });
    if (!sealed.ok) { toast(sealed.error); return; }
    mutate(s => { s.vault = sealed.vault; });
    vaultSession.entries = r.entries;
    toast('已删除');
    render(ctx);
  }

  async function changePasswordFlow(ctx) {
    const done = await openForm({
      title: '修改主密码',
      fields: [
        { key: 'old', label: '当前主密码', type: 'password', required: true },
        { key: 'pw', label: '新主密码', type: 'password', required: true, placeholder: '至少 6 位' },
        { key: 'pw2', label: '确认新主密码', type: 'password', required: true }
      ],
      onSubmit: async v => {
        if (v.pw !== v.pw2) throw new Error('两次输入的新主密码不一致');
        const ck = validateMasterPassword(v.pw);
        if (!ck.ok) throw new Error(ck.error);
        const verify = await unlockVault(state.vault, v.old);
        if (!verify.ok) throw new Error('当前主密码不正确');
        const sealed = await sealVault(vaultSession.entries, v.pw, { iterations: state.vault.iterations });
        if (!sealed.ok) throw new Error(sealed.error);
        mutate(s => { s.vault = sealed.vault; });
        vaultSession.password = v.pw;
        toast('主密码已修改');
      }
    });
    if (done) render(ctx);
  }

  function entryRowEl(entry, ctx) {
    const row = document.createElement('div');
    row.className = 'row';
    const inner = document.createElement('div');
    inner.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
    const name = document.createElement('span');
    name.style.cssText = 'font-size:14px;font-weight:600;';
    name.textContent = entry.name;
    inner.append(name);
    if (entry.account) {
      const acc = document.createElement('span');
      acc.style.cssText = 'font-size:12px;color:var(--text-soft);word-break:break-all;';
      acc.textContent = entry.account;
      inner.append(acc);
    }
    let shown = false;
    const secretEl = document.createElement('span');
    secretEl.className = 'badge badge-gray';
    secretEl.textContent = '••••••••';
    secretEl.title = '密码 / 密钥';
    inner.append(secretEl);
    row.append(inner);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const tgl = document.createElement('button');
    tgl.className = 'btn-icon';
    tgl.textContent = '👁';
    tgl.title = '显示 / 隐藏';
    tgl.onclick = () => {
      shown = !shown;
      secretEl.textContent = shown ? entry.secret : '••••••••';
    };
    const copy = document.createElement('button');
    copy.className = 'btn-icon';
    copy.textContent = '📋';
    copy.title = '复制密码 / 密钥';
    copy.onclick = () => copyText(entry.secret);
    const edit = document.createElement('button');
    edit.className = 'btn-icon';
    edit.textContent = '✏️';
    edit.title = '编辑';
    edit.onclick = () => editEntryFlow(entry, ctx);
    const del = document.createElement('button');
    del.className = 'btn-icon';
    del.textContent = '🗑️';
    del.title = '删除';
    del.onclick = () => deleteEntryFlow(entry, ctx);
    actions.append(tgl, copy, edit, del);
    row.append(actions);
    return row;
  }

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      toast('已复制到剪贴板');
    } catch {
      toast('复制失败');
    }
  }

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
    vaultSession = null;
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
    vaultSession = null;
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
