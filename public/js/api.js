// 数据 API 封装
export async function getData() {
  const r = await fetch('/api/data');
  if (!r.ok) throw new Error('读取数据失败');
  return r.json();
}

export async function saveData(obj) {
  const r = await fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  });
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
