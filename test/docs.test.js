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

test('文档版本：package / lock 均为 v1.3.2，README 与开发计划标注 v1.1+ 系列', () => {
  assert.equal(pkg.version, '1.3.2');
  assert.equal(lock.version, '1.3.2');
  assert.equal(lock.packages[''].version, '1.3.2');
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

// ---------- v1.1.1 迭代（PDF 工具前端优化 + 桃夭视觉微调）文档同步 ----------
test('开发计划：记录 v1.1.1 变更（PDF 前端可连续转换 / 主题变量修复 / 版本号）', () => {
  assert.match(plan, /v1\.1\.1/);
  assert.match(plan, /可连续转换/);
  assert.match(plan, /validatePdfFile/);
});

test('优化记录：execution log 含 2026-10-25 本轮条目', () => {
  const opt = read('docs/optimization.md');
  assert.match(opt, /2026-10-25/);
  assert.match(opt, /PDF 转换前端优化/);
});

// ---------- v1.2.0 迭代（工具箱新增 Git 使用指南）文档同步 ----------
test('开发计划：工具箱章节记录 Git 指南工具（搜索/分类/复制/数据规模）', () => {
  assert.match(plan, /v1\.2\.0/);
  assert.match(plan, /git-guide\.js/);
  assert.match(plan, /Git 使用指南|Git 指南/);
  assert.match(plan, /52 条/);
});

test('README：工具箱包含 Git 指南条目', () => {
  assert.match(readme, /Git 使用指南|Git 指南/);
});

// ---------- v1.2.1 迭代（安全审计与修复）文档同步 ----------
test('开发计划：记录 v1.2.1 安全审计要点（open 执行面 / 渲染预算 / 临时目录）', () => {
  assert.match(plan, /v1\.2\.1/);
  assert.match(plan, /inspectOpenTarget/);
  assert.match(plan, /MAX_RENDER_PIXELS/);
  assert.match(plan, /sweepStaleFiles/);
});

test('安全验收报告：docs/test 下存在 2026-11-01 安全审计报告', () => {
  const report = join(root, 'docs/test/SafeTest-2026-11-01-安全审计与漏洞修复-tulip.md');
  assert.ok(existsSync(report), '应有本轮安全审计报告');
  const body = readFileSync(report, 'utf8');
  assert.match(body, /风险清单/);
  assert.match(body, /复测|回归/);
});

// ---------- v1.3.0 迭代（PDF 按页码转换）文档同步 ----------
test('开发计划：记录 v1.3.0 按页转换要点（范围语法 / 三层贯通 / 页号语义）', () => {
  assert.match(plan, /v1\.3\.0/);
  assert.match(plan, /parse_page_range/);
  assert.match(plan, /page-range\.js/);
  assert.match(plan, /按页码转换/);
});

test('README：PDF 转换条目说明按页码转换能力', () => {
  assert.match(readme, /按页码转换/);
  assert.match(readme, /2-5/);
});

// ---------- 版本变更日志（CHANGELOG）与发版一致性 ----------
test('变更日志：存在 CHANGELOG.md，首条记录与 package.version 一致', () => {
  assert.ok(existsSync(join(root, 'CHANGELOG.md')), '根目录应有 CHANGELOG.md');
  const changelog = read('CHANGELOG.md');
  const firstVersion = changelog.match(/^## v(\d+\.\d+\.\d+)/m)?.[1];
  assert.equal(firstVersion, pkg.version, 'CHANGELOG 最新版本应与 package.json 一致');
});

test('变更日志：覆盖 v1.0.0 以来各版本，且 v1.2.1 条目含安全加固要点', () => {
  const changelog = read('CHANGELOG.md');
  for (const v of ['1.0.0', '1.1.0', '1.1.1', '1.2.0', '1.2.1', '1.3.0', '1.3.1', '1.3.2']) {
    assert.match(changelog, new RegExp(`## v${v.replace(/\./g, '\\.')}`), `缺少 v${v} 记录`);
  }
  assert.match(changelog, /inspectOpenTarget|40 项/);
  assert.match(changelog, /MAX_RENDER_PIXELS/);
  assert.match(changelog, /SafeTest-2026-11-01/);
});

// ---------- v1.3.2 迭代（PDF 转换保真修复）文档同步 ----------
test('开发计划：记录 v1.3.2 转换保真修复的五处改动', () => {
  assert.match(plan, /v1\.3\.2/);
  assert.match(plan, /_document_body_size/);
  assert.match(plan, /_docx_new_list_numbering/);
  assert.match(plan, /_list_prefixes/);
  assert.match(plan, /Block\.start/);
});

test('README：PDF 条目说明转换保真（正文不误判标题 / 列表编号保留）', () => {
  assert.match(readme, /转换保真/);
  assert.match(readme, /有序列表各自从 1 开始/);
});

test('变更日志：v1.3.2 条目包含四处格式缺陷与测试数量', () => {
  const changelog = read('CHANGELOG.md');
  const section = changelog.split('## v1.3.2')[1]?.split('## v1.3.1')[0] ?? '';
  assert.match(section, /正文被误判成标题/);
  assert.match(section, /编号跨组累加/);
  assert.match(section, /Markdown 列表被空行拆散/);
  assert.match(section, /TXT \/ PPT 列表符号消失/);
  assert.match(section, /142\/142/);
});

test('验收报告：docs/test 下存在 v1.3.2 转换保真报告', () => {
  const report = join(root, 'docs/test/Test-2026-11-08-PDF转换格式保真修复-Tulip.md');
  assert.ok(existsSync(report), '应有本轮转换保真修复的验收报告');
  const body = readFileSync(report, 'utf8');
  assert.match(body, /问题 1/);
  assert.match(body, /全量/);
});

test('文档索引与 README 均链接到变更日志，避免发版后无处可查', () => {
  assert.match(readme, /CHANGELOG\.md/);
  assert.match(read('docs/README.md'), /CHANGELOG\.md/);
  assert.match(readme, new RegExp(`v${pkg.version.replace(/\./g, '\\.')}`));
});

test('仓库忽略规则：不提交本地 agent 状态与运行产物', () => {
  const ignore = read('.gitignore');
  for (const rule of ['.workbuddy/', 'node_modules/', 'data/', 'python/.venv/']) {
    assert.ok(ignore.includes(rule), `.gitignore 应包含 ${rule}`);
  }
});
