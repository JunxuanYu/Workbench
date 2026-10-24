// noqa: SIZE_OK - 自包含单文件 Express 服务,经用户确认保持单体
// WorkLift 本地服务
// - 静态托管 public/
// - 数据 API：GET/PUT /api/data、GET /api/backup、GET /api/info、GET /api/ping
// - 原子写入（临时文件 + 重命名），保证刷新/关闭/重启数据不丢
// - 双击 start.bat 运行后自动打开默认浏览器
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { defaultData, validateData, migrateData } from './public/js/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
export const DEFAULT_DATA_FILE = path.join(__dirname, 'data', 'worklift-data.json');

// ---------- PDF 转换(Python 后端)常量 ----------
const PDF_TMP_DIR = path.join(__dirname, 'data', '.pdf-tmp');
const PDF_CLI_PATH = path.join(__dirname, 'python', 'pdf_convert.py');
const PDF_FORMATS = {
  word: { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  excel: { ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  ppt: { ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  image: { ext: '.zip', mime: 'application/zip' },
  txt: { ext: '.txt', mime: 'text/plain; charset=utf-8' },
  md: { ext: '.md', mime: 'text/markdown; charset=utf-8' },
};
const PDF_TOKEN_TTL_MS = 60 * 60 * 1000; // 转换会话 60 分钟
const PDF_SWEEP_MS = 10 * 60 * 1000; // 每 10 分钟清理过期会话

// ---------- Markdown → PDF(Python 后端)常量 ----------
// 单次转换无会话：临时 .md 与输出 .pdf 用完即删
const MD_TMP_DIR = path.join(__dirname, 'data', '.md-tmp');
const MD_CLI_PATH = path.join(__dirname, 'python', 'md_convert.py');

function localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ensureDataFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) writeAtomic(filePath, defaultData());
}

function readData(filePath) {
  // 读取时顺带迁移旧数据（清理已下线的 meals、补全 notes），下次保存即落盘
  return migrateData(JSON.parse(fs.readFileSync(filePath, 'utf8')));
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

// ---------- PDF 转换：会话存储 / 子进程调用 / 默认工具 ----------

export class PdfHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'PdfHttpError';
  }
}

// 上传会话令牌存储：token -> { file, originalName, numPages, expiresAt }
export function createPdfTokenStore({ now = Date.now, ttlMs = PDF_TOKEN_TTL_MS } = {}) {
  const entries = new Map();
  return {
    add(entry) {
      const token = crypto.randomBytes(16).toString('hex');
      entries.set(token, { ...entry, expiresAt: now() + ttlMs });
      return token;
    },
    get(token) {
      const e = entries.get(token);
      if (!e) return null;
      if (now() >= e.expiresAt) {
        entries.delete(token);
        return null;
      }
      e.expiresAt = now() + ttlMs; // 每次使用刷新 60 分钟
      return e;
    },
    delete(token) {
      return entries.delete(token);
    },
    cleanupExpired() {
      const t = now();
      const removed = [];
      for (const [k, e] of entries) {
        if (t >= e.expiresAt) {
          entries.delete(k);
          removed.push(e);
        }
      }
      return removed;
    },
    size() {
      return entries.size;
    },
  };
}

// 防御文件名：仅取 basename，剥掉控制字符，兜底"文档.pdf"
function sanitizeFileName(name) {
  // eslint-disable-next-line no-control-regex -- \x00-\x1f 控制字符剥离是意图（文件名安全）
  const base = path.basename(String(name || '文档.pdf')).replace(/[\x00-\x1f]/g, '');
  return base || '文档.pdf';
}

// venv 的 python 可执行文件：Windows -> Scripts\python.exe，macOS/Linux -> bin/python
function venvPythonPath() {
  const candidates = ['Scripts', 'bin'].map((dir) =>
    path.join(__dirname, 'python', '.venv', dir, process.platform === 'win32' ? 'python.exe' : 'python'),
  );
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

// 运行 pdf_convert.py，遵循其 JSON 契约：
//   成功 -> stdout 一行 {"ok":true,...}，resolve(meta)
//   失败 -> stderr 一行 {"error":"中文"}，reject(PdfHttpError)；spawn 失败(环境缺失) -> 503
function runPdfCmd(py, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(py, args, { timeout, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', () => {
      reject(new PdfHttpError(503, 'Python 环境未就绪，请运行 start.bat 完成环境安装'));
    });
    child.on('close', (code) => {
      if (code === 0) {
        try {
          const meta = JSON.parse(stdout.trim());
          if (meta && meta.ok) return resolve(meta);
        } catch {
          /* 落到下方统一报错 */
        }
        return reject(new PdfHttpError(500, 'Python 转换进程输出异常'));
      }
      let msg = 'Python 转换进程异常退出';
      try {
        const parsed = JSON.parse(stderr.trim());
        if (parsed && parsed.error) msg = parsed.error;
      } catch {
        /* 保留默认信息 */
      }
      reject(new PdfHttpError(500, msg));
    });
  });
}

// 懒探测并缓存 venv 内指定 Python 模块可导入性（每个工具实例各自缓存一次结果）
function createEnvProbe(importSpec) {
  let envChecked = null;
  return async function envOk() {
    if (envChecked !== null) return envChecked;
    try {
      const r = spawnSync(venvPythonPath(), ['-c', importSpec], {
        timeout: 15000,
        windowsHide: true,
      });
      envChecked = r.status === 0;
    } catch {
      envChecked = false;
    }
    return envChecked;
  };
}

// 默认 PDF 工具：Node 子进程调用 python/pdf_convert.py，临时文件放在 data/.pdf-tmp/
function createDefaultPdfTool({ now, ttlMs } = {}) {
  const store = createPdfTokenStore({ now, ttlMs });
  const envOk = createEnvProbe('import pymupdf, docx, openpyxl, pptx');

  return {
    store,
    async parse(buf, originalName) {
      // 非 application/pdf 的内容类型 body 可能未被 raw 解析（{} 或 undefined），统一判为无效
      if (!Buffer.isBuffer(buf) || buf.length === 0) throw new PdfHttpError(400, '无法解析：内容为空');
      if (!(await envOk())) {
        throw new PdfHttpError(503, 'Python 环境未就绪，请运行 start.bat 完成环境安装');
      }
      const name = sanitizeFileName(originalName);
      const file = path.join(PDF_TMP_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
      fs.writeFileSync(file, buf);
      let numPages;
      try {
        const meta = await runPdfCmd(venvPythonPath(), [PDF_CLI_PATH, file, '--check']);
        numPages = meta.numPages;
      } catch (e) {
        fs.rmSync(file, { force: true });
        if (e instanceof PdfHttpError && /无法解析|文件不存在/.test(e.message)) {
          throw new PdfHttpError(400, e.message);
        }
        throw e;
      }
      const token = store.add({ file, originalName: name, numPages });
      return { token, numPages };
    },
    async convert(token, format) {
      const fmt = PDF_FORMATS[format];
      if (!fmt) throw new PdfHttpError(400, '未知格式');
      const entry = store.get(token);
      if (!entry) throw new PdfHttpError(404, '会话不存在或已过期，请重新上传');
      const outFile = path.join(PDF_TMP_DIR, `${token}${fmt.ext}`);
      try {
        await runPdfCmd(venvPythonPath(), [PDF_CLI_PATH, entry.file, outFile, '--format', format]);
        const buffer = fs.readFileSync(outFile);
        return { buffer, baseName: entry.originalName.replace(/\.pdf$/i, ''), ext: fmt.ext, mime: fmt.mime };
      } catch (e) {
        throw e instanceof PdfHttpError ? e : new PdfHttpError(500, '转换失败');
      } finally {
        fs.rmSync(outFile, { force: true });
      }
    },
    async page(token, n) {
      const entry = store.get(token);
      if (!entry) throw new PdfHttpError(404, '会话不存在或已过期，请重新上传');
      if (!Number.isInteger(n) || n < 1 || n > entry.numPages) {
        throw new PdfHttpError(404, '页号超出范围');
      }
      const pngFile = path.join(PDF_TMP_DIR, `${token}-p${n}.png`);
      try {
        await runPdfCmd(venvPythonPath(), [PDF_CLI_PATH, entry.file, pngFile, '--page', String(n)]);
        return fs.readFileSync(pngFile);
      } catch (e) {
        throw e instanceof PdfHttpError ? e : new PdfHttpError(500, '页面渲染失败');
      } finally {
        fs.rmSync(pngFile, { force: true });
      }
    },
    // 清理过期会话及其临时文件，返回剩余会话数
    cleanup() {
      store.cleanupExpired().forEach((entry) => fs.rmSync(entry.file, { force: true }));
      return store.size();
    },
  };
}

// 默认 Markdown→PDF 工具：Node 子进程调用 python/md_convert.py。
// 单次转换无会话：临时 .md 与输出 .pdf 用完即删，天然不漏不占内存。
function createDefaultMdTool() {
  const envOk = createEnvProbe('import pymupdf');

  return {
    async convert(buf, originalName) {
      // raw text/markdown 之外的 body 可能未被解析（{} 或 undefined），统一判为无效
      if (!Buffer.isBuffer(buf) || buf.length === 0) throw new PdfHttpError(400, '内容为空，请粘贴 Markdown 文本');
      if (!(await envOk())) {
        throw new PdfHttpError(503, 'Python 环境未就绪，请运行 start.bat 完成环境安装');
      }
      const name = sanitizeFileName(originalName || '文档.md').replace(/\.(md|markdown|txt)$/i, '') || '文档';
      const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const inFile = path.join(MD_TMP_DIR, `${tag}.md`);
      const outFile = path.join(MD_TMP_DIR, `${tag}.pdf`);
      fs.writeFileSync(inFile, buf);
      try {
        await runPdfCmd(venvPythonPath(), [MD_CLI_PATH, inFile, outFile]);
        const buffer = fs.readFileSync(outFile);
        return { buffer, baseName: name, ext: '.pdf', mime: 'application/pdf' };
      } catch (e) {
        throw e instanceof PdfHttpError ? e : new PdfHttpError(500, '转换失败');
      } finally {
        fs.rmSync(inFile, { force: true });
        fs.rmSync(outFile, { force: true });
      }
    },
  };
}

// 工具路由统一错误响应：PdfHttpError 用其 status，其余一律 500，兜底文案由各路由提供
function sendToolError(res, e, fallbackMsg) {
  const status = e instanceof PdfHttpError ? e.status : 500;
  res.status(status).json({ error: e.message || fallbackMsg });
}

const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
// Windows 下 /api/open 最终经 cmd start 打开；& | < > ^ % ( ) 会被 cmd 当成命令分隔/展开符。
// 即使接口仅本机可用，也拒绝这些字符，避免「打开文档」升级为命令执行面。
const WINDOWS_CMD_META_RE = /["&|<>^%()\r\n]/;
const CSP_VALUE =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export function createApp(dataFile = DEFAULT_DATA_FILE, opts = {}) {
  ensureDataFile(dataFile);
  const app = express();
  app.disable('x-powered-by');

  // 全局安全响应头：CSP（仅自源脚本）、点击劫持防护、MIME 嗅探防护、
  // 跨源窗口/资源读取隔离（DNS rebinding 与钓鱼页无法读写本机页面资源）
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP_VALUE);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });

  // /api 守卫：Host 必须是本机回环地址（DNS rebinding 防护）；
  // Origin / Sec-Fetch-Site 非本机同源一律拒绝（跨站 JSON 被预检拦截、简单请求被显式拒绝）；
  // 所有 API 响应不缓存（/api/data 含密码箱密文等敏感数据）
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const host = req.headers.host || '';
    if (!LOCAL_HOST_RE.test(host)) {
      return res.status(403).json({ error: '仅允许本机访问' });
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (!LOCAL_HOST_RE.test(new URL(origin).host)) {
          return res.status(403).json({ error: '跨站请求被拒绝' });
        }
      } catch {
        return res.status(403).json({ error: '跨站请求被拒绝' });
      }
    }
    const sfs = req.headers['sec-fetch-site'];
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
      return res.status(403).json({ error: '跨站请求被拒绝' });
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  // PDF 转换后端：默认走本机 Python；测试可注入 mock opts.pdfTool（注入时不建临时目录、不起清扫定时器）
  const pdfTool = opts.pdfTool || createDefaultPdfTool({ now: opts.now, ttlMs: opts.ttlMs });
  if (!opts.pdfTool) {
    fs.rmSync(PDF_TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(PDF_TMP_DIR, { recursive: true });
    const pdfInterval = setInterval(() => {
      try {
        pdfTool.cleanup();
      } catch {
        /* 清理失败不影响主流程 */
      }
    }, PDF_SWEEP_MS);
    pdfInterval.unref(); // 不阻止进程退出（node --test 依赖）
  }

  // Markdown 转换后端：默认走本机 Python；测试可注入 mock opts.mdTool（注入时不建临时目录）
  const mdTool = opts.mdTool || createDefaultMdTool();
  if (!opts.mdTool) {
    fs.rmSync(MD_TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(MD_TMP_DIR, { recursive: true });
  }

  app.use(express.static(PUBLIC_DIR));

  app.get('/api/ping', (req, res) => res.json({ ok: true }));

  // 关闭工作台服务：响应先发出，再触发 onShutdown（直接运行时优雅关闭并退出）
  // 仅接受 application/json 的 POST（防止 <form>/<img> 等简单请求跨站关停本机服务）
  app.post('/api/shutdown', (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: '仅接受 application/json' });
    res.json({ ok: true, message: 'WorkLift 服务已关闭' });
    if (typeof opts.onShutdown === 'function') {
      setTimeout(() => opts.onShutdown(), 50);
    }
  });

  app.get('/api/data', (req, res) => {
    try {
      res.json(readData(dataFile));
    } catch {
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
    } catch {
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
    } catch {
      res.status(500).json({ error: '备份失败' });
    }
  });

  app.get('/api/info', (req, res) => {
    try {
      const stat = fs.statSync(dataFile);
      const data = readData(dataFile);
      res.json({ filePath: dataFile, size: stat.size, updatedAt: data.updatedAt || null });
    } catch {
      res.status(500).json({ error: '读取数据信息失败' });
    }
  });

  // 打开本地文件/文件夹。仅接受 application/json 的 POST：
  // 浏览器会拦截跨站 JSON POST（需预检通过），外部网页无法借 <img>/<form> 等简单请求诱导打开任意文件
  app.post('/api/open', (req, res) => {
    const p = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    if (!p) return res.status(400).json({ error: '缺少要打开的本地路径' });
    if (process.platform === 'win32' && WINDOWS_CMD_META_RE.test(p)) {
      return res.status(400).json({ error: '路径包含 Windows 命令特殊字符，已拒绝' });
    }
    // 拒绝 UNC 网络路径（\\server\share 或 //server/share）：会触发系统向远程 SMB 共享发起
    // 认证握手（NetNTLM 泄露），本工具仅面向本机文件/文件夹
    if (/^(\\\\|\/\/)/.test(p)) return res.status(400).json({ error: '不支持网络路径（UNC）' });
    try {
      const st = fs.statSync(p);
      if (!st.isFile() && !st.isDirectory()) return res.status(400).json({ error: '路径既不是文件也不是文件夹' });
      // 拒绝可执行/脚本文件：cmd start 会执行 .bat/.exe/.js/.hta/.lnk 等而非仅打开，
      // 避免「打开关联文档」升级为任意代码执行面
      if (
        st.isFile() &&
        /\.(bat|cmd|com|exe|scr|js|jse|vbs|vbe|wsf|wsh|hta|lnk|pif|msi|msp|ps1|psm1|psd1|jar|reg|appref-ms)$/i.test(p)
      )
        return res.status(400).json({ error: '不支持打开可执行/脚本文件' });
    } catch {
      return res.status(404).json({ error: `本地路径不存在：${p}` });
    }
    try {
      openWithOS(p);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: '调用系统程序打开失败' });
    }
  });

  // ---------- PDF 转换 ----------
  // 上传解析：raw application/pdf，默认上限 200MB（opts.pdfRawBodyLimitMb 可配）
  app.post(
    '/api/tools/pdf/parse',
    express.raw({ type: 'application/pdf', limit: `${opts.pdfRawBodyLimitMb ?? 200}mb` }),
    async (req, res) => {
      try {
        const name = typeof req.query.name === 'string' ? req.query.name : '文档.pdf';
        const { token, numPages } = await pdfTool.parse(req.body, name);
        res.json({ ok: true, token, numPages });
      } catch (e) {
        sendToolError(res, e, '解析失败');
      }
    },
  );

  // 转换下载：token + 格式 -> 真实格式文件字节
  app.get('/api/tools/pdf/convert', async (req, res) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const format = typeof req.query.format === 'string' ? req.query.format : '';
      const { buffer, baseName, ext, mime } = await pdfTool.convert(token, format);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(baseName + ext)}`);
      res.send(buffer);
    } catch (e) {
      sendToolError(res, e, '转换失败');
    }
  });

  // 单页预览图：token + 页码 -> PNG（页号越界由服务端校验，404）
  app.get('/api/tools/pdf/page', async (req, res) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const n = Number(req.query.page);
      const png = await pdfTool.page(token, n);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.send(png);
    } catch (e) {
      sendToolError(res, e, '页面渲染失败');
    }
  });

  // ---------- Markdown 转换 ----------
  // Markdown → PDF：raw text/markdown 请求体，一次性转换，文件名（去扩展名）用于下载
  app.post(
    '/api/tools/md/convert',
    express.raw({ type: ['text/markdown', 'text/plain'], limit: `${opts.mdRawBodyLimitMb ?? 10}mb` }),
    async (req, res) => {
      try {
        const name = typeof req.query.name === 'string' ? req.query.name : '文档.md';
        const { buffer, baseName, ext, mime } = await mdTool.convert(req.body, name);
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(baseName + ext)}`);
        res.send(buffer);
      } catch (e) {
        sendToolError(res, e, '转换失败');
      }
    },
  );

  // 请求体解析错误统一转 JSON：413 超限 / 400 格式错误
  // eslint-disable-next-line no-unused-vars -- Express 错误中间件按 4 参签名识别，next 必须保留
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: '文件过大，超出上传上限' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体解析失败' });
    res.status(err?.status || 500).json({ error: err?.message || '服务器错误' });
  });

  return app;
}

// 直接运行时启动服务并打开浏览器（被测试 import 时不执行）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT) || 8788;
  const app = createApp(DEFAULT_DATA_FILE, {
    onShutdown: () => {
      // 先停止接收新连接，关闭后再退出进程（退出码 0，start.bat 会提示"已退出"）
      server.close(() => process.exit(0));
      // 兜底：若仍有 keep-alive 连接挂起，超时强制退出
      setTimeout(() => process.exit(0), 300).unref();
    },
  });
  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`WorkLift 已启动: http://127.0.0.1:${PORT}`);
    console.log(`数据文件: ${DEFAULT_DATA_FILE}`);
    if (process.env.NO_OPEN !== '1') {
      spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${PORT}`], { detached: true, stdio: 'ignore' }).unref();
    }
  });
}
