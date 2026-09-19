/**
 * 三层记忆库 MemoryVault（嵌入式向量数据库 · 多时空云就绪 v2）
 *
 * 时空模型（多租户）：
 *   appId(时空ID,实例级配置 'tianyi_stories') → userId(用户ID,'local') → conversationId(存档线)
 *   - 本时空检索 recall() 永远只返回本 appId 数据（云端行为对齐）
 *   - crossSense() 跨时空感应：独立只读通道，仅同 userId、仅摘要级(mid/long)、
 *     低频限次；本地单时空实现恒返回空，云端混合记忆库上线后由适配器激活
 *
 * 三层记忆：
 *   短期：24h 内完整对话上下文（滚动窗口，设备本地资产，不上云）
 *   中期：每日对当天上下文的 AI 总结（带向量，mentionDates 按天去重计数）
 *   长期：每 30 天对中期记忆的总结；唯一提及天数<3 的中期记忆自动丢弃；
 *         60 天未被提及自动遗忘；关键记忆（关系/生日/身份/共同记忆）永不遗忘且直写长期
 *
 * 数据契约：exportAll() v2（schema:2，以时空组织，含 tombstone 预留），
 *           importAll() 幂等 upsert（id+updatedAt LWW），拒绝异时空数据。
 *           契约全文见 docs/CLOUD_SYNC_CONTRACT.md
 * 向量后端：原生 EmbeddingBridge（SiliconFlow BAAI/bge-m3 + bge-reranker-v2-m3，密钥原生保护）
 * 降级：无桥环境（浏览器预览）用字符 bigram 重叠度检索，功能可用但精度降级
 * 云同步：attachCloudSync(adapter)（契约见 docs/CLOUD_SYNC_CONTRACT.md，服务端未实现）
 */
class EmbeddingClient {
    constructor() {
        this._cbs = new Map();
        this._seq = 0;
        this.available = typeof window.EmbeddingBridge !== 'undefined' && typeof window.EmbeddingBridge.embed === 'function';
        if (this.available) {
            window.EmbeddingCallback = {
                _resolve: (cbId, result) => {
                    const cb = this._cbs.get(cbId);
                    if (cb) { this._cbs.delete(cbId); cb(result); }
                }
            };
        }
    }

    /** 批量嵌入：返回向量二维数组，降级返回 null */
    async embed(texts) {
        if (!this.available) return null;
        return new Promise(resolve => {
            const cbId = 'eb_' + (++this._seq);
            const timer = setTimeout(() => { this._cbs.delete(cbId); resolve(null); }, 25000);
            this._cbs.set(cbId, result => {
                clearTimeout(timer);
                resolve(result && result.ok ? result.data : null);
            });
            try {
                window.EmbeddingBridge.embed(JSON.stringify(texts), cbId);
            } catch (_) { clearTimeout(timer); this._cbs.delete(cbId); resolve(null); }
        });
    }

    /** 重排序：返回 [{index,score}]，降级返回 null */
    async rerank(query, docs) {
        if (!this.available || !docs || docs.length === 0) return null;
        return new Promise(resolve => {
            const cbId = 'rr_' + (++this._seq);
            const timer = setTimeout(() => { this._cbs.delete(cbId); resolve(null); }, 20000);
            this._cbs.set(cbId, result => {
                clearTimeout(timer);
                resolve(result && result.ok ? result.data : null);
            });
            try {
                window.EmbeddingBridge.rerank(query, JSON.stringify(docs), cbId);
            } catch (_) { clearTimeout(timer); this._cbs.delete(cbId); resolve(null); }
        });
    }
}

class MemoryVault {
    constructor() {
        this.db = null;
        this.dbName = 'tianyi_memory_vault';
        this.dbVersion = 2;
        // ===== 多时空实例配置（上云后为云端路由/隔离键，一经确认不可改动） =====
        this.appId = 'tianyi_stories';          // 时空ID（稳定技术标识，非显示名）
        this.userId = 'local';                   // 用户ID（登录后由 AuthBridge 覆写）
        this.embedder = new EmbeddingClient();
        this.isInitialized = false;
        this.SHORT_TTL = 24 * 60 * 60 * 1000;      // 短期 24h（本地资产，不上云）
        this.MENTION_FORGET_MS = 60 * 24 * 3600 * 1000; // 长期 60 天未提及遗忘
        this.CONSOLIDATE_MS = 30 * 24 * 3600 * 1000;    // 每 30 天中期→长期
        this.MIN_MENTIONS = 3;                     // 中期唯一提及天数 <3 丢弃
        // 关键记忆直写长期：关系 / 生日 / 身份 / 共同记忆
        // v2 收紧：删除「哥哥/姐姐/第一次/在一起」等宽泛词条（误命中污染核心记忆）
        this.keyPatterns = /生日|出生于|\d+\s*岁|我叫|我的名字|我是做|我的职业|我的工作|在读|学校|毕业|纪念日|女朋友|男朋友|老婆|老公|结婚|订婚|同居|我们曾经|约定|承诺|一起去|旅行|养了|宠物|家人|爸爸|妈妈|弟弟|妹妹/;
    }

    /** 租户元数据：写入每条 mid/long 记录 */
    _tenantMeta() {
        return {
            appId: this.appId,
            userId: this.userId,
            userName: (window.playerInfoManager?.get?.()?.name) || '',
            conversationId: this._conversationId()
        };
    }

    /** 存档线 ID：优先沿用 AIChatManager 会话 id（同一存档线延续），否则惰性生成持久化 */
    _conversationId() {
        try {
            const cid = window.aiChatManager?.conversationId;
            if (cid) return cid;
            const m = this._metaGetSync('conversationId');
            if (m) return m.v;
            const nv = 'conv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            this._metaSetSync('conversationId', nv);
            return nv;
        } catch (_) { return 'conv_local'; }
    }

    async init() {
        if (this.isInitialized) return true;
        try {
            this.db = await this._openDB();
            this.isInitialized = true;
            // 启动时执行周期任务（每日整合/30天整合/衰减遗忘）
            this.maintenance().catch(e => console.warn('[MemoryVault] 维护任务失败:', e));
            console.log('[MemoryVault] 初始化完成 v' + this.dbVersion, '时空:', this.appId, '向量后端:', this.embedder.available ? '原生嵌入' : '降级(关键词)');
            return true;
        } catch (e) {
            console.error('[MemoryVault] 初始化失败:', e);
            return false;
        }
    }

    _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, this.dbVersion);
            req.onupgradeneeded = () => {
                const db = req.result;
                // ---- v1 基础结构 ----
                if (!db.objectStoreNames.contains('short_term')) {
                    const s = db.createObjectStore('short_term', { keyPath: 'id' });
                    s.createIndex('ts', 'ts');
                }
                if (!db.objectStoreNames.contains('mid_term')) {
                    db.createObjectStore('mid_term', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('long_term')) {
                    db.createObjectStore('long_term', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'k' });
                }
                // ---- v2 迁移：mid/long 增加多时空租户字段（存量回填默认值，原子事务内完成） ----
                if (!req.transaction) return;
                const backfill = (storeName) => {
                    try {
                        const store = req.transaction.objectStore(storeName);
                        const all = store.getAll();
                        all.onsuccess = () => {
                            const w = req.transaction.objectStore(storeName);
                            for (const r of all.result || []) {
                                w.put(Object.assign({
                                    appId: 'tianyi_stories',
                                    userId: 'local',
                                    userName: '',
                                    conversationId: 'conv_legacy',
                                    mentionDates: [],
                                    degraded: false,
                                    updatedAt: Date.now()
                                }, r, { mentionDates: r.mentionDates || [], vector: r.vector }));
                            }
                        };
                    } catch (_) {}
                };
                backfill('mid_term');
                backfill('long_term');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    _tx(store, mode = 'readonly') {
        return this.db.transaction(store, mode).objectStore(store);
    }

    _req(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _metaGet(k) { return this._req(this._tx('meta').get(k)); }
    async _metaSet(k, v) { this._req(this._tx('meta', 'readwrite').put({ k, v })); }

    /** 同步读 meta（onupgradeneeded 事务外的常规路径；异步版本初始化前不可用时返回 null） */
    _metaGetSync(k) { return null; }
    _metaSetSync(k, v) { try { this._req(this._tx('meta', 'readwrite').put({ k, v })); } catch (_) {} }

    _dateKey(d = new Date()) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    _id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    // ================= 短期记忆（24h 完整上下文 · 设备本地资产） =================

    /** 写入短期；命中关键模式则同时直写长期（永不遗忘） */
    async addExchange(userText, aiText) {
        if (!this.isInitialized) return;
        try {
            const now = Date.now();
            const sw = this._tx('short_term', 'readwrite');
            sw.put({ id: this._id(), role: 'user', content: userText, ts: now });
            sw.put({ id: this._id(), role: 'assistant', content: aiText, ts: now });
            // 关键记忆检测（用户说的话含关键信息才直写长期）
            if (userText && this.keyPatterns.test(userText)) {
                await this.addLongTerm(`（${this._dateKey()}）${userText}`, true, 'key-auto');
            }
            this._cleanupShortTerm();
        } catch (e) { console.warn('[MemoryVault] addExchange 失败:', e); }
    }

    /** 清理超过 24h 的短期记忆 */
    async _cleanupShortTerm() {
        try {
            const cutoff = Date.now() - this.SHORT_TTL;
            const store = this._tx('short_term', 'readwrite');
            const all = await this._req(store.getAll());
            for (const r of all) if (r.ts < cutoff) store.delete(r.id);
        } catch (_) {}
    }

    async getShortTerm() {
        if (!this.isInitialized) return [];
        const all = await this._req(this._tx('short_term').getAll());
        return all.sort((a, b) => a.ts - b.ts);
    }

    // ================= 中期记忆（每日总结） =================

    /**
     * 每日整合：自上次整合以来的短期上下文 → AI 总结 → 中期（带向量）。
     * v2 修复：①按 ts >= lastConsolidationTs 过滤（防止混入已整合内容重复沉淀）
     *          ②整合成功后清空已整合短期记录（自然跨天语义，短期→中期交接）
     *          ③AI 失败降级内容打 degraded 标记，下轮整合窗口重做
     */
    async dailyConsolidation() {
        if (!this.isInitialized) return false;
        const todayKey = this._dateKey();
        const last = await this._metaGet('lastMidDate');
        if (last && last.v === todayKey) return false; // 今天已整合
        const since = (await this._metaGet('lastConsolidationTs'))?.v || 0;
        const short = (await this.getShortTerm()).filter(m => m.ts >= since);
        if (short.length === 0) { await this._metaSet('lastMidDate', todayKey); return false; }

        const dialogue = short.map(m => `${m.role === 'user' ? '用户' : '天依'}: ${m.content}`).join('\n');
        const summary = await this._aiSummarize(
            `把以下一段时间的对话整理成一份简洁的记忆摘要（150字以内），保留重要的个人信息、偏好、约定、情绪事件，用第三人称陈述，不要寒暄：\n${dialogue}`
        );
        const degraded = !summary;
        const content = summary || this._localSummarize(short);
        const vector = degraded ? null : await this._embedOne(content);
        const dateKey = last?.v || this._dateKey(new Date(Date.now() - 86400000));
        const maxTs = short[short.length - 1].ts;
        this._tx('mid_term', 'readwrite').put({
            id: this._id(), dateKey, summary: content, vector,
            ...this._tenantMeta(),
            mentionDates: [], degraded, updatedAt: Date.now(), createdAt: Date.now()
        });
        // 整合成功（含 degraded 兜底）即交接：清空已整合短期，推进游标
        const sw = this._tx('short_term', 'readwrite');
        for (const m of short) sw.delete(m.id);
        await this._metaSet('lastConsolidationTs', maxTs);
        await this._metaSet('lastMidDate', todayKey);
        console.log('[MemoryVault] 每日整合完成:', dateKey, degraded ? '(降级内容,下轮重做)' : '');
        return true;
    }

    // ================= 长期记忆（30天总结 + 衰减） =================

    /**
     * 30 天整合：唯一提及天数≥3 的中期记忆 → AI 总结 → 长期；
     * <3 的到期中期记忆自动丢弃；长期记忆执行 60 天衰减遗忘。
     */
    async monthlyConsolidation() {
        if (!this.isInitialized) return false;
        const now = Date.now();
        const lastRun = (await this._metaGet('lastLongRun'))?.v || 0;
        if (now - lastRun < this.CONSOLIDATE_MS) { return false; }

        const mids = await this._req(this._tx('mid_term').getAll());
        // 仅处理已满 30 天的本时空中期记忆（未满期不参与淘汰，防止首次运行误删新记忆）
        const mature = mids.filter(m => (m.appId || 'tianyi_stories') === this.appId
            && now - (m.createdAt || 0) >= this.CONSOLIDATE_MS);
        const mentionDays = m => (m.mentionDates || []).length || m.mentions || 0;
        // 丢弃唯一提及天数 <3 的到期中期记忆
        const keep = mature.filter(m => mentionDays(m) >= this.MIN_MENTIONS);
        const dropped = mature.length - keep.length;
        const mw = this._tx('mid_term', 'readwrite');
        mature.filter(m => mentionDays(m) < this.MIN_MENTIONS).forEach(m => mw.delete(m.id));

        if (keep.length > 0) {
            const joined = keep.map(m => `[${m.dateKey}] ${m.summary}`).join('\n');
            const summary = await this._aiSummarize(
                `把以下一个月的记忆摘要提炼成一份长期核心记忆（250字以内），只保留最重要的事实与关系，用第三人称简洁陈述：\n${joined}`
            );
            const content = summary || joined.slice(0, 500);
            const vector = await this._embedOne(content);
            this._tx('long_term', 'readwrite').put({
                id: this._id(), content, vector, isKey: false,
                ...this._tenantMeta(),
                mentionDates: [], degraded: !summary, updatedAt: now,
                lastMentioned: now, createdAt: now, source: 'monthly'
            });
        }

        // 长期衰减：60 天未提及且非关键 → 遗忘
        let forgotten = 0;
        const longs = await this._req(this._tx('long_term').getAll());
        const lw = this._tx('long_term', 'readwrite');
        for (const l of longs) {
            if ((l.appId || 'tianyi_stories') !== this.appId) continue;
            if (!l.isKey && l.lastMentioned && now - l.lastMentioned > this.MENTION_FORGET_MS) {
                lw.delete(l.id); forgotten++;
            }
        }
        await this._metaSet('lastLongRun', now);
        console.log(`[MemoryVault] 30天整合: 保留${keep.length} 摘要入长期, 丢弃低频中期${dropped}条, 遗忘长期${forgotten}条`);
        return true;
    }

    /** 手动/关键内容直写长期 */
    async addLongTerm(content, isKey = false, source = 'manual') {
        if (!this.isInitialized || !content) return null;
        const vector = await this._embedOne(content);
        const rec = {
            id: this._id(), content, vector, isKey,
            ...this._tenantMeta(),
            mentionDates: [], degraded: false, updatedAt: Date.now(),
            lastMentioned: Date.now(), createdAt: Date.now(), source
        };
        this._tx('long_term', 'readwrite').put(rec);
        return rec;
    }

    // ================= 动态检索（上下文注入） =================

    /**
     * 本时空动态检索：向量初筛（中期+长期 top8）→ 重排序 → 动态阈值注入
     * （rerank score≥minScore 才注入，防噪声；全被滤时保留最优 1 条，防失忆）。
     * v2：①显式 appId 过滤（云端行为对齐，本地即养成时空纪律）
     *     ②命中计数按天去重（mentionDates 当日唯一才计，修复同日多次检索虚增）
     */
    async recall(query, { topK = 3, minScore = 0.35 } = {}) {
        if (!this.isInitialized || !query) return [];
        try {
            const mids = (await this._req(this._tx('mid_term').getAll()))
                .filter(m => (m.appId || 'tianyi_stories') === this.appId)
                .map(m => ({ layer: 'mid', id: m.id, text: m.summary, vector: m.vector, ref: m }));
            const longs = (await this._req(this._tx('long_term').getAll()))
                .filter(l => (l.appId || 'tianyi_stories') === this.appId)
                .map(l => ({ layer: 'long', id: l.id, text: l.content, vector: l.vector, ref: l }));
            const pool = [...mids, ...longs];
            if (pool.length === 0) return [];

            let ranked = [];
            const qvec = await this._embedOne(query);
            if (qvec && pool.some(p => p.vector)) {
                // 向量初筛 top8
                const scored = pool
                    .filter(p => p.vector)
                    .map(p => ({ p, s: this._cosine(qvec, p.vector) }))
                    .sort((a, b) => b.s - a.s)
                    .slice(0, 8)
                    .map(x => x.p);
                if (scored.length > 0) {
                    // 重排序精排
                    const rr = await this.embedder.rerank(query, scored.map(p => p.text));
                    if (rr && rr.length > 0) {
                        const sorted = rr.slice().sort((a, b) => b.score - a.score);
                        // 动态注入:仅保留重排相关度达标项(防噪声);全部被滤时保留最优 1 条(防失忆)
                        let picked = sorted.filter(r => r.score >= minScore).slice(0, topK);
                        if (picked.length === 0 && sorted.length > 0) picked = [sorted[0]];
                        ranked = picked.map(r => scored[r.index]).filter(Boolean);
                    } else {
                        // rerank 降级：余弦序取 topK
                        ranked = scored.slice(0, topK);
                    }
                }
            }
            if (ranked.length === 0) {
                // 完全降级：关键词 bigram 重叠
                ranked = pool
                    .map(p => ({ p, s: this._overlap(query, p.text) }))
                    .filter(x => x.s > 0.15)
                    .sort((a, b) => b.s - a.s)
                    .slice(0, topK)
                    .map(x => x.p);
            }

            // 命中计数（按天去重）与衰减续期
            this._markMentioned(ranked);
            return ranked.map(r => ({
                layer: r.layer, id: r.id, content: r.text,
                isKey: r.layer === 'long' ? !!r.ref.isKey : false,
                dateKey: r.ref.dateKey || null
            }));
        } catch (e) {
            console.warn('[MemoryVault] recall 失败:', e);
            return [];
        }
    }

    /** 命中即视为提及：mentionDates 当日唯一才计数；lastMentioned 衰减续期 */
    _markMentioned(ranked) {
        const today = this._dateKey();
        const now = Date.now();
        const mw = this._tx('mid_term', 'readwrite');
        const lw = this._tx('long_term', 'readwrite');
        for (const r of ranked) {
            const dates = r.ref.mentionDates = Array.isArray(r.ref.mentionDates) ? r.ref.mentionDates : [];
            if (!dates.includes(today)) dates.push(today);   // 按天去重：同日多次检索只计 1 次
            r.ref.mentions = dates.length;                    // 旧字段兼容：= 唯一提及天数
            r.ref.lastMentioned = now;
            r.ref.updatedAt = now;
            (r.layer === 'mid' ? mw : lw).put(r.ref);
        }
    }

    /**
     * 核心(⭐)记忆常驻集:isKey 长期记忆,按最近提及排序。
     * 防失忆底线:生日/身份/关系/约定等关键记忆无论检索是否命中都注入上下文。
     */
    async getCoreMemories(limit = 4) {
        if (!this.isInitialized) return [];
        try {
            const longs = await this._req(this._tx('long_term').getAll());
            return longs
                .filter(l => (l.appId || 'tianyi_stories') === this.appId && l.isKey)
                .sort((a, b) => (b.lastMentioned || b.updatedAt || 0) - (a.lastMentioned || a.updatedAt || 0))
                .slice(0, limit)
                .map(l => ({ layer: 'long', id: l.id, content: l.content, isKey: true, dateKey: l.dateKey || null }));
        } catch (e) {
            console.warn('[MemoryVault] getCoreMemories 失败:', e);
            return [];
        }
    }

    /**
     * 短期记忆检索匹配(1.1.11/132):从 24h 短期库中找与当前话题相关、
     * 且不在 LLM 滚动窗口内的近期对话,以 [近期] 标签补充注入。
     * - 候选池:短期库最近 200 条(TTL 24h 由写入侧清理)
     * - 检索:字符 bigram 重叠度(本地零成本;短期为原始对话行,无需向量/重排)
     * - 排除:excludeNorms=当前注入的 10 条滚动窗口归一化文本(防重复注入造成混乱)
     */
    async recallShortTerm(query, { topK = 3, excludeNorms = [] } = {}) {
        if (!this.isInitialized || !query) return [];
        try {
            const all = await this._req(this._tx('short_term').getAll());
            const exclude = new Set((excludeNorms || []).map(n => String(n || '')));
            const ranked = all
                .sort((a, b) => b.ts - a.ts)
                .slice(0, 200)
                .filter(r => {
                    const n = this._normText(r.content);
                    return n && !exclude.has(n);
                })
                .map(r => ({ layer: 'short', id: r.id, content: r.content, s: this._overlap(query, r.content) }))
                .filter(x => x.s > 0.15)
                .sort((a, b) => b.s - a.s)
                .slice(0, topK);
            return ranked.map(({ layer, id, content }) => ({ layer, id, content }));
        } catch (e) {
            console.warn('[MemoryVault] recallShortTerm 失败:', e);
            return [];
        }
    }

    /** 文本归一化(去空白/标点/大小写):滚动窗口排除比对与检索查询构造共用 */
    _normText(s) {
        return String(s || '').toLowerCase()
            .replace(/[\s，。！？!?.,、~～…（）()\[\]【】*·：:；;'"「」『』]/g, '');
    }

    // ================= 跨时空感应（独立只读通道 · 本地恒空） =================

    /**
     * 跨时空感应【时空回响】：读取【同 userId 其他 appId】的记忆摘要。
     * 权限红线：仅同用户、仅 mid/long 摘要级、只读、低频限次。
     * 本地单时空实现恒返回 []（无数据可感应，接口零成本占位）；
     * 云端混合记忆库上线后由 CloudSyncAdapter.crossSense() 提供真实数据，
     * 契约见 docs/CLOUD_SYNC_CONTRACT.md「跨时空感应协议」。
     * 触发纪律（AIChatManager 侧）：概率触发 + 会话限 1 次 + 用户开关。
     */
    async crossSense(query, { topK = 2 } = {}) {
        if (!this.isInitialized || !query) return [];
        if (!this.cloudSync || typeof this.cloudSync.crossSense !== 'function') return [];
        try {
            const enabled = window.settingsManager?.get?.('crossSenseEnabled') !== false;
            if (!enabled) return [];
            return await this.cloudSync.crossSense(query, {
                appId: this.appId, userId: this.userId, topK: Math.min(topK, 2)
            });
        } catch (e) {
            console.warn('[MemoryVault] crossSense 失败:', e);
            return [];
        }
    }

    // ================= 可视化管理接口 =================

    async listAll(layer) {
        if (!this.isInitialized) return [];
        const store = layer === 'short' ? 'short_term' : layer === 'mid' ? 'mid_term' : 'long_term';
        const all = await this._req(this._tx(store).getAll());
        return all.sort((a, b) => (b.ts || b.createdAt || 0) - (a.ts || a.createdAt || 0));
    }

    async deleteMemory(layer, id) {
        const store = layer === 'short' ? 'short_term' : layer === 'mid' ? 'mid_term' : 'long_term';
        this._tx(store, 'readwrite').delete(id);
        // tombstone：中期/长期删除需记录，供云同步传播（多设备删除一致性）；
        // 短期为本地资产，删除不上报
        if (layer !== 'short') await this._recordTombstone(id);
    }

    /** 记录删除墓碑（云同步 tombstone；服务器清理策略见契约文档） */
    async _recordTombstone(id) {
        try {
            const m = await this._metaGet('tombstones');
            const list = Array.isArray(m?.v) ? m.v : [];
            if (!list.includes(id)) list.push(id);
            // 墓碑上限保护：超过 500 条时保留最新（推送成功后云端 ACK 可清理）
            await this._metaSet('tombstones', list.slice(-500));
        } catch (_) {}
    }

    async toggleKey(id) {
        const l = await this._req(this._tx('long_term').get(id));
        if (l) { l.isKey = !l.isKey; l.updatedAt = Date.now(); this._tx('long_term', 'readwrite').put(l); return l.isKey; }
        return null;
    }

    async getStats() {
        if (!this.isInitialized) return { short: 0, mid: 0, long: 0, key: 0, embedAvailable: false };
        const [s, m, l] = await Promise.all([
            this._req(this._tx('short_term').count()),
            this._req(this._tx('mid_term').count()),
            this._req(this._tx('long_term').getAll())
        ]);
        return { short: s, mid: m, long: l.length, key: l.filter(x => x.isKey).length, embedAvailable: this.embedder.available };
    }

    // ================= 云端同步预留接口 =================

    /** 后期接入服务器：vault.attachCloudSync(new MyCloudAdapter())（契约见 docs/CLOUD_SYNC_CONTRACT.md） */
    attachCloudSync(adapter) {
        if (adapter && typeof adapter.sync === 'function') {
            this.cloudSync = adapter;
            console.log('[MemoryVault] 云同步适配器已挂载');
        }
    }

    async syncToCloud() {
        if (!this.cloudSync) return { skipped: true, message: '未配置云端同步' };
        const data = await this.exportAll();
        return this.cloudSync.sync(data);
    }

    /**
     * 导出 v2（多时空云同步数据契约）：
     * { schema:2, appId, deviceId, exportedAt, mid:[], long:[], deletedIds:[], lastSyncAt }
     * - 只含中期/长期（短期为设备本地资产，不上云）
     * - mid/long 每条含完整租户元数据与向量（服务端 Milvus 直迁不重嵌）
     * - deletedIds 为 tombstone（本地删除记录，云端传播后可清理）
     * - v1（旧格式 {short,mid,long}）由 importAll 兼容导入
     */
    async exportAll() {
        const [mid, long] = await Promise.all([
            this._req(this._tx('mid_term').getAll()),
            this._req(this._tx('long_term').getAll())
        ]);
        const tombs = await this._metaGet('tombstones');
        const lastSync = await this._metaGet('lastSyncAt');
        const did = await this._deviceId();
        return {
            schema: 2,
            appId: this.appId,
            deviceId: did,
            exportedAt: Date.now(),
            mid: mid.filter(r => (r.appId || 'tianyi_stories') === this.appId),
            long: long.filter(r => (r.appId || 'tianyi_stories') === this.appId),
            deletedIds: Array.isArray(tombs?.v) ? tombs.v : [],
            lastSyncAt: lastSync?.v || 0
        };
    }

    /** 本设备唯一标识（首启生成，持久化 meta） */
    async _deviceId() {
        const m = await this._metaGet('deviceId');
        if (m?.v) return m.v;
        const did = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        await this._metaSet('deviceId', did);
        return did;
    }

    /**
     * 导入（幂等 upsert · LWW）：
     * - v2：校验 data.appId === 本时空 appId，异时空数据拒绝导入（防污染）
     * - 逐条以 id+updatedAt 比较，新者覆盖（Last-Write-Wins）
     * - v1（旧 {short,mid,long} 格式）：兼容导入 mid/long（回填租户默认值），忽略 short
     */
    async importAll(data) {
        if (!data) return false;
        if (data.schema === 2) {
            if (data.appId !== this.appId) {
                console.warn('[MemoryVault] 拒绝导入异时空数据:', data.appId, '≠', this.appId);
                return false;
            }
            const mk = r => ({ ...r, appId: this.appId, updatedAt: r.updatedAt || 0 });
            await this._upsertLWW('mid_term', (data.mid || []).map(mk));
            await this._upsertLWW('long_term', (data.long || []).map(mk));
            return true;
        }
        // v1 兼容
        const mk = r => ({
            ...r,
            appId: this.appId, userId: this.userId, userName: '',
            conversationId: r.conversationId || 'conv_legacy',
            mentionDates: r.mentionDates || [], degraded: false, updatedAt: 0
        });
        await this._upsertLWW('mid_term', (data.mid || []).map(mk));
        await this._upsertLWW('long_term', (data.long || []).map(mk));
        return true;
    }

    /** 幂等 upsert（id+updatedAt LWW：仅当来者更新才覆盖） */
    async _upsertLWW(storeName, records) {
        const store = this._tx(storeName, 'readwrite');
        for (const r of records) {
            if (!r || !r.id) continue;
            const existing = await this._req(store.get(r.id));
            const eu = existing?.updatedAt || 0;
            const nu = r.updatedAt || 0;
            if (!existing || nu >= eu) store.put(r);
        }
    }

    // ================= 内部工具 =================

    /** 启动维护：每日整合补做 + 30天整合 + 衰减 */
    async maintenance() {
        await this.dailyConsolidation().catch(() => {});
        await this.monthlyConsolidation().catch(() => {});
    }

    async _embedOne(text) {
        if (!text) return null;
        const vecs = await this.embedder.embed([String(text).slice(0, 1500)]);
        return vecs && vecs[0] ? vecs[0] : null;
    }

    _cosine(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
        }
        if (na === 0 || nb === 0) return 0;
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    /** 降级检索：字符 bigram 重叠度 */
    _overlap(q, t) {
        const grams = s => {
            const set = new Set();
            const cs = [...String(s || '')];
            for (let i = 0; i < cs.length - 1; i++) set.add(cs[i] + cs[i + 1]);
            return set;
        };
        const gq = grams(q), gt = grams(t);
        if (gq.size === 0 || gt.size === 0) return 0;
        let hit = 0;
        gq.forEach(g => { if (gt.has(g)) hit++; });
        return hit / gq.size;
    }

    /** 本地兜底总结（无 AI 时） */
    _localSummarize(short) {
        const userMsgs = short.filter(m => m.role === 'user').map(m => m.content).slice(0, 10);
        return '当天聊到：' + userMsgs.join('；').slice(0, 200);
    }

    /** AI 总结（复用用户配置的对话后端） */
    async _aiSummarize(prompt) {
        try {
            const cfg = window.aiConfig;
            if (!cfg || cfg.getMode() === 'LOCAL') return null;
            const messages = [
                { role: 'system', content: '你是记忆压缩助手，输出精炼的中文事实性摘要。' },
                { role: 'user', content: prompt }
            ];
            const body = cfg.buildRequestBody(messages);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            const resp = await fetch(cfg.getChatURL(), {
                method: 'POST', headers: cfg.buildHeaders(),
                body: JSON.stringify(body), signal: controller.signal
            });
            clearTimeout(timeout);
            if (!resp.ok) return null;
            const text = cfg.parseResponseText(await resp.json()).trim();
            return text && text.length > 10 ? text : null;
        } catch (_) { return null; }
    }
}

window.MemoryVault = MemoryVault;
window.memoryVault = new MemoryVault();
