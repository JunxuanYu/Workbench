// Markdown 转换工具测试（Node 可运行）
//   1. 工具注册表逻辑（md-convert 已自动注册、结构与顺序）
//   2. HTTP API（createApp + 注入 mock mdTool：convert 成功/空内容/503/413 超限）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp, PdfHttpError } from '../server.js';

// ---------- Mock 最小 DOM 环境（md-convert.js / consult.js 需在 Node 下可导入） ----------
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
test('工具注册表：Markdown 转换工具已自动注册且顺序正确', async () => {
  const mod = await import('../public/js/pages/consult.js');
  const tools = mod.getTools();
  const mdTool = tools.find((t) => t.id === 'md-convert');
  assert.ok(mdTool, 'md-convert 应已注册');
  assert.equal(mdTool.name, 'Markdown 转换');
  assert.equal(mdTool.icon, '📝');
  assert.equal(typeof mdTool.render, 'function');
  // 顺序：pdf-convert → md-convert → json-convert
  assert.deepEqual(
    tools.map((t) => t.id),
    ['pdf-convert', 'md-convert', 'json-convert'],
  );
});

test('工具注册表：重复注册 md-convert 抛错', async () => {
  const mod = await import('../public/js/pages/consult.js');
  assert.throws(() => mod.registerTool({ id: 'md-convert', name: '重复', icon: 'x', render() {} }), /已注册/);
});

// ---------- 工具结构测试 ----------
test('MD 工具：createMdConvertTool 返回正确结构（模块顶层无副作用）', async () => {
  const mod = await import('../public/js/tools/md-convert.js');
  const tool = mod.createMdConvertTool();
  assert.equal(tool.id, 'md-convert');
  assert.equal(tool.name, 'Markdown 转换');
  assert.equal(tool.icon, '📝');
  assert.equal(typeof tool.render, 'function');
});

// ---------- HTTP API 测试（注入 mock mdTool） ----------

function createMockMdTool() {
  const calls = { convert: [] };
  return {
    calls,
    async convert(body, name) {
      calls.convert.push({ body, name });
      if (body == null || body.length === 0) throw new PdfHttpError(400, '内容为空，请粘贴 Markdown 文本');
      const baseName = String(name || '文档.md').replace(/\.(md|markdown|txt)$/i, '') || '文档';
      return {
        buffer: Buffer.from('%PDF-1.4 fake-md-content', 'utf8'),
        baseName,
        ext: '.pdf',
        mime: 'application/pdf',
      };
    },
  };
}

async function withMdApp(mdTool, opts = {}, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-md-test-'));
  const dataFile = path.join(tmp, 'data.json');
  const app = createApp(dataFile, { mdTool, ...opts });
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

test('POST /api/tools/md/convert：成功返回 PDF 字节与下载头', async () => {
  const tool = createMockMdTool();
  await withMdApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/md/convert?name=${encodeURIComponent('笔记.md')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      body: Buffer.from('# 标题\n\n正文内容', 'utf8'),
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'application/pdf');
    const cd = resp.headers.get('content-disposition') || '';
    assert.ok(cd.includes('attachment'), '应声明 attachment');
    assert.ok(cd.includes(encodeURIComponent('笔记.pdf')), '文件名应为去扩展名 + .pdf 且 UTF-8 编码');
    const bytes = new Uint8Array(await resp.arrayBuffer());
    assert.equal(Buffer.from(bytes).toString(), '%PDF-1.4 fake-md-content');
    assert.equal(tool.calls.convert.length, 1);
    assert.equal(tool.calls.convert[0].name, '笔记.md');
    assert.match(tool.calls.convert[0].body.toString('utf8'), /正文内容/);
  });
});

test('POST /api/tools/md/convert：空内容 → 400 JSON', async () => {
  const tool = createMockMdTool();
  await withMdApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/md/convert?name=x.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body: Buffer.alloc(0),
    });
    assert.equal(resp.status, 400);
    assert.match((await resp.json()).error, /内容为空/);
  });
});

test('POST /api/tools/md/convert：Python 环境未就绪 → 503 JSON', async () => {
  const tool = createMockMdTool();
  tool.convert = async () => {
    throw new PdfHttpError(503, 'Python 环境未就绪，请运行 start.bat 完成环境安装');
  };
  await withMdApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/md/convert?name=x.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body: Buffer.from('# hi'),
    });
    assert.equal(resp.status, 503);
    assert.match((await resp.json()).error, /start\.bat/);
  });
});

test('POST /api/tools/md/convert：超过上限 → 413 JSON（mdRawBodyLimitMb 可配）', async () => {
  const tool = createMockMdTool();
  await withMdApp(tool, { mdRawBodyLimitMb: 1 }, async (base) => {
    const huge = Buffer.alloc(2 * 1024 * 1024); // 2MB > 1MB 上限
    const resp = await fetch(`${base}/api/tools/md/convert?name=x.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body: huge,
    });
    assert.equal(resp.status, 413);
    assert.match((await resp.json()).error, /文件过大/);
    assert.equal(tool.calls.convert.length, 0, '超限不应到达工具层');
  });
});

test('POST /api/tools/md/convert：未知扩展名也走默认文档名', async () => {
  const tool = createMockMdTool();
  await withMdApp(tool, {}, async (base) => {
    const resp = await fetch(`${base}/api/tools/md/convert?name=${encodeURIComponent('随手写.txt')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('标题'),
    });
    assert.equal(resp.status, 200);
    const cd = resp.headers.get('content-disposition') || '';
    assert.ok(cd.includes(encodeURIComponent('随手写.pdf')), '.txt 输入应得到去除扩展名的 .pdf 文件名');
  });
});

test('createApp：注入 mdTool 时跳过临时目录创建', async () => {
  const tool = createMockMdTool();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-md-test-'));
  const dataFile = path.join(tmp, 'data.json');
  const app = createApp(dataFile, { mdTool: tool });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const ok = (await (await fetch(`http://127.0.0.1:${server.address().port}/api/ping`)).json()).ok;
  assert.equal(ok, true);
  server.close();
  await once(server, 'close');
  fs.rmSync(tmp, { recursive: true, force: true });
});
