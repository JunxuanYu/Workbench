// 确认弹窗：普通确认 / 危险操作（需输入指定文字才能确认）
import { esc } from './util.js';

export function confirmDialog({ title = '确认', message = '', danger = false, requireText = null, okText = '确定' }) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">${esc(title)}</div>
        <div class="modal-body">
          <p class="confirm-msg">${esc(message)}</p>
          ${requireText
            ? `<p class="confirm-hint">请输入 <b>${esc(requireText)}</b> 以继续</p>
               <input class="confirm-input" type="text" autocomplete="off">`
            : ''}
        </div>
        <div class="modal-actions">
          <button class="btn btn-plain" data-act="cancel">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" ${requireText ? 'disabled' : ''}>${esc(okText)}</button>
        </div>
      </div>`;
    const input = overlay.querySelector('.confirm-input');
    const okBtn = overlay.querySelector('[data-act="ok"]');
    const close = val => { overlay.remove(); resolve(val); };

    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    overlay.querySelector('[data-act="cancel"]').onclick = () => close(false);
    okBtn.onclick = () => close(true);
    if (input) {
      input.oninput = () => { okBtn.disabled = input.value.trim() !== requireText; };
      input.onkeydown = e => { if (e.key === 'Enter' && !okBtn.disabled) close(true); };
      setTimeout(() => input.focus(), 0);
    }
    root.appendChild(overlay);
  });
}
