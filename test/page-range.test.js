// 页码范围解析纯函数测试（前后端共用模块）
// 覆盖：单页/区间/开放式/组合、全角与空格、越界与倒序、非法输入、压缩描述
// 以及与 Python 实现（python/pdf_convert.py::parse_page_range）的语义一致性
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePageSelection, describePageSelection } from '../public/js/tools/page-range.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

test('页码：留空 / 纯空格表示全部页', () => {
  for (const spec of [undefined, null, '', '   ', '　']) {
    const r = parsePageSelection(spec, 5);
    assert.deepEqual(r, { ok: true, pages: [], all: true }, `${JSON.stringify(spec)} 应表示全部页`);
  }
});

test('页码：单页与区间', () => {
  assert.deepEqual(parsePageSelection('3', 5), { ok: true, pages: [3], all: false });
  assert.deepEqual(parsePageSelection('2-4', 5), { ok: true, pages: [2, 3, 4], all: false });
  assert.deepEqual(parsePageSelection('1-1', 5), { ok: true, pages: [1], all: false });
  assert.deepEqual(parsePageSelection('1-5', 5), { ok: true, pages: [1, 2, 3, 4, 5], all: false });
});

test('页码：开放式区间 2- 与 -3', () => {
  assert.deepEqual(parsePageSelection('3-', 5).pages, [3, 4, 5]);
  assert.deepEqual(parsePageSelection('-2', 5).pages, [1, 2]);
});

test('页码：组合输入会排序去重', () => {
  assert.deepEqual(parsePageSelection('3,1,2,2', 5).pages, [1, 2, 3]);
  assert.deepEqual(parsePageSelection('5,1-2,2-3', 5).pages, [1, 2, 3, 5]);
});

test('页码：全角符号与空格自动兼容（中文输入法场景）', () => {
  assert.deepEqual(parsePageSelection('1－2，4', 5).pages, [1, 2, 4]);
  assert.deepEqual(parsePageSelection(' 1 ~ 2 , 4 ', 5).pages, [1, 2, 4]);
  assert.deepEqual(parsePageSelection('1、3', 5).pages, [1, 3]);
  assert.deepEqual(parsePageSelection('1，2；4', 5).pages, [1, 2, 4]);
});

test('页码：越界被拒绝，提示含实际页数', () => {
  const r = parsePageSelection('9', 3);
  assert.equal(r.ok, false);
  assert.match(r.message, /超出范围/);
  assert.match(r.message, /共 3 页/);
  assert.equal(parsePageSelection('3-9', 3).ok, false);
});

test('页码：0 、负数、非数字被拒绝', () => {
  for (const spec of ['0', '-0', 'abc', '1-a', '1-2-3', '1,,x']) {
    const r = parsePageSelection(spec, 3);
    assert.equal(r.ok, false, `${spec} 应被拒绝`);
    assert.match(r.message, /格式不正确|超出范围/);
  }
});

test('页码：起始页大于结束页被拒绝', () => {
  const r = parsePageSelection('3-1', 5);
  assert.equal(r.ok, false);
  assert.match(r.message, /起始页不能大于结束页/);
});

test('页码：总页数未知时应提示重新解析文件', () => {
  for (const total of [0, -1, undefined, NaN, 1.5]) {
    const r = parsePageSelection('1', total);
    assert.equal(r.ok, false);
    assert.match(r.message, /页数/);
  }
});

test('页码：describePageSelection 压缩连续页号', () => {
  assert.equal(describePageSelection([1, 2, 3, 5]), '1-3,5');
  assert.equal(describePageSelection([2]), '2');
  assert.equal(describePageSelection([1, 2]), '1-2');
  assert.equal(describePageSelection([1, 3, 5]), '1,3,5');
  assert.equal(describePageSelection([]), '');
  assert.equal(describePageSelection(null), '');
});

test('页码：解析 -> 描述 往返一致', () => {
  for (const spec of ['1-3,5', '2-', '1,4', '7']) {
    const r = parsePageSelection(spec, 10);
    assert.equal(r.ok, true);
    assert.deepEqual(parsePageSelection(describePageSelection(r.pages), 10).pages, r.pages);
  }
});

// ---------- 与 Python 实现的一致性（缺解释器时跳过，CI 中由 Node job 覆盖） ----------
function findPython() {
  const candidates =
    process.platform === 'win32'
      ? [path.join(root, 'python', '.venv', 'Scripts', 'python.exe'), 'python']
      : [path.join(root, 'python', '.venv', 'bin', 'python'), 'python3', 'python'];
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    const r = spawnSync(candidate, ['-c', 'import pymupdf'], { timeout: 15000 });
    if (r.status === 0) return candidate;
  }
  return null;
}

const python = findPython();

test(
  '页码：与 Python parse_page_range 语义一致（同一输入同一结果）',
  { skip: python ? false : '未找到可用的 Python 解释器（需含 pymupdf）' },
  () => {
    const cases = ['', '2', '2-4', '3-', '-2', '1,3,5-6', '3,1,2,2', '1－2，4', '0', '9', '3-1', 'abc'];
    const script = [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(path.join(root, 'python'))})`,
      'import pdf_convert',
      `specs = json.loads(sys.argv[1])`,
      'out = []',
      'for s in specs:',
      '    try:',
      '        out.append({"ok": True, "pages": pdf_convert.parse_page_range(s, 5)})',
      '    except pdf_convert.PdfError as e:',
      '        out.append({"ok": False, "message": str(e)})',
      'print(json.dumps(out, ensure_ascii=False))',
    ].join('\n');
    const r = spawnSync(python, ['-c', script, JSON.stringify(cases)], { encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    const pyResults = JSON.parse(r.stdout);
    cases.forEach((spec, i) => {
      const js = parsePageSelection(spec, 5);
      assert.equal(js.ok, pyResults[i].ok, `${spec} 的合法性判定应一致`);
      if (js.ok) {
        // JS 用 all=true 表示"未限定"，Python 直接给出全部页号，比较时展开
        const jsPages = js.all ? [1, 2, 3, 4, 5] : js.pages;
        assert.deepEqual(jsPages, pyResults[i].pages, `${spec} 的页号应一致`);
      }
    });
  },
);
