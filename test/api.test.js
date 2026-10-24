// P0/P1 数据层 API 测试：启动真实服务（临时数据文件），用 fetch 验证
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server.js';
import { defaultData, validateData } from '../public/js/logic.js';

let server, base, tmpDir, dataFile;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklift-test-'));
  dataFile = path.join(tmpDir, 'data.json');
  const app = createApp(dataFile);
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// 原始 HTTP 请求（可伪造 Host/Origin/Sec-Fetch-Site 等浏览器不允许注入的头，
// 用于验证守卫中间件在真实攻击请求下的行为）
function rawFetch(baseUrl, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + pathname);
    const req = http.request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method,
        headers,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

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
  assert.ok(data.categories.every((c) => c.builtin === true));
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

// ---------- P0 安全：响应头 / 守卫中间件（DNS rebinding、点击劫持、MIME 嗅探、缓存） ----------
test('响应头：CSP/XFO/nosniff/Referrer-Policy/Permissions-Policy/COOP/CORP 齐全，无 X-Powered-By', async () => {
  const r = await fetch(`${base}/`);
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/, 'CSP 默认仅自源');
  assert.match(csp, /img-src 'self' data: blob:/, 'CSP 图片允许 data/blob（前端生成二维码等）');
  assert.match(csp, /style-src 'self' 'unsafe-inline'/, 'CSP 样式允许内联（style.cssText）');
  assert.match(csp, /script-src 'self'/, 'CSP 脚本仅自源（无内联脚本）');
  assert.match(csp, /frame-ancestors 'none'/, 'CSP 禁止被嵌入');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('permissions-policy') || '', /camera=\(\)/);
  assert.match(r.headers.get('permissions-policy') || '', /microphone=\(\)/);
  assert.match(r.headers.get('permissions-policy') || '', /geolocation=\(\)/);
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(r.headers.get('x-powered-by'), null, '不应泄露 Express 版本');
});

test('守卫：/api 响应带 Cache-Control: no-store（含密码箱密文不落缓存）', async () => {
  const r = await fetch(`${base}/api/data`);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('守卫：伪造 Host（DNS rebinding）→ 403，本机 Host → 放行', async () => {
  const evil = await rawFetch(base, '/api/ping', { headers: { Host: 'evil.example.com' } });
  assert.equal(evil.status, 403, '非本机 Host 必须拒绝');
  assert.match(evil.text, /仅允许本机访问/);
  const localhost = await rawFetch(base, '/api/ping', { headers: { Host: `localhost:${server.address().port}` } });
  assert.equal(localhost.status, 200, 'localhost Host 应放行');
  const ip = await rawFetch(base, '/api/ping', { headers: { Host: `127.0.0.1:${server.address().port}` } });
  assert.equal(ip.status, 200, '127.0.0.1 Host 应放行');
});

test('守卫：跨站 Origin → 403，同源 Origin → 放行', async () => {
  const evil = await rawFetch(base, '/api/ping', { headers: { Origin: 'http://evil.example.com' } });
  assert.equal(evil.status, 403, '跨站 Origin 必须拒绝');
  const same = await rawFetch(base, '/api/ping', { headers: { Origin: base } });
  assert.equal(same.status, 200, '同源 Origin 应放行');
});

test('守卫：Sec-Fetch-Site: cross-site → 403，same-origin/none → 放行', async () => {
  const cross = await rawFetch(base, '/api/ping', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(cross.status, 403, '跨站 Sec-Fetch-Site 必须拒绝');
  const same = await rawFetch(base, '/api/ping', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(same.status, 200);
  const none = await rawFetch(base, '/api/ping', { headers: { 'Sec-Fetch-Site': 'none' } });
  assert.equal(none.status, 200);
});

// ---------- P1：数据写入 / 校验 / 原子性 / 备份 / 持久化 ----------

test('PUT 合法数据 → ok:true，GET 能读回', async () => {
  const d = defaultData();
  d.memos.push({ id: 'm1', text: '测试备忘', pinned: true });
  const r = await fetch(`${base}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(d),
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
    body: JSON.stringify({ foo: 1 }),
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
    body: JSON.stringify(d),
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
    '/js/app.js',
    '/js/api.js',
    '/js/store.js',
    '/js/router.js',
    '/js/logic.js',
    '/js/vault.js',
    '/js/components/util.js',
    '/js/components/toast.js',
    '/js/components/empty.js',
    '/js/components/confirm.js',
    '/js/components/modal.js',
    '/js/components/dateNav.js',
    '/js/pages/home.js',
    '/js/pages/today.js',
    '/js/pages/dev.js',
    '/js/pages/consult.js',
    '/js/pages/notes.js',
    '/js/markdown.js',
    '/js/pages/money.js',
    '/js/pages/settings.js',
  ];
  for (const p of assets) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.status, 200, `${p} 应可访问`);
    assert.match(r.headers.get('content-type') || '', /javascript|css/, `${p} 类型正确`);
  }
});

test('P2 外壳：index.html 包含7个导航项与内容区', async () => {
  const html = await (await fetch(`${base}/`)).text();
  for (const route of ['home', 'today', 'dev', 'consult', 'notes', 'money', 'settings']) {
    assert.ok(html.includes(`data-route="${route}"`), `导航应有 ${route}`);
  }
  assert.equal(html.includes('data-route="diet"'), false, '饮食计划已下线');
  assert.ok(html.includes('id="app"'));
  assert.ok(html.includes('id="toast-root"'));
  assert.ok(html.includes('id="modal-root"'));
});

test('P2 外壳：导航顺序为「个人笔记」在「账目计划」之前', async () => {
  const html = await (await fetch(`${base}/`)).text();
  const iNotes = html.indexOf('data-route="notes"');
  const iMoney = html.indexOf('data-route="money"');
  assert.ok(iNotes !== -1 && iMoney !== -1, '两个导航项都应存在');
  assert.ok(iNotes < iMoney, '个人笔记应排在账目计划之前');
});

test('P2 外壳：页面模块语法有效（Node 可解析）', async () => {
  const mod = await import('../public/js/pages/today.js');
  assert.equal(typeof mod.render, 'function');
});

test('P2 外壳：settings 页面模块语法有效（含密码箱）', async () => {
  const mod = await import('../public/js/pages/settings.js');
  assert.equal(typeof mod.render, 'function');
});

// ---------- 密码箱（vault）数据层 ----------
test('PUT 含密码箱（vault 密文）的数据 → 200 且 GET 读回一致', async () => {
  const d = defaultData();
  d.vault = { salt: 'c2FsdA==', iterations: 1000, data: 'aWF2Y2lwaGVy' };
  const r = await fetch(`${base}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(d),
  });
  assert.equal(r.status, 200);
  const back = await (await fetch(`${base}/api/data`)).json();
  assert.deepEqual(back.vault, d.vault, '密文应原样保存');
});

test('PUT 非法 vault 结构 → 400 且数据不被破坏', async () => {
  const before = await (await fetch(`${base}/api/data`)).json();
  const d = defaultData();
  d.vault = { salt: 'x' }; // 缺 iterations/data
  const r = await fetch(`${base}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(d),
  });
  assert.equal(r.status, 400);
  const after = await (await fetch(`${base}/api/data`)).json();
  assert.deepEqual(after.vault, before.vault, '非法请求后密码箱数据未变');
});

// ---------- P11：关联文档 - 打开本地文件/文件夹接口 ----------
test('POST /api/open 缺少路径 → 400', async () => {
  const r = await fetch(`${base}/api/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
  assert.ok((await r.json()).error);
});

test('POST /api/open 路径不存在 → 404 且提示路径', async () => {
  const r = await fetch(`${base}/api/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path.join(tmpDir, 'no-such-file-xyz.md') }),
  });
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /不存在/);
});

test('POST /api/open 非 application/json 内容被拒（防跨站简单请求触发打开任意文件）', async () => {
  const r = await fetch(`${base}/api/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ path: tmpDir }),
  });
  assert.equal(r.status, 400, 'express.json 不解析 text/plain → body 为空 → 400');
});

test('GET /api/open 不提供（防 <img src> 等跨站 GET 触发打开）', async () => {
  const r = await fetch(`${base}/api/open?path=${encodeURIComponent(tmpDir)}`);
  assert.equal(r.status, 404);
});

test('POST /api/open 拒绝 UNC 网络路径（\\\\server\\share → 400，防 NetNTLM 凭据泄露）', async () => {
  const r = await fetch(`${base}/api/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '\\\\malicious-server\\share\\file.md' }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /不支持网络路径/);
});

test('POST /api/open 拒绝可执行/脚本文件（.bat/.exe/.js/.lnk → 400，防 cmd start 执行）', async () => {
  for (const ext of ['.bat', '.cmd', '.exe', '.js', '.hta', '.lnk', '.vbs', '.ps1']) {
    const f = path.join(tmpDir, `pwned${ext}`);
    fs.writeFileSync(f, '# nothing');
    try {
      const r = await fetch(`${base}/api/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: f }),
      });
      assert.equal(r.status, 400, `${ext} 应被拒绝`);
      assert.match((await r.json()).error, /不支持打开可执行/);
    } finally {
      fs.rmSync(f, { force: true });
    }
  }
});

test('POST /api/open 可执行扩展名大小写不敏感（.BAT → 400）', async () => {
  const f = path.join(tmpDir, 'uppercase.BAT');
  fs.writeFileSync(f, '@echo off');
  try {
    const r = await fetch(`${base}/api/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: f }),
    });
    assert.equal(r.status, 400);
  } finally {
    fs.rmSync(f, { force: true });
  }
});

// ---------- P11：openLocalPath 客户端封装（旧版本服务兜底提示） ----------
test('P11 openLocalPath：旧实例返回非 JSON 404 时提示重启应用', async () => {
  const mod = await import('../public/js/api.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('<!doctype html>Cannot POST /api/open', { status: 404, headers: { 'Content-Type': 'text/html' } });
  try {
    await assert.rejects(() => mod.openLocalPath('D:\\x.md'), /重新运行 start\.bat/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('P11 openLocalPath：服务端 JSON 错误信息原样抛出（如路径不存在）', async () => {
  const mod = await import('../public/js/api.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: '本地路径不存在：D:\\x.md' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  try {
    await assert.rejects(() => mod.openLocalPath('D:\\x.md'), /本地路径不存在/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

describe('持久化：重启服务后数据仍在', () => {
  let s2, base2, file2, dir2;
  before(async () => {
    dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'worklift-persist-'));
    file2 = path.join(dir2, 'data.json');
    const app1 = createApp(file2);
    await new Promise((r) => {
      s2 = app1.listen(0, '127.0.0.1', r);
    });
    const b1 = `http://127.0.0.1:${s2.address().port}`;
    const d = defaultData();
    d.memos.push({ id: 'keep', text: '重启后还要在', pinned: false });
    await fetch(`${b1}/api/data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
    s2.close();
  });

  test('用同一数据文件重新创建服务 → 数据完整保留', async () => {
    const app2 = createApp(file2);
    await new Promise((r) => {
      s2 = app2.listen(0, '127.0.0.1', r);
    });
    base2 = `http://127.0.0.1:${s2.address().port}`;
    const data = await (await fetch(`${base2}/api/data`)).json();
    assert.equal(data.memos[0].text, '重启后还要在');
    s2.close();
  });

  after(() => {
    fs.rmSync(dir2, { recursive: true, force: true });
  });
});

// 关闭服务端点：/api/shutdown 返回 ok 并触发注入的 onShutdown 回调
describe('POST /api/shutdown', () => {
  let s3, base3, dir3, file3, shutdownFired;

  before(async () => {
    dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'worklift-shutdown-'));
    file3 = path.join(dir3, 'data.json');
    shutdownFired = false;
    const app3 = createApp(file3, {
      onShutdown: () => {
        shutdownFired = true;
      },
    });
    await new Promise((r) => {
      s3 = app3.listen(0, '127.0.0.1', r);
    });
    base3 = `http://127.0.0.1:${s3.address().port}`;
  });

  test('GET /api/shutdown 返回 404（仅接受 POST，防止被简单请求触发）', async () => {
    const r = await fetch(`${base3}/api/shutdown`);
    assert.equal(r.status, 404);
    assert.equal(shutdownFired, false);
  });

  test('POST /api/shutdown 非 application/json → 415 且不触发关闭（防 <form> 跨站关停）', async () => {
    const r = await fetch(`${base3}/api/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'shutdown',
    });
    assert.equal(r.status, 415);
    assert.equal(shutdownFired, false, '拒绝时应不触发 onShutdown');
  });

  test('POST /api/shutdown 返回 ok 并触发 onShutdown 回调', async () => {
    const r = await fetch(`${base3}/api/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    // 回调在响应后延迟触发，短暂等待
    await new Promise((r2) => setTimeout(r2, 80));
    assert.equal(shutdownFired, true, 'onShutdown 回调应被触发');
  });

  after(() => {
    if (shutdownFired) {
      // 回调只是把标志置 true，未真正关闭服务；此时直接关闭即可
    }
    s3?.close();
    fs.rmSync(dir3, { recursive: true, force: true });
  });
});
