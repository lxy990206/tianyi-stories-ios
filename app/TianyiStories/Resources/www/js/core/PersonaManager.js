/**
 * 人格管理器 (Persona Manager)
 * 仿照 MaiBot 的人格架构：
 *  - 每个服装绑定一个 persona（人格 JSON）
 *  - 人格包含 identity / personality / reply_style / multiple_reply_style / states
 *  - 换装时自动切换当前人格，AI 回复使用对应人格
 */
class PersonaManager {
    constructor() {
        this.personas = new Map();
        this.activePersonaId = 'default';
        this._current = null;
        this._promiseCache = new Map();
        this._basePath = 'js/AI/personas/';
    }

    /** 注册/缓存人格文件（map: outfitId -> personaId 或 persona 对象） */
    register(personaId, personaObjOrPath) {
        if (typeof personaObjOrPath === 'object') {
            this.personas.set(personaId, personaObjOrPath);
        } else if (typeof personaObjOrPath === 'string') {
            this.personas.set(personaId, { _path: personaObjOrPath });
        }
        return this;
    }

    async _loadPersona(personaId) {
        if (this._promiseCache.has(personaId)) return this._promiseCache.get(personaId);
        const p = new Promise(async (resolve) => {
            const entry = this.personas.get(personaId);
            if (!entry) return resolve(null);
            if (entry._path) {
                try {
                    const resp = await fetch(entry._path);
                    if (resp.ok) return resolve(await resp.json());
                } catch (_) {}
                return resolve(null);
            }
            resolve(entry);
        });
        this._promiseCache.set(personaId, p);
        return p;
    }

    /** 获取当前活跃人格（异步），未指定时按存档 outfit 加载 */
    async getActivePersona() {
        if (!this._current) {
            this._current = await this._loadPersona(this.activePersonaId);
        }
        return this._current;
    }

    /** 立即切换到某人格（按服装 outfit id） */
    async switchPersona(personaId) {
        const p = await this._loadPersona(personaId);
        if (!p) return false;
        this.activePersonaId = personaId;
        this._current = p;
        // 通知 AI 对话管理器
        if (window.aiChatManager) {
            try { window.aiChatManager.refreshPersona?.(); } catch (_) {}
        }
        console.log(`[Persona] 已切换人格: ${p.name} · ${p.description || personaId}`);
        return true;
    }

    getActivePersonaId() { return this.activePersonaId; }

    /**
     * 构建人格 prompt 段（仿 MaiBot build_personality_prompt）
     * 优先使用完整的 systemPrompt（最丰富），否则用 identity。
     *
     * 1.1.10Beta5/143 提示词轮 A 修复:
     *  - P0-1 states 附加不再截断:旧实现 identity.split('。')[0] 会把整段
     *    systemPrompt 截成第一句(15% 概率命中→人设崩坏);改为全文保留+
     *    末尾独立附加【当前状态】行。
     *  - P0-2 运行时剥离 persona 内嵌【回复要求】段(称呼硬编码『哥哥』或
     *    『姐姐』/标签 -3~+5 等旧规则)——运行时 _buildPrompt 规则层为唯一
     *    规则来源(动态称呼/-5~+5),双规则下发冲突消除;JSON 原文件不动
     *    (非破坏式,可随时回退)。
     */
    buildPersonalityPrompt(persona) {
        if (!persona) return {};
        // 完整设定优先：systemPrompt 包含核心身份/背景/说话风格等
        let identity = persona.systemPrompt || persona.identity || `你是${persona.name || '天依'}`;
        // P0-2:剥离内嵌旧规则段(【回复要求】至文末),规则唯一来源=运行时规则层
        const ruleIdx = identity.indexOf('【回复要求】');
        if (ruleIdx > 0) identity = identity.slice(0, ruleIdx).trim();
        const states = persona.states;
        const prob = persona.state_probability || 0;
        if (states && states.length > 0 && prob > 0 && Math.random() < prob) {
            // P0-1:全文保留 + 末尾独立【当前状态】行(不再截断)
            identity = identity + '\n【当前状态】' + randomChoice(states);
        }
        const replyStyle = this.pickReplyStyle(persona);
        return {
            identity,
            replyStyle,
            personality: persona.personality || '',
            appearance: persona.appearance || '',
            background: persona.background || ''
        };
    }

    /** 按 multiple_probability 随机选择 reply_style（仿 MaiBot） */
    pickReplyStyle(persona) {
        let style = persona.reply_style || '';
        const multi = persona.multiple_reply_style || [];
        const prob = persona.multiple_probability || 0;
        if (multi.length > 0 && prob > 0 && Math.random() < prob) {
            style = randomChoice(multi);
        }
        return style;
    }

    /** 校验旧存档：如果没有 persona 字段，回退到 default */
    resolveFromSave(saveData) {
        const outfit = saveData?.wardrobe?.currentOutfit;
        if (outfit && this.personas.has(outfit)) {
            this.activePersonaId = outfit;
        } else {
            this.activePersonaId = 'default';
        }
        return this.activePersonaId;
    }
}

function randomChoice(arr) {
    if (!arr || arr.length === 0) return '';
    return arr[Math.floor(Math.random() * arr.length)];
}

window.PersonaManager = PersonaManager;
window.personaManager = new PersonaManager();
