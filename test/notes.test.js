// 个人笔记：Markdown 安全渲染、H1 目录提取、饮食模块清理的回归测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractH1, extractHeadings, renderMarkdown, safeUrl, slugifyHeading } from '../public/js/markdown.js';
import { defaultData, migrateData, validateData } from '../public/js/logic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// ---------- 标题提取 ----------
test('笔记标题：extractH1 只提取一级标题，忽略二至六级与正文', () => {
  const md = ['# 桃夭笔记', '', '正文 ## 不是标题', '', '## 二级标题', '', '### 三级标题'].join('\n');
  const h1 = extractH1(md);
  assert.equal(h1.length, 1);
  assert.equal(h1[0].text, '桃夭笔记');
  assert.equal(h1[0].level, 1);
  assert.ok(h1[0].id);
});

test('笔记标题：围栏代码块与行内代码里的 # 不会误判为标题', () => {
  const md = ['# 真标题', '', '```bash', '# 这是代码注释', '```', '', '`# 行内代码`', '', '# 第二个标题'].join('\n');
  const h1 = extractH1(md);
  assert.deepEqual(
    h1.map((h) => h.text),
    ['真标题', '第二个标题'],
  );
});

test('笔记标题：重复 H1 生成唯一锚点，且 id 不含空格/引号', () => {
  const md = ['# 重复 标题', '# 重复 标题', '# 重复 标题'].join('\n');
  const h1 = extractH1(md);
  assert.equal(h1.length, 3);
  assert.equal(new Set(h1.map((h) => h.id)).size, 3);
  for (const h of h1) assert.match(h.id, /^[\p{L}\p{N}-]+$/u);
});

test('笔记标题：中文 slug 可用，纯符号标题有兜底 id', () => {
  assert.equal(slugifyHeading('桃之夭夭，灼灼其华'), '桃之夭夭灼灼其华');
  const h = extractH1('# ！！！')[0];
  assert.match(h.id, /^section-\d+$/);
});

test('笔记标题：extractHeadings 返回全部层级，顺序与原文一致', () => {
  const headings = extractHeadings('# A\n\n## B\n\n### C');
  assert.deepEqual(
    headings.map((h) => h.level),
    [1, 2, 3],
  );
});

// ---------- 渲染 ----------
test('笔记渲染：标题/段落/加粗/斜体/列表/代码/表格/链接', () => {
  const md = [
    '# 标题',
    '',
    '一段 **加粗** 与 *斜体* 文字。',
    '',
    '- 甲',
    '- 乙',
    '',
    '```js',
    'const a = 1 < 2;',
    '```',
    '',
    '| 名称 | 数量 |',
    '| --- | --- |',
    '| 书 | 2 |',
    '',
    '[示例](https://example.com/a)',
  ].join('\n');
  const { html, headings } = renderMarkdown(md);
  assert.match(html, /<h1 id="标题">标题<\/h1>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<ul><li>甲<\/li><li>乙<\/li><\/ul>/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.ok(html.includes('const a = 1 &lt; 2;'), '代码块内容应转义');
  assert.match(html, /<table><thead><tr><th>名称<\/th><th>数量<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>书<\/td>/);
  assert.match(html, /href="https:\/\/example.com\/a"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal(headings[0].text, '标题');
});

test('笔记渲染：空输入安全返回空结构', () => {
  assert.deepEqual(renderMarkdown(''), { html: '', headings: [] });
  assert.deepEqual(renderMarkdown(null), { html: '', headings: [] });
});

// ---------- 安全 ----------
test('笔记安全：原始 HTML 被转义，不会变成可执行标签', () => {
  const { html } = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.ok(html.includes('&lt;script&gt;'), 'script 应被转义');
  assert.equal(html.includes('<script>'), false, '不得输出真实 script 标签');
  assert.equal(html.includes('<img'), false, '不得输出原始 img 标签');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('笔记安全：javascript/data:text/html 等危险链接不生成 href', () => {
  const md = [
    '[a](javascript:alert(1))',
    '[b](JavaScript:alert(1))',
    '[c](data:text/html;base64,PHNjcmlwdD4=)',
    '[d](vbscript:msgbox(1))',
  ].join('\n\n');
  const { html } = renderMarkdown(md);
  assert.equal(/href\s*=\s*["']?\s*javascript:/i.test(html), false);
  assert.equal(/href\s*=\s*["']?\s*data:text\/html/i.test(html), false);
  assert.equal(/href\s*=\s*["']?\s*vbscript:/i.test(html), false);
  assert.equal(html.includes('<a '), false, '危险链接只保留文字');
});

test('笔记安全：链接/图片语法不能注入属性或标签', () => {
  const md = '[x](https://example.com/" onmouseover="alert(1))';
  const { html } = renderMarkdown(md);
  assert.equal(/onmouseover="alert/.test(html), false);
  assert.ok(html.includes('&quot;'), '属性中的引号应被转义');
});

test('笔记安全：safeUrl 白名单', () => {
  assert.equal(safeUrl('https://example.com'), 'https://example.com');
  assert.equal(safeUrl('http://example.com'), 'http://example.com');
  assert.equal(safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(safeUrl('#part'), '#part');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.equal(safeUrl('//evil.example'), null);
  assert.equal(safeUrl(''), null);
});

// ---------- 饮食模块清理 / 笔记数据结构 ----------
test('饮食下线：导航、路由、首页、logic 均无残留引用', () => {
  const index = read('public/index.html');
  assert.match(index, /data-route="notes"/);
  assert.equal(index.includes('data-route="diet"'), false);
  assert.equal(index.includes('饮食计划'), false);
  assert.equal(existsSync(join(root, 'public/js/pages/diet.js')), false, 'diet.js 应删除');

  const router = read('public/js/router.js');
  assert.ok(router.includes('./pages/notes.js'));
  assert.equal(router.includes('diet'), false);

  const home = read('public/js/pages/home.js');
  assert.equal(home.includes('mealEntriesOn'), false);
  assert.equal(home.includes("route: 'diet'"), false);

  const logic = read('public/js/logic.js');
  for (const token of ['dietProgress', 'daysSinceLastMeal', 'mealEntriesOn', 'mealsToday']) {
    assert.equal(logic.includes(token), false, `logic.js 不应残留 ${token}`);
  }
});

test('笔记数据：defaultData 含 notes 空数组，旧数据迁移后通过校验', () => {
  const d = defaultData();
  assert.deepEqual(d.notes, []);
  assert.equal('meals' in d, false);
  assert.deepEqual(validateData(d), { ok: true, errors: [] });

  const old = { ...defaultData(), meals: { '2026-08-11': {} } };
  delete old.notes;
  const migrated = migrateData(old);
  assert.equal('meals' in migrated, false);
  assert.deepEqual(migrated.notes, []);
  assert.deepEqual(validateData(migrated), { ok: true, errors: [] });
});

test('笔记数据：server 与 store 读取时会执行 migrateData', () => {
  assert.ok(read('server.js').includes('migrateData'));
  assert.ok(read('public/js/store.js').includes('migrateData'));
});
