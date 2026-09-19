/**
 * 全局等级系统：1-100
 */
class GlobalLevelSystem {
    constructor() {
        this.level = 1;
        this.exp = 0;
        this.expToNext = 100;
    }

    init() {}

    addExp(amount) {
        this.exp += amount;
        while (this.exp >= this.expToNext) {
            this.exp -= this.expToNext;
            this.level = Math.min(100, this.level + 1);
            this.expToNext = Math.floor(this.expToNext * 1.15);
        }
    }

    loadData(d) { if (d) { this.level = d.level || 1; this.exp = d.exp || 0; this.expToNext = d.expToNext || 100; } }
    getSaveData() { return { level: this.level, exp: this.exp, expToNext: this.expToNext }; }
}

window.GlobalLevelSystem = GlobalLevelSystem;
