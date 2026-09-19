/**
 * 敏感词过滤：基本词库（轻量版）
 */
class WordFilter {
    constructor() {
        this.blocked = new Set();
        this._load();
    }

    _load() {
        try {
            const raw = localStorage.getItem('tianyi_wordfilter');
            if (raw) this.blocked = new Set(JSON.parse(raw));
        } catch (_) {}
    }

    add(words) {
        (Array.isArray(words) ? words : [words]).forEach(w => this.blocked.add(w));
        try { localStorage.setItem('tianyi_wordfilter', JSON.stringify([...this.blocked])); } catch (_) {}
    }

    check(text) {
        if (!text) return { safe: true, hits: [] };
        const hits = [];
        for (const w of this.blocked) {
            if (text.includes(w)) hits.push(w);
        }
        return { safe: hits.length === 0, hits };
    }

    filter(text) {
        if (!text) return '';
        let out = text;
        for (const w of this.blocked) {
            out = out.split(w).join('*'.repeat(w.length));
        }
        return out;
    }
}

window.WordFilter = WordFilter;
window.wordFilter = new WordFilter();
