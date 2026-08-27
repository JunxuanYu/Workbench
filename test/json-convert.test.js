// JSON 转换工具测试（纯逻辑，Node 可运行）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonSafe, formatJson, minifyJson, validateJson,
  jsonToCsv, jsonToYaml, executeOperation, OPERATIONS,
  createJsonConvertTool
} from '../public/js/tools/json-convert.js';

// ---------- parseJsonSafe ----------
test('parseJsonSafe：合法 JSON 返回 ok', () => {
  const r = parseJsonSafe('{"a":1}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { a: 1 });
  assert.equal(r.error, null);
});

test('parseJsonSafe：非法 JSON 返回 error', () => {
  const r = parseJsonSafe('{a:1}');
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.ok(r.error.length > 0);
});

test('parseJsonSafe：空字符串返回 error', () => {
  const r = parseJsonSafe('');
  assert.equal(r.ok, false);
});

// ---------- formatJson ----------
test('formatJson：美化输出有缩进', () => {
  const result = formatJson('{"a":1,"b":[2,3]}');
  assert.ok(result.includes('\n'));
  assert.ok(result.includes('  "a"'));
  assert.equal(JSON.parse(result).a, 1);
});

test('formatJson：自定义缩进', () => {
  const result = formatJson('{"x":1}', 4);
  assert.ok(result.includes('    "x"'));
});

test('formatJson：非法 JSON 抛错', () => {
  assert.throws(() => formatJson('{bad}'), /解析失败/);
});

// ---------- minifyJson ----------
test('minifyJson：压缩为单行', () => {
  const result = minifyJson('{ "a" : 1 , "b" : [ 2 ] }');
  assert.equal(result, '{"a":1,"b":[2]}');
  assert.ok(!result.includes('\n'));
});

test('minifyJson：非法 JSON 抛错', () => {
  assert.throws(() => minifyJson('[1,}'), /解析失败/);
});

// ---------- validateJson ----------
test('validateJson：合法 JSON 返回 valid', () => {
  const r = validateJson('{"name":"test","value":42}');
  assert.equal(r.valid, true);
  assert.equal(r.error, null);
});

test('validateJson：非法 JSON 返回位置信息', () => {
  const r = validateJson('{\n  "a": 1,\n  "b": undefined\n}');
  assert.equal(r.valid, false);
  assert.ok(r.error.length > 0);
});

test('validateJson：空输入返回 invalid', () => {
  const r = validateJson('');
  assert.equal(r.valid, false);
});

// ---------- jsonToCsv ----------
test('jsonToCsv：对象数组转 CSV', () => {
  const input = '[{"name":"张三","age":25},{"name":"李四","age":30}]';
  const csv = jsonToCsv(input);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'name,age');
  assert.equal(lines[1], '张三,25');
  assert.equal(lines[2], '李四,30');
});

test('jsonToCsv：含逗号的字段自动加引号', () => {
  const input = '[{"info":"a,b","val":1}]';
  const csv = jsonToCsv(input);
  assert.ok(csv.includes('"a,b"'));
});

test('jsonToCsv：空数组返回空字符串', () => {
  assert.equal(jsonToCsv('[]'), '');
});

test('jsonToCsv：非数组对象包装为单行', () => {
  const csv = jsonToCsv('{"name":"test"}');
  assert.ok(csv.includes('name'));
  assert.ok(csv.includes('test'));
});

test('jsonToCsv：null/undefined 字段输出空', () => {
  const csv = jsonToCsv('[{"a":null,"b":1}]');
  const lines = csv.split('\n');
  assert.equal(lines[1], ',1');
});

// ---------- jsonToYaml ----------
test('jsonToYaml：简单对象', () => {
  const yaml = jsonToYaml('{"name":"test","value":42}');
  assert.ok(yaml.includes('name: test'));
  assert.ok(yaml.includes('value: 42'));
});

test('jsonToYaml：嵌套对象', () => {
  const yaml = jsonToYaml('{"user":{"name":"张三","age":25}}');
  assert.ok(yaml.includes('user:'));
  assert.ok(yaml.includes('name: 张三'));
});

test('jsonToYaml：数组', () => {
  const yaml = jsonToYaml('{"items":[1,2,3]}');
  assert.ok(yaml.includes('items:'));
  assert.ok(yaml.includes('- 1'));
  assert.ok(yaml.includes('- 2'));
  assert.ok(yaml.includes('- 3'));
});

test('jsonToYaml：布尔和 null', () => {
  const yaml = jsonToYaml('{"flag":true,"empty":null}');
  assert.ok(yaml.includes('flag: true'));
  assert.ok(yaml.includes('empty: null'));
});

test('jsonToYaml：非法 JSON 抛错', () => {
  assert.throws(() => jsonToYaml('{bad}'), /解析失败/);
});

test('jsonToYaml：空对象/数组', () => {
  assert.equal(jsonToYaml('{}').trim(), '{}');
  assert.equal(jsonToYaml('[]').trim(), '[]');
});

// ---------- executeOperation ----------
test('executeOperation：format 返回格式化 JSON', () => {
  const result = executeOperation('format', '{"a":1}');
  assert.ok(result.includes('\n'));
  assert.equal(JSON.parse(result).a, 1);
});

test('executeOperation：minify 返回压缩 JSON', () => {
  const result = executeOperation('minify', '{ "a" : 1 }');
  assert.equal(result, '{"a":1}');
});

test('executeOperation：validate 返回结果对象', () => {
  const ok = executeOperation('validate', '{"a":1}');
  assert.equal(ok.success, true);
  const fail = executeOperation('validate', '{bad}');
  assert.equal(fail.success, false);
});

test('executeOperation：csv 返回 CSV', () => {
  const result = executeOperation('csv', '[{"a":1},{"a":2}]');
  assert.ok(result.includes('a'));
  assert.ok(result.includes('1'));
});

test('executeOperation：yaml 返回 YAML', () => {
  const result = executeOperation('yaml', '{"x":1}');
  assert.ok(result.includes('x: 1'));
});

test('executeOperation：未知操作抛错', () => {
  assert.throws(() => executeOperation('unknown', '{}'), /未知操作/);
});

// ---------- OPERATIONS 结构 ----------
test('OPERATIONS：包含 5 种操作', () => {
  assert.equal(OPERATIONS.length, 5);
  const ids = OPERATIONS.map(o => o.id);
  assert.deepEqual(ids, ['format', 'minify', 'validate', 'csv', 'yaml']);
  for (const op of OPERATIONS) {
    assert.ok(op.label, `${op.id} 应有 label`);
    assert.ok(op.icon, `${op.id} 应有 icon`);
    assert.ok(op.description, `${op.id} 应有 description`);
  }
});

// ---------- createJsonConvertTool ----------
test('createJsonConvertTool：返回正确结构', () => {
  const tool = createJsonConvertTool();
  assert.equal(tool.id, 'json-convert');
  assert.equal(tool.name, 'JSON 转换');
  assert.equal(tool.icon, '🔧');
  assert.equal(typeof tool.render, 'function');
});

// ---------- 工具注册 ----------
test('工具箱：JSON 转换工具已自动注册', async () => {
  const { getTools } = await import('../public/js/pages/consult.js');
  const tools = getTools();
  const jsonTool = tools.find(t => t.id === 'json-convert');
  assert.ok(jsonTool, 'json-convert 应已注册');
  assert.equal(jsonTool.name, 'JSON 转换');
});

test('工具箱：现在有 2 个工具', async () => {
  const { getTools } = await import('../public/js/pages/consult.js');
  const tools = getTools();
  assert.ok(tools.length >= 2, '应至少有 2 个工具');
  const ids = tools.map(t => t.id);
  assert.ok(ids.includes('pdf-convert'));
  assert.ok(ids.includes('json-convert'));
});
