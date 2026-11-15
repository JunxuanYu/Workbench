// 前端状态管理：变更即保存（防抖200ms）
// 并发保护：保存时带上"读取时拿到的 updatedAt"，服务端不一致则 409。
// 没有这层校验时，另一个窗口/标签页只要保存一次，就会用旧快照整份覆盖数据文件，
// 密码箱密文随之回滚——表现为"主密码被改了"（新密码失效、旧密码复活）。
import { getData, saveData } from './api.js';
import { defaultData, migrateData } from './logic.js';
import { toast } from './components/toast.js';

let state = null;
let timer = null;
// 与服务端一致的版本 token（数据文件的 updatedAt；从未保存过为 null）
let baseUpdatedAt = null;
// 一旦检测到并发冲突就停止自动保存，避免继续用旧快照覆盖别人的修改
let conflictBlocked = false;

export async function loadData() {
  try {
    const data = await getData();
    state = migrateData(data);
    baseUpdatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null;
    conflictBlocked = false;
  } catch (e) {
    state = defaultData();
    baseUpdatedAt = null;
    throw e;
  }
  return state;
}

export function getState() {
  return state;
}

// 是否因并发冲突暂停了自动保存（UI 可据此提示用户刷新）
export function isSaveBlocked() {
  return conflictBlocked;
}

async function persist(force = false) {
  if (conflictBlocked && !force) return false;
  try {
    const snapshot = JSON.parse(JSON.stringify(state));
    // force：用户已明确确认整体覆盖（恢复备份/清空），不参与乐观校验，且允许替换密码箱密文
    const r = await saveData(snapshot, force ? undefined : baseUpdatedAt, {
      allowVaultReplace: force,
    });
    if (r && typeof r.updatedAt === 'string') {
      baseUpdatedAt = r.updatedAt;
      conflictBlocked = false;
    }
    return true;
  } catch (e) {
    if (e && e.conflict) {
      conflictBlocked = true;
      toast(
        e.vaultConflict
          ? '密码箱与当前数据不一致，已拒绝保存，请刷新页面后重试'
          : '另一个窗口已更新数据，请刷新页面后再继续操作',
      );
      return false;
    }
    toast('保存失败，请重试');
    return false;
  }
}

function scheduleSave(force = false) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    persist(force);
  }, 200);
}

// 修改数据后调用；fn 直接操作 state
export function mutate(fn) {
  fn(state);
  state.updatedAt = new Date().toISOString();
  scheduleSave();
}

// 整体替换（恢复备份/清空后使用）：用户已二次确认，按强制覆盖保存
export function replaceState(newState) {
  state = migrateData(newState);
  state.updatedAt = new Date().toISOString();
  scheduleSave(true);
}

// 立即保存未落盘的防抖数据（如关闭服务前调用，避免丢失最近变更）
// 冲突时抛错：宁可提示保存失败，也不用旧快照覆盖另一个窗口的新数据
export async function flushSave() {
  clearTimeout(timer);
  if (!state) return;
  const ok = await persist();
  if (!ok) {
    const err = new Error(conflictBlocked ? '另一个窗口已更新数据，请刷新页面后再关闭' : '保存失败，请重试');
    throw err;
  }
}
