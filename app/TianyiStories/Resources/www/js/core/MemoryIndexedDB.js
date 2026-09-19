/**
 * 内存索引数据库 - 浏览器/Web 降级实现
 * 简单的 TF-IDF + 倒排索引，支持 addMemory / searchMemories。
 */
class MemoryIndexedDB {
    constructor() {
        this.storeName = 'tianyi_memories';
        this._store = new Map();
        this._meta = new Map();
        this._initialized = false;
        this._idCounter = 0;
    }

    async init() {
        if (this._initialized) return true;
        try {
            const raw = localStorage.getItem('tianyi_memory_store');
            if (raw) {
                const parsed = JSON.parse(raw);
                for (const [k, v] of Object.entries(parsed)) this._store.set(k, v);
            }
            this._initialized = true;
            return true;
        } catch (e) {
            console.warn('[MemoryIndexedDB] 加载本地存储失败:', e);
            this._initialized = true;
            return false;
        }
    }

    _save() {
        try {
            const obj = Object.fromEntries(this._store);
            localStorage.setItem('tianyi_memory_store', JSON.stringify(obj));
        } catch (e) { console.warn('[MemoryIndexedDB] 保存失败:', e); }
    }

    _tokenize(text) {
        const cjk = [];
        const lower = (text || '').toLowerCase();
        for (let i = 0; i < lower.length - 1; i++) {
            if (this._isCJK(lower[i]) && this._isCJK(lower[i + 1])) cjk.push(lower.substr(i, 2));
        }
        const parts = lower.split(/[^a-z0-9一-鿿]+/).filter(Boolean);
        return [...new Set([...parts, ...cjk])];
    }

    _isCJK(c) {
        const code = c.charCodeAt(0);
        return code >= 0x4E00 && code <= 0x9FFF;
    }

    async addMemory(content, options = {}) {
        if (!this._initialized) await this.init();
        const id = 'mem_' + (++this._idCounter) + '_' + Date.now();
        const now = Date.now();
        const tokens = this._tokenize(content);
        const node = {
            id, content,
            memoryType: options.memoryType || 'fact',
            eventTime: now,
            eventTimeStr: new Date(now).toISOString().replace('T', ' ').substring(0, 16),
            importance: options.importance ?? 0.5,
            tags: options.tags || [],
            tokens,
            ts: now
        };
        this._store.set(id, node);
        this._save();
        return { success: true, id, nodesSaved: 1, nodesEmbedded: 1 };
    }

    async searchMemories(query, options = {}) {
        if (!this._initialized) await this.init();
        const topK = options.limit || 10;
        const qTokens = this._tokenize(query);
        if (qTokens.length === 0) return [];
        const docs = Array.from(this._store.values());
        const N = Math.max(docs.length, 1);
        const idf = {};
        for (const tok of qTokens) {
            const df = docs.filter(d => d.tokens?.includes(tok)).length;
            idf[tok] = Math.log(1 + N / (df + 1));
        }
        const scored = docs.map(doc => {
            let score = 0;
            for (const tok of qTokens) {
                if (doc.tokens?.includes(tok)) {
                    const tf = (doc.tokens.filter(t => t === tok).length) / Math.max(doc.tokens.length, 1);
                    score += tf * (idf[tok] || 0);
                }
            }
            return { ...doc, similarity: score, score, timestamp: new Date(doc.ts).toISOString() };
        }).filter(d => d.similarity > 0)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, topK);
        return scored;
    }

    async getStats() {
        return { totalNodes: this._store.size, edgeCount: 0, dbSizeBytes: 0 };
    }

    async clearAll() {
        this._store.clear();
        localStorage.removeItem('tianyi_memory_store');
        return { success: true };
    }
}

window.MemoryIndexedDB = MemoryIndexedDB;
