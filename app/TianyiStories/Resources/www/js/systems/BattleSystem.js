/**
 * 战斗系统：五子棋 / 大乱斗基础
 */
class BattleSystem {
    constructor() {
        this.callbacks = { onBattleEnd: [], onLevelUp: [] };
    }

    init() {}

    on(event, cb) { if (this.callbacks[event]) this.callbacks[event].push(cb); }

    /**
     * 五子棋
     * 简易返回结果（前端 UI 在 UISystem 中实现）
     */
    gomoku(playerWon) {
        const result = { success: playerWon, type: 'gomoku' };
        this.callbacks.onBattleEnd.forEach(cb => cb(result));
        return result;
    }

    /** 五子棋 AI 引擎(1.1.10Beta5/137 框架搭建,暂不开放 UI 入口):
     *  惰性实例化 GomokuAI(棋盘/胜负判定/启发式 AI),入口预留 */
    getGomokuEngine() {
        if (!this._gomoku && window.GomokuAI) this._gomoku = new window.GomokuAI();
        return this._gomoku || null;
    }

    loadData(d) { /* TODO */ }
    getSaveData() { return {}; }
}

window.BattleSystem = BattleSystem;
