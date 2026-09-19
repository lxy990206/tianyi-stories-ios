/**
 * 角色系统：好感度 / 信任度 / 心情 / 立绘选择
 *
 * 1.1.12/133 数值与情感重构:
 *  - 新刻度:好感度/信任度均为 -100 ~ 100,初始 0 =「认识的普通朋友」;
 *    正向(关心/陪伴/记住约定)增长,负向(敷衍/冒犯/伤害)衰减
 *  - 情感分级 emotionTone():把数值映射为人设框架内的情感描述,
 *    由 AIChatManager 注入 prompt【情感状态】块,驱动 AI 对话的情感温度
 *  - 存档迁移:旧刻度 affection 0..1000 / trust 0..100 自动换算
 *    (affection /10 → 0..100,0 保持普通朋友;trust ×2-100,50 → 0),带 statSchema=3 标记
 *  - 事件阈值:好感 30/70 解锁事件;好感 ≤-30 触发 diaryLeak;
 *    信任 ≤-30 触发 yandereEvent(旧版 trust=0 即触发,新刻度下不再适用)
 */
class CharacterSystem {
    constructor() {
        this.stats = { affection: 0, trust: 0 };
        this.statMin = -100;
        this.affectionCap = 100;
        this.trustMin = -100;
        this.trustMax = 100;
        this.statSchema = 3;
        this.character = {
            name: '天依',
            personality: '温柔、善良、略带娇羞',
            currentMood: 'normal'
        };
        this.callbacks = { onStatChange: [], onMoodChange: [], onEventUnlock: [] };
        this.eventFlags = {
            affection30Event: false,
            affection70Event: false,
            giftPreferenceEvent: false,
            yandereEvent: false,
            diaryLeak: false,
            diaryLeakRecovered: false,
            outfit19Unlocked: false
        };
    }

    init(engine) { this.engine = engine; console.log('[CharacterSystem] 初始化完成'); this.updateUI(); }

    update(dt) { this._updateMood(); }

    on(event, cb) { if (this.callbacks[event]) this.callbacks[event].push(cb); }

    applyEffects(effects) {
        const old = { ...this.stats };
        if (typeof effects.affection === 'number') {
            this.stats.affection = Math.max(this.statMin, Math.min(this.affectionCap, this.stats.affection + effects.affection));
        }
        if (typeof effects.trust === 'number') {
            this.stats.trust = Math.max(this.trustMin, Math.min(this.trustMax, this.stats.trust + effects.trust));
        }
        this._onStatChange(old, this.stats);
    }

    _onStatChange(old, next) {
        console.log(`[CharacterSystem] 好感: ${Math.round(old.affection)} -> ${Math.round(next.affection)} | 信任: ${Math.round(old.trust)} -> ${Math.round(next.trust)}`);

        // 触发事件(新刻度阈值)
        if (!this.eventFlags.affection30Event && old.affection < 30 && next.affection >= 30) {
            this.eventFlags.affection30Event = true;
            this._triggerEvent('affection30Event');
        }
        if (!this.eventFlags.affection70Event && old.affection < 70 && next.affection >= 70) {
            this.eventFlags.affection70Event = true;
            this.eventFlags.giftPreferenceEvent = true;
            this._triggerEvent('affection70Event');
            this._triggerEvent('giftPreferenceEvent');
        }
        if (!this.eventFlags.yandereEvent && next.trust <= -30 && old.trust > -30) {
            this.eventFlags.yandereEvent = true;
            this._triggerEvent('yandereEvent');
        }
        if (!this.eventFlags.diaryLeak && next.affection <= -30 && old.affection > -30) {
            this.eventFlags.diaryLeak = true;
            this._triggerEvent('diaryLeak');
        }

        this.callbacks.onStatChange.forEach(cb => cb(old, next));
        this.updateUI();

        // 同步到本地预设生成器
        if (window.presetReplyGenerator) {
            window.presetReplyGenerator.setStats(this.stats.affection, this.stats.trust);
        }
        if (this.engine?.getModule('SaveManager')) {
            this.engine.getModule('SaveManager').scheduleSave?.();
        }
    }

    _updateMood() {
        let newMood = 'normal';
        if (this.stats.affection >= 60 && this.stats.trust >= 40) newMood = 'happy';
        else if (this.stats.affection <= -30 || this.stats.trust <= -30) newMood = 'sad';
        if (newMood !== this.character.currentMood) {
            const old = this.character.currentMood;
            this.character.currentMood = newMood;
            this.callbacks.onMoodChange.forEach(cb => cb(old, newMood));
        }
    }

    _triggerEvent(name) {
        console.log(`[CharacterSystem] 触发事件: ${name}`);
        const es = this.engine?.getModule('EventSystem');
        if (es && es.triggerEvent) es.triggerEvent(name, true);
    }

    getStats() { return { ...this.stats }; }
    getCharacterInfo() { return { ...this.character }; }
    getAffectionLevel(aff = this.stats.affection) {
        if (aff < -30) return 'verylow';
        if (aff < 30) return 'low';
        if (aff < 70) return 'medium';
        return 'high';
    }

    /**
     * 情感分级(1.1.12/133):把 -100~100 数值映射为人设框架内的情感描述,
     * 供 prompt【情感状态】块注入——数值直接驱动 AI 对话的情感温度。
     */
    emotionTone(aff = this.stats.affection, trust = this.stats.trust) {
        aff = Math.round(aff); trust = Math.round(trust);
        let tone;
        if (aff >= 80) tone = '非常喜欢对方,亲昵黏人,把对方当作世界上最重要的人';
        else if (aff >= 60) tone = '喜欢对方,亲近自然,会主动关心和撒娇';
        else if (aff >= 20) tone = '把对方当作友善亲近的好朋友,相处轻松愉快';
        else if (aff >= 0) tone = '刚认识的普通朋友,礼貌友好,还略带一点拘谨和距离感';
        else if (aff >= -29) tone = '和对方有些疏远,像是闹过别扭,语气客气而有距离';
        else tone = '对对方很生气也很失望,冷淡抗拒、不太想搭理(但仍是洛天依,不辱骂不决裂)';
        if (trust >= 60) tone += ';完全信任对方,愿意交心倾诉';
        else if (trust >= 20) tone += ';比较信任对方';
        else if (trust <= -30) tone += ';对对方充满不信任,心存戒备';
        else if (trust < 0) tone += ';对对方有些提防,不太敢交心';
        return tone;
    }

    getCurrentCharacterImageId() {
        const aff = this.stats.affection;
        if (this.stats.trust <= -30) return 'heroine_null';
        if (aff >= 70) return 'heroine_high';
        if (aff < -30) return 'heroine_verylow';
        if (aff < 30) return 'heroine_low';
        return 'heroine_medium';
    }

    getCurrentCharacterImageUrl() {
        return `images/characters/${this.getCurrentCharacterImageId()}.svg`;
    }

    updateUI() {
        const affBar = document.getElementById('hud-affection-bar');
        const affVal = document.getElementById('hud-affection-value');
        const truBar = document.getElementById('hud-trust-bar');
        const truVal = document.getElementById('hud-trust-value');
        if (affBar) {
            // 新刻度 -100..100:0 在条中央(半条=普通朋友)
            const pct = (this.stats.affection + 100) / 200 * 100;
            affBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
        }
        if (affVal) affVal.textContent = Math.round(this.stats.affection);
        if (truBar) {
            const pct = (this.stats.trust + 100) / 200 * 100;
            truBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
        }
        if (truVal) truVal.textContent = Math.round(this.stats.trust);
    }

    loadData(data) {
        if (data) {
            if (data.stats) {
                this.stats = { ...this.stats, ...data.stats };
                // 存档迁移(1.1.12/133):旧刻度 → -100..100;带 statSchema 标记防止二次迁移
                if (!data.statSchema) {
                    const a = this.stats.affection, t = this.stats.trust;
                    this.stats.affection = Math.max(0, Math.min(100, Math.round((a || 0) / 10)));
                    this.stats.trust = Math.max(-100, Math.min(100, Math.round((t || 50) * 2 - 100)));
                    console.log('[CharacterSystem] 存档数值迁移: affection', a, '->', this.stats.affection,
                        '| trust', t, '->', this.stats.trust);
                }
            }
            if (data.character) this.character = { ...this.character, ...data.character };
            if (data.affectionCap) this.affectionCap = Math.min(data.affectionCap, 100);
            if (data.eventFlags) this.eventFlags = { ...this.eventFlags, ...data.eventFlags };
        }
        this.updateUI();
    }

    getSaveData() {
        return {
            stats: { ...this.stats },
            character: { ...this.character },
            affectionCap: this.affectionCap,
            trustMin: this.trustMin,
            trustMax: this.trustMax,
            eventFlags: { ...this.eventFlags },
            statSchema: this.statSchema
        };
    }
}

window.CharacterSystem = CharacterSystem;
