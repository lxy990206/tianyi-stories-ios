/**
 * UI 系统：模态弹窗 / 消息提示 / 设置面板
 */
class UISystem {
    constructor() {
        this.callbacks = {};
    }

    init() {}

    showModal(title, text, onClose) {
        this._closeAll();
        const root = document.getElementById('modal-root');
        const m = document.createElement('div');
        m.className = 'modal';
        m.style.display = 'flex';
        m.innerHTML = `
            <div class="modal-card">
                <h2>${this._esc(title)}</h2>
                <p>${this._esc(text)}</p>
                <div class="modal-actions">
                    <button class="btn btn-primary">好的</button>
                </div>
            </div>`;
        root.appendChild(m);
        m.querySelector('button').onclick = () => { m.remove(); onClose?.(); };
    }

    hideModal() {
        document.getElementById('modal-root').innerHTML = '';
    }

    showMessage(text, type = 'info') {
        window.showToast?.(text, type);
    }

    _closeAll() {
        const root = document.getElementById('modal-root');
        if (root) root.innerHTML = '';
    }

    _esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
}

window.UISystem = UISystem;
