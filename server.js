// WorkLift 本地服务
// - 静态托管 public/
// - 数据 API：GET/PUT /api/data、GET /api/backup、GET /api/info、GET /api/ping
// - 原子写入（临时文件 + 重命名），保证刷新/关闭/重启数据不丢
// - 双击 start.bat 运行后自动打开默认浏览器
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { defaultData, validateData } from './public/js/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
export const DEFAULT_DATA_FILE = path.join(__dirname, 'data', 'worklift-data.json');

function localDateStr(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ensureDataFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) writeAtomic(filePath, defaultData());
}

function readData(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// 用系统默认程序打开本地文件/文件夹（供「关联文档」点击调用；浏览器禁止 http 页面直接跳 file://，由本机服务代为打开）
function openWithOS(target) {
  if (process.platform === 'win32') {
    // start 的第一个带引号参数是窗口标题，需额外传空标题
    return spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
  }
  if (process.platform === 'darwin') {
    return spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
  }
  return spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
}

export function createApp(dataFile = DEFAULT_DATA_FILE) {
  ensureDataFile(dataFile);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(PUBLIC_DIR));

  app.get('/api/ping', (req, res) => res.json({ ok: true }));

  app.get('/api/data', (req, res) => {
    try {
      res.json(readData(dataFile));
    } catch (e) {
      res.status(500).json({ error: '读取数据失败' });
    }
  });

  app.put('/api/data', (req, res) => {
    const check = validateData(req.body);
    if (!check.ok) return res.status(400).json({ error: check.errors.join('; ') });
    req.body.updatedAt = new Date().toISOString();
    try {
      writeAtomic(dataFile, req.body);
      res.json({ ok: true, updatedAt: req.body.updatedAt });
    } catch (e) {
      res.status(500).json({ error: '保存失败' });
    }
  });

  app.get('/api/backup', (req, res) => {
    try {
      const data = readData(dataFile);
      const name = `WorkLift备份-${localDateStr(new Date())}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.send(JSON.stringify(data, null, 2));
    } catch (e) {
      res.status(500).json({ error: '备份失败' });
    }
  });

  app.get('/api/info', (req, res) => {
    try {
      const stat = fs.statSync(dataFile);
      const data = readData(dataFile);
      res.json({ filePath: dataFile, size: stat.size, updatedAt: data.updatedAt || null });
    } catch (e) {
      res.status(500).json({ error: '读取数据信息失败' });
    }
  });

  // 打开本地文件/文件夹。仅接受 application/json 的 POST：
  // 浏览器会拦截跨站 JSON POST（需预检通过），外部网页无法借 <img>/<form> 等简单请求诱导打开任意文件
  app.post('/api/open', (req, res) => {
    const p = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    if (!p) return res.status(400).json({ error: '缺少要打开的本地路径' });
    try {
      const st = fs.statSync(p);
      if (!st.isFile() && !st.isDirectory()) return res.status(400).json({ error: '路径既不是文件也不是文件夹' });
    } catch (e) {
      return res.status(404).json({ error: `本地路径不存在：${p}` });
    }
    try {
      openWithOS(p);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: '调用系统程序打开失败' });
    }
  });

  return app;
}

// 直接运行时启动服务并打开浏览器（被测试 import 时不执行）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT) || 8788;
  const app = createApp();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`WorkLift 已启动: http://127.0.0.1:${PORT}`);
    console.log(`数据文件: ${DEFAULT_DATA_FILE}`);
    if (process.env.NO_OPEN !== '1') {
      spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${PORT}`], { detached: true, stdio: 'ignore' }).unref();
    }
  });
}
