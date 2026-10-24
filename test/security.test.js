// 安全回归：XSS/危险链接、API 同源守卫、静态目录穿越、打开本地文件的命令注入面、密码箱参数
// 这些用例覆盖 v1.1 新增的个人笔记渲染，以及既有的本机服务边界。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server.js';
import { defaultData, migrateData, validateData } from '../public/js/logic.js';
import { renderMarkdown, safeUrl } from '../public/js/markdown.js';
import { DEFAULT_ITERATIONS, MAX_ITERATIONS, createVault, unlockVault, validateVault } from '../public/js/vault.js';

const stubPdfTool = {
  parse: async () => {
    throw new Error('not used');
  },
  convert: async () => {
    throw new Error('not used');
  },
  page: async () => {
    throw new Error('not used');
  },
  cleanup: () => 0,
};
const stubMdTool = {
  convert: async () => {
    throw new Error('not used');
  },
};

let server;
let base;
let tmpDir;
let dataFile;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklift-security-'));
  dataFile = path.join(tmpDir, 'data.json');
  const app = createApp(dataFile, { pdfTool: stubPdfTool, mdTool: stubMdTool, onShutdown: () => {} });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function rawFetch(pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathname);
    const req = http.request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('个人笔记：Markdown XSS 与危险协议', () => {
  test('原始 HTML/脚本/事件属性被转义，不产生可执行标签', () => {
    const payload = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<iframe srcdoc="<script>alert(2)</script>"></iframe>',
      '正文 <a href="javascript:alert(3)">链接</a>',
    ].join('\n\n');
    const { html } = renderMarkdown(payload);
    assert.doesNotMatch(html, /<(script|img|svg|iframe)\b/i);
    // onerror 等字样只允许出现在已转义的文本里，不能出现在真实标签属性中
    assert.doesNotMatch(html, /<[^>]+\son(?:error|load|click|mouseover)\s*=/i);
    assert.ok(html.includes('&lt;script&gt;'), 'script 应作为文本显示');
  });

  test('javascript/data/vbscript/file/协议相对链接均不生成 href', () => {
    const md = [
      '[a](javascript:alert(1))',
      '[b](JaVaScRiPt:alert(1))',
      '[c](data:text/html;base64,PHNjcmlwdD4=)',
      '[d](vbscript:msgbox(1))',
      '[e](file:///C:/Windows/win.ini)',
      '[f](//evil.example/path)',
      '![g](javascript:alert(1))',
    ].join('\n\n');
    const { html } = renderMarkdown(md);
    assert.doesNotMatch(html, /href\s*=\s*["']?\s*(?:javascript|data|vbscript|file):/i);
    assert.doesNotMatch(html, /href\s*=\s*["']?\s*\/\//i);
    assert.doesNotMatch(html, /<img\b/i);
  });

  test('链接属性注入被转义，不产生 onmouseover 等属性', () => {
    const { html } = renderMarkdown('[x](https://example.com/" onmouseover="alert(1))');
    assert.doesNotMatch(html, /<[^>]+\sonmouseover\s*=/i, '真实标签中不得出现事件属性');
    assert.ok(html.includes('&quot;'), '引号应被转义');
  });

  test('标题/表格/列表中的 HTML 同样被转义', () => {
    const { html } = renderMarkdown('# "><img src=x onerror=alert(1)>\n\n| <script>x</script> |\n| --- |');
    assert.doesNotMatch(html, /<img|<script/i);
    assert.doesNotMatch(html, /<[^>]+\sonerror\s*=/i, '真实标签中不得出现事件属性');
  });

  test('safeUrl 白名单只放行 http(s)/mailto/页内锚点', () => {
    assert.equal(safeUrl('https://example.com'), 'https://example.com');
    assert.equal(safeUrl('http://example.com'), 'http://example.com');
    assert.equal(safeUrl('mailto:a@example.com'), 'mailto:a@example.com');
    assert.equal(safeUrl('#section'), '#section');
    for (const raw of [
      'javascript:alert(1)',
      'data:text/html,x',
      'vbscript:msgbox(1)',
      'file:///C:/x.txt',
      '//evil.example',
      ' javaScript:alert(1)',
    ]) {
      assert.equal(safeUrl(raw), null, `${raw} 应被拒绝`);
    }
  });
});

describe('API 边界：同源/Host 守卫与危险请求', () => {
  test('非本机 Host（DNS rebinding）被拒绝', async () => {
    const r = await rawFetch('/api/ping', { headers: { Host: 'evil.example.com' } });
    assert.equal(r.status, 403);
  });

  test('跨站 Origin / null Origin / 跨站 Sec-Fetch-Site 被拒绝', async () => {
    for (const headers of [
      { Origin: 'https://evil.example' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
    ]) {
      const r = await rawFetch('/api/ping', { headers });
      assert.equal(r.status, 403, JSON.stringify(headers));
    }
  });

  test('本机同源请求仍可用，且 API 响应不缓存', async () => {
    const r = await rawFetch('/api/data', {
      headers: { Host: `127.0.0.1:${server.address().port}`, Origin: base, 'Sec-Fetch-Site': 'same-origin' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
  });

  test('关闭工作台：GET 不存在，非 JSON POST 被 415 拒绝', async () => {
    const get = await rawFetch('/api/shutdown');
    assert.equal(get.status, 404);
    const post = await rawFetch('/api/shutdown', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"x":1}',
    });
    assert.equal(post.status, 415);
  });

  test('打开本地文件：GET 不存在，text/plain POST 不解析路径', async () => {
    const get = await rawFetch('/api/open?path=' + encodeURIComponent(tmpDir));
    assert.equal(get.status, 404);
    const post = await rawFetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ path: tmpDir }),
    });
    assert.equal(post.status, 400);
  });

  test('打开本地文件：UNC 网络路径被拒绝（防 NetNTLM 泄露）', async () => {
    const r = await fetch(`${base}/api/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '\\\\attacker\\share\\x.txt' }),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /不支持网络路径/);
  });

  test('打开本地文件：Windows cmd 元字符路径被拒绝（命令注入面）', { skip: process.platform !== 'win32' }, async () => {
    const evil = path.join(tmpDir, 'a&calc.txt');
    fs.writeFileSync(evil, 'x');
    try {
      const r = await fetch(`${base}/api/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: evil }),
      });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /特殊字符/);
    } finally {
      fs.rmSync(evil, { force: true });
    }
  });

  test('静态目录不暴露数据文件/服务端源码，路径穿越返回非 200', async () => {
    for (const pathname of [
      '/data/worklift-data.json',
      '/../data/worklift-data.json',
      '/%2e%2e/data/worklift-data.json',
      '/server.js',
      '/../server.js',
      '/js/../../server.js',
    ]) {
      const r = await rawFetch(pathname);
      assert.notEqual(r.status, 200, `${pathname} 不应可读`);
    }
  });

  test('安全响应头：CSP 禁止内联脚本与嵌入，no-sniff/无版本头', async () => {
    const r = await fetch(`${base}/`);
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/i);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });
});

describe('数据层：主题/笔记形状校验与迁移', () => {
  test('非法主题被校验拒绝，迁移时回退默认桃夭', () => {
    const d = defaultData();
    d.settings.theme = 'not-a-theme';
    assert.equal(validateData(d).ok, false);
    assert.equal(migrateData({ ...d }).settings.theme, 'peach');
  });

  test('notes 必须是对象数组；null/字符串项被拒绝并在迁移时过滤', () => {
    const d = defaultData();
    d.notes = [null, 'x', { id: 'n1', title: 'T', content: '# T' }];
    assert.equal(validateData(d).ok, false);
    assert.equal(migrateData({ ...d }).notes.length, 1);
  });
});

describe('密码箱：加密参数与明文不落盘', () => {
  test('PBKDF2 迭代上限合理，AES-GCM 密文不含主密码/条目明文', async () => {
    assert.ok(DEFAULT_ITERATIONS >= 100_000);
    assert.ok(MAX_ITERATIONS > DEFAULT_ITERATIONS);
    const created = await createVault('master-1234');
    assert.equal(created.ok, true);
    assert.equal(created.vault.iterations, DEFAULT_ITERATIONS);
    assert.ok(created.vault.salt.length > 0);
    assert.ok(created.vault.data.length > 0);
    assert.equal(JSON.stringify(created.vault).includes('master-1234'), false);

    const unlocked = await unlockVault(created.vault, 'master-1234');
    assert.equal(unlocked.ok, true);
    assert.deepEqual(unlocked.entries, []);
    const wrong = await unlockVault(created.vault, 'wrong-password');
    assert.equal(wrong.ok, false);
  });

  test('validateVault 拒绝超限迭代次数（防 PBKDF2 DoS）', () => {
    assert.equal(validateVault({ salt: 'x', iterations: MAX_ITERATIONS + 1, data: 'y' }).ok, false);
    assert.equal(validateVault({ salt: 'x', iterations: 0, data: 'y' }).ok, false);
    assert.equal(validateVault({ salt: 'x', iterations: 1000, data: 'y' }).ok, true);
  });
});
