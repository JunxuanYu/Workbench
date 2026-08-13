// 密码箱纯逻辑测试（vault.js 不依赖 DOM，Node 直接 import；测试使用低迭代次数加速）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ITERATIONS, validateMasterPassword, validateVault, isVaultConfigured,
  createVault, unlockVault, sealVault,
  validateEntry, addVaultEntry, updateVaultEntry, removeVaultEntry
} from '../public/js/vault.js';

const ITER = 1000; // 测试用低迭代次数（生产默认 210000）

// ---------- 主密码 ----------
test('主密码：少于6位拒绝，6位及以上通过', () => {
  assert.deepEqual(validateMasterPassword(''), { ok: false, error: '主密码至少 6 位' });
  assert.deepEqual(validateMasterPassword('12345'), { ok: false, error: '主密码至少 6 位' });
  assert.deepEqual(validateMasterPassword(undefined), { ok: false, error: '主密码至少 6 位' });
  assert.deepEqual(validateMasterPassword('123456'), { ok: true });
});

// ---------- 创建 / 解锁 ----------
test('createVault：生成合法结构（盐/迭代次数/密文），默认迭代次数合理', async () => {
  const r = await createVault('master123', ITER);
  assert.equal(r.ok, true);
  assert.ok(typeof r.vault.salt === 'string' && r.vault.salt.length > 0, '应有盐');
  assert.equal(r.vault.iterations, ITER);
  assert.ok(typeof r.vault.data === 'string' && r.vault.data.length > 0, '应有密文');
  assert.equal(DEFAULT_ITERATIONS, 210000);
});

test('createVault：主密码太短直接拒绝', async () => {
  const r = await createVault('123', ITER);
  assert.deepEqual(r, { ok: false, error: '主密码至少 6 位' });
});

test('解锁：正确主密码得到空条目列表，错误主密码拒绝', async () => {
  const { vault } = await createVault('master123', ITER);
  const ok = await unlockVault(vault, 'master123');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.entries, []);
  const bad = await unlockVault(vault, 'wrong-password');
  assert.deepEqual(bad, { ok: false, error: '主密码不正确' });
});

test('解锁：未配置的密码箱直接拒绝', async () => {
  assert.deepEqual(await unlockVault(null, 'x'), { ok: false, error: '密码箱尚未设置' });
  assert.deepEqual(await unlockVault({}, 'x'), { ok: false, error: '密码箱尚未设置' });
});

test('加密存储：落盘 JSON 不含任何明文条目内容', async () => {
  const { vault } = await createVault('master123', ITER);
  const { entries } = addVaultEntry([], { name: 'GitHub', account: 'junxuan', secret: 's3cret!密码', notes: '公司邮箱' });
  const sealed = await sealVault(entries, 'master123', { salt: vault.salt, iterations: vault.iterations });
  const stored = JSON.stringify(sealed.vault);
  for (const plain of ['GitHub', 'junxuan', 's3cret!密码', '公司邮箱']) {
    assert.ok(!stored.includes(plain), `明文「${plain}」不应出现在存储中`);
  }
});

test('JSON 序列化往返：按数据文件方式存储后仍可解锁', async () => {
  const { vault } = await createVault('master123', ITER);
  const stored = JSON.parse(JSON.stringify(vault));
  const ok = await unlockVault(stored, 'master123');
  assert.equal(ok.ok, true);
});

// ---------- 条目 CRUD ----------
test('添加条目：名称必填、账号密码至少其一、去除首尾空白', () => {
  assert.equal(addVaultEntry([], {}).ok, false);
  assert.equal(addVaultEntry([], {}).error, '名称不能为空');
  assert.equal(addVaultEntry([], { name: 'GitHub' }).error, '账号与密码（密钥）至少填写一项');
  const r = addVaultEntry([], { name: '  GitHub  ', account: 'a', secret: 'b', notes: 'n' });
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].name, 'GitHub');
  assert.equal(r.entries[0].account, 'a');
  assert.equal(r.entries[0].secret, 'b');
  assert.equal(r.entries[0].notes, 'n');
  assert.ok(r.entries[0].id.startsWith('v_'), '应带 v_ 前缀 id');
  assert.ok(r.entries[0].createdAt);
  assert.equal(r.entries[0].updatedAt, r.entries[0].createdAt);
});

test('修改条目：字段更新、createdAt 保留、updatedAt 刷新', () => {
  const t0 = new Date('2026-08-13T00:00:00Z');
  const t1 = new Date('2026-08-14T00:00:00Z');
  const { entries } = addVaultEntry([], { name: 'GitHub', account: 'a', secret: 'b' }, t0);
  const r = updateVaultEntry(entries, entries[0].id, { name: 'GitHub 2FA', account: 'a', secret: 'new', notes: '改' }, t1);
  assert.equal(r.ok, true);
  assert.equal(r.entries[0].name, 'GitHub 2FA');
  assert.equal(r.entries[0].secret, 'new');
  assert.equal(r.entries[0].createdAt, t0.toISOString(), '创建时间不变');
  assert.equal(r.entries[0].updatedAt, t1.toISOString());
});

test('修改条目：不存在的条目拒绝且不修改', () => {
  const { entries } = addVaultEntry([], { name: 'GitHub', account: 'a', secret: 'b' });
  const r = updateVaultEntry(entries, 'nope', { name: 'X', account: '1', secret: '2' });
  assert.deepEqual(r, { ok: false, error: '条目不存在' });
});

test('删除条目：成功删除 / 不存在拒绝', () => {
  const { entries } = addVaultEntry([], { name: 'GitHub', account: 'a', secret: 'b' });
  const r = removeVaultEntry(entries, entries[0].id);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries, []);
  assert.deepEqual(removeVaultEntry(entries, 'nope'), { ok: false, error: '条目不存在' });
});

// ---------- 重加密（CRUD 后落盘）----------
test('CRUD 后重加密：新增/修改/删除全部反映到解锁结果', async () => {
  let { vault } = await createVault('master123', ITER);
  let entries = [];
  let r = addVaultEntry(entries, { name: 'GitHub', account: 'junxuan', secret: 'pw1' });
  ({ vault } = await sealVault(r.entries, 'master123', { salt: vault.salt, iterations: vault.iterations }));

  r = addVaultEntry(r.entries, { name: 'SSH 密钥', account: '', secret: '-----BEGIN OPENSSH PRIVATE KEY-----' });
  entries = r.entries;
  ({ vault } = await sealVault(entries, 'master123', { salt: vault.salt, iterations: vault.iterations }));

  let u = await unlockVault(vault, 'master123');
  assert.equal(u.ok, true);
  assert.equal(u.entries.length, 2);

  const upd = updateVaultEntry(u.entries, u.entries[0].id, { name: 'GitHub', account: 'junxuan', secret: 'pw2' });
  entries = removeVaultEntry(upd.entries, upd.entries.find(e => e.name === 'SSH 密钥').id).entries;
  ({ vault } = await sealVault(entries, 'master123', { salt: vault.salt, iterations: vault.iterations }));

  u = await unlockVault(vault, 'master123');
  assert.equal(u.entries.length, 1);
  assert.equal(u.entries[0].name, 'GitHub');
  assert.equal(u.entries[0].secret, 'pw2');
});

test('修改主密码：省略 salt 重新加盐，新密码可解、旧密码失效', async () => {
  const { vault } = await createVault('master123', ITER);
  const { entries } = addVaultEntry([], { name: 'GitHub', account: 'a', secret: 'b' });
  const sealed = await sealVault(entries, 'new-master-456', { iterations: vault.iterations });
  assert.equal(sealed.ok, true);
  assert.notEqual(sealed.vault.salt, vault.salt, '换主密码应重新加盐');

  const ok = await unlockVault(sealed.vault, 'new-master-456');
  assert.equal(ok.ok, true);
  assert.equal(ok.entries[0].name, 'GitHub');
  const old = await unlockVault(sealed.vault, 'master123');
  assert.deepEqual(old, { ok: false, error: '主密码不正确' });
});

// ---------- 数据层校验 ----------
test('validateVault：null 合法 / 缺字段或类型非法拒绝 / 合法结构通过', () => {
  assert.deepEqual(validateVault(null), { ok: true });
  assert.deepEqual(validateVault(undefined), { ok: true });
  assert.equal(validateVault([]).ok, false, '数组非法');
  assert.equal(validateVault({}).ok, false, '缺 salt');
  assert.equal(validateVault({ salt: '', iterations: 1000, data: 'y' }).ok, false, '空 salt 非法');
  assert.equal(validateVault({ salt: 'x', iterations: 0, data: 'y' }).ok, false, '迭代次数必须为正');
  assert.equal(validateVault({ salt: 'x', iterations: 1.5, data: 'y' }).ok, false, '迭代次数必须为整数');
  assert.equal(validateVault({ salt: 'x', iterations: 1000, data: '' }).ok, false, '空密文非法');
  assert.deepEqual(validateVault({ salt: 'x', iterations: 1000, data: 'y' }), { ok: true });
});

test('isVaultConfigured：null 未配置，合法结构已配置', () => {
  assert.equal(isVaultConfigured(null), false);
  assert.equal(isVaultConfigured(undefined), false);
  assert.equal(isVaultConfigured({}), false);
  assert.equal(isVaultConfigured({ salt: 'x', iterations: 1000, data: 'y' }), true);
});

// ---------- 条目校验 ----------
test('validateEntry：名称必填、账号密码至少其一、返回清洗后的条目', () => {
  assert.equal(validateEntry({}).ok, false);
  assert.equal(validateEntry({ name: '  ' }).ok, false);
  assert.equal(validateEntry({ name: 'GitHub' }).ok, false);
  assert.deepEqual(validateEntry({ name: ' Git ', account: 'a' }), { ok: true, entry: { name: 'Git', account: 'a', secret: '', notes: '' } });
  assert.deepEqual(validateEntry({ name: 'WiFi', secret: 'p' }), { ok: true, entry: { name: 'WiFi', account: '', secret: 'p', notes: '' } });
});
