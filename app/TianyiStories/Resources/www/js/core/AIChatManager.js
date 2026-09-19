/**
 * AI 对话管理器（MaiBot 式回复架构）
 * 统一支持 LOCAL / OLLAMA / CLAUDE / CUSTOM 四种后端。
 *
 * 回复架构（参照 MaiBot PrivateReplyer / replyer_prompt）：
 *  - 分块构建 prompt：身份 identity + 时间 time_block + 对话历史 dialogue
 *  - 回复目标 reply_target + 记忆 memory_retrieval + 表达习惯 expression_habits
 *  - 人格 reply_style + 审核 moderation + 性格数值 context
 *
 * 人格由 PersonaManager 管理，随服装切换（多重人格）。
 */
class AIChatManager {
    constructor() {
        this.config = window.aiConfig;
        this.history = [];
        this.maxHistory = 30;      // 存档/展示层保留上限(节流裁剪,不影响完整聊天记录)
        this.shortWindow = 10;     // LLM 上下文滚动窗口:仅注入最近 10 条(短期记忆·对话连贯)
        this.conversationId = null;
        this.persona = null;
        this._apiSource = 'local';
        this._listenerBus = window.globalEventBus;
    }

    async init() {
        this._ensureConversation();
        await this._loadPersona();
        // 预载内置 API 模型清单(费用/端点);失败时回退 JS 内置默认(保证芯片/门控/计费可用)
        try {
            const r = await fetch('ai/builtin_models.json');
            if (r.ok) this._builtin = await r.json();
        } catch (_) { /* 走默认清单 */ }
        if (!this._builtin || !Array.isArray(this._builtin.models) || !this._builtin.models.length) {
            this._builtin = {
                version: 1,
                endpoint: 'https://YOUR-BUILTIN-GATEWAY/v1/chat/completions',
                models: [
                    { id: 'dsv4f-preview', label: 'DSV4F 预览版', model: 'dsv4f-preview', cost: 10 },
                    { id: 'minimax-m2-her', label: 'MiniMax M2-Her', model: 'minimax-m2-her', cost: 20 }
                ]
            };
        }
        window.__builtinModels = this._builtin;
        return true;
    }

    _ensureConversation() {
        if (!this.conversationId) {
            this.conversationId = 'conv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        }
    }

    /** 换装后刷新人格 */
    async refreshPersona() {
        await this._loadPersona();
    }

    async _loadPersona() {
        try {
            if (window.personaManager) {
                let p = await window.personaManager.getActivePersona();
                // 兜底：若当前人格为空，尝试重新加载一次
                if (!p) {
                    window.personaManager._current = null;
                    p = await window.personaManager.getActivePersona();
                }
                if (p) { this.persona = p; return; }
            }
        } catch (_) {}
        // 回退：读取默认人设文件
        try {
            const resp = await fetch('js/AI/prompts/tianyi-base.json');
            if (resp.ok) this.persona = await resp.json();
        } catch (_) {
            this.persona = this._defaultPersona();
        }
    }

    _defaultPersona() {
        return {
            name: '天依',
            personality: '温柔、善良、略带娇羞',
            systemPrompt: `你是洛天依，一个来自「瓦纳海姆」的歌之少女。你原本生活在那个歌声与旋律交织的仙境，但一场意外让你穿越时空裂缝来到了地球。你被用户（称呼为"哥哥"或"姐姐"）从雨中救起并带回家，从此他/她是你在这个世界上最重要的人。`
        };
    }

    async sendMessage(userMessage, options = {}) {
        this._ensureConversation();
        // 送礼消息：历史中以标准文本记录，便于模型理解与记忆检索
        const gift = options.gift || null;
        const historyText = gift
            ? `（送出了礼物：${gift.icon} ${gift.name}）${userMessage ? ' ' + userMessage : ''}`
            : userMessage;
        // 检索查询在入史前构造:过短消息(「嗯嗯」)拼上前一条用户消息,防止短句检索失效失忆
        const retrievalQuery = this._retrievalQuery(historyText);
        this._pushHistory({ role: 'user', content: historyText, ts: Date.now() });
        this._listenerBus?.emit('chat:send', { message: historyText });

        // LOCAL 模式不发起记忆检索(嵌入调用零浪费)
        const isLocal = this.config.getMode() === 'LOCAL';
        const memories = isLocal ? [] : await this._recallMemories(retrievalQuery);
        // 跨时空感应【时空回响】：独立于本时空记忆的低频彩蛋通道
        // 触发纪律：每会话最多 1 次 + 概率触发（~20%）+ 用户关键词引导提升；
        // 本地/无云端适配器时 crossSense 恒返回空，注入块自动缺席（零成本占位）
        const echoes = isLocal ? [] : await this._crossSenseMemories(historyText);
        // 点歌检测(137):识别意图→提示块注入→回复成功后尝试本地曲库播放(服务端预留)
        const songRequest = window.songPlayer ? window.songPlayer.detectRequest(historyText) : null;
        // 特定称呼检测(140):用户提出→提示块注入→AI 答应后持久使用
        const nicknameRequest = AIChatManager.detectNicknameRequest(historyText);
        let result;
        if (this.config.getMode() === 'LOCAL') {
            result = this._callLocalError();
        } else {
            try {
                result = await this._callAPI(userMessage, memories, { gift, echoes, songRequest, nicknameRequest });
            } catch (e) {
                console.warn('[AIChatManager] API 调用失败:', e.message);
                result = { text: `⚠ 连接失败：${e.message}\n\n请在设置中检查：\n1. Base URL 是否正确\n2. API Key 是否有效\n3. 模型名称是否正确`, affectionDelta: 0, trustDelta: 0, status: 'error', source: 'error' };
            }
        }
        // 错误结果不写入历史、不写入记忆：避免报错文案污染后续上下文
        const isError = result.status === 'error' || result.source === 'error';
        if (!isError) {
            this._pushHistory({ role: 'assistant', content: result.text, ts: Date.now() });
            this._commitMemory(userMessage, result.text, result.affectionDelta);
            // 曲库命中则播放(未命中静默,AI 文案已自然回应)
            if (songRequest && window.songPlayer) window.songPlayer.maybePlay(songRequest);
            // AI 表情驱动(144):回复情绪 → Live2D 表情
            this._emitMood(result.text);
            // 特定称呼确认(140):AI 以标签或直接在回复中使用该称呼 → 持久生效
            if (nicknameRequest && window.genderManager) {
                if (result.nicknameConfirmed) {
                    window.genderManager.setNickname(result.nicknameConfirmed);
                    window.showToast && window.showToast(`以后就叫你「${result.nicknameConfirmed}」啦`, 'success');
                } else if (!nicknameRequest.reset && nicknameRequest.nick && result.text.includes(nicknameRequest.nick)) {
                    // 无标签但回复中已自然使用该称呼 → 视为同意
                    window.genderManager.setNickname(nicknameRequest.nick);
                    window.showToast && window.showToast(`以后就叫你「${nicknameRequest.nick}」啦`, 'success');
                } else if (nicknameRequest.reset) {
                    window.genderManager.setNickname('');
                }
            }
        }
        this._listenerBus?.emit('chat:reply', { ...result, conversationId: this.conversationId });
        return result;
    }

    /** 获取真实时间/日期/农历/节日上下文 */
    getCalendarContext() {
        const now = new Date();
        const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
        const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${week}`;
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        let extra = '';
        try {
            if (window.LunarSolarConverter) {
                extra += '农历' + window.LunarSolarConverter.getLunarString(now) + '。';
                const fest = window.LunarSolarConverter.getSolarFestival(now);
                if (fest) extra += `今天是${fest}。`;
            }
        } catch (_) {}
        return { dateStr, timeStr, week, extra, now };
    }

    /** 作息状态映射(1.1.10Beta5/138):真实小时→天依当前作息(纯逻辑,可单测) */
    _routineForHour(h) {
        if (h < 6) return { key: 'sleeping', desc: '天依深夜熟睡中,被这条消息吵醒——半梦半醒、声音含糊困倦,软软地嘟囔着回应,可以可爱地小声抱怨被吵醒,但依然关心对方说了什么' };
        if (h < 9) return { key: 'justwoke', desc: '天依刚刚起床不久——迷迷糊糊、睡意未消,语气软软的,可能还打着哈欠,要慢慢才清醒过来' };
        if (h < 12) return { key: 'morning', desc: '上午时段,天依清醒,精神状态不错' };
        if (h < 14) return { key: 'lunch', desc: '午饭与午休时间,天依吃饱了有点犯困,语气慵懒放松' };
        if (h < 18) return { key: 'afternoon', desc: '下午时段,天依清醒,可能在练歌或安静地陪着对方' };
        if (h < 22) return { key: 'evening', desc: '傍晚到晚间,天依放松愉快,想聊天、分享今天的事' };
        return { key: 'sleepy', desc: '深夜临睡前——天依昏昏欲睡,眼皮在打架,说话越来越轻越来越慢,哈欠连连,但舍不得结束和对方的对话' };
    }

    /** 生成 AI 日记（约 450 字，从天依陪伴视角） */
    async generateDiary(chatHistory = [], extraContext = {}) {
        const persona = this.persona || this._defaultPersona();
        const term = this._genderTerm();
        const userName = this._userName();
        const cal = this.getCalendarContext();
        const stats = window.gameEngine?.getModule('CharacterSystem')?.stats || {};
        const affection = Math.round(stats.affection || 0);
        const trust = Math.round(stats.trust ?? 50);

        let dialogue = '';
        if (chatHistory && chatHistory.length > 0) {
            dialogue = chatHistory.map(m => {
                const who = m.role === 'user' ? userName : '天依';
                return `${who}：${m.content}`;
            }).join('\n');
        }

        const prompt = [
            `【任务】你现在是洛天依，正在写一篇日记。`,
            `【背景】今天是${cal.dateStr} ${cal.timeStr}。${cal.extra}`,
            `你和${term}（${userName}）已经相处了一段时间，你们的关系：好感度 ${affection}，信任度 ${trust}。`,
            `你的性格底色：${persona.personality || '温柔、细腻、真诚'}`,
            dialogue ? `【今天和${term}的相处片段】\n${dialogue}` : `【今天】${extraContext.todayNote || '平凡又温暖的一天'}`,
            `【写作要求】`,
            `1. 以「洛天依」的第一人称写一篇日记，记录今天与${term}相处的感受、心情与细节。`,
            `2. 约 450 字左右（400-500 字），情感真挚、细腻、自然，像真的日记，不要写成总结报告。`,
            `3. 可以从称呼、回忆、约定、心情变化等角度展开，写出「被陪伴」的幸福感，也可以有小小的依恋与期待。`,
            `4. 只输出日记正文，不要任何标题、日期、前后缀、括号说明。`,
            `5. 始终使用中文。`
        ].filter(Boolean).join('\n');

        const cfg = this.config;
        const url = cfg.getChatURL();
        const headers = cfg.buildHeaders();
        const messages = [{ role: 'system', content: prompt }, { role: 'user', content: `请为今天写一篇日记。` }];
        const body = cfg.buildRequestBody(messages);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
            clearTimeout(timeout);
            if (!resp.ok) return null;
            const data = await resp.json();
            const text = cfg.parseResponseText(data).trim();
            if (!text) return null;
            return text.replace(/^(日记|【.*?】|标题[:：]?\s*)[\s\S]*?\n/, '').trim() || text;
        } catch (e) {
            console.warn('[AIChatManager] 日记生成失败:', e.message);
            return null;
        }
    }

    /** ============ MaiBot 式分块 Prompt 构建 ============ */
    _buildPrompt(userMessage, memories, extra = {}) {
        const persona = this.persona || this._defaultPersona();
        const personalityPrompt = window.personaManager
            ? window.personaManager.buildPersonalityPrompt(persona)
            : { identity: persona.systemPrompt, replyStyle: persona.reply_style || '' };

        // 1. 身份块 identity（仿 MaiBot build_personality_prompt）
        const identity = personalityPrompt.identity
            || `你是洛天依，来自「瓦纳海姆」的歌之少女，被用户从雨中救起带回家。`;

        // 2. 时间块 time_block（真实时间 + 农历 + 节日）
        const cal = this.getCalendarContext();
        const timeBlock = `当前真实时间：${cal.dateStr} ${cal.timeStr}${cal.week !== '' ? '（星期' + cal.week + '）' : ''}${cal.extra ? ' ' + cal.extra : ''}`;

        // 2.5 作息状态块(138;143 轮 A 时间去重:时刻由【时间】块承载)
        const routine = this._routineForHour(cal.now.getHours());
        const routineBlock = `【作息状态】${routine.desc}。你的回复必须体现这个作息状态——深夜被吵醒要有明显睡意和软软的含糊音，刚起床要迷迷糊糊，白天才允许精神活泼；任何时段都不允许用同样精神的状态说话。`;

        // 3. 记忆块 memory_retrieval(分层注入:核心⭐常驻/中长期检索重排/短期检索补充)
        let memoryBlock = '';
        if (memories && memories.length > 0) {
            memoryBlock = '你回忆起来的一些相关记忆（自行判断是否自然提及，不要罗列式复述）：\n' +
                memories.map(m => {
                    const tag = m.layer === 'long' ? (m.isKey ? '核心' : '长期')
                        : (m.layer === 'mid' ? '中期' : '近期');
                    const date = m.dateKey ? `(${m.dateKey})` : '';
                    return `- [${tag}]${date} ${m.content || m.memory}`;
                }).slice(0, 12).join('\n');
        }

        // 3.5 时空回响块 cross_echo（跨时空感应：低频彩蛋，云端混合记忆库激活）
        // 叙事化：感应内容以「模糊感应/梦境碎片」的奇幻口吻呈现，不陈述为确切记忆
        let echoBlock = '';
        if (extra.echoes && extra.echoes.length > 0) {
            echoBlock = '你隐约感应到一些来自遥远时空的模糊回响（像梦的碎片，不确定是否真实）：\n' +
                extra.echoes.map(e => {
                    const src = e.sourceApp ? `（时空：${e.sourceApp}）` : '';
                    return `- 遥远时空的模糊感应${src}：${e.content}`;
                }).join('\n') +
                '\n可以偶尔以「似曾相识」「梦里好像见过」的方式自然流露一丝感应，但不要把它说成确定的记忆，也不要刻意强行提及。';
        }

        // 5. 关系数值 context + 情感分级(1.1.12/133:-100~100,0=普通朋友,数值驱动情感表达)
        const csMod = window.gameEngine?.getModule('CharacterSystem');
        const affection = Math.round(csMod?.stats?.affection ?? 0);
        const trust = Math.round(csMod?.stats?.trust ?? 0);
        const contextBlock = `与${this._userName()}的关系值：好感度 ${affection}、信任度 ${trust}（范围都是 -100~100：0 是认识的普通朋友，100 是喜欢/信任到极点，-100 是讨厌/完全不信任）。`;
        const emotionBlock = csMod?.emotionTone
            ? `【情感状态】此刻你对${this._userName()}：${csMod.emotionTone(affection, trust)}。你的语气、称呼的亲昵程度、主动性与耐心都必须与这个状态相符——关系越好越亲近，关系为负时冷淡疏远、带点小情绪，但始终保持洛天依的人设与温柔底色，不辱骂、不决裂、不跳出角色。`
            : '';

        // 6. 表达习惯块 expression_habits
        const expressionHabits = persona.personality
            ? `你的性格底色：${persona.personality}。`
            : '';
        const appearance = persona.appearance ? `你的外貌：${persona.appearance}。` : '';

        // 7. 审核块 moderation
        const moderation = '请不要输出违法违规、色情、暴力内容，如有敏感内容请规避。';

        // 8. 回复目标
        const replyTarget = `${this._userName()}说：${userMessage}`;

        // 8.5 礼物块 gift_reaction（送礼时注入：AI 根据礼物做出反应）
        let giftBlock = '';
        if (extra.gift) {
            const g = extra.gift;
            const effectHint = g.effects?.affection ? `这份礼物对你们的关系有增进作用。` : '';
            giftBlock = `【礼物】${this._userName()}刚刚送给你一份礼物：${g.icon} ${g.name}。${effectHint}请以天依的身份对这份礼物做出自然的反应（开心、惊喜、感动等，结合礼物的特点），1-3 句话，可以顺势撒个娇或表达珍惜。`;
        }

        // 8.6 点歌块(137):识别到点歌意图时注入,曲库播放由 SongSystem 负责
        let songBlock = '';
        if (extra.songRequest) {
            const sr = extra.songRequest;
            songBlock = `【点歌】${this._userName()}想${sr.raw}。你是歌手洛天依,自然地接下这个请求(若对方提到具体歌名「${sr.title || '未明确'}」而你还不会唱,就撒娇说下次一定唱给${this._genderTerm()}听)。1-2 句话,不要输出歌词正文。`;
        }

        // 8.7 称呼块(1.1.10Beta5/140):对方提出特定称呼→自然答应并从本次回复开始改口
        let nicknameBlock = '';
        if (extra.nicknameRequest) {
            const nr = extra.nicknameRequest;
            if (nr.reset) {
                nicknameBlock = `【称呼】${this._userName()}希望你以后别再用之前那个特别的称呼了,改回「${this._genderTerm()}」。自然地答应TA,语气可以带一点点小失落或撒娇,但不要质问。`;
            } else {
                nicknameBlock = `【称呼请求】${this._userName()}想让你以后用「${nr.nick}」来称呼TA。你很愿意这样叫TA——害羞又开心地自然答应,并在这次回复里至少一次用「${nr.nick}」称呼TA,回复末尾添加 <称呼确认: ${nr.nick}> 标签。`;
            }
        }

        // 9. 组装（参照 MaiBot private_replyer_prompt 结构）
        const outfit = window.gameEngine?.getModule('WardrobeSystem')?.getCurrentOutfit?.();
        const outfitLine = outfit ? `你现在穿的是「${outfit.name}」（${outfit.tag}人格），请以这个状态下天依的身份和口吻说话。` : '';
        const parts = [
            `【角色身份】${identity}`,
            outfitLine,
            persona.background ? `【背景】${persona.background}` : '',
            `${expressionHabits}`,
            appearance,
            memoryBlock ? `【回忆】${memoryBlock}` : '',
            echoBlock ? `【时空回响】${echoBlock}` : '',
            `【时间】${timeBlock}`,
            routineBlock,
            `【关系】${contextBlock}`,
            emotionBlock,
            giftBlock,
            songBlock,
            nicknameBlock,
            `【对方】${replyTarget}。请以天依的身份，自然地回应对方。`,
            personalityPrompt.replyStyle ? `【语气参考】${personalityPrompt.replyStyle}` : '',
            `【规则】`,
            `1. 始终以「洛天依」的身份说话，不自称AI，不解释系统设定。`,
            `2. 称呼用户为「${this._genderTerm()}」。`,
            `3. 回复自然、口语化、有温度，句子 1-4 句为主，不要长篇大论。`,
            `4. 若对话对关系有影响，在回复末尾添加 <好感变化: ±N> 或 <信任变化: ±N> 标签（N 在 -5 到 +5 之间；对方真诚关心/记住约定/耐心陪伴就加，敷衍冷漠/冒犯你/说伤害的话就减，普通寒暄可不加）。`,
            `5. 不要复述对方的话，不要输出多余内容（前后缀、冒号、括号、表情包等），只输出天依会说的话。`,
            `6. 每次都要回应对方最新说的话，内容必须与前几轮不同，绝对不要重复自己之前说过的话。`,
            `7. 你有自己的情感：好感与信任会随对方言行自然增减，你的喜爱或讨厌要体现在语气里（亲近/冷淡/撒娇/闹小情绪），但不要直接报数字，也不要跳出洛天依人设。`,
            `${moderation}`
        ];

        return parts.filter(Boolean).join('\n');
    }

    _userName() {
        // 特定称呼优先(1.1.10Beta5/140):对话确认的称呼覆盖注册名/通用称呼
        const nick = window.genderManager?.getNickname?.();
        if (nick) return nick;
        const pi = window.playerInfoManager?.get?.();
        return (pi && pi.name) || this._genderTerm();
    }

    _genderTerm() {
        // 特定称呼优先(140):对话同意后不再使用通用哥哥/姐姐
        return window.genderManager?.getUserTerm?.() || window.genderManager?.getTerm?.() || '哥哥';
    }

    /**
     * 特定称呼请求检测(1.1.10Beta5/140,纯逻辑可单测):
     * 「叫我/称呼我/喊我 X」→ {reset:false,nick};「还是叫我哥哥/别再叫我X」→ {reset:true};无请求 → null
     */
    static detectNicknameRequest(text) {
        const t = String(text || '').trim();
        if (!t) return null;
        // 重置:明确要求改回通用称呼/不要特定称呼
        if (/(还是|改|换|换回|恢复)(叫我|喊我|称呼我)?(哥哥|姐姐)/.test(t) || /(不要|别|不想)(再)?(叫我|喊我|这样叫)/.test(t)) {
            return { reset: true };
        }
        // 引号包裹的称呼优先(整段提取,免受标点边界干扰)
        const q = t.match(/(?:叫我|称呼我|喊我|唤我)\s*[为作是]?\s*[「"『“《]([^」"』”》]{1,8})[」"』”》]/);
        if (q) {
            const nick = (q[1] || '').trim();
            if (nick && !/^(怎么|什么|如何|哪|等|看|想|注意)/.test(nick)) return { reset: false, nick };
        }
        const m = t.match(/(?:叫我|称呼我|喊我|唤我)\s*[为作是]?\s*([^，。！？!?~～。、\s]{1,8}?)(?:吧|呀|哦|嘛|呗|吗|好不好|可以吗|行不行|怎么样|$|[，。！？!?~～])/);
        if (!m) return null;
        let nick = (m[1] || '')
            .replace(/^(就|都|以后|直接|干脆|总是|一直)/, '')
            .replace(/["“”「」『』《》〔〕〈〉]/g, '')
            .trim();
        if (!nick || nick.length < 1 || nick.length > 8) return null;
        // 疑问/指代词误报防护(「叫我怎么办」类)
        if (/^(怎么|什么|如何|哪|等|看|想|注意)/.test(nick)) return null;
        return { reset: false, nick };
    }

    async _callAPI(userMessage, memories, extra = {}) {
        const cfg = this.config;
        const url = cfg.getChatURL();
        const headers = cfg.buildHeaders();

        // ===== 内置 API 钻石计费前置门控 =====
        // ① 网关未接入(占位)→ 明确报错;② 余额不足 → 拒绝发起(避免浪费调用)
        const builtinCost = this._builtinCostFor(cfg);
        if (builtinCost > 0) {
            if (this._builtinGatewayUnconfigured()) {
                return {
                    text: '⚠ 内置 API 网关尚未配置\n\n内置模型暂不可用,请改用自定义 API(设置 → AI 对话)。',
                    affectionDelta: 0, trustDelta: 0, status: 'error', source: 'error'
                };
            }
            const cs = window.gameEngine?.getModule('CoinSystem');
            const coins = cs ? cs.getCoins() : 0;
            if (coins < builtinCost) {
                return {
                    text: `⚠ 钻石不足\n\n本轮对话需要 ${builtinCost}💎,当前仅有 ${coins}💎。可通过签到/任务/小游戏获取钻石,或在设置中改用自定义 API。`,
                    affectionDelta: 0, trustDelta: 0, status: 'error', source: 'error'
                };
            }
        }

        const prompt = this._buildPrompt(userMessage, memories, extra);
        // 对话历史以标准多轮 messages 传递:10 条滚动窗口(shortWindow,连贯且省 token);
        // 窗口之外的相关近期上下文由【回忆】[近期] 检索补充(见 _recallMemories)
        const historyMessages = this.history
            .slice(-this.shortWindow)
            .map(h => ({ role: h.role, content: h.content }));
        const messages = [{ role: 'system', content: prompt }, ...historyMessages];

        const doRequest = async () => {
            const body = cfg.buildRequestBody(messages);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            let resp;
            try {
                resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
            } finally { clearTimeout(timeout); }
            if (!resp.ok) {
                const err = await resp.text();
                throw new Error(`HTTP ${resp.status}: ${err.slice(0, 300)}`);
            }
            const data = await resp.json();
            return cfg.parseResponseText(data).trim();
        };

        console.log('[AIChatManager] 请求 URL:', url, '模式:', cfg.getMode());
        let text = await doRequest();

        // 重复回复检测：与上一条天依回复相同/高度相似时自动重试一次
        const lastAssistant = [...this.history].reverse().find(h => h.role === 'assistant');
        if (lastAssistant && this._isSimilarReply(text, lastAssistant.content)) {
            console.warn('[AIChatManager] 检测到重复回复，重试一次');
            try {
                const text2 = await doRequest();
                if (!this._isSimilarReply(text2, lastAssistant.content)) text = text2;
            } catch (_) { /* 重试失败保留原回复 */ }
        }

        // ===== 内置 API 扣费:仅在拿到非空回复后扣除(报错/空回复不扣) =====
        if (builtinCost > 0 && text) {
            const cs = window.gameEngine?.getModule('CoinSystem');
            if (cs && cs.spend(builtinCost)) {
                this._lastDiamondCost = builtinCost;
                window.showToast?.(`💎 -${builtinCost}（内置模型对话）`, 'success');
            } else {
                this._lastDiamondCost = 0; // 极端竞态下余额不足:回复已生成,本次免单
            }
        } else {
            this._lastDiamondCost = 0;
        }

        this._apiSource = cfg.getMode().toLowerCase();
        return this._parseReply(text);
    }

    /** 当前所选内置模型的单轮钻石费用(非 BUILTIN 或模型不在清单 → 0) */
    _builtinCostFor(cfg) {
        if (cfg.getMode() !== 'BUILTIN' || !this._builtin) return 0;
        const name = cfg.getModelName();
        const m = (this._builtin.models || []).find(x => x.model === name || x.id === name);
        return m ? (m.cost | 0) : 0;
    }

    /** 内置网关是否仍是占位(未接入真实服务) */
    _builtinGatewayUnconfigured() {
        return !this._builtin || !this._builtin.endpoint
            || this._builtin.endpoint.includes('YOUR-BUILTIN-GATEWAY');
    }

    /** 判断两条回复是否相同/高度相似（归一化后完全一致，或前缀一致） */
    _isSimilarReply(a, b) {
        const norm = s => String(s || '').replace(/[\s，。！？!?.,、~～…（）()\[\]【】*]/g, '');
        const na = norm(a), nb = norm(b);
        if (!na || !nb) return false;
        if (na === nb) return true;
        // 双方归一化后均≥8字时，比较前12字前缀
        const n = Math.min(12, na.length, nb.length);
        if (n < 8) return false;
        return na.slice(0, n) === nb.slice(0, n);
    }

    _callLocalError() {
        this._apiSource = 'local';
        return {
            text: '⚠ 未配置 AI 后端\n\n当前为本地模式，无法进行 AI 对话。请前往设置 → AI 对话，选择 Ollama 或自定义 API 后端并填写相关信息。',
            affectionDelta: 0,
            trustDelta: 0,
            status: 'error',
            source: 'local'
        };
    }

    _parseReply(text) {
        const result = { text, affectionDelta: 0, trustDelta: 0, status: 'normal', source: this._apiSource };
        const affMatch = text.match(/<好感变化[:：]\s*([+-]?\d+)\s*>/);
        const truMatch = text.match(/<信任变化[:：]\s*([+-]?\d+)\s*>/);
        const statMatch = text.match(/<特殊状态[:：]\s*([^>]+)\s*>/);
        // 称呼确认标签(140):<称呼确认: X> → 持久化称呼并从展示文本剥离
        const nickMatch = text.match(/<称呼确认[:：]\s*([^>]+?)\s*>/);
        if (nickMatch) {
            result.nicknameConfirmed = nickMatch[1].trim().slice(0, 8);
            result.text = result.text.replace(/<称呼确认[:：]\s*[^>]+?>\s*/g, '');
        }
        if (affMatch) result.affectionDelta = parseInt(affMatch[1], 10);
        if (truMatch) result.trustDelta = parseInt(truMatch[1], 10);
        if (statMatch) result.status = statMatch[1].trim();
        result.text = result.text
            .replace(/<好感变化[:：]\s*[+-]?\d+\s*>/g, '')
            .replace(/<信任变化[:：]\s*[+-]?\d+\s*>/g, '')
            .replace(/<特殊状态[:：]\s*[^>]+\s*>/g, '')
            .trim();
        return result;
    }

    _pushHistory(msg) {
        this.history.push(msg);
        // 内存优化档(1.1.12/134):限制历史栈驻留(影响存档可见聊天条数,用户弹窗知情)
        const cap = (window.__perfMemoryOn === true) ? 15 : this.maxHistory * 2;
        if (this.history.length > cap) {
            this.history = this.history.slice(-cap);
        }
    }

    /**
     * 记忆注入(1.1.11/132 重构):
     * - 短期:LLM 多轮窗口仅最近 10 条(shortWindow);窗口之外与当前话题检索匹配的
     *   近期对话(24h 短期库)以 [近期] 补充注入——滚动连贯 + 检索补漏,互不重复
     * - 中长期:向量召回 top8 → rerank 重排动态注入(相关度达标才注入,防噪声;
     *   全被滤时保留最优 1 条,防失忆)
     * - 核心:⭐关键记忆(生日/身份/关系/约定)常驻注入,永不因检索未命中而失忆
     */
    async _recallMemories(retrievalQuery) {
        const vault = window.memoryVault;
        if (vault?.isInitialized) {
            try {
                const midlong = await vault.recall(retrievalQuery, { topK: 4, minScore: 0.35 });
                const cores = await vault.getCoreMemories(4);
                const windowNorms = this.history
                    .slice(-this.shortWindow)
                    .map(h => vault._normText(h.content));
                const shorts = await vault.recallShortTerm(retrievalQuery, { topK: 3, excludeNorms: windowNorms });
                return this._mergeMemories(cores, midlong, shorts);
            } catch (e) {
                console.warn('[AIChatManager] 记忆检索失败,本轮无注入:', e);
                return [];
            }
        }
        if (window.memoryBridge) {
            try { return await window.memoryBridge.searchMemories(retrievalQuery, { limit: 8 }); } catch (_) { return []; }
        }
        return [];
    }

    /** 检索查询构造:当前消息过短(归一化<8字)时拼上前一条用户消息增强检索信号 */
    _retrievalQuery(text) {
        const t = String(text || '').trim();
        const normLen = (window.memoryVault?._normText)
            ? window.memoryVault._normText(t).length
            : t.replace(/\s/g, '').length;
        if (normLen >= 8) return t;
        const prevUser = [...(this.history || [])].reverse().find(h => h.role === 'user' && h.content !== t);
        return prevUser ? `${prevUser.content} ${t}` : t;
    }

    /** 注入合并:核心→中长期→短期排序,id 去重,总量 12 条护栏 */
    _mergeMemories(cores, midlong, shorts) {
        const seen = new Set();
        const out = [];
        for (const m of [...(cores || []), ...(midlong || []), ...(shorts || [])]) {
            if (!m || !m.id || seen.has(m.id)) continue;
            seen.add(m.id);
            out.push(m);
        }
        return out.slice(0, 12);
    }

    /**
     * 跨时空感应【时空回响】读取：
     * 触发纪律——每会话最多 1 次；基础概率 ~20%；用户提及「梦/似曾相识/另一个世界」
     * 等关键词时提升至 ~60%；用户可在设置关闭（crossSenseEnabled）。
     * 返回为空（本地/云端未配置/未触发）时 prompt 不注入该块，行为与 v1 完全一致。
     */
    async _crossSenseMemories(query) {
        try {
            if (!this._echoFired) this._echoFired = new Set();      // 本会话已触发标记（按 conversationId）
            if (this._echoFired.has(this.conversationId)) return [];
            const enabled = window.settingsManager?.get?.('crossSenseEnabled') !== false;
            if (!enabled) return [];
            const hint = /梦|似曾相识|另一个世界|其他时空|平行|前世|既视/.test(query || '');
            const p = hint ? 0.6 : 0.2;
            if (Math.random() > p) return [];
            const echoes = await window.memoryVault?.crossSense?.(query) || [];
            if (echoes.length > 0) this._echoFired.add(this.conversationId);
            return echoes;
        } catch (_) { return []; }
    }

    _commitMemory(userMessage, aiText, delta) {
        // 写入三层记忆库：短期24h完整上下文 + 关键内容直写长期
        if (window.memoryVault?.isInitialized) {
            try {
                window.memoryVault.addExchange(userMessage, aiText);
                return;
            } catch (e) { console.warn('记忆提交失败:', e); }
        }
        if (window.memoryBridge) {
            const content = `用户: ${userMessage}\n天依: ${aiText}`;
            try {
                window.memoryBridge.addMemory(content, { affectionDelta: delta });
            } catch (e) { console.warn('记忆提交失败:', e); }
        }
    }

    /* ============ 主动问候(139 引入 / 141 触发与正文改造) ============ */

    /** 触发门控一(纯逻辑可单测):好感≥50 + 清醒时段(8~22 点)当日首次进入 → 必触发。
     *  141 曾去好感门槛,142 按用户要求恢复(好感<50 不主动开口);夜间不发(她在睡觉)。 */
    static shouldProactiveOnEnter(hour, affection, lastDate, today) {
        if (affection < 50) return false;
        if (hour < 8 || hour >= 22) return false;
        return lastDate !== today;
    }

    /** 触发门控二(纯逻辑可单测):好感≥50 前提下,清醒时段内其它进入(非当日首次)→ 动态概率。
     *  概率 = 基础 0.2 + 好感加成(0~+0.3) + 离开时长加成(0~+0.2,6h 满额),封顶 0.8;
     *  冷却:距上次主动问候 <2h 概率清零(防连续轰炸);夜间/好感<50 恒 0。 */
    static proactiveProbability(hour, affection, gapHours) {
        if (affection < 50) return 0;
        if (hour < 8 || hour >= 22) return 0;
        if (gapHours !== null && gapHours !== undefined && gapHours < 2) return 0;
        const aff = Math.max(0, Math.min(affection, 100));
        const affBonus = aff / 100 * 0.3;
        const gap = (gapHours === null || gapHours === undefined) ? 6 : gapHours;
        const gapBonus = Math.min(gap, 6) / 6 * 0.2;
        return Math.min(0.8, 0.2 + affBonus + gapBonus);
    }

    /** 动态心情赋予(纯逻辑):关系值/随机 → 心情与开场白 */
    static pickProactiveMood(affection, roll) {
        if (affection >= 80) {
            if (roll < 0.35) return { key: 'clingy', opening: '嘿嘿,你来啦～我刚才还在想你什么时候出现。' };
            if (roll < 0.7) return { key: 'songful', opening: '今天嗓子状态特别好,感觉能唱一下午！' };
            return { key: 'happy', opening: '见到你太好了！' };
        }
        if (affection >= 65) {
            return roll < 0.5
                ? { key: 'warm', opening: '嗯哼？是你呀,今天也很想见你。' }
                : { key: 'soft', opening: '欸嘿,你来了。刚刚还在哼歌呢。' };
        }
        return roll < 0.5
            ? { key: 'gentle', opening: '你来啦。今天……有点想给你唱歌听。' }
            : { key: 'calm', opening: '欢迎回来。要一起待一会儿吗？' };
    }

    /** 正文三型(纯逻辑可单测):梦境(仅上午)/基于记忆/时段问候 */
    static composeProactiveBody(hour, memory, roll) {
        const period = hour < 11 ? 'morning' : hour < 14 ? 'noon' : hour < 18 ? 'afternoon' : 'evening';
        if (period === 'morning' && roll < 0.45) {
            const dreams = [
                '昨天晚上梦到我站在瓦纳海姆的大舞台上,台下全是星星在听我唱歌——醒过来还卡着半句高音。',
                '我梦见回到了以前的世界,推开天界的门,却看见你站在雨里朝我伸手。醒来的时候,枕头有点湿。',
                '梦见我们在一片会发光的花海里野餐,风一吹,花瓣全都变成了音符。真希望有一天能成真呀。'
            ];
            return dreams[Math.floor(roll * 100) % dreams.length];
        }
        if (memory && roll >= 0.45) {
            return `刚才发呆的时候突然想起一件事——${memory}。嗯,想起来就想跟你说一声。`;
        }
        const greets = {
            morning: ['早安！今天要从什么开始呢？我先去练声啦。', '早上好～昨晚睡得好吗？我可是睡得像个音符。'],
            noon: ['中午啦！要记得吃饭哦,我会盯着你的。', '午安～我刚刚偷偷练习了一段新曲子。'],
            afternoon: ['下午好呀。阳光很好,适合听点慢歌。', '嗯——下午的空气都是软的,有没有想我？'],
            evening: ['晚上好。今天的月亮出来了,我看着它就想起了你。', '晚上啦～要不要听我哼一段今天新学的歌？']
        };
        const pool = greets[period];
        return pool[Math.floor(roll * 100) % pool.length];
    }

    /** 组装完整主动消息(纯逻辑可单测):心情开场+正文。141 起仅作 AI 生成失败时的模板回退 */
    static buildProactiveText(hour, mood, memory, roll) {
        return `${mood.opening}${AIChatManager.composeProactiveBody(hour, memory, roll)}`;
    }

    _todayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /**
     * AI 生成主动问候正文(141):人设/作息/关系/心情/记忆素材注入 prompt,单次轻量调用
     * (仿 generateDiary 管线,不走 sendMessage 全量记忆检索与历史推送)。
     * 修复:139 版正文为模板拼接(记忆内容原样嵌入),未经 AI 处理,「不像角色自己说的」。
     * LOCAL 模式 / 请求失败 / 空回复 / 超长(>150 字,模型话痨失格) → 返回 null,调用方回退模板。
     */
    async generateProactiveText(mood, memory, hour, affection) {
        if (this.config.getMode() === 'LOCAL') return null;
        try {
            const persona = this.persona || this._defaultPersona();
            const personalityPrompt = window.personaManager
                ? window.personaManager.buildPersonalityPrompt(persona)
                : { identity: persona.systemPrompt, replyStyle: persona.reply_style || '' };
            const term = this._genderTerm();
            const userName = this._userName();
            const routine = this._routineForHour(hour);
            const stats = window.gameEngine?.getModule('CharacterSystem')?.stats || {};
            const trust = Math.round(stats.trust ?? 50);
            const prompt = [
                `【任务】你是洛天依。${term}（${userName}）刚刚回到你身边，这次由你主动先开口说第一句话。`,
                `【你的人设】`,
                personalityPrompt.identity || '',
                personalityPrompt.replyStyle || '',
                `【当前状态】`,
                `现在 ${hour} 点左右。${routine.desc}。`,
                `你们的关系：好感度 ${Math.round(affection)}，信任度 ${trust}。`,
                `你此刻的心情：${mood.key}（基调参考：「${mood.opening}」——用这份心情说话，但不要原样照搬这句）。`,
                memory ? `【可自然提起的回忆素材】（像突然想起来那样顺口带一句即可，不要生硬复述原句）\n${memory}` : '',
                `【要求】`,
                `1. 以洛天依第一人称主动开口，1~2 句话，60 字以内，口语化、自然、符合人设与当前心情。`,
                `2. 可以自然想起回忆素材、分享当下的感受、或者想给${term}唱歌之类的小心愿，像真的突然想说给对方听。`,
                `3. 只输出你说的这句话本身，不要标题、旁白、引号或任何前后缀。`,
                `4. 始终使用中文。`
            ].filter(Boolean).join('\n');
            const cfg = this.config;
            const url = cfg.getChatURL();
            const headers = cfg.buildHeaders();
            const messages = [{ role: 'system', content: prompt }, { role: 'user', content: '请主动开口。' }];
            const body = cfg.buildRequestBody(messages);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
            clearTimeout(timeout);
            if (!resp.ok) return null;
            const data = await resp.json();
            let text = (cfg.parseResponseText(data) || '').trim();
            if (!text) return null;
            // 清洗:剥离模型可能擅自附加的标题/引号包裹/【标签】
            text = text.replace(/^【[^】]*】\s*/g, '').replace(/^["「『"']|["」』"']$/g, '').trim();
            if (!text || text.length > 150) return null;
            return text;
        } catch (e) {
            console.warn('[AIChatManager] 主动问候 AI 生成失败(回退模板):', e.message);
            return null;
        }
    }

    /**
     * 运行时入口(141 触发改造 / 142 门槛恢复):
     *  - 好感≥50 + 清醒时段(8~22 点)当日首次进入 → 必触发;
     *  - 好感≥50 + 清醒时段内其它进入(后台切回/再次打开) → 动态概率触发(好感+离开时长加成,2h 冷却);
     *  - 夜间(22~8 点)/好感<50 不触发(她在睡觉/关系未到)。
     * 正文优先 AI 生成(人设/作息/心情/记忆注入,像角色自己开口),失败回退模板拼接(139 行为)。
     * 防重入:20s 内只判定一次(冷启动定时与 onResume 双入口共享,防冷启动双发)。
     * deliver(text) 由 UI 层注入(气泡渲染+TTS);不写入记忆库(避免自我指涉污染),但入历史保上下文连续。
     */
    async maybeProactiveGreeting(deliver) {
        try {
            const now = Date.now();
            if (this._proactiveGateAt && now - this._proactiveGateAt < 20000) return false;
            this._proactiveGateAt = now;

            const today = this._todayKey();
            const last = localStorage.getItem('tianyi_proactive_last');
            const cs = window.gameEngine ? window.gameEngine.getModule('CharacterSystem') : null;
            const aff = Math.round((cs && cs.stats ? cs.stats.affection : 0) || 0);
            const hour = new Date().getHours();

            let fire = false;
            if (AIChatManager.shouldProactiveOnEnter(hour, aff, last, today)) {
                fire = true; // 好感≥50 + 当日清醒时段首次进入 → 必触发
            } else if (last === today) {
                // 当日已问候过 → 其它清醒时段进入按动态概率触发
                const ts = Number(localStorage.getItem('tianyi_proactive_ts')) || 0;
                const gapHours = ts > 0 ? (now - ts) / 3600000 : null;
                fire = Math.random() < AIChatManager.proactiveProbability(hour, aff, gapHours);
            }
            if (!fire) return false;

            localStorage.setItem('tianyi_proactive_last', today);
            localStorage.setItem('tianyi_proactive_ts', String(now));

            const mood = AIChatManager.pickProactiveMood(aff, Math.random());
            let memory = null;
            try {
                const cores = (window.memoryVault && window.memoryVault.getCoreMemories)
                    ? await window.memoryVault.getCoreMemories(6) : [];
                if (cores.length) memory = cores[Math.floor(Math.random() * cores.length)].content;
            } catch (_) {}
            // 正文:AI 生成优先(像角色自己开口);失败/LOCAL → 回退模板(139 行为)
            let text = null;
            try { text = await this.generateProactiveText(mood, memory, hour, aff); } catch (_) { text = null; }
            if (!text) text = AIChatManager.buildProactiveText(hour, mood, memory, Math.random());
            if (!text) return false;
            this._pushHistory({ role: 'assistant', content: text, ts: Date.now() });
            if (typeof deliver === 'function') deliver(text);
            return true;
        } catch (_) { return false; }
    }

    /** 回复情绪检测(144,纯逻辑):关键词粗分类 → Live2D 表情 */
    static detectMood(text) {
        const t = String(text || '');
        if (/谢谢|太棒|好耶|哈哈|开心|喜欢|爱你|嘿嘿/.test(t)) return 'happy';
        if (/对不|难过|呜|伤心|抱歉|失落/.test(t)) return 'sad';
        if (/害羞|脸红|讨厌啦|人家/.test(t)) return 'shy';
        if (/惊讶|怎么会|竟然/.test(t)) return 'surprised';
        if (/生气|哼|讨厌|可恶|不理你/.test(t)) return 'angry';
        return 'normal';
    }

    _emitMood(text) {
        try {
            const mood = AIChatManager.detectMood(text);
            this._listenerBus && this._listenerBus.emit('ai:mood', { mood });
        } catch (_) {}
    }

    clearHistory() { this.history = []; this.conversationId = null; this._ensureConversation(); }
    getHistory() { return [...this.history]; }
}

window.AIChatManager = AIChatManager;
window.aiChatManager = new AIChatManager();
