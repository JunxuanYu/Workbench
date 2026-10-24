// 工具箱 & PDF 转换工具测试（Node 可运行）
//   1. 工具注册表逻辑（registerTool / getTools）
//   2. PDF 转换工具结构（createPdfConvertTool / FORMAT_OPTIONS 契约）
//   3. 会话令牌存储（createPdfTokenStore，假时钟）
//   4. HTTP API（createApp + 注入 mock pdfTool：parse/convert/page、413 超限、错误映射）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp, createPdfTokenStore, PdfHttpError } from '../server.js';

// ---------- Mock 最小 DOM 环境（consult.js 需在 Node 下可导入） ----------
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement() {
      return { style: {}, classList: { add() {} }, append() {}, setAttribute() {} };
    },
    head: { append() {} },
    querySelector() {
      return null;
    },
  };
}

// ---------- 工具注册表测试 ----------
let registerTool, getTools;

test('工具注册表：导入成功', async () => {
  const mod = await import('../public/js/pages/consult.js');
  registerTool = mod.registerTool;
  getTools = mod.getTools;
  assert.equal(typeof registerTool, 'function');
  assert.equal(typeof getTools, 'function');
});

test('工具注册表：getTools 返回数组', () => {
  const tools = getTools();
  assert.ok(Array.isArray(tools));
  // consult.js 已自动注册了 PDF 转换工具
  assert.ok(tools.length >= 1, '应至少有 1 个已注册工具');
});

test('工具注册表：PDF 转换工具已自动注册', () => {
  const tools = getTools();
  const pdfTool = tools.find((t) => t.id === 'pdf-convert');
  assert.ok(pdfTool, 'pdf-convert 应已注册');
  assert.equal(pdfTool.name, 'PDF 转换');
  assert.equal(pdfTool.icon, '📑');
  assert.equal(typeof pdfTool.render, 'function');
});

test('工具注册表：重复注册同 id 抛错', () => {
  assert.throws(() => registerTool({ id: 'pdf-convert', name: '重复', icon: 'x', render() {} }), /已注册/);
});

test('工具注册表：缺字段抛错', () => {
  assert.throws(() => registerTool({ id: 'test' }), /必须包含/);
  assert.throws(() => registerTool(null), /必须包含/);
  assert.throws(() => registerTool({ id: 't', name: 'T', icon: 'x' }), /必须包含/); // 无 render
});

// ---------- PDF 转换工具结构测试 ----------
let createPdfConvertTool, FORMAT_OPTIONS;

test('PDF 工具：导入成功（模块顶层无副作用）', async () => {
  const mod = await import('../public/js/tools/pdf-convert.js');
  createPdfConvertTool = mod.createPdfConvertTool;
  FORMAT_OPTIONS = mod.FORMAT_OPTIONS;
  assert.equal(typeof createPdfConvertTool, 'function');
  assert.ok(Array.isArray(FORMAT_OPTIONS));
});

test('PDF 工具：createPdfConvertTool 返回正确结构', () => {
  const tool = createPdfConvertTool();
  assert.equal(tool.id, 'pdf-convert');
  assert.equal(tool.name, 'PDF 转换');
  assert.equal(tool.icon, '📑');
  assert.equal(typeof tool.render, 'function');
});

test('PDF 工具：FORMAT_OPTIONS 顺序与扩展名/MIME 契约', () => {
  assert.equal(FORMAT_OPTIONS.length, 6);
  assert.deepEqual(
    FORMAT_OPTIONS.map((f) => f.id),
    ['word', 'image', 'excel', 'ppt', 'txt', 'md'],
  );
  const byId = Object.fromEntries(FORMAT_OPTIONS.map((f) => [f.id, f]));
  assert.equal(byId.word.ext, '.docx');
  assert.equal(byId.word.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(byId.image.ext, '.zip');
  assert.equal(byId.image.mime, 'application/zip');
  assert.equal(byId.excel.ext, '.xlsx');
  assert.equal(byId.excel.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(byId.ppt.ext, '.pptx');
  assert.equal(byId.ppt.mime, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(byId.txt.ext, '.txt');
  assert.equal(byId.txt.mime, 'text/plain;charset=utf-8');
  assert.equal(byId.md.ext, '.md');
  assert.equal(byId.md.mime, 'text/markdown;charset=utf-8');
  for (const f of FORMAT_OPTIONS) {
    assert.ok(f.label, `${f.id} 应有 label`);
    assert.ok(f.icon, `${f.id} 应有 icon`);
  }
});

// ---------- 会话令牌存储测试（假时钟） ----------
test('token store：add/get 并在使用后刷新过期时间', () => {
  let t = 0;
  const store = createPdfTokenStore({ now: () => t, ttlMs: 100 });
  const tok = store.add({ file: 'a.pdf', originalName: 'a.pdf', numPages: 2 });
  assert.equal(store.size(), 1);

  t = 90;
  const e = store.get(tok);
  assert.equal(e.numPages, 2); // 读到并刷新到 190

  t = 185; // 仍在刷新后的窗口内
  assert.equal(store.get(tok).numPages, 2); // 再次刷新到 285

  t = 286; // 超出第二次刷新窗口
  assert.equal(store.get(tok), null);
  assert.equal(store.size(), 0, '过期条目应被移除');
});

test('token store：无效 token 返回 null', () => {
  const store = createPdfTokenStore({ now: () => 0, ttlMs: 100 });
  assert.equal(store.get('nope'), null);
});

test('token store：delete 删除并返回是否成功', () => {
  let t = 0;
  const store = createPdfTokenStore({ now: () => t, ttlMs: 100 });
  const tok = store.add({ file: 'a.pdf' });
  assert.equal(store.delete(tok), true);
  assert.equal(store.delete(tok), false);
  assert.equal(store.size(), 0);
});

test('token store：cleanupExpired 返回被删条目', () => {
  let t = 0;
  const store = createPdfTokenStore({ now: () => t, ttlMs: 100 });
  store.add({ file: 'a.pdf' });
  store.add({ file: 'b.pdf' });
  t = 150;
  const removed = store.cleanupExpired();
  assert.equal(removed.length, 2);
  assert.deepEqual(removed.map((e) => e.file).sort(), ['a.pdf', 'b.pdf']);
  assert.equal(store.size(), 0);
});

// ---------- HTTP API 测试（注入 mock pdfTool） ----------

function createMockPdfTool() {
  const calls = { parse: [], convert: [], page: [] };
  return {
    calls,
    async parse(body, name) {
      calls.parse.push({ body, name });
      if (body == null || body.length === 0) throw new PdfHttpError(400, '无法解析：内容为空');
      return { token: 'tok123', numPages: 3 };
    },
    async convert(token, format) {
      calls.convert.push({ token, format });
      if (format === 'word') {
        return {
          buffer: Buffer.from('fake-docx-content'),
          baseName: '测试文档',
          ext: '.docx',
          mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
      }
      if (format === 'md') {
        return {
          buffer: Buffer.from('# 标题\n\n正文内容', 'utf8'),
          baseName: '测试文档',
          ext: '.md',
          mime: 'text/markdown; charset=utf-8',
        };
      }
      throw new PdfHttpError(400, '未知格式');
    },
    async page(token, n) {
      calls.page.push({ token, n });
      if (n !== 2) throw new PdfHttpError(404, '页号超出范围');
      return Buffer.from('fake-png');
    },
  };
}

async function withApp(pdfTool, opts = {}, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-pdf-test-'));
  const dataFile = path.join(tmp, 'data.json');
  const app = createApp(dataFile, { pdfTool, ...opts });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
    await once(server, 'close');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('POST /api/tools/pdf/parse：成功返回 token 与页数', async () => {
  const tool = createMockPdfTool();
  await withApp(tool, {}, async (base) => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    const resp = await fetch(`${base}/api/tools/pdf/parse?name=${encodeURIComponent('测试文档.pdf')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdf,
    });
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.ok, true);
    assert.equal(data.token, 'tok123');
    assert.equal(data.numPages, 3);
    assert.equal(tool.calls.parse.length, 1);
    assert.equal(tool.calls.parse[0].body.byteLength, pdf.length);
    assert.equal(tool.calls.parse[0].name, '测试文档.pdf');
  });
});

test('POST /api/tools/pdf/parse：无效 PDF → 400 JSON', async () => {
  const tool = createMockPdfTool();
  tool.parse = async () => {
    throw new PdfHttpError(400, '无法解析：内容为空');
  };
  await withApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/pdf/parse?name=x.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: Buffer.alloc(0),
    });
    assert.equal(resp.status, 400);
    assert.match((await resp.json()).error, /无法解析/);
  });
});

test('POST /api/tools/pdf/parse：Python 环境未就绪 → 503 JSON', async () => {
  const tool = createMockPdfTool();
  tool.parse = async () => {
    throw new PdfHttpError(503, 'Python 环境未就绪，请运行 start.bat 完成环境安装');
  };
  await withApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/pdf/parse?name=x.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: Buffer.from('%PDF fake'),
    });
    assert.equal(resp.status, 503);
    assert.match((await resp.json()).error, /start\.bat/);
  });
});

test('POST /api/tools/pdf/parse：超过上限 → 413 JSON（pdfRawBodyLimitMb 可配）', async () => {
  const tool = createMockPdfTool();
  await withApp(tool, { pdfRawBodyLimitMb: 1 }, async (base) => {
    const huge = Buffer.alloc(2 * 1024 * 1024); // 2MB > 1MB 上限
    const resp = await fetch(`${base}/api/tools/pdf/parse?name=x.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: huge,
    });
    assert.equal(resp.status, 413);
    assert.match((await resp.json()).error, /文件过大/);
    assert.equal(tool.calls.parse.length, 0, '超限不应到达工具层');
  });
});

test('GET /api/tools/pdf/convert：成功返回文件字节与下载头', async () => {
  const tool = createMockPdfTool();
  await withApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/pdf/convert?token=tok123&format=word`);
    assert.equal(resp.status, 200);
    assert.equal(
      resp.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const cd = resp.headers.get('content-disposition') || '';
    assert.ok(cd.includes('attachment'), '应声明 attachment');
    assert.ok(cd.includes(encodeURIComponent('测试文档.docx')), '文件名应 UTF-8 编码');
    const bytes = new Uint8Array(await resp.arrayBuffer());
    assert.equal(Buffer.from(bytes).toString(), 'fake-docx-content');
    assert.deepEqual(tool.calls.convert[0], { token: 'tok123', format: 'word' });
  });
});

test('GET /api/tools/pdf/convert：Markdown 成功返回 UTF-8 字节与下载头', async () => {
  const tool = createMockPdfTool();
  await withApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/pdf/convert?token=tok123&format=md`);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'text/markdown; charset=utf-8');
    const cd = resp.headers.get('content-disposition') || '';
    assert.ok(cd.includes('attachment'), '应声明 attachment');
    assert.ok(cd.includes(encodeURIComponent('测试文档.md')), '文件名应 UTF-8 编码且为 .md');
    const text = await resp.text();
    assert.equal(text, '# 标题\n\n正文内容');
    assert.deepEqual(tool.calls.convert[0], { token: 'tok123', format: 'md' });
  });
});

test('GET /api/tools/pdf/convert：未知格式 → 400 JSON', async () => {
  const tool = createMockPdfTool();
  await withApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/pdf/convert?token=tok123&format=bogus`);
    assert.equal(resp.status, 400);
    assert.match((await resp.json()).error, /未知格式/);
  });
});

test('GET /api/tools/pdf/convert：token 无效 → 404 JSON', async () => {
  const tool = createMockPdfTool();
  tool.convert = async () => {
    throw new PdfHttpError(404, '会话不存在或已过期，请重新上传');
  };
  await withApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/pdf/convert?token=bad&format=word`);
    assert.equal(resp.status, 404);
    assert.match((await resp.json()).error, /会话/);
  });
});

test('GET /api/tools/pdf/page：成功返回 PNG', async () => {
  const tool = createMockPdfTool();
  await withApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/pdf/page?token=tok123&page=2`);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await resp.arrayBuffer());
    assert.equal(Buffer.from(bytes).toString(), 'fake-png');
  });
});

test('GET /api/tools/pdf/page：页号越界 → 404 JSON', async () => {
  const tool = createMockPdfTool();
  await withApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/pdf/page?token=tok123&page=99`);
    assert.equal(resp.status, 404);
    assert.match((await resp.json()).error, /页号/);
  });
});

// ---------- 默认（真实 Python 工具注入开关）验证：注入 mock 时不建临时目录/不起清扫 ----------
test('createApp：注入 pdfTool 时跳过临时目录与清扫定时器', async () => {
  const tool = createMockPdfTool();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-pdf-test-'));
  const dataFile = path.join(tmp, 'data.json');
  const app = createApp(dataFile, { pdfTool: tool });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const ok = (await (await fetch(`http://127.0.0.1:${server.address().port}/api/ping`)).json()).ok;
  assert.equal(ok, true);
  server.close();
  await once(server, 'close');
  fs.rmSync(tmp, { recursive: true, force: true });
});
