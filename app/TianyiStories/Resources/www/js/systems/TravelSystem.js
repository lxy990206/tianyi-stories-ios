/**
 * 旅行系统：地图移动 / 偶遇事件
 */
class TravelSystem {
    constructor() {
        this.destinations = [
            { id: 'home', name: '家中', cost: 0, effects: {} },
            { id: 'park', name: '樱花公园', cost: 10, effects: { affection: 5 } },
            { id: 'school', name: '学校', cost: 10, effects: { trust: 3 } },
            { id: 'cafe', name: '咖啡馆', cost: 20, effects: { affection: 3, trust: 2 } },
            { id: 'amusement', name: '游乐园', cost: 50, effects: { affection: 10 } },
            { id: 'beach', name: '海边', cost: 100, effects: { affection: 15, trust: 5 } }
        ];
        this.currentLocation = 'home';
        this.isTravelMode = false;
    }

    init() {}

    travelTo(id) {
        const dest = this.destinations.find(d => d.id === id);
        if (!dest) return { success: false };
        const coins = window.gameEngine?.getModule('CoinSystem');
        if (dest.cost > 0 && (!coins || !coins.spend(dest.cost))) {
            return { success: false, message: '金币不足' };
        }
        this.currentLocation = id;
        this.isTravelMode = true;
        const charSys = window.gameEngine?.getModule('CharacterSystem');
        if (charSys && dest.effects) charSys.applyEffects(dest.effects);
        return { success: true, destination: dest };
    }

    backHome() {
        this.currentLocation = 'home';
        this.isTravelMode = false;
    }

    getSaveData() { return { currentLocation: this.currentLocation }; }
    loadData(d) { if (d?.currentLocation) this.currentLocation = d.currentLocation; }

    /** 旅行剧情(1.1.10Beta5/137 预留接口):js/AI/travel_stories.json 待填充;
     *  填充 text 后到达目的地自动展示小剧场;fetch 失败/无内容返回 null(UI 走原行为) */
    async getStory(destId) {
        if (!this._storyPromise) {
            this._storyPromise = fetch('js/AI/travel_stories.json')
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null);
        }
        let data = null;
        try { data = await this._storyPromise; } catch (_) { return null; }
        const s = data && data.stories && data.stories[destId];
        return (s && s.text) ? s : null;
    }
}

window.TravelSystem = TravelSystem;
