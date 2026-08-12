// P0/P1 数据层 API 测试：启动真实服务（临时数据文件），用 fetch 验证
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { defaultData, validateData } from '../public/js/logic.js';

let server, base, tmpDir, dataFile;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklift-test-'));
  dataFile = path.join(tmpDir, 'data.json');
  const app = createApp(dataFile);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /api/ping 返回 ok', async () => {
  const r = await fetch(`${base}/api/ping`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('GET / 返回前端页面（静态托管）', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /WorkLift/);
});

test('首次启动自动创建默认数据文件', () => {
  assert.ok(fs.existsSync(dataFile));
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(data.version, 1);
});

test('GET /api/data 返回默认结构（含7个内置分类）', async () => {
  const r = await fetch(`${base}/api/data`);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.version, 1);
  assert.ok(Array.isArray(data.categories));
  assert.equal(data.categories.length, 7);
  assert.ok(data.categories.every(c => c.builtin === true));
  assert.deepEqual(validateData(data), { ok: true, errors: [] });
});

test('GET /api/info 返回文件位置/大小/更新时间', async () => {
  const r = await fetch(`${base}/api/info`);
  assert.equal(r.status, 200);
  const info = await r.json();
  assert.equal(info.filePath, dataFile);
  assert.equal(typeof info.size, 'number');
  assert.ok(info.size > 0);
});

// ---------- P1：数据写入 / 校验 / 原子性 / 备份 / 持久化 ----------

test('PUT 合法数据 → ok:true，GET 能读回', async () => {
  const d = defaultData();
  d.memos.push({ id: 'm1', text: '测试备忘', pinned: true });
  const r = await fetch(`${base}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(d)
  });
  assert.equal(r.status, 200);
  const res = await r.json();
  assert.equal(res.ok, true);
  assert.ok(res.updatedAt);

  const back = await (await fetch(`${base}/api/data`)).json();
  assert.equal(back.memos.length, 1);
  assert.equal(back.memos[0].text, '测试备忘');
  assert.ok(back.updatedAt, 'PUT 后 updatedAt 已刷新');
});

test('PUT 非法数据（缺 version）→ 400 且文件不被破坏', async () => {
  const before = await (await fetch(`${base}/api/data`)).json();
  const r = await fetch(`${base}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ foo: 1 })
  });
  assert.equal(r.status, 400);
  const after = await (await fetch(`${base}/api/data`)).json();
  assert.equal(after.memos.length, before.memos.length, '非法请求后数据未变');
});

test('原子写入：成功后数据文件中不残留 .tmp 临时文件', async () => {
  const d = defaultData();
  const r = await fetch(`${base}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(d)
  });
  assert.equal(r.status, 200);
  assert.ok(!fs.existsSync(dataFile + '.tmp'), '不应残留临时文件');
  assert.ok(fs.existsSync(dataFile));
});

test('GET /api/backup 以附件下载、内容与当前数据一致、文件名带日期', async () => {
  const current = await (await fetch(`${base}/api/data`)).json();
  const r = await fetch(`${base}/api/backup`);
  assert.equal(r.status, 200);
  const cd = r.headers.get('content-disposition') || '';
  assert.ok(cd.includes('attachment'), '应为附件下载');
  assert.ok(cd.includes("filename*=UTF-8''"), '中文文件名应做 RFC5987 编码');
  const encName = cd.split("filename*=UTF-8''")[1];
  const realName = decodeURIComponent(encName);
  assert.match(realName, /^WorkLift备份-\d{4}-\d{2}-\d{2}\.json$/);
  const body = await r.json();
  assert.deepEqual(body, current, '备份内容与当前数据一致');
});

// ---------- P2：应用外壳静态资源完整性 ----------
test('P2 外壳：全部静态资源可访问', async () => {
  const assets = [
    '/css/style.css',
    '/js/app.js', '/js/api.js', '/js/store.js', '/js/router.js', '/js/logic.js',
    '/js/components/util.js', '/js/components/toast.js', '/js/components/empty.js',
    '/js/components/confirm.js', '/js/components/modal.js', '/js/components/dateNav.js',
    '/js/pages/home.js', '/js/pages/today.js', '/js/pages/dev.js', '/js/pages/consult.js',
    '/js/pages/diet.js', '/js/pages/money.js', '/js/pages/settings.js'
  ];
  for (const p of assets) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.status, 200, `${p} 应可访问`);
    assert.match(r.headers.get('content-type') || '', /javascript|css/, `${p} 类型正确`);
  }
});

test('P2 外壳：index.html 包含7个导航项与内容区', async () => {
  const html = await (await fetch(`${base}/`)).text();
  for (const route of ['home', 'today', 'dev', 'consult', 'diet', 'money', 'settings']) {
    assert.ok(html.includes(`data-route="${route}"`), `导航应有 ${route}`);
  }
  assert.ok(html.includes('id="app"'));
  assert.ok(html.includes('id="toast-root"'));
  assert.ok(html.includes('id="modal-root"'));
});

test('P2 外壳：导航顺序为「饮食计划」在「账目计划」之后', async () => {
  const html = await (await fetch(`${base}/`)).text();
  const iMoney = html.indexOf('data-route="money"');
  const iDiet = html.indexOf('data-route="diet"');
  assert.ok(iMoney !== -1 && iDiet !== -1, '两个导航项都应存在');
  assert.ok(iDiet > iMoney, '饮食计划应排在账目计划之后');
});

test('P2 外壳：页面模块语法有效（Node 可解析）', async () => {
  const mod = await import('../public/js/pages/today.js');
  assert.equal(typeof mod.render, 'function');
});

describe('持久化：重启服务后数据仍在', () => {
  let s2, base2, file2, dir2;
  before(async () => {
    dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'worklift-persist-'));
    file2 = path.join(dir2, 'data.json');
    const app1 = createApp(file2);
    await new Promise(r => { s2 = app1.listen(0, '127.0.0.1', r); });
    const b1 = `http://127.0.0.1:${s2.address().port}`;
    const d = defaultData();
    d.memos.push({ id: 'keep', text: '重启后还要在', pinned: false });
    await fetch(`${b1}/api/data`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d)
    });
    s2.close();
  });

  test('用同一数据文件重新创建服务 → 数据完整保留', async () => {
    const app2 = createApp(file2);
    await new Promise(r => { s2 = app2.listen(0, '127.0.0.1', r); });
    base2 = `http://127.0.0.1:${s2.address().port}`;
    const data = await (await fetch(`${base2}/api/data`)).json();
    assert.equal(data.memos[0].text, '重启后还要在');
    s2.close();
  });

  after(() => {
    fs.rmSync(dir2, { recursive: true, force: true });
  });
});
