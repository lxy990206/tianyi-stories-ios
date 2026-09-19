/**
 * 日记系统：天依视角写日记
 * 由 AI 在聊天过程中自动总结生成（一天最多 3 篇），无需手动点击。
 * 内容从天依「被陪伴」的感受出发，约 450 字。
 */
class DiarySystem {
    constructor() {
        this.callbacks = { onNewDiary: [] };
        // 触发阈值：当天累计用户消息数达到以下值时自动写日记（最多 3 篇）
        this.triggerThresholds = [3, 8, 13];
        this._counters = this._loadCounters();
    }

    init() {}

    on(event, cb) { if (this.callbacks[event]) this.callbacks[event].push(cb); }

    _key() { return `tianyi_diary_counters_slot_${window.diaryStorage?.slotId || 1}`; }

    _todayKey() { return new Date().toDateString(); }

    _loadCounters() {
        try {
            const raw = localStorage.getItem(this._key());
            const data = raw ? JSON.parse(raw) : {};
            if (data.date !== this._todayKey()) {
                return { date: this._todayKey(), messages: 0, diaries: 0 };
            }
            return data;
        } catch (_) {
            return { date: this._todayKey(), messages: 0, diaries: 0 };
        }
    }

    _saveCounters() {
        try { localStorage.setItem(this._key(), JSON.stringify(this._counters)); } catch (_) {}
    }

    /** 当天已写日记数 */
    getTodayDiaryCount() {
        this._counters = this._loadCounters();
        return this._counters.diaries || 0;
    }

    /**
     * 记录一次用户消息。当累计消息数达到阈值且当天未满 3 篇时，自动生成日记。
     * 返回生成的日记条目（可能为 null）。
     */
    async recordUserMessage() {
        this._counters = this._loadCounters();
        this._counters.messages = (this._counters.messages || 0) + 1;
        this._saveCounters();

        const diaryCount = this._counters.diaries || 0;
        if (diaryCount >= 3) return null;
        const threshold = this.triggerThresholds[diaryCount];
        if (threshold === undefined || this._counters.messages < threshold) return null;

        const entry = await this.generateEntry('auto');
        if (entry) {
            this._counters = this._loadCounters();
            this._counters.diaries = (this._counters.diaries || 0) + 1;
            this._saveCounters();
        }
        return entry;
    }

    /**
     * 生成一条日记：优先用 AI 写作（约 450 字，从天依陪伴视角），失败则用本地模板。
     */
    async generateEntry(trigger = 'auto') {
        const stats = window.gameEngine?.getModule('CharacterSystem')?.stats;
        if (!stats) return null;
        const term = window.genderManager?.getTerm() || '哥哥';
        const userName = window.playerInfoManager?.get()?.name || term;
        const aff = Math.round(stats.affection);
        const mood = aff >= 70 ? '幸福' : aff >= 30 ? '开心' : aff < -30 ? '难过' : '平静';

        // 收集今天的聊天记录
        let chatHistory = [];
        if (window.aiChatManager) {
            chatHistory = window.aiChatManager.getHistory().filter(m => m.role === 'user').slice(-13);
        }

        let body = null;
        if (window.aiChatManager && window.aiChatManager.config?.getMode?.() !== 'LOCAL') {
            body = await window.aiChatManager.generateDiary(chatHistory, {
                todayNote: `今天天依和${userName}相处得很愉快，聊了很多。`
            });
        }
        if (!body || body.length < 80) {
            // 本地模板兜底
            const dateStr = new Date().toLocaleDateString('zh-CN');
            body = `今天是 ${dateStr}。\n${term}（${userName}）来陪我了，和我聊了很多。\n天依现在的心情：${mood}。\n和你在一起的时候，总觉得时间过得好快。希望明天也能见到${term}。`;
        }

        const entry = await window.diaryStorage.addEntry({
            trigger,
            mood,
            affection: aff,
            trust: Math.round(stats.trust),
            title: `第 ${this._day()} 天 · ${mood}`,
            body
        });
        this.callbacks.onNewDiary.forEach(cb => cb(entry));
        return entry;
    }

    _day() {
        return window.gameEngine?.getModule('TimeSystem')?.currentDay || 1;
    }

    async listAll() { return await window.diaryStorage.listAll(); }
    async remove(id) { return await window.diaryStorage.deleteEntry(id); }
}

window.DiarySystem = DiarySystem;