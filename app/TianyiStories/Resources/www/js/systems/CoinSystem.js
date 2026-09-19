/**
 * 金币系统：在线 / 离线收益、消费
 */
class CoinSystem {
    constructor() {
        this.coins = 1000;
        this.passiveRate = 1;  // 每分钟 +1
        this._accum = 0;
    }

    init() {}

    update(dt) {
        this._accum += dt * this.passiveRate;
        if (this._accum >= 60) {
            const add = Math.floor(this._accum / 60);
            this.coins += add;
            this._accum %= 60;
            this._updateUI();
        }
    }

    getCoins() { return this.coins; }
    setCoins(c) { this.coins = Math.max(0, c | 0); this._updateUI(); }
    add(n) { this.coins += n; this._updateUI(); }
    spend(n) {
        if (this.coins < n) return false;
        this.coins -= n;
        this._updateUI();
        return true;
    }

    _updateUI() {
        const el = document.getElementById('hud-coin-value');
        if (el) el.textContent = this.coins;
    }

    /** 离线收益：根据离线时长累计 */
    applyOfflineReward(minutes) {
        const reward = Math.floor(minutes * 0.5);
        if (reward > 0) this.add(reward);
        return reward;
    }

    loadData(data) {
        if (typeof data?.coins === 'number') this.coins = data.coins;
        this._updateUI();
    }

    getSaveData() { return { coins: this.coins }; }
}

window.CoinSystem = CoinSystem;
