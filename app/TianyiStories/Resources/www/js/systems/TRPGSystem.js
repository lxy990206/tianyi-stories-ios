/**
 * TRPG 系统：跑团核心
 * 简化版：任务卡 + 骰子 + 资源条
 */
class TRPGSystem {
    constructor() {
        this._consecutiveFails = 0;   // 连败保底计数(见 getSuccessThreshold)
        this.missions = [
            {
                id: 'm1',
                name: '失踪的音乐盒',
                description: '在古老的阁楼里寻找失落的音乐盒。',
                difficulty: '简单',
                stats: { hp: 30, mp: 10, san: 50 },
                rewards: { affection: 10, trust: 5, coins: 100 }
            },
            {
                id: 'm2',
                name: '星空下的约定',
                description: '与天依一起在星空中寻找承诺的证据。',
                difficulty: '普通',
                stats: { hp: 50, mp: 20, san: 60 },
                rewards: { affection: 15, trust: 10, coins: 200 }
            }
        ];
    }

    init() {}

    getMissions() { return this.missions; }

    rollDice(sides = 6) { return 1 + Math.floor(Math.random() * sides); }

    /** 连败保底(1.1.10Beta5/137):连续失败 ≥2 次后,判定阈值每再败一次 -2
     *  (d20 上约 +10% 成功率),上限 -6(+30%);任一次成功即重置。
     *  返回成功判定下限(骰值 ≥ 该值即成功;基础 11 = dice>10) */
    getSuccessThreshold() {
        const pity = this._consecutiveFails >= 2 ? Math.min((this._consecutiveFails - 1) * 2, 6) : 0;
        return 11 - pity;
    }

    notifyResult(success) {
        this._consecutiveFails = success ? 0 : this._consecutiveFails + 1;
        return this._consecutiveFails;
    }

    start(missionId) {
        const m = this.missions.find(x => x.id === missionId);
        if (!m) return null;
        return { mission: m, dice: this.rollDice(20) };
    }

    complete(missionId, success) {
        const m = this.missions.find(x => x.id === missionId);
        if (!m) return null;
        if (success) {
            const charSys = window.gameEngine?.getModule('CharacterSystem');
            const coins = window.gameEngine?.getModule('CoinSystem');
            if (charSys) charSys.applyEffects({ affection: m.rewards.affection, trust: m.rewards.trust });
            if (coins) coins.add(m.rewards.coins);
        }
        return { success, mission: m };
    }
}

window.TRPGSystem = TRPGSystem;
