// 数据 API 封装
export async function getData() {
  const r = await fetch('/api/data');
  if (!r.ok) throw new Error('读取数据失败');
  return r.json();
}

export async function saveData(obj, baseUpdatedAt, { allowVaultReplace = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  // 乐观并发校验：带上读取时的 updatedAt（null → 'none'）；不传则服务端按无条件覆盖处理
  if (baseUpdatedAt !== undefined) {
    headers['X-WorkLift-Base-Updated-At'] = baseUpdatedAt === null ? 'none' : String(baseUpdatedAt);
  }
  // 显式覆盖（恢复备份/清空）才允许替换密码箱密文，防止旧快照把主密码改回去
  if (allowVaultReplace) headers['X-WorkLift-Vault-Replace'] = '1';
  const r = await fetch('/api/data', {
    method: 'PUT',
    headers,
    body: JSON.stringify(obj),
  });
  if (r.status === 409) {
    const e = await r.json().catch(() => ({}));
    const err = new Error(e.error || '数据已被其他窗口更新，请刷新后再保存');
    err.conflict = true;
    err.vaultConflict = e.vaultConflict === true;
    err.updatedAt = e.updatedAt ?? null;
    throw err;
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || '保存失败');
  }
  return r.json();
}

export async function getInfo() {
  const r = await fetch('/api/info');
  if (!r.ok) throw new Error('读取数据信息失败');
  return r.json();
}

export function downloadBackup() {
  window.location.href = '/api/backup';
}

// 请求关闭 WorkLift 服务（本机 Node 服务优雅关闭并退出）
export async function shutdownServer() {
  const r = await fetch('/api/shutdown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) {
    let msg = '';
    try {
      msg = (await r.json()).error || '';
    } catch {
      /* 忽略 */
    }
    throw new Error(msg || `关闭失败（HTTP ${r.status}）`);
  }
  return r.json();
}

// 用系统默认程序打开本地文件/文件夹（由本机 WorkLift 服务执行；浏览器不允许 http 页面直接打开 file:// 链接）
export async function openLocalPath(p) {
  const r = await fetch('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  });
  if (!r.ok) {
    let msg = '';
    try {
      msg = (await r.json()).error || '';
    } catch {
      /* 非 JSON 响应（如 Express 默认 404 页面） */
    }
    // 返回非 JSON 的 404：通常说明正在运行的是没有 /api/open 路由的旧实例
    if (!msg && r.status === 404)
      msg = '当前运行的 WorkLift 是旧版本（不含打开本地文件功能），请完全关闭后重新运行 start.bat';
    throw new Error(msg || `打开失败（HTTP ${r.status}）`);
  }
  return r.json();
}
