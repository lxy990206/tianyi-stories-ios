/**
 * 约会系统：6 个地点 + 时间窗口
 */
class DateSystem {
    constructor() {
        this.locations = [
            { id: 'park', name: '樱花公园', icon: '🌸', effects: { affection: 8 }, time: 'morning' },
            { id: 'cafe', name: '街角咖啡馆', icon: '☕', effects: { affection: 5, trust: 3 }, time: 'noon' },
            { id: 'library', name: '市立图书馆', icon: '📚', effects: { trust: 6 }, time: 'afternoon' },
            { id: 'amusement', name: '游乐园', icon: '🎡', effects: { affection: 12, trust: 4 }, time: 'afternoon' },
            { id: 'cinema', name: '电影院', icon: '🎬', effects: { affection: 10, trust: 2 }, time: 'evening' },
            { id: 'rooftop', name: '天台观星', icon: '🌌', effects: { affection: 15, trust: 5 }, time: 'night' }
        ];
        this.history = [];
    }

    init() {}

    getAvailable(currentPeriod) {
        return this.locations.filter(l => l.time === currentPeriod);
    }

    goDate(locationId) {
        const loc = this.locations.find(l => l.id === locationId);
        if (!loc) return { success: false, message: '未知的约会地点' };
        const charSys = window.gameEngine?.getModule('CharacterSystem');
        if (charSys) charSys.applyEffects(loc.effects);
        this.history.push({ id: loc.id, ts: Date.now() });
        return { success: true, location: loc, effects: loc.effects };
    }

    loadData(d) { if (Array.isArray(d)) this.history = d; }
    getSaveData() { return this.history; }

    /** 约会剧情(1.1.10Beta5/137 预留接口):js/AI/date_stories.json 待填充;
     *  填充 text 后约会成功自动展示小剧场;fetch 失败/无内容返回 null(UI 走原行为) */
    async getStory(locationId) {
        if (!this._storyPromise) {
            this._storyPromise = fetch('js/AI/date_stories.json')
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null);
        }
        let data = null;
        try { data = await this._storyPromise; } catch (_) { return null; }
        const s = data && data.stories && data.stories[locationId];
        return (s && s.text) ? s : null;
    }
}

window.DateSystem = DateSystem;
