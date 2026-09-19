/**
 * 签到系统：每天上线弹出一次，签到获得 15000 钻石
 */
class CheckInSystem {
    constructor() {
        this.reward = 15000;
        this._dateKey = null;
        this._modal = null;
    }

    _key() { return `tianyi_checkin_slot_${window.saveManager?.slotId || 1}`; }

    _today() { return new Date().toDateString(); }

    /** 今天是否已签到 */
    hasCheckedToday() {
        try {
            const raw = localStorage.getItem(this._key());
            if (!raw) return false;
            return raw.split('::')[0] === this._today();
        } catch (_) { return false; }
    }

    /** 是否连续签到天数（奖励仅固定 15000，不做递增） */
    getStreak() {
        try {
            const raw = localStorage.getItem(this._key());
            return raw && raw.includes('::') ? parseInt(raw.split('::')[1], 10) || 1 : 1;
        } catch (_) { return 1; }
    }

    /** 执行签到：发钻石，记录日期与连续天数，返回奖励 */
    checkIn() {
        if (this.hasCheckedToday()) return { success: false, message: '今天已经签到过啦～' };
        const coins = window.gameEngine?.getModule('CoinSystem');
        if (!coins) return { success: false, message: '金币系统未就绪' };
        coins.add(this.reward);

        let streak = this.getStreak();
        try {
            const raw = localStorage.getItem(this._key());
            if (raw) {
                const prevDate = raw.split('::')[0];
                const yesterday = new Date(Date.now() - 86400000).toDateString();
                streak = prevDate === yesterday ? streak + 1 : 1;
            } else {
                streak = 1;
            }
            localStorage.setItem(this._key(), `${this._today()}::${streak}`);
        } catch (_) {}

        if (window.saveManager) window.saveManager.scheduleSave();
        this._renderModal(streak);
        return { success: true, reward: this.reward, streak };
    }

    /** 显示签到弹窗（如果今天未签到） */
    maybeShow() {
        if (this.hasCheckedToday()) return false;
        // 延迟到游戏完全就绪后弹出
        setTimeout(() => {
            if (document.getElementById('modal-root') && !document.getElementById('checkin-modal')) {
                this._renderPreview();
            }
        }, 1200);
        return true;
    }

    _renderPreview() {
        const root = document.getElementById('modal-root');
        if (!root) return;
        this._modal = document.createElement('div');
        this._modal.id = 'checkin-modal';
        this._modal.className = 'modal';
        this._modal.style.display = 'flex';
        this._modal.innerHTML = `
            <div class="modal-card checkin-card">
                <div class="checkin-icon">📅</div>
                <h2>每日签到</h2>
                <p class="checkin-sub">天依为你准备了今日的钻石～</p>
                <div class="checkin-reward">
                    <span class="checkin-coin">💎</span>
                    <span class="checkin-amount">${this.reward.toLocaleString()}</span>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary" id="checkin-claim-btn">领取签到奖励</button>
                    <button class="btn btn-ghost" id="checkin-later-btn">稍后</button>
                </div>
            </div>`;
        root.appendChild(this._modal);
        this._modal.querySelector('#checkin-claim-btn').onclick = () => {
            const r = this.checkIn();
            if (!r.success) { window.showToast(r.message, 'info'); this._modal.remove(); return; }
            const card = this._modal.querySelector('.modal-card');
            card.innerHTML = `
                <div class="checkin-icon">🎉</div>
                <h2>签到成功！</h2>
                <p class="checkin-sub">已到账 <strong>${r.reward.toLocaleString()}</strong> 钻石（连续签到 ${r.streak} 天）</p>
                <div class="modal-actions">
                    <button class="btn btn-primary" id="checkin-done-btn">收下啦</button>
                </div>`;
            this._modal.querySelector('#checkin-done-btn').onclick = () => {
                this._modal.remove();
                const ms = window.gameEngine?.getModule('MainScene');
                if (ms) ms.showBubble('钻石我帮你收好啦，今天也要开开心心的～');
            };
        };
        this._modal.querySelector('#checkin-later-btn').onclick = () => {
            this._modal.remove();
            // 记录为已签到（不领奖则不再弹出），避免重复打扰
            try { localStorage.setItem(this._key(), `${this._today()}::${this.getStreak()}`); } catch (_) {}
        };
    }

    _renderModal(streak) {
        // checkIn() 已通过 _renderPreview 的按钮触发，成功后切换内容；此处兜底
    }
}

window.CheckInSystem = CheckInSystem;
window.checkInSystem = new CheckInSystem();