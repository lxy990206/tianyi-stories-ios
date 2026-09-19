/**
 * 玩家信息管理：姓名、生日、身份
 */
class PlayerInfoManager {
    constructor() {
        this.info = null;
        this._load();
    }

    _load() {
        try {
            const raw = localStorage.getItem('tianyi_player_info');
            if (raw) this.info = JSON.parse(raw);
        } catch (_) {}
    }

    _save() {
        if (this.info) {
            try { localStorage.setItem('tianyi_player_info', JSON.stringify(this.info)); } catch (_) {}
        }
    }

    get() { return this.info ? { ...this.info } : null; }

    async savePlayerInfo(data) {
        this.info = { ...data, savedAt: Date.now() };
        this._save();
        return this.info;
    }

    async markAsSkipped() {
        this.info = { name: '', birthday: '', identity: '', skipped: true, savedAt: Date.now() };
        this._save();
        return this.info;
    }

    validateAll(data) {
        if (!data.name || data.name.trim().length === 0) {
            return { valid: false, error: '请输入你的名字' };
        }
        if (data.name.length > 20) {
            return { valid: false, error: '名字不能超过 20 个字符' };
        }
        return { valid: true };
    }
}

window.PlayerInfoManager = PlayerInfoManager;
window.playerInfoManager = new PlayerInfoManager();
