// 工具箱 & PDF 转换工具测试（纯逻辑，Node 可运行）
// 注：pdf.js 的实际解析和 Canvas 渲染需要浏览器环境，此处仅测试：
//   1. 工具注册表逻辑（registerTool / getTools）
//   2. PDF 转换工具结构（createPdfConvertTool / FORMAT_OPTIONS）
//   3. 纯文本转换函数（convertTxt）
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- Mock 最小 DOM 环境 ----------
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) {
      return {
        width: 0, height: 0,
        toDataURL() { return 'data:image/png;base64,mock'; },
        getContext() { return {}; }
      };
    },
    head: { append() {} },
    querySelector() { return null; }
  };
}
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = class Blob {
    constructor(parts, opts) {
      this._text = (parts || []).map(p => typeof p === 'string' ? p : '').join('');
      this.type = opts?.type || '';
    }
    async text() { return this._text; }
  };
}
if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = { createObjectURL() { return 'blob:mock'; } };
}

// ---------- 工具注册表测试 ----------
// 动态导入 consult.js（需 mock DOM 后再导入）
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
  const pdfTool = tools.find(t => t.id === 'pdf-convert');
  assert.ok(pdfTool, 'pdf-convert 应已注册');
  assert.equal(pdfTool.name, 'PDF 转换');
  assert.equal(pdfTool.icon, '📑');
  assert.equal(typeof pdfTool.render, 'function');
});

test('工具注册表：重复注册同 id 抛错', () => {
  assert.throws(
    () => registerTool({ id: 'pdf-convert', name: '重复', icon: 'x', render() {} }),
    /已注册/
  );
});

test('工具注册表：缺字段抛错', () => {
  assert.throws(() => registerTool({ id: 'test' }), /必须包含/);
  assert.throws(() => registerTool(null), /必须包含/);
  assert.throws(() => registerTool({ id: 't', name: 'T', icon: 'x' }), /必须包含/); // 无 render
});

// ---------- PDF 转换工具结构测试 ----------
let createPdfConvertTool, FORMAT_OPTIONS, convertTxt;

test('PDF 工具：导入成功', async () => {
  const mod = await import('../public/js/tools/pdf-convert.js');
  createPdfConvertTool = mod.createPdfConvertTool;
  FORMAT_OPTIONS = mod.FORMAT_OPTIONS;
  convertTxt = mod.convertTxt;
  assert.equal(typeof createPdfConvertTool, 'function');
  assert.ok(Array.isArray(FORMAT_OPTIONS));
  assert.equal(typeof convertTxt, 'function');
});

test('PDF 工具：createPdfConvertTool 返回正确结构', () => {
  const tool = createPdfConvertTool();
  assert.equal(tool.id, 'pdf-convert');
  assert.equal(tool.name, 'PDF 转换');
  assert.equal(tool.icon, '📑');
  assert.equal(typeof tool.render, 'function');
});

test('PDF 工具：FORMAT_OPTIONS 包含 5 种格式', () => {
  assert.equal(FORMAT_OPTIONS.length, 5);
  const ids = FORMAT_OPTIONS.map(f => f.id);
  assert.deepEqual(ids, ['word', 'image', 'excel', 'ppt', 'txt']);
  for (const f of FORMAT_OPTIONS) {
    assert.ok(f.label, `${f.id} 应有 label`);
    assert.ok(f.icon, `${f.id} 应有 icon`);
    assert.ok(f.mime, `${f.id} 应有 mime`);
    assert.ok(f.ext, `${f.id} 应有 ext`);
  }
});

// ---------- 转换函数测试 ----------
test('convertTxt：提取文本，包含页码标记', async () => {
  const mockPdf = {
    numPages: 2,
    pages: [
      { num: 1, text: '第一页内容', imageData: '' },
      { num: 2, text: '第二页内容', imageData: '' }
    ]
  };
  const blob = convertTxt(mockPdf);
  assert.ok(blob instanceof Blob);
  const text = await blob.text();
  assert.ok(text.includes('第一页内容'));
  assert.ok(text.includes('第二页内容'));
  assert.ok(text.includes('第 1 页'));
  assert.ok(text.includes('第 2 页'));
});

test('convertTxt：空 PDF 返回空内容', async () => {
  const mockPdf = { numPages: 0, pages: [] };
  const blob = convertTxt(mockPdf);
  const text = await blob.text();
  assert.equal(text, '');
});

test('convertTxt：单页 PDF 只有一个页码标记', async () => {
  const mockPdf = {
    numPages: 1,
    pages: [{ num: 1, text: 'Hello World', imageData: '' }]
  };
  const blob = convertTxt(mockPdf);
  const text = await blob.text();
  assert.ok(text.includes('第 1 页'));
  assert.ok(text.includes('Hello World'));
  // 不应有第二个页码标记
  assert.ok(!text.includes('第 2 页'));
});
