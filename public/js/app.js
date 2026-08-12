// 应用入口
import { loadData } from './store.js';
import { initRouter } from './router.js';

async function boot() {
  try {
    await loadData();
  } catch (e) {
    // 数据加载失败时以默认结构继续（server 会自动重建数据文件）
    console.error('数据加载失败，已使用默认结构', e);
  }
  initRouter();
}

boot();
