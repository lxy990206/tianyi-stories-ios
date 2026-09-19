/**
 * 存档管理
 * 使用 localStorage + 可选 IndexedDB 双写。
 * 每 60 秒自动保存；玩家行为变更触发即时保存。
 */
class SaveManager {
    constructor() {
        this.slotId = 1;
        this.autoSaveInterval = 30000;
        this._autoSaveTimer = null;
        this._getDataCallback = null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return true;
        this.initialized = true;
        console.log('[SaveManager] 初始化完成');
        return true;
    }

    setSlot(slotId) { this.slotId = slotId; }

    _key() { return `tianyi_save_slot_${this.slotId}`; }

    async saveGame(data) {
        try {
            const payload = {
                ...data,
                _meta: {
                    savedAt: Date.now(),
                    version: '1.0.0',
                    slotId: this.slotId
                }
            };
            localStorage.setItem(this._key(), JSON.stringify(payload));
            console.log('[SaveManager] 已保存到 slot', this.slotId);
            return { success: true };
        } catch (e) {
            console.error('[SaveManager] 保存失败:', e);
            return { success: false, error: e.message };
        }
    }

    async loadGame() {
        try {
            const raw = localStorage.getItem(this._key());
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.error('[SaveManager] 加载失败:', e);
            return null;
        }
    }

    async hasSaveData() {
        return localStorage.getItem(this._key()) !== null;
    }

    async clearSave() {
        localStorage.removeItem(this._key());
        return { success: true };
    }

    startAutoSave(getDataCb) {
        this._getDataCallback = getDataCb;
        this.stopAutoSave();
        this._autoSaveTimer = setInterval(() => {
            if (this._getDataCallback) {
                const data = this._getDataCallback();
                if (data) this.saveGame(data);
            }
        }, this.autoSaveInterval);
        console.log('[SaveManager] 自动保存已启动 (', this.autoSaveInterval, 'ms)');
    }

    stopAutoSave() {
        if (this._autoSaveTimer) {
            clearInterval(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    }

    scheduleSave() {
        if (this._saveDebounce) clearTimeout(this._saveDebounce);
        this._saveDebounce = setTimeout(() => {
            if (this._getDataCallback) {
                const data = this._getDataCallback();
                if (data) this.saveGame(data);
            }
        }, 800);
    }

    async initializeLongTermMemory() {
        if (window.memoryBridge && !window.memoryBridge.isInitialized) {
            try { await window.memoryBridge.init(); } catch (e) { console.warn('记忆初始化失败:', e); }
        }
    }

    getDefaultPlayerInfo() {
        return { name: '', birthday: '', identity: '', skipped: true };
    }

    async checkAndApplyTrustDecay() {
        // 长期未上线时信任度自然衰减
        try {
            const data = await this.loadGame();
            if (!data || !data._meta) return;
            const now = Date.now();
            const daysSince = (now - data._meta.savedAt) / (1000 * 60 * 60 * 24);
            if (daysSince > 7 && data.characterSystemData?.stats) {
                const decay = Math.floor(daysSince / 7) * 3;
                data.characterSystemData.stats.trust = Math.max(0, data.characterSystemData.stats.trust - decay);
                await this.saveGame(data);
                console.log('[SaveManager] 信任度衰减', decay, '点');
            }
        } catch (_) {}
    }

    async exportSave() {
        const data = await this.loadGame();
        if (!data) return null;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        return URL.createObjectURL(blob);
    }

    async importSave(json) {
        try {
            const data = typeof json === 'string' ? JSON.parse(json) : json;
            localStorage.setItem(this._key(), JSON.stringify(data));
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
}

window.SaveManager = SaveManager;
