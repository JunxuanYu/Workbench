// 工作台关闭流程：纯逻辑可测（依赖注入）
// 目标：点击「关闭工作台」→ 确认 → 保存未落盘数据 → 请求本机 Node 服务关闭并退出，
//       ​随后自动关闭当前浏览器标签页（window.close），实现「退出后自动关闭标签页」。
// 若服务不支持 /api/shutdown（旧实例）或请求失败，回退尝试 window.close()，最后提示手动关闭。

// 默认提示文案
export const CLOSE_MESSAGE = 'WorkLift 服务已关闭，正在自动关闭标签页';
export const CLOSED_KEEP_MESSAGE = 'WorkLift 服务已关闭，请手动关闭此标签页';
export const MANUAL_MESSAGE = '请手动关闭浏览器窗口以完成关闭';
export const BLOCKED_MESSAGE = '未能自动关闭，请关闭浏览器窗口并在终端按 Ctrl+C 停止服务';

/**
 * 关闭流程主逻辑（可在 Node 下注入桩函数测试）。
 * @param {object} deps
 * @param {() => Promise<boolean>} deps.confirm  确认弹窗，返回用户是否确认
 * @param {() => Promise<void>} [deps.flushSave] 保存未落盘数据
 * @param {() => Promise<void>} deps.shutdown     调用 /api/shutdown
 * @param {() => boolean} [deps.closeWindow]      尝试 window.close（返回浏览器是否已关闭/接受关闭）
 * @param {(msg: string) => void} [deps.notify]   展示消息（如 toast）
 * @returns {Promise<{status: string, message: string|null}>}
 *          status: 'cancelled' | 'closed' | 'window-closed' | 'manual'
 */
export async function runCloseFlow(deps) {
  const confirmed = await deps.confirm();
  if (!confirmed) return { status: 'cancelled', message: null };

  if (deps.flushSave) {
    try { await deps.flushSave(); } catch { /* 保存失败不阻断关闭，服务端数据为上次已保存状态 */ }
  }

  try {
    await deps.shutdown();
    // 服务已关闭 → 自动关闭标签页
    let closedByWindow = false;
    if (typeof deps.closeWindow === 'function') {
      try { closedByWindow = deps.closeWindow(); } catch { closedByWindow = false; }
    }
    if (closedByWindow) {
      if (typeof deps.notify === 'function') deps.notify(CLOSE_MESSAGE);
      return { status: 'closed', message: CLOSE_MESSAGE };
    }
    // 浏览器策略可能拦截 window.close → 提示手动关闭标签页（服务已退出）
    if (typeof deps.notify === 'function') deps.notify(CLOSED_KEEP_MESSAGE);
    return { status: 'closed-keep', message: CLOSED_KEEP_MESSAGE };
  } catch {
    // 服务不支持/无法关闭 → 回退关闭浏览器窗口
    let closedByWindow = false;
    if (typeof deps.closeWindow === 'function') {
      try { closedByWindow = deps.closeWindow(); } catch { closedByWindow = false; }
    }
    if (closedByWindow) {
      if (typeof deps.notify === 'function') deps.notify(BLOCKED_MESSAGE);
      return { status: 'window-closed', message: BLOCKED_MESSAGE };
    }
    if (typeof deps.notify === 'function') deps.notify(MANUAL_MESSAGE);
    return { status: 'manual', message: MANUAL_MESSAGE };
  }
}

/**
 * 浏览器环境便捷函数：把真实实现注入 runCloseFlow。
 * @param {object} impl { confirm, flushSave, shutdown, window }
 * @param {(msg: string) => void} notify
 */
export function closeWorkbench(impl, notify) {
  const closeWindow = () => {
    const win = impl.window;
    if (!win || typeof win.close !== 'function') return false;
    win.close();
    return true;
  };
  return runCloseFlow({
    confirm: impl.confirm,
    flushSave: impl.flushSave,
    shutdown: impl.shutdown,
    closeWindow,
    notify
  });
}
