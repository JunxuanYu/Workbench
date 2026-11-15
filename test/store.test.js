// store.js 并发保护测试：base token 传递、冲突后停止自动保存、强制覆盖
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadData, mutate, replaceState, flushSave, isSaveBlocked } from '../public/js/store.js';
import { defaultData } from '../public/js/logic.js';

// toast 依赖 DOM：给一个空实现，避免测试环境报错
globalThis.document = { getElementById: () => null };

const BASE_HEADER = 'X-WorkLift-Base-Updated-At';
const calls = [];
let handler;

globalThis.fetch = async (url, opts = {}) => {
  const rec = { url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body };
  calls.push(rec);
  return handler(rec);
};

function res(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const READ_TOKEN = '2026-11-08T00:00:00.000Z';
const SAVED_TOKEN = '2026-11-08T00:00:01.000Z';
const wait = (ms = 280) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  calls.length = 0;
  handler = () => res({ ...defaultData(), updatedAt: READ_TOKEN });
  await loadData(); // 重置内部 base 与冲突标记
  calls.length = 0;
  handler = () => res({ ok: true, updatedAt: SAVED_TOKEN });
});

test('保存时带上读取时的 updatedAt 作为 base', async () => {
  mutate((s) => s.memos.push({ id: 'm1', text: '测试', pinned: false }));
  await wait();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].headers[BASE_HEADER], READ_TOKEN);
});

test('保存成功后用服务端新 token 继续保存', async () => {
  mutate((s) => s.memos.push({ id: 'm1', text: 'a', pinned: false }));
  await wait();
  mutate((s) => s.memos.push({ id: 'm2', text: 'b', pinned: false }));
  await wait();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers[BASE_HEADER], SAVED_TOKEN);
});

test('409 冲突后暂停自动保存，不再用旧快照覆盖', async () => {
  handler = () => res({ error: '冲突', conflict: true, updatedAt: '2026-11-08T00:00:09.000Z' }, 409);
  mutate((s) => s.memos.push({ id: 'm1', text: 'a', pinned: false }));
  await wait();
  assert.equal(calls.length, 1);
  assert.equal(isSaveBlocked(), true, '冲突后应标记为暂停保存');

  mutate((s) => s.memos.push({ id: 'm2', text: 'b', pinned: false }));
  await wait();
  assert.equal(calls.length, 1, '暂停后不应再发保存请求');
});

test('恢复备份/清空走强制覆盖，不携带 base 头但显式声明允许替换密码箱', async () => {
  replaceState(defaultData());
  await wait();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].headers[BASE_HEADER], undefined);
  assert.equal(calls[0].headers['X-WorkLift-Vault-Replace'], '1');
});

test('冲突时 flushSave 抛错，避免关闭前静默覆盖', async () => {
  handler = () => res({ error: '冲突', conflict: true, updatedAt: null }, 409);
  await assert.rejects(() => flushSave(), /另一个窗口已更新数据/);
  assert.equal(isSaveBlocked(), true);
});

test('loadData 会清除冲突标记并记录最新 base', async () => {
  handler = () => res({ error: '冲突', conflict: true, updatedAt: null }, 409);
  await flushSave().catch(() => {});
  assert.equal(isSaveBlocked(), true);

  calls.length = 0;
  handler = () => res({ ...defaultData(), updatedAt: '2026-11-08T00:00:05.000Z' });
  await loadData();
  assert.equal(isSaveBlocked(), false);

  handler = () => res({ ok: true, updatedAt: SAVED_TOKEN });
  mutate((s) => s.memos.push({ id: 'm1', text: 'a', pinned: false }));
  await wait();
  assert.equal(calls[1].headers[BASE_HEADER], '2026-11-08T00:00:05.000Z');
});
