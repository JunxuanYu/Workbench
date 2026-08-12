// 前端状态管理：变更即保存（防抖200ms）
import { getData, saveData } from './api.js';
import { defaultData } from './logic.js';
import { toast } from './components/toast.js';

let state = null;
let timer = null;

export async function loadData() {
  try {
    state = await getData();
  } catch (e) {
    state = defaultData();
    throw e;
  }
  return state;
}

export function getState() { return state; }

function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await saveData(JSON.parse(JSON.stringify(state)));
    } catch (e) {
      toast('保存失败，请重试');
    }
  }, 200);
}

// 修改数据后调用；fn 直接操作 state
export function mutate(fn) {
  fn(state);
  state.updatedAt = new Date().toISOString();
  scheduleSave();
}

// 整体替换（恢复备份/清空后使用）
export function replaceState(newState) {
  state = newState;
  state.updatedAt = new Date().toISOString();
  scheduleSave();
}
