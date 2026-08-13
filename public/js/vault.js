// WorkLift 密码箱：纯加密逻辑模块（不依赖 DOM），浏览器与 Node 共用（测试直接 import）
// 加密方案：PBKDF2-SHA256（随机盐）派生 AES-256-GCM 密钥，加密整个密码箱内容
// 落盘结构（随数据文件保存）：{ salt, iterations, data }
//   data = base64( 12字节随机IV + AES-GCM密文 )，明文只存在于解锁后的内存中

export const DEFAULT_ITERATIONS = 210000;

const te = new TextEncoder();
const td = new TextDecoder();

function cryptoObj() {
  return globalThis.crypto;
}

function b64encode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt, iterations) {
  const c = cryptoObj();
  const material = await c.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function aesGcmEncrypt(key, plaintext) {
  const c = cryptoObj();
  const iv = c.getRandomValues(new Uint8Array(12));
  const cipher = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext));
  const blob = new Uint8Array(iv.length + cipher.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(cipher), iv.length);
  return b64encode(blob);
}

async function aesGcmDecrypt(key, dataB64) {
  const blob = b64decode(dataB64);
  const iv = blob.slice(0, 12);
  const cipher = blob.slice(12);
  const plain = await cryptoObj().subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return td.decode(plain);
}

// ---------- 校验 ----------

export function validateMasterPassword(pw) {
  const s = String(pw || '');
  if (s.length < 6) return { ok: false, error: '主密码至少 6 位' };
  return { ok: true };
}

// 数据层校验：vault 为 null 合法（未设置），存在时必须为合法加密结构
export function validateVault(vault) {
  if (vault == null) return { ok: true };
  if (typeof vault !== 'object' || Array.isArray(vault)) return { ok: false, error: 'vault 必须是对象' };
  if (typeof vault.salt !== 'string' || !vault.salt) return { ok: false, error: 'vault.salt 必须是字符串' };
  if (!Number.isInteger(vault.iterations) || vault.iterations <= 0) return { ok: false, error: 'vault.iterations 必须是正整数' };
  if (typeof vault.data !== 'string' || !vault.data) return { ok: false, error: 'vault.data 必须是字符串' };
  return { ok: true };
}

export function isVaultConfigured(vault) {
  return vault != null && validateVault(vault).ok;
}

// ---------- 加解密 ----------

// 创建密码箱：随机盐 + 空条目列表
export async function createVault(masterPassword, iterations = DEFAULT_ITERATIONS) {
  const ck = validateMasterPassword(masterPassword);
  if (!ck.ok) return ck;
  const c = cryptoObj();
  const salt = c.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(masterPassword, salt, iterations);
  const data = await aesGcmEncrypt(key, JSON.stringify([]));
  return { ok: true, vault: { salt: b64encode(salt), iterations, data } };
}

// 解锁：主密码错误时 AES-GCM 认证失败 → 拒绝
export async function unlockVault(vault, masterPassword) {
  if (!isVaultConfigured(vault)) return { ok: false, error: '密码箱尚未设置' };
  try {
    const key = await deriveKey(masterPassword, b64decode(vault.salt), vault.iterations);
    const plain = await aesGcmDecrypt(key, vault.data);
    const entries = JSON.parse(plain);
    if (!Array.isArray(entries)) throw new Error('格式错误');
    return { ok: true, entries };
  } catch {
    return { ok: false, error: '主密码不正确' };
  }
}

// 重新加密：CRUD 后传入现有 salt/iterations（密钥不变）；修改主密码时省略 salt（重新加盐）
export async function sealVault(entries, masterPassword, { salt, iterations = DEFAULT_ITERATIONS } = {}) {
  const ck = validateMasterPassword(masterPassword);
  if (!ck.ok) return ck;
  const c = cryptoObj();
  const fresh = salt ? b64decode(salt) : c.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(masterPassword, fresh, iterations);
  const data = await aesGcmEncrypt(key, JSON.stringify(entries));
  return { ok: true, vault: { salt: b64encode(fresh), iterations, data } };
}

// ---------- 条目 ----------

export function validateEntry(fields = {}) {
  const name = String(fields.name || '').trim();
  const account = String(fields.account || '').trim();
  const secret = String(fields.secret || '').trim();
  const notes = String(fields.notes || '').trim();
  if (!name) return { ok: false, error: '名称不能为空' };
  if (!account && !secret) return { ok: false, error: '账号与密码（密钥）至少填写一项' };
  return { ok: true, entry: { name, account, secret, notes } };
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function addVaultEntry(entries, fields, now = new Date()) {
  const ck = validateEntry(fields);
  if (!ck.ok) return ck;
  const ts = now.toISOString();
  const entry = { id: uid('v'), ...ck.entry, createdAt: ts, updatedAt: ts };
  return { ok: true, entries: [...entries, entry], entry };
}

export function updateVaultEntry(entries, id, fields, now = new Date()) {
  const ck = validateEntry(fields);
  if (!ck.ok) return ck;
  const i = entries.findIndex(e => e.id === id);
  if (i === -1) return { ok: false, error: '条目不存在' };
  const next = [...entries];
  const updated = { ...next[i], ...ck.entry, updatedAt: now.toISOString() };
  next[i] = updated;
  return { ok: true, entries: next, entry: updated };
}

export function removeVaultEntry(entries, id) {
  const next = entries.filter(e => e.id !== id);
  if (next.length === entries.length) return { ok: false, error: '条目不存在' };
  return { ok: true, entries: next };
}
