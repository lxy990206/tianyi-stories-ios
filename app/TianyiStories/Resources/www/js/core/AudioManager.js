/**
 * 音频管理：使用 Web Audio API + Audio 元素。
 * 音效用程序生成（短促合成），避免引入外部音频文件。
 */
class AudioManager {
    constructor() {
        this.ctx = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.currentMusic = null;
        this.musicVolume = 0.7;
        this.sfxVolume = 0.8;
        this.muted = false;
        this._initialized = false;
    }

    init() {
        if (this._initialized) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
            this.musicGain = this.ctx.createGain();
            this.musicGain.gain.value = this.musicVolume;
            this.musicGain.connect(this.ctx.destination);
            this.sfxGain = this.ctx.createGain();
            this.sfxGain.gain.value = this.sfxVolume;
            this.sfxGain.connect(this.ctx.destination);
            this._initialized = true;
        } catch (e) {
            console.warn('[AudioManager] 初始化失败:', e);
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    pause() {
        if (this.ctx) this.ctx.suspend();
    }

    setMusicVolume(v) { this.musicVolume = v; if (this.musicGain) this.musicGain.gain.value = v; }
    setSfxVolume(v) { this.sfxVolume = v; if (this.sfxGain) this.sfxGain.gain.value = v; }

    playUISound(name) {
        if (!this._initialized) return;
        const freq = { success: 880, notification: 660, error: 220, click: 440 }[name] || 440;
        const duration = 0.12;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.001, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.3, this.ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        o.connect(g); g.connect(this.sfxGain);
        o.start();
        o.stop(this.ctx.currentTime + duration);
    }

    playMusic(name) {
        if (!this._initialized) return;
        if (this.currentMusic) try { this.currentMusic.stop(); } catch (_) {}
        // 合成一段柔和循环
        const now = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        const g = this.ctx.createGain();
        o.type = name === 'sad' ? 'minor' : 'sine';
        o.frequency.value = name === 'sad' ? 220 : 440;
        lfo.frequency.value = 0.3;
        lfoGain.gain.value = 20;
        lfo.connect(lfoGain); lfoGain.connect(o.frequency);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.15, now + 1);
        o.connect(g); g.connect(this.musicGain);
        o.start(); lfo.start();
        this.currentMusic = { stop: () => { try { o.stop(); lfo.stop(); } catch (_) {} } };
    }
}

window.AudioManager = AudioManager;
