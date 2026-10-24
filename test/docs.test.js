// v1.1 迭代文档一致性：README / PRD / 开发计划 / package 与实现保持同步
// 目的：防止「代码已改、文档仍写饮食计划/12 套主题」这类迭代漂移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (name) => readFileSync(join(root, name), 'utf8');
const readme = read('README.md');
const prd = read('docs/PRD.md');
const plan = read('docs/开发计划.md');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('public/index.html');

test('文档版本：package / lock 均为 v1.1.0，README 与开发计划标注 v1.1', () => {
  assert.equal(pkg.version, '1.1.0');
  assert.equal(lock.version, '1.1.0');
  assert.equal(lock.packages[''].version, '1.1.0');
  assert.match(plan, /v1\.1/);
  assert.match(readme, /13 套配色|个人笔记/);
});

test('README：已替换饮食计划，包含个人笔记与桃夭主题说明', () => {
  assert.match(readme, /# 个人笔记/);
  assert.match(readme, /上传 `\.md`/);
  assert.match(readme, /13 套配色/);
  assert.match(readme, /桃夭/);
  assert.doesNotMatch(readme, /# 饮食计划/);
  assert.doesNotMatch(readme, /吃饭/);
});

test('PRD：模块/首页/功能/验收均为个人笔记，13 套主题，无饮食章节', () => {
  assert.match(prd, /7 个模块：.*个人笔记/);
  assert.match(prd, /### 5\.5 个人笔记/);
  assert.match(prd, /5 张摘要卡片/);
  assert.match(prd, /13 套主题/);
  assert.match(prd, /默认「桃夭」/);
  assert.match(prd, /\*\*个人笔记\*\*/);
  assert.doesNotMatch(prd, /### 5\.5 饮食计划/);
  assert.doesNotMatch(prd, /12 套主题/);
});

test('开发计划：结构/数据模型/测试清单已同步 v1.1', () => {
  assert.match(plan, /pages\/notes\.js/);
  assert.match(plan, /markdown\.js/);
  assert.match(plan, /#\/notes/);
  assert.match(plan, /13 套主题/);
  assert.match(plan, /"settings": \{ "theme": "peach" \}/);
  assert.match(plan, /"notes": \[/);
  assert.match(plan, /security\.test\.js/);
  assert.doesNotMatch(plan, /pages\/diet\.js/);
  assert.doesNotMatch(plan, /"meals":/);
  assert.doesNotMatch(plan, /12 套主题/);
});

test('文档与实现：导航 7 项、无 diet、笔记在账目之前', () => {
  const routes = [...index.matchAll(/data-route="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(routes, ['home', 'today', 'dev', 'consult', 'notes', 'money', 'settings']);
  assert.equal(index.includes('data-route="diet"'), false);
  assert.ok(index.indexOf('data-route="notes"') < index.indexOf('data-route="money"'));
});

test('测试报告目录存在，命名规范可被后续报告沿用', () => {
  assert.ok(existsSync(join(root, 'docs/test')), 'docs/test 应存在');
});
