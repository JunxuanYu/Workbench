// 应用入口
import { loadData, getState, flushSave } from './store.js';
import { initRouter } from './router.js';
import { applyTheme } from './theme.js';
import { currentTheme } from './logic.js';
import { toast } from './components/toast.js';
import { confirmDialog } from './components/confirm.js';
import { shutdownServer } from './api.js';
import { closeWorkbench } from './close-workbench.js';

async function boot() {
  try {
    await loadData();
  } catch (e) {
    // 数据加载失败时以默认结构继续（server 会自动重建数据文件）
    console.error('数据加载失败，已使用默认结构', e);
  }
  // 应用已保存的工作台外观主题
  applyTheme(document.body, currentTheme(getState()));
  initRouter();
  // 左侧栏底部：关闭工作台服务按钮
  const closeBtn = document.getElementById('close-workbench');
  if (closeBtn) {
    closeBtn.onclick = async () => {
      await closeWorkbench({
        confirm: () => confirmDialog({
          title: '关闭工作台',
          message: '确定要关闭 WorkLift 服务吗？会先自动保存所有数据。若需再次使用，请重新运行 start.bat。',
          danger: true,
          okText: '关闭服务'
        }),
        flushSave,
        shutdown: shutdownServer,
        window
      }, toast);
    };
  }
}

boot();
