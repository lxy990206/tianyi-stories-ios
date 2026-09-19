/**
 * 时间系统：天 / 时段推进
 */
class TimeSystem {
    constructor() {
        this.currentDay = 1;
        this.actionsLeft = 3;
        this.maxActions = 3;
        this.currentTime = 8 * 60;  // 分钟数，0-1440
        this.lastRealDate = null;   // 真实日期感知基准（相处日期每日0:00自动+1）
        this.callbacks = { onSpecialEvent: [] };
    }

    init(engine) {
        this.engine = engine;
    }

    update(dt) { /* 时间由玩家行为推进 */ }

    /** 本地日期键（0:00 自然切换） */
    _realDateKey(d = new Date()) {
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }

    /**
     * 真实日期跨天检查：本地时间每过一天（0:00），相处日期 currentDay +1。
     * 由 HUD 定时器周期调用与读档后调用；离线多日则按天数补足。
     */
    checkRealDateRollover() {
        const today = this._realDateKey();
        if (!this.lastRealDate) {
            this.lastRealDate = today;
            return false;
        }
        if (this.lastRealDate === today) return false;
        const prev = new Date(this.lastRealDate.replace(/-/g, '/') + ' 00:00:00');
        const now = new Date(today.replace(/-/g, '/') + ' 00:00:00');
        const diffDays = Math.max(1, Math.round((now - prev) / 86400000));
        this.currentDay += diffDays;
        this.actionsLeft = this.maxActions;   // 新的一天恢复行动点
        this.lastRealDate = today;
        this._triggerSpecial();
        if (window.saveManager) window.saveManager.scheduleSave();
        return true;
    }

    on(event, cb) { if (this.callbacks[event]) this.callbacks[event].push(cb); }

    getTimeStatus() {
        const h = Math.floor(this.currentTime / 60);
        const m = this.currentTime % 60;
        return {
            currentDay: this.currentDay,
            time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
            actionsLeft: this.actionsLeft,
            maxActions: this.maxActions,
            period: this.getPeriod()
        };
    }

    getPeriod() {
        const h = this.currentTime / 60;
        if (h < 6) return 'night';
        if (h < 11) return 'morning';
        if (h < 14) return 'noon';
        if (h < 18) return 'afternoon';
        if (h < 22) return 'evening';
        return 'night';
    }

    advanceTime(minutes = 60) {
        this.currentTime += minutes;
        while (this.currentTime >= 24 * 60) {
            this.currentTime -= 24 * 60;
            this.currentDay++;
            this.actionsLeft = this.maxActions;
            this._triggerSpecial();
        }
    }

    consumeAction() {
        if (this.actionsLeft <= 0) return false;
        this.actionsLeft--;
        if (this.actionsLeft === 0) {
            this.advanceTime(4 * 60);
        }
        return true;
    }

    _triggerSpecial() {
        // 每天第一次进入夜晚时触发 special event
        const evt = { event: 'newDay' };
        this.callbacks.onSpecialEvent.forEach(cb => cb(evt));
    }

    loadData(data) {
        if (data) {
            this.currentDay = data.currentDay || 1;
            this.actionsLeft = data.actionsLeft ?? 3;
            this.maxActions = data.maxActions || 3;
            this.currentTime = data.currentTime ?? 8 * 60;
            this.lastRealDate = data.lastRealDate || null;
        }
        // 读档后立即结算离线跨天（相处日期每日0:00+1）
        this.checkRealDateRollover();
    }

    getSaveData() {
        return {
            currentDay: this.currentDay,
            actionsLeft: this.actionsLeft,
            maxActions: this.maxActions,
            currentTime: this.currentTime,
            lastRealDate: this.lastRealDate || this._realDateKey()
        };
    }
}

window.TimeSystem = TimeSystem;
