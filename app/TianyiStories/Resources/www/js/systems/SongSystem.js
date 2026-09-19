/**
 * 点歌系统(1.1.10Beta5/137 新增,能力预留)
 * - 意图检测 detectRequest:对话中点歌/提到歌名 → {raw,title}
 * - 本地曲库:audio/songs/manifest.json(songs 可随时填充;fetch 失败回退内置空库)
 * - 播放能力:Audio 播放 + EventBus song:start/song:end + toast
 * - 服务端预留:attachSongServer(adapter) 适配器接口,server 未连接时恒走本地曲库
 */
class SongSystem {
    constructor() {
        this._manifest = null;
        this._manifestPromise = null;
        this._audio = null;
        this._current = null;
        this._serverAdapter = null;   // 预留:远端曲库适配器(服务端暂未连接)
        this._bus = window.globalEventBus;
    }

    init() {}

    /** 加载本地曲库清单(懒加载一次;失败回退空库,曲库可后续填充) */
    _loadManifest() {
        if (!this._manifestPromise) {
            this._manifestPromise = fetch('audio/songs/manifest.json')
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null)
                .then(d => (d && Array.isArray(d.songs) ? d : { version: 1, server: null, songs: [] }));
        }
        return this._manifestPromise;
    }

    /** 服务端适配器预留:adapter 需实现 async search(title) → [{id,title,artist,streamUrl}] */
    attachSongServer(adapter) {
        if (adapter && typeof adapter.search === 'function') {
            this._serverAdapter = adapter;
            console.log('[SongSystem] 远端曲库适配器已挂载');
        }
    }

    /** 点歌意图检测(纯逻辑,可单测):命中点歌关键词返回 {raw,title},否则 null */
    detectRequest(text) {
        const t = String(text || '');
        if (!/(点歌|点一首|来一首|来首|放一首|放首|播一首|播放|唱一首|唱首|想听|听歌|听一下)/.test(t)) return null;
        let title = null;
        const q = t.match(/[《「"“](.+?)[》」"”]/);
        if (q) {
            title = q[1].trim();
        } else {
            const m = t.match(/(?:一首|首|播放|放|唱|听)\s*([\u4e00-\u9fa5A-Za-z0-9 ]{2,16})/);
            if (m) {
                title = (m[1] || '').trim().replace(/(这首歌|的歌|歌|吧|好吗|可以吗|谢谢|呢|么|了)+$/, '').trim() || null;
            }
        }
        return { raw: t.slice(0, 48), title: (title && title.length >= 2) ? title : null };
    }

    /** 曲库检索(标题/别名包含匹配);server 适配器接入后优先远端(预留) */
    async search(title) {
        if (!title) return null;
        if (this._serverAdapter) {
            try {
                const r = await this._serverAdapter.search(title);
                if (r && r.length) return r[0];
            } catch (_) { /* 远端失败回落本地 */ }
        }
        const mf = await this._loadManifest();
        const t = String(title).toLowerCase();
        return mf.songs.find(s =>
            (s.title || '').toLowerCase().includes(t) ||
            (s.alias || []).some(a => String(a).toLowerCase().includes(t))) || null;
    }

    /** 播放(本地 file 相对 audio/songs/;远端 streamUrl 预留) */
    play(song) {
        if (!song) return null;
        this.stop();
        this._audio = new Audio(song.file ? 'audio/songs/' + song.file : song.streamUrl);
        this._current = song;
        this._bus && this._bus.emit && this._bus.emit('song:start', { id: song.id, title: song.title, artist: song.artist || '' });
        window.showToast && window.showToast(`🎵 正在为你播放《${song.title}》`, 'success');
        this._audio.onended = () => this.stop();
        this._audio.onerror = () => this.stop();
        this._audio.play().catch(() => this.stop());
        return song;
    }

    stop() {
        if (this._audio) {
            try { this._audio.pause(); } catch (_) {}
            this._audio = null;
            if (this._current) {
                this._bus && this._bus.emit && this._bus.emit('song:end', { id: this._current.id, title: this._current.title });
                this._current = null;
            }
        }
    }

    /** 对话钩子:曲库命中才播(未命中静默——AI 文案已自然回应,曲库后续填充即生效) */
    async maybePlay(req) {
        if (!req) return null;
        const song = await this.search(req.title);
        return song ? this.play(song) : null;
    }
}

window.SongSystem = SongSystem;
window.songPlayer = new SongSystem();
