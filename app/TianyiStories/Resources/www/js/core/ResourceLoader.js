/**
 * 资源加载器：图片 / 音频 / JSON 资源
 * 监听 onProgress 回调以驱动 loading 进度条。
 */
class ResourceLoader {
    constructor() {
        this.cache = new Map();
        this.failed = new Set();
        this._pending = 0;
        this._completed = 0;
    }

    loadDefaultResources() {
        // 占位：实际角色立绘使用 SVG（直接放在 DOM img 标签中加载）
        this.defaults = [];
    }

    loadAll(onProgress, onComplete) {
        const items = this.defaults || [];
        if (items.length === 0) {
            onProgress?.(1, 0, 0);
            onComplete?.({});
            return;
        }
        this._pending = items.length;
        this._completed = 0;
        const results = {};
        for (const item of items) {
            this._loadOne(item, res => {
                if (res) results[item.key] = res;
                this._completed++;
                const progress = this._completed / this._pending;
                onProgress?.(progress, this._completed, this._pending);
                if (this._completed >= this._pending) onComplete?.(results);
            });
        }
    }

    _loadOne(item, cb) {
        if (item.type === 'image') {
            const img = new Image();
            img.onload = () => { this.cache.set(item.key, img); cb(img); };
            img.onerror = () => { this.failed.add(item.url); cb(null); };
            img.src = item.url;
        } else {
            cb(null);
        }
    }

    get(key) { return this.cache.get(key); }
}

window.ResourceLoader = ResourceLoader;
