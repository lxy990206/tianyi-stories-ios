/**
 * 日程提醒系统：按真实时间自动提醒
 *  - 早餐 / 午餐 / 晚餐：主动提醒用户吃饭
 *  - 夜间：提醒用户睡觉休息
 * 每天每个提醒点只触发一次；优先用 AI 生成暖心提醒语，失败则用本地文案。
 */
class ReminderSystem {
    constructor() {
        this.schedules = [
            { id: 'breakfast', name: '早餐', window: [7, 9], emoji: '🍞', fallback: '该吃早餐啦～早餐很重要，再忙也要好好吃饭哦。' },
            { id: 'lunch', name: '午餐', window: [11, 13], emoji: '🍚', fallback: '中午啦，该吃午饭咯～天依陪你一起吃饭。' },
            { id: 'dinner', name: '晚餐', window: [17, 19], emoji: '🍜', fallback: '傍晚啦，记得吃晚饭哦～今晚想吃什么呀？' },
            { id: 'sleep', name: '睡觉', window: [22, 24], emoji: '🌙', fallback: '夜深啦，该休息了～天依会一直守护你，晚安。' }
        ];
        this._fired = {};
        this._timer = null;
        this._lastCheckMinute = -1;
    }

    init() {
        // 每分钟检查一次真实时间
        this._timer = setInterval(() => this.tick(), 30000);
        this.tick();
    }

    _key() { return `tianyi_reminders_slot_${window.saveManager?.slotId || 1}`; }

    _loadFired() {
        try {
            const raw = localStorage.getItem(this._key());
            if (raw) {
                const data = JSON.parse(raw);
                if (data.date === new Date().toDateString()) {
                    this._fired = data.fired || {};
                } else {
                    this._fired = {};
                }
            }
        } catch (_) { this._fired = {}; }
    }

    _saveFired() {
        try {
            localStorage.setItem(this._key(), JSON.stringify({ date: new Date().toDateString(), fired: this._fired }));
        } catch (_) {}
    }

    tick() {
        const now = new Date();
        const minute = now.getHours() * 60 + now.getMinutes();
        if (minute === this._lastCheckMinute) return;
        this._lastCheckMinute = minute;
        this._loadFired();
        for (const s of this.schedules) {
            const start = s.window[0] * 60;
            const end = s.window[1] * 60;
            if (minute >= start && minute < end) {
                if (!this._fired[s.id]) {
                    this._fired[s.id] = true;
                    this._saveFired();
                    this._fire(s);
                }
            }
        }
    }

    async _fire(schedule) {
        const text = await this._generateMessage(schedule);
        const mainScene = window.gameEngine?.getModule('MainScene');
        if (mainScene) mainScene.showBubble(text);
        window.showToast(schedule.emoji + ' ' + text, 'info', 4200);

        // 若聊天面板打开，也推一条 AI 消息（不打断玩家输入）
        const panel = document.getElementById('chat-panel');
        if (panel && panel.style.display !== 'none') {
            this._appendChatMessage(text);
        }
        console.log('[Reminder]', schedule.id, text);
    }

    async _generateMessage(schedule) {
        try {
            if (window.aiChatManager && window.aiChatManager.config?.getMode?.() !== 'LOCAL') {
                const term = window.genderManager?.getTerm() || '哥哥';
                const userName = window.playerInfoManager?.get()?.name || term;
                const persona = window.personaManager?.getActivePersonaId?.() || 'default';
                const prompt = [
                    `你是洛天依，正在提醒你的${term}（${userName}）。现在是${schedule.name}时间。`,
                    `请用 1-2 句自然、温暖、符合你当前人格的话主动提醒${term}${schedule.id === 'sleep' ? '该睡觉休息了' : '好好吃饭'}。`,
                    `要求：口语化、有温度，像真实陪伴，不要像客服话术，不要出现「提醒」「通知」等字眼。`,
                    `只输出天依会说的话，不要多余内容。`
                ].join('\n');
                const cfg = window.aiChatManager.config;
                const messages = [{ role: 'system', content: prompt }, { role: 'user', content: `请提醒${term}${schedule.id === 'sleep' ? '睡觉' : '吃饭'}。` }];
                const resp = await fetch(cfg.getChatURL(), {
                    method: 'POST',
                    headers: cfg.buildHeaders(),
                    body: JSON.stringify(cfg.buildRequestBody(messages))
                });
                if (resp.ok) {
                    const data = await resp.json();
                    const t = cfg.parseResponseText(data)?.trim();
                    if (t && t.length > 0 && t.length < 60) return t;
                }
            }
        } catch (_) {}
        return schedule.fallback;
    }

    _appendChatMessage(text) {
        const messages = document.getElementById('chat-messages');
        if (!messages) return;
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble ai';
        bubble.textContent = text;
        messages.appendChild(bubble);
        messages.scrollTop = messages.scrollHeight;
    }

    stop() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
}

window.ReminderSystem = ReminderSystem;
window.reminderSystem = new ReminderSystem();