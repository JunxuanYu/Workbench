// PDF 转换工具：支持 PDF → Word / 图片 / Excel / PPT / TXT
// 使用 pdf.js（CDN）解析 PDF，浏览器端完成转换

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let pdfjsLib = null;
let pdfjsLoading = null;

// ---------- pdf.js 动态加载 ----------
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  if (pdfjsLoading) return pdfjsLoading;

  pdfjsLoading = (async () => {
    // 加载主库
    await loadScript(`${PDFJS_CDN}/pdf.min.js`);
    pdfjsLib = globalThis.pdfjsLib;
    if (!pdfjsLib) throw new Error('pdf.js 加载失败');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
    return pdfjsLib;
  })();

  return pdfjsLoading;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
    document.head.append(s);
  });
}

// ---------- PDF 解析 ----------
async function parsePdf(arrayBuffer) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    // 提取文本
    const textContent = await page.getTextContent();
    const text = textContent.items.map(it => it.str).join('');
    // 渲染为图片（缩放至合适宽度）
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const imageData = canvas.toDataURL('image/png');
    pages.push({ num: i, text, imageData, width: viewport.width, height: viewport.height });
  }
  return { numPages: pdf.numPages, pages };
}

// ---------- 转换目标定义 ----------
export const FORMAT_OPTIONS = [
  { id: 'word',   label: 'Word (.doc)',  icon: '📄', mime: 'application/msword',                ext: '.doc' },
  { id: 'image',  label: '图片 (.png)',   icon: '🖼️', mime: 'image/png',                          ext: '.png' },
  { id: 'excel',  label: 'Excel (.csv)', icon: '📊', mime: 'text/csv;charset=utf-8',             ext: '.csv' },
  { id: 'ppt',    label: 'PPT (.ppt)',   icon: '📽️', mime: 'application/vnd.ms-powerpoint',     ext: '.ppt' },
  { id: 'txt',    label: 'TXT (.txt)',   icon: '📝', mime: 'text/plain;charset=utf-8',           ext: '.txt' }
];

// ---------- 转换实现 ----------

function convertTxt(pdfData) {
  const parts = pdfData.pages.map(p => `--- 第 ${p.num} 页 ---\n${p.text}`);
  return new Blob([parts.join('\n\n')], { type: 'text/plain;charset=utf-8' });
}

function convertImage(pdfData) {
  // 多页时打包为单个下载：逐页提供下载链接
  // 返回所有页面的 dataURL 数组
  return pdfData.pages.map(p => ({
    name: `page_${p.num}.png`,
    dataUrl: p.imageData
  }));
}

function convertWord(pdfData) {
  // 生成 HTML 格式（Word 可直接打开 .doc/HTML）
  let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word"
    xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>PDF转换</title>
<style>
body { font-family: "SimSun", serif; margin: 40px; }
h1 { font-size: 20px; margin-bottom: 20px; }
.page-break { page-break-after: always; }
.page-img { max-width: 100%; margin: 10px 0; }
.page-text { white-space: pre-wrap; font-size: 12px; color: #666; margin: 10px 0; }
</style></head><body>
<h1>PDF 文档</h1>`;
  for (const p of pdfData.pages) {
    html += `<div class="page-break">
<h3>第 ${p.num} 页</h3>
<img class="page-img" src="${p.imageData}" />
<div class="page-text">${escHtml(p.text)}</div>
</div>`;
  }
  html += '</body></html>';
  return new Blob(['\ufeff' + html], { type: 'application/msword' });
}

function convertExcel(pdfData) {
  // CSV 格式：每页分隔，文本按行排列
  const lines = [];
  for (const p of pdfData.pages) {
    lines.push(`--- 第 ${p.num} 页 ---`);
    // 将文本按换行或句号分隔成行
    const pageLines = p.text.split(/\n/).filter(Boolean);
    for (const line of pageLines) {
      // CSV 转义：含逗号/引号/换行的字段用引号包裹
      const escaped = line.includes(',') || line.includes('"') || line.includes('\n')
        ? `"${line.replace(/"/g, '""')}"` : line;
      lines.push(escaped);
    }
    lines.push('');
  }
  return new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
}

function convertPpt(pdfData) {
  // 生成 HTML 幻灯片（可在浏览器中逐页查看/打印）
  let html = `<html><head><meta charset="utf-8"><title>PDF 幻灯片</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #222; font-family: sans-serif; }
.slide { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; page-break-after: always; background: #fff; }
.slide img { max-width: 90%; max-height: 90%; }
.slide-num { position: fixed; bottom: 10px; right: 20px; color: #999; font-size: 14px; }
@media print { .slide { page-break-after: always; } }
</style></head><body>`;
  for (const p of pdfData.pages) {
    html += `<div class="slide">
<img src="${p.imageData}" />
<span class="slide-num">${p.num} / ${pdfData.numPages}</span>
</div>`;
  }
  html += '</body></html>';
  return new Blob(['\ufeff' + html], { type: 'application/vnd.ms-powerpoint' });
}

const CONVERTERS = {
  txt: convertTxt,
  image: convertImage,
  word: convertWord,
  excel: convertExcel,
  ppt: convertPpt
};

// ---------- 工具入口 ----------

export function createPdfConvertTool() {
  return {
    id: 'pdf-convert',
    name: 'PDF 转换',
    icon: '📑',
    render(container) {
      renderPdfConvert(container);
    }
  };
}

async function renderPdfConvert(container) {
  container.innerHTML = '';
  // 标题
  const heading = document.createElement('h2');
  heading.style.cssText = 'font-size:16px;margin-bottom:12px;';
  heading.textContent = 'PDF 转换工具';
  container.append(heading);

  // 文件选择
  const fileRow = document.createElement('div');
  fileRow.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap;';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf';
  fileInput.style.cssText = 'font-size:14px;';
  fileRow.append(fileInput);
  container.append(fileRow);

  // 状态区
  const status = document.createElement('div');
  status.style.cssText = 'font-size:13px;color:var(--text-soft);margin-bottom:12px;min-height:20px;';
  container.append(status);

  // 转换按钮区
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;';
  container.append(btnRow);

  // 结果区
  const resultArea = document.createElement('div');
  container.append(resultArea);

  // 禁用所有转换按钮
  let currentFile = null;
  let currentPdfData = null;

  const fmtBtns = FORMAT_OPTIONS.map(fmt => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = `${fmt.icon} ${fmt.label}`;
    btn.disabled = true;
    btn.onclick = () => doConvert(fmt);
    btnRow.append(btn);
    return { btn, fmt };
  });

  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      status.textContent = '❌ 请选择 PDF 文件';
      return;
    }
    currentFile = file;
    currentPdfData = null;
    status.textContent = '⏳ 正在解析 PDF...';
    resultArea.innerHTML = '';
    fmtBtns.forEach(b => { b.btn.disabled = true; });

    try {
      const buf = await file.arrayBuffer();
      currentPdfData = await parsePdf(buf);
      status.textContent = `✅ 已加载「${file.name}」— 共 ${currentPdfData.numPages} 页`;
      fmtBtns.forEach(b => { b.btn.disabled = false; });
    } catch (e) {
      status.textContent = `❌ 解析失败: ${e.message}`;
    }
  };

  async function doConvert(fmt) {
    if (!currentPdfData) return;
    status.textContent = `⏳ 正在转换为 ${fmt.label}...`;
    resultArea.innerHTML = '';

    try {
      const result = CONVERTERS[fmt.id](currentPdfData);

      if (fmt.id === 'image' && Array.isArray(result)) {
        // 图片：显示预览 + 逐页下载
        const preview = document.createElement('div');
        preview.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
        for (const img of result) {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:8px;';
          const imgEl = document.createElement('img');
          imgEl.src = img.dataUrl;
          imgEl.style.cssText = 'width:100%;border-radius:4px;';
          const dlBtn = document.createElement('a');
          dlBtn.href = img.dataUrl;
          dlBtn.download = img.name;
          dlBtn.className = 'btn btn-sm';
          dlBtn.textContent = `⬇ 下载 ${img.name}`;
          wrap.append(imgEl, dlBtn);
          preview.append(wrap);
        }
        resultArea.append(preview);
        status.textContent = `✅ 转换完成，共 ${result.length} 张图片`;
      } else {
        // Blob：提供下载链接
        const baseName = currentFile?.name?.replace(/\.pdf$/i, '') || 'output';
        const url = URL.createObjectURL(result);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseName}${fmt.ext}`;
        link.className = 'btn btn-primary';
        link.textContent = `⬇ 下载 ${fmt.label}`;
        link.style.cssText = 'display:inline-block;margin-top:8px;';
        resultArea.append(link);

        // 如果是文本格式，显示预览
        if (fmt.id === 'txt' || fmt.id === 'excel') {
          const text = await result.text();
          const preview = document.createElement('pre');
          preview.style.cssText = 'background:var(--gray-light);padding:12px;border-radius:8px;font-size:12px;max-height:300px;overflow:auto;margin-top:10px;white-space:pre-wrap;';
          preview.textContent = text.slice(0, 5000) + (text.length > 5000 ? '\n...（已截断）' : '');
          resultArea.append(preview);
        }

        // Word/PPT 预览提示
        if (fmt.id === 'word' || fmt.id === 'ppt') {
          const hint = document.createElement('div');
          hint.style.cssText = 'font-size:12px;color:var(--text-soft);margin-top:8px;';
          hint.textContent = '💡 下载后用 Word / PowerPoint 打开即可查看';
          resultArea.append(hint);
        }

        status.textContent = `✅ 转换完成 — ${fmt.label}`;
      }
    } catch (e) {
      status.textContent = `❌ 转换失败: ${e.message}`;
    }
  }
}

// HTML 转义（防 XSS）
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- 导出纯逻辑函数供测试 ----------
export { parsePdf, CONVERTERS, convertTxt, convertWord, convertExcel, convertPpt, convertImage };
