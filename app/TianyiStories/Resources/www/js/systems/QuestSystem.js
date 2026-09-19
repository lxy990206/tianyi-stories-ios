/**
 * 任务系统：每日任务、主线任务
 */
class QuestSystem {
    constructor() {
        this.quests = [];
        this.completed = new Set();
    }

    init() {
        this._initDailyQuests();
    }

    _initDailyQuests() {
        const today = new Date().toDateString();
        const stored = localStorage.getItem('tianyi_quest_daily');
        let parsed = null;
        try { parsed = stored ? JSON.parse(stored) : null; } catch (_) {}
        if (parsed?.date === today && parsed.quests) {
            this.quests = parsed.quests;
        } else {
            this.quests = [
                { id: 'chat_3', name: '与天依聊天 3 次', reward: 20, progress: 0, target: 3, completed: false },
                { id: 'gift_1', name: '送天依一份礼物', reward: 30, progress: 0, target: 1, completed: false },
                { id: 'play_1', name: '和天依下一局五子棋', reward: 25, progress: 0, target: 1, completed: false }
            ];
            this._saveDaily();
        }
    }

    _saveDaily() {
        try {
            localStorage.setItem('tianyi_quest_daily', JSON.stringify({
                date: new Date().toDateString(),
                quests: this.quests
            }));
        } catch (_) {}
    }

    progress(questId, delta = 1) {
        const q = this.quests.find(x => x.id === questId);
        if (!q || q.completed) return null;
        q.progress = Math.min(q.target, q.progress + delta);
        if (q.progress >= q.target) {
            q.completed = true;
            this._saveDaily();
            return { reward: q.reward, name: q.name };
        }
        this._saveDaily();
        return null;
    }

    getActive() { return this.quests.filter(q => !q.completed); }
    getCompleted() { return this.quests.filter(q => q.completed); }

    loadData(data) {
        if (data?.quests) this.quests = data.quests;
    }
    getSaveData() { return { quests: this.quests }; }
}

window.QuestSystem = QuestSystem;
