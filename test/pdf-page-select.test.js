// PDF 转换工具：页码范围交互测试
// 用最小 DOM 桩真实调用 render()，串起「上传解析 -> 填页码 -> 校验 -> 发起转换」全流程，
// 断言请求 URL、下载文件名、状态文案都与所选页码一致（纯源码字符串检查抓不到这类回归）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this._text = '';
    this.value = '';
    this.disabled = false;
    this.className = '';
    const cls = new Set();
    this.classList = {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, on) => {
        const next = on === undefined ? !cls.has(c) : Boolean(on);
        if (next) cls.add(c);
        else cls.delete(c);
      },
    };
  }
  set innerHTML(v) {
    this._html = String(v);
    if (!v) this.children = [];
  }
  get innerHTML() {
    return this._html || '';
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  append(...nodes) {
    for (const n of nodes) {
      if (!n) continue;
      n.parent = this;
      this.children.push(n);
    }
  }
  appendChild(n) {
    this.append(n);
    return n;
  }
  setAttribute(k, v) {
    this[k] = v;
  }
  addEventListener() {}
  focus() {}
  select() {}
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  // 拖拽区 reset 时按标签取子节点
  querySelectorAll(selector) {
    const tag = selector.toUpperCase();
    const out = [];
    const walk = (node) => {
      for (const c of node.children || []) {
        if (c.tagName === tag) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

function findByTag(root, tag) {
  const out = [];
  const walk = (node) => {
    for (const c of node.children || []) {
      if (c.tagName === tag) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

function findByClass(root, cls) {
  const out = [];
  const walk = (node) => {
    for (const c of node.children || []) {
      if ((c.className || '').split(/\s+/).includes(cls)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

globalThis.document = {
  createElement: (tag) => new El(tag),
  body: new El('body'),
  head: new El('head'),
  getElementById: () => null,
  querySelector: () => null,
};
globalThis.URL.createObjectURL = () => 'blob:mock';
globalThis.URL.revokeObjectURL = () => {};

const { createPdfConvertTool } = await import('../public/js/tools/pdf-convert.js');

function setupFetch({ numPages = 5, convertStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    if (String(url).startsWith('/api/tools/pdf/parse')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, token: 'tok1', numPages }) };
    }
    return {
      ok: convertStatus === 200,
      status: convertStatus,
      json: async () => ({ error: '转换失败' }),
      blob: async () => ({ size: 4096, text: async () => '内容' }),
    };
  };
  return calls;
}

async function mount({ numPages = 5, convertStatus = 200 } = {}) {
  const calls = setupFetch({ numPages, convertStatus });
  const view = new El('div');
  createPdfConvertTool().render(view);
  const fileInput = findByTag(view, 'INPUT').find((i) => i.type === 'file');
  const pageInput = findByTag(view, 'INPUT').find((i) => i.id === 'pdf-page-range');
  const hint = findByClass(view, 'pdf-range-hint')[0];
  const buttons = findByTag(view, 'BUTTON').filter(
    (b) => b.className.includes('btn-sm') && !/重新选择/.test(b.textContent),
  );
  const upload = async (name = '报告.pdf') => {
    fileInput.files = [{ name, size: 2048, arrayBuffer: async () => new ArrayBuffer(4) }];
    await fileInput.onchange();
  };
  return { view, calls, fileInput, pageInput, hint, buttons, upload };
}

test('页码输入：上传前禁用，解析完成后启用并显示总页数', async () => {
  const { pageInput, hint, upload } = await mount({ numPages: 5 });
  assert.equal(pageInput.disabled, true, '未上传时不应允许填页码');
  await upload();
  assert.equal(pageInput.disabled, false);
  assert.match(hint.textContent, /共 5 页/);
  assert.match(hint.textContent, /全部转换/);
});

test('页码输入：输入时实时校验（越界即时提示，合法显示已选页数）', async () => {
  const { pageInput, hint, upload } = await mount({ numPages: 5 });
  await upload();

  pageInput.value = '9';
  pageInput.oninput();
  assert.ok(pageInput.classList.contains('is-invalid'), '越界应标红');
  assert.match(hint.textContent, /超出范围/);

  pageInput.value = '3-1';
  pageInput.oninput();
  assert.match(hint.textContent, /起始页不能大于结束页/);

  pageInput.value = '2-3';
  pageInput.oninput();
  assert.ok(!pageInput.classList.contains('is-invalid'));
  assert.match(hint.textContent, /已选 2 页/);

  pageInput.value = '';
  pageInput.oninput();
  assert.match(hint.textContent, /全部转换/);
});

test('页码输入：非法输入时不发起转换请求（按格式按钮也无网络请求）', async () => {
  const { view, pageInput, buttons, calls, upload } = await mount({ numPages: 5 });
  await upload();
  const before = calls.length;
  pageInput.value = 'abc';
  await buttons[0].onclick();
  assert.equal(calls.length, before, '非法页码不应请求后端');
  const message = findByTag(view, 'DIV').find((d) => /格式不正确/.test(d.textContent));
  assert.ok(message, '状态区应提示页码格式错误');
  assert.ok(pageInput.classList.contains('is-invalid'));
});

test('转换请求：选中页码时带 pages 参数，下载名附 -p 后缀', async () => {
  const { pageInput, buttons, calls, upload } = await mount({ numPages: 5 });
  await upload();
  pageInput.value = '2-3';
  pageInput.oninput();
  await buttons[0].onclick(); // Word（第一个格式按钮）

  const convertCall = calls.find((c) => c.url.startsWith('/api/tools/pdf/convert'));
  assert.ok(convertCall, '应发起转换请求');
  assert.match(convertCall.url, /pages=2-3/);
  assert.match(convertCall.url, /format=word/);
  assert.match(convertCall.url, /layout=1/);
});

test('转换请求：未填页码时不带 pages 参数（保持旧行为）', async () => {
  const { buttons, calls, upload } = await mount({ numPages: 5 });
  await upload();
  await buttons[0].onclick();
  const convertCall = calls.find((c) => c.url.startsWith('/api/tools/pdf/convert'));
  assert.ok(!convertCall.url.includes('pages='), '未选页时不应带 pages');
});

test('转换结果：选页时状态与结果区标明页码范围、文件名带后缀', async () => {
  const { view, pageInput, buttons, upload } = await mount({ numPages: 5 });
  await upload();
  pageInput.value = '2';
  pageInput.oninput();
  await buttons[0].onclick();

  const status = findByTag(view, 'DIV').find((d) => /转换完成/.test(d.textContent));
  assert.ok(status, '应有完成状态提示');
  assert.match(status.textContent, /第 2 页/);

  const link = findByTag(view, 'A')[0];
  assert.equal(link.download, '报告-p2.docx');
  const scope = findByClass(view, 'pdf-result-scope')[0];
  assert.match(scope.textContent, /已转换 第 2 页（共 5 页）/);
});

test('转换结果：全套页时文件名不带后缀，结果区无页码说明', async () => {
  const { view, buttons, upload } = await mount({ numPages: 3 });
  await upload();
  await buttons[0].onclick();
  const link = findByTag(view, 'A')[0];
  assert.equal(link.download, '报告.docx');
  assert.equal(findByClass(view, 'pdf-result-scope').length, 0);
});

test('重新选择：清空页码并恢复禁用状态', async () => {
  const { view, pageInput, hint, upload } = await mount({ numPages: 4 });
  await upload();
  pageInput.value = '2';
  pageInput.oninput();
  const resetBtn = findByTag(view, 'BUTTON').find((b) => /重新选择/.test(b.textContent));
  resetBtn.onclick();
  assert.equal(pageInput.value, '');
  assert.equal(pageInput.disabled, true);
  assert.match(hint.textContent, /上传后填写/);
});
