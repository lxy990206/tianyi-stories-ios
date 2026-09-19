/**
 * TTS语音合成管理
 * 支持 Web Speech API（浏览器）、Android原生TTS（JSBridge → 小米Mimo等）
 * 设计要点：预创建Utterance池、队列化播放、快速首音
 */
class TTSManager {
    constructor() {
        this.enabled = false;
        this.engine = 'auto';       // auto | web-speech | android | mimotts
        this.rate = 1.0;           // 0.5 ~ 2.0
        this.pitch = 1.0;          // 0.5 ~ 2.0
        this.voiceName = '';       // 空=系统默认
        this._synth = null;
        this._voice = null;
        this._queue = [];
        this._speaking = false;
        this._pool = [];           // Utterance 对象池
        this._poolSize = 4;
        this._ready = false;
        this._androidBridge = null;
        this._initPromise = null;
        this._mimoGuard = null;    // mimotts 兜底超时句柄
    }

    // ---- 初始化 ----

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit();
        return this._initPromise;
    }

    async _doInit() {
        // 检测 Android 桥接（engine 已在检测内设置）
        if (this._detectAndroidBridge()) {
            this._ready = true;
            console.log('[TTS] Android桥接已就绪:', this.engine);
            return;
        }

        // 检测 Web Speech API
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            this._synth = window.speechSynthesis;
            this.engine = 'web-speech';
            // 预加载语音列表（异步，不阻塞）
            this._loadVoices();
            // 预建对象池
            this._buildPool();
            this._ready = true;
            console.log('[TTS] Web Speech API 已就绪');
            return;
        }

        console.warn('[TTS] 无可用的语音引擎');
    }

    _detectAndroidBridge() {
        try {
            // 小米 MiMo TTS 原生桥优先（默认克隆洛天依音色）
            if (typeof window.MimoTTS !== 'undefined') {
                const available = !window.MimoTTS.isAvailable || window.MimoTTS.isAvailable();
                if (available) {
                    this._androidBridge = window.MimoTTS;
                    this.engine = 'mimotts';
                    return true;
                }
            }
            if (typeof window.TTSBridge !== 'undefined') {
                // mock 兼容层 isAvailable() 返回 false，避免浏览器中被空实现劫持
                const available = !window.TTSBridge.isAvailable || window.TTSBridge.isAvailable();
                if (available) {
                    this._androidBridge = window.TTSBridge;
                    this.engine = 'android';
                    return true;
                }
            }
        } catch (_) {}
        return false;
    }

    _loadVoices() {
        if (!this._synth) return;
        const voices = this._synth.getVoices();
        if (voices.length) {
            this._selectVoice(voices);
            return;
        }
        // Chrome 需要异步加载
        this._synth.onvoiceschanged = () => {
            const v = this._synth.getVoices();
            this._selectVoice(v);
            this._buildPool();
        };
    }

    _selectVoice(voices) {
        if (this.voiceName) {
            this._voice = voices.find(v => v.name === this.voiceName) || null;
        }
        if (!this._voice) {
            // 优先选中文女声
            this._voice = voices.find(v => v.lang.startsWith('zh') && v.name.includes('Female'))
                || voices.find(v => v.lang.startsWith('zh'))
                || voices.find(v => v.lang.startsWith('en'))
                || voices[0]
                || null;
        }
    }

    // ---- 对象池 ----

    _buildPool() {
        this._pool = [];
        for (let i = 0; i < this._poolSize; i++) {
            const u = new SpeechSynthesisUtterance('');
            u.rate = this.rate;
            u.pitch = this.pitch;
            u.volume = 1;
            if (this._voice) u.voice = this._voice;
            this._pool.push(u);
        }
    }

    _getUtterance(text) {
        let u = this._pool.pop();
        if (!u) {
            u = new SpeechSynthesisUtterance(text);
            u.rate = this.rate;
            u.pitch = this.pitch;
            if (this._voice) u.voice = this._voice;
        } else {
            u.text = text;
        }
        return u;
    }

    _returnUtterance(u) {
        u.onend = null;
        u.onerror = null;
        u.onstart = null;
        if (this._pool.length < this._poolSize) {
            this._pool.push(u);
        }
    }

    // ---- 公开接口 ----

    /**
     * 剥离非语言内容：括号内的动作/心情/场景描写不参与TTS
     * 覆盖半角()、全角（）、未闭合尾部括号及markdown符号
     */
    _stripNonVerbal(text) {
        return text
            .replace(/\([^()]*\)/g, '')    // 半角括号对
            .replace(/（[^（）]*）/g, '')    // 全角括号对
            .replace(/\([^()]*$/g, '')      // 未闭合半角(常见于句尾动作描写)
            .replace(/（[^（）]*$/g, '')     // 未闭合全角
            .replace(/[*_~`#\[\]]/g, '')    // markdown符号
            .replace(/[()（）]/g, '')       // 残留的孤立括号
            .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '') // emoji/装饰符号(138 一致性:符号引发韵律漂移)
            .replace(/([。！？!?，,、；;：:])[。！？!?，,、；;：:]+/g, '$1')  // 标点连排(含全半角混合)收敛到首个
            .replace(/!{2,}/g, '！').replace(/！{2,}/g, '！')
            .replace(/\?{2,}/g, '？').replace(/？{2,}/g, '？')
            .replace(/\s{2,}/g, ' ')       // 压缩多余空白
            .trim();
    }

    /**
     * 朗读文本
     * @param {string} text 要朗读的文本
     * @param {string} type 类型：'chat'(对话) | 'story'(剧情) | 'ui'(界面)
     */
    speak(text, type = 'chat') {
        if (!this.enabled || !this._ready || !text) return;

        // 剥离括号内动作/心情描写等非语言内容
        const clean = this._stripNonVerbal(text);
        if (!clean) return;

        // mimotts 原生引擎：整段一次合成（单请求单采样，保证整句韵律连贯）；
        // Web Speech 引擎：维持长句按标点切分排队（浏览器合成器对超长文本不稳）
        const segments = this.engine === 'mimotts' ? [clean] : this._splitText(clean);

        // 加入队列
        this._queue.push(...segments.map(s => ({ text: s, type })));

        // 触发播放
        if (!this._speaking) this._playNext();
    }

    /**
     * 立即朗读（清空队列）
     */
    speakNow(text, type = 'chat') {
        this.stop();
        this.speak(text, type);
    }

    /**
     * 试听预览：无视「启用语音播报」开关，整段文本一次合成
     * （MiMo 单次请求产出连续音频，比切片排队更连贯）
     */
    preview(text) {
        if (!this._ready || !text) return;
        const clean = this._stripNonVerbal(text);
        if (!clean) return;
        this.stop();
        const wasEnabled = this.enabled;
        this.enabled = true; // speak 检查 enabled，试听强制生效
        this._queue.push({ text: clean, type: 'ui' }); // 不切片，整段合成
        if (!this._speaking) this._playNext();
        this.enabled = wasEnabled;
        console.log('[TTS] 试听预览,引擎:', this.engine);
    }

    /**
     * 停止播放并清空队列
     */
    stop() {
        this._queue.length = 0;
        if (this._synth) {
            this._synth.cancel();
        }
        if (this._androidBridge && this._androidBridge.stop) {
            this._androidBridge.stop();
        }
        clearTimeout(this._mimoGuard);
        this._mimoGuard = null;
        this._speaking = false;
    }

    // ---- 内部播放 ----

    _splitText(text) {
        if (text.length <= 80) return [text];
        const result = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= 80) {
                result.push(remaining);
                break;
            }
            // 在最近的标点处分割
            let cut = 80;
            for (let i = 80; i >= 40; i--) {
                if (/[，。！？；：、,\.!\?;:]/.test(remaining[i])) {
                    cut = i + 1;
                    break;
                }
            }
            result.push(remaining.substring(0, cut));
            remaining = remaining.substring(cut);
        }
        return result;
    }

    _playNext() {
        if (this._queue.length === 0) {
            this._speaking = false;
            return;
        }

        this._speaking = true;
        const { text, type } = this._queue.shift();

        if (this.engine === 'android' || this.engine === 'mimotts') {
            this._speakAndroid(text, type);
        } else {
            this._speakWeb(text);
        }
    }

    _speakWeb(text) {
        const u = this._getUtterance(text);
        u.onstart = () => {
            // Web Speech: 播放开始(时长按文本长度估算),供前端文字同步显现
            if (window.globalEventBus) {
                window.globalEventBus.emit('tts:start', { duration: Math.max(1200, text.length * 260) });
            }
        };
        u.onend = () => {
            if (window.globalEventBus) window.globalEventBus.emit('tts:done', {});
            this._returnUtterance(u);
            this._playNext();
        };
        u.onerror = (e) => {
            if (e.error !== 'interrupted') {
                console.warn('[TTS] 播放错误:', e.error);
            }
            if (window.globalEventBus) window.globalEventBus.emit('tts:done', {});
            this._returnUtterance(u);
            this._playNext();
        };
        this._synth.speak(u);
    }

    _speakAndroid(text, type) {
        if (!this._androidBridge) {
            // 浏览器中手动选择 mimotts 等原生引擎时，回退 Web Speech
            if (this._synth) {
                this._speakWeb(text);
                return;
            }
            this._playNext();
            return;
        }
        try {
            if (this._androidBridge.speak) {
                this._androidBridge.speak(text, type, this.rate, this.pitch);
            } else {
                this._playNext();
                return;
            }
        } catch (e) {
            console.warn('[TTS] Android桥接调用失败:', e);
            this._playNext();
            return;
        }

        if (this.engine === 'mimotts') {
            // MiMo: 等待原生播放完成回调(onDone/onError)推进队列。
            // 兜底超时随整段文本长度自适应:需覆盖原生合成读超时(240s)+播放时长(约300ms/字),
            // 保证原生仍在合成/播放时前端不抢先推进;仅在原生回调彻底丢失时兜底
            clearTimeout(this._mimoGuard);
            this._mimoGuard = setTimeout(() => {
                console.warn('[TTS] mimotts 兜底超时,强制推进队列');
                this._playNext();
            }, 330000 + text.length * 300);
        } else {
            // 旧版原生TTS: 无完成回调,按估算时长推进
            const estDuration = Math.max(500, text.length * 80); // 约80ms/字
            setTimeout(() => this._playNext(), estDuration);
        }
    }

    // ---- 配置 ----

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) this.stop();
    }

    setRate(rate) {
        this.rate = Math.max(0.5, Math.min(2.0, rate));
        this._pool.forEach(u => { u.rate = this.rate; });
    }

    setPitch(pitch) {
        this.pitch = Math.max(0.5, Math.min(2.0, pitch));
        this._pool.forEach(u => { u.pitch = this.pitch; });
    }

    setVoice(name) {
        this.voiceName = name;
        if (this._synth) {
            const voices = this._synth.getVoices();
            this._selectVoice(voices);
            this._pool.forEach(u => { if (this._voice) u.voice = this._voice; });
        }
    }

    setEngine(engine) {
        this.engine = engine;
        if (engine === 'mimotts' && this._androidBridge) {
            // 通知原生层使用洛天依克隆音色
            this._androidBridge.setEngine?.('voiceclone');
        }
    }

    /**
     * 获取可用语音列表（仅 Web Speech API）
     */
    getVoices() {
        if (!this._synth) return [];
        return this._synth.getVoices().map(v => ({
            name: v.name,
            lang: v.lang,
            default: v.default
        }));
    }

    /**
     * Android 端播放完成回调
     */
    onAndroidSpeakDone() {
        clearTimeout(this._mimoGuard);
        this._mimoGuard = null;
        if (window.globalEventBus) window.globalEventBus.emit('tts:done', {});
        this._playNext();
    }

    /**
     * Android 端播放开始回调(携带音频时长 ms)
     * 广播 tts:start,供聊天文字与语音同步逐字显现
     */
    onAndroidSpeakStart(durationMs) {
        if (window.globalEventBus) {
            window.globalEventBus.emit('tts:start', { duration: Number(durationMs) || 0 });
        }
    }
}

window.TTSManager = TTSManager;