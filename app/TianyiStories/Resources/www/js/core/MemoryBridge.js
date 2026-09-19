/**
 * 记忆系统桥接 - 统一 Android 原生 / Web 端 IndexedDB 降级
 */
class MemoryBridge {
    constructor() {
        this.platform = this._detectPlatform();
        this.androidBridge = null;
        this.isInitialized = false;
        this.isEnabled = true;
        this.deferredInit = false;
        this._useAndroid = this.platform === 'android';
        this._fallback = new MemoryIndexedDB();
        this._callbackCounter = 0;
        this._callbacks = new Map();
    }

    _detectPlatform() {
        if (typeof window === 'undefined') return 'web';
        if (window.AndroidMemoryBridge) return 'android';
        if (/Android/i.test(navigator.userAgent)) return 'android';
        return 'web';
    }

    async init() {
        if (this.isInitialized) return true;
        try {
            if (this._useAndroid) {
                if (window.AndroidMemoryBridge && typeof window.AndroidMemoryBridge.init === 'function') {
                    await this._callAndroidAsync('init');
                }
            } else {
                await this._fallback.init();
            }
            this.isInitialized = true;
            console.log('[MemoryBridge] 初始化完成, platform =', this.platform);
            return true;
        } catch (e) {
            console.error('[MemoryBridge] 初始化失败:', e);
            return false;
        }
    }

    setEnabled(b) { this.isEnabled = !!b; }

    isMemoryEnabled() { return this.isEnabled; }

    async addMemory(content, options = {}) {
        if (!this.isEnabled || !this.isInitialized) return { skipped: true };
        try {
            if (this._useAndroid) {
                return await this._callAndroidAsync('addMemoryAsync', content, JSON.stringify(options));
            }
            return await this._fallback.addMemory(content, options);
        } catch (e) {
            console.warn('[MemoryBridge] addMemory 失败:', e);
            return { success: false, error: e.message };
        }
    }

    async searchMemories(query, options = {}) {
        if (!this.isEnabled || !this.isInitialized) return [];
        try {
            let raw = [];
            if (this._useAndroid) {
                const result = await this._callAndroidAsync('searchMemoriesAsync', query, JSON.stringify(options));
                raw = result?.results || [];
                try { raw = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) {}
            } else {
                raw = await this._fallback.searchMemories(query, options);
            }
            const MIN_SIM = 0.15;
            return (raw || [])
                .map(r => {
                    if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_) { return null; } }
                    return r;
                })
                .filter(Boolean)
                .filter(r => (r.similarity ?? r.score ?? 0) >= MIN_SIM);
        } catch (e) {
            console.warn('[MemoryBridge] searchMemories 失败:', e);
            return [];
        }
    }

    async getStats() {
        if (!this.isInitialized) return { totalNodes: 0, isInitialized: false };
        if (this._useAndroid) {
            return await this._callAndroidAsync('getStatsAsync');
        }
        return await this._fallback.getStats();
    }

    async clearAll() {
        try {
            if (this._useAndroid) {
                return await this._callAndroidAsync('clearAllAsync');
            }
            return await this._fallback.clearAll();
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async reinitialize() {
        if (this._useAndroid) {
            try { return await this._callAndroidAsync('reinitializeAsync'); } catch (_) {}
        }
        this.isInitialized = false;
        return this.init();
    }

    /** 排序与截断（保留原契约语义） */
    rankAndTruncateForPrompt(memories, query, options = {}) {
        if (!memories || memories.length === 0) return [];
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        const weight = { semantic: 0.6, temporal: 0.2, importance: 0.2 };
        const scored = memories.map(m => {
            const sem = m.similarity ?? m.score ?? 0.5;
            const ts = m.timestamp ? new Date(m.timestamp).getTime() : now;
            const age = (now - ts) / day;
            let temp;
            if (age < 1) temp = 1;
            else if (age < 7) temp = 0.9;
            else if (age < 30) temp = 0.7;
            else temp = Math.max(0.3, Math.exp(-age / 60));
            const imp = m.importance ?? 0.5;
            const final = Math.min(sem * weight.semantic + temp * weight.temporal + imp * weight.importance, 1);
            return { ...m, finalScore: final };
        }).sort((a, b) => b.finalScore - a.finalScore);

        const maxTokens = options.maxTokens || 4096;
        const result = [];
        let used = 0;
        for (const m of scored) {
            const content = m.content || m.memory || '';
            const est = Math.ceil(content.length / 2);
            if (used + est > maxTokens) break;
            result.push(m);
            used += est;
        }
        return result;
    }

    formatMemoriesForPrompt(memories, maxTokens = 500) {
        if (!memories || memories.length === 0) return '';
        let text = '\n【可能相关的记忆，自行判断是否需要提及】\n';
        for (const m of memories) {
            const content = m.content || m.memory || '';
            const ts = m.timestamp ? new Date(m.timestamp) : new Date();
            const stamp = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
            text += `- ${content} (${stamp})\n`;
        }
        return text;
    }

    /** Android 异步调用（callback 风格），带超时保护 */
    _callAndroidAsync(method, ...args) {
        return new Promise((resolve, reject) => {
            if (!window.AndroidMemoryBridge) {
                reject(new Error('AndroidMemoryBridge 不可用'));
                return;
            }
            const cbId = 'cb_' + (++this._callbackCounter) + '_' + Date.now();
            this._callbacks.set(cbId, { resolve, reject, method });
            window.AndroidMemoryCallback = {
                resolve: (id, result) => {
                    const cb = this._callbacks.get(id);
                    if (cb) {
                        this._callbacks.delete(id);
                        try {
                            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
                            cb.resolve(parsed);
                        } catch (_) { cb.resolve(result); }
                    }
                },
                reject: (id, error) => {
                    const cb = this._callbacks.get(id);
                    if (cb) { this._callbacks.delete(id); cb.reject(new Error(error)); }
                }
            };
            try {
                const fn = window.AndroidMemoryBridge[method];
                if (typeof fn === 'function') {
                    fn.apply(window.AndroidMemoryBridge, [...args, cbId]);
                } else {
                    window.AndroidMemoryBridge.callAndroidAsync.apply(window.AndroidMemoryBridge, [method, ...args]);
                }
            } catch (e) {
                this._callbacks.delete(cbId);
                reject(e);
            }
            // 超时保护：10 秒后仍未收到回调则自动 resolve（避免卡死）
            setTimeout(() => {
                const cb = this._callbacks.get(cbId);
                if (cb) {
                    this._callbacks.delete(cbId);
                    console.warn('[MemoryBridge] 异步调用超时:', method);
                    cb.resolve({ success: false, timeout: true });
                }
            }, 10000);
        });
    }

    isSystemPrompt(content) {
        if (!content || typeof content !== 'string') return false;
        return /[（(]?system[：:]/i.test(content) || content.includes('请以妹妹的身份');
    }
}

window.MemoryBridge = MemoryBridge;
window.memoryBridge = new MemoryBridge();
