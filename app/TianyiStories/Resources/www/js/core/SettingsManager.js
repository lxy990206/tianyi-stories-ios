/**
 * 设置管理：音乐/音效音量、自动保存、语音TTS等
 */

// TTS 试听文本：演唱会感言（固定台词，走当前引擎整段合成）
const TTS_PREVIEW_TEXT = '如果天依是拥有时间魔法的魔女，真想让时间永远停留在这一刻，也许在万千的演唱会中，天依的这场并没有那么特别，甚至会被许多人误解，天依相信只要有热爱，只要我还能继续歌唱，只要大家都能愿意聆听，这一切就是最美好最幸福的存在。在舞台上，天依看着你们就像一颗颗微小但闪耀的星辰，但此刻汇聚成星海，而当人潮散去，又将在属于自己的世界里闪闪发光。谢谢大家今晚的到来，对天依来说，你们就是我的共鸣者们，是我想深深刻印在记忆里，但没有办法辨出每一个名字的珍贵存在，接下来的这首歌大家和天依一起唱好吗！就算无法让大雨停下，就算无法被世界回答，我会陪你在雨里放肆奔跑，我会在身边一遍遍对你说，我爱你！';

class SettingsManager {
    constructor() {
        this.defaults = {
            musicVolume: 0.7,
            sfxVolume: 0.8,
            autoSave: true,
            voiceEnabled: false,
            ttsEnabled: true,
            ttsRate: 1.0,
            ttsPitch: 1.0,
            asrEngine: 'off',
            crossSenseEnabled: true,   // 跨时空感应【时空回响】（世界观彩蛋，云端激活；本地恒空）
            perfAnimation: 'auto',     // 性能适配-动画: auto=跟随设备分级 | off=强制无动画 | full=强制完整动画(1.1.12/134)
            perfMemory: 'auto',        // 性能适配-内存: auto=跟随设备分级 | on=强制开启 | off=关闭(1.1.12/134)
            cloudSync: { server: '', token: '' },   // 云同步预留（服务器未上线；token 实际存原生 SecureStore）
            llm: { mode: 'LOCAL', baseURL: 'http://10.0.2.2:11434', apiKey: '', modelName: 'qwen3:8b' }
        };
        this.state = { ...this.defaults };
        this.audioManager = null;
        this.ttsManager = null;
        this._bindings = [];
    }

    init(audioManager, ttsManager) {
        // GameEngine 统一初始化会以 init(engine) 单参数回调各模块，
        // 此时保留已注入的管理器，仅刷新状态与UI绑定
        if (audioManager && ttsManager) {
            this.audioManager = audioManager;
            this.ttsManager = ttsManager;
        }
        this._load();
        this._applyTTS();
        this._bindUI();
    }

    _load() {
        try {
            const raw = localStorage.getItem('tianyi_settings');
            if (raw) this.state = { ...this.defaults, ...JSON.parse(raw) };
        } catch (_) {}
    }

    _save() {
        try { localStorage.setItem('tianyi_settings', JSON.stringify(this.state)); } catch (_) {}
    }

    _bindUI() {
        // 先解绑旧监听，防止重复初始化（GameEngine 统一 init 回调）造成监听器堆积
        this._bindings.forEach(off => off());
        this._bindings = [];
        const musicSlider = document.getElementById('setting-music');
        const sfxSlider = document.getElementById('setting-sfx');
        const autoSaveCheck = document.getElementById('setting-autosave');
        if (musicSlider) {
            musicSlider.value = Math.round(this.state.musicVolume * 100);
            const handler = e => { this.set('musicVolume', e.target.value / 100); };
            musicSlider.addEventListener('input', handler);
            this._bindings.push(() => musicSlider.removeEventListener('input', handler));
        }
        if (sfxSlider) {
            sfxSlider.value = Math.round(this.state.sfxVolume * 100);
            const handler = e => { this.set('sfxVolume', e.target.value / 100); };
            sfxSlider.addEventListener('input', handler);
            this._bindings.push(() => sfxSlider.removeEventListener('input', handler));
        }
        if (autoSaveCheck) {
            autoSaveCheck.checked = this.state.autoSave;
            const handler = e => this.set('autoSave', e.target.checked);
            autoSaveCheck.addEventListener('change', handler);
            this._bindings.push(() => autoSaveCheck.removeEventListener('change', handler));
        }
        // 时空感应开关（跨时空回响；云端激活，本地恒空）
        const crossSenseCheck = document.getElementById('setting-cross-sense');
        if (crossSenseCheck) {
            crossSenseCheck.checked = this.state.crossSenseEnabled !== false;
            const csHandler = e => this.set('crossSenseEnabled', e.target.checked);
            crossSenseCheck.addEventListener('change', csHandler);
            this._bindings.push(() => crossSenseCheck.removeEventListener('change', csHandler));
        }
        // 性能适配-动画(1.1.12/134):用户手动选择降级档时弹窗确认(会影响使用体验)
        const perfAnimSel = document.getElementById('setting-perf-anim');
        if (perfAnimSel) {
            perfAnimSel.value = this.state.perfAnimation || 'auto';
            const paHandler = e => {
                const v = e.target.value;
                if (v === 'off' && this.state.perfAnimation !== 'off'
                    && !window.confirm('关闭全部动画会显著降低观感(过渡、特效、加载动画全部停用),可能影响使用体验。确定开启吗?')) {
                    e.target.value = this.state.perfAnimation || 'auto';
                    return;
                }
                this.set('perfAnimation', v);
                window.applyPerformanceSettings && window.applyPerformanceSettings();
            };
            perfAnimSel.addEventListener('change', paHandler);
            this._bindings.push(() => perfAnimSel.removeEventListener('change', paHandler));
        }
        // 性能适配-内存(1.1.12/134):手动开启时弹窗确认
        const perfMemSel = document.getElementById('setting-perf-memory');
        if (perfMemSel) {
            perfMemSel.value = this.state.perfMemory || 'auto';
            const pmHandler = e => {
                const v = e.target.value;
                if (v === 'on' && this.state.perfMemory !== 'on'
                    && !window.confirm('开启内存优化将限制聊天记录驻留条数、降低开场图片清晰度,可能影响使用体验。确定开启吗?')) {
                    e.target.value = this.state.perfMemory || 'auto';
                    return;
                }
                this.set('perfMemory', v);
                window.applyPerformanceSettings && window.applyPerformanceSettings();
            };
            perfMemSel.addEventListener('change', pmHandler);
            this._bindings.push(() => perfMemSel.removeEventListener('change', pmHandler));
        }
        this._bindTTS();
    }

    set(key, value) {
        this.state[key] = value;
        this._save();
        if (this.audioManager) {
            if (key === 'musicVolume') this.audioManager.setMusicVolume(value);
            if (key === 'sfxVolume') this.audioManager.setSfxVolume(value);
        }
        if (this.ttsManager) {
            if (key === 'ttsEnabled') this.ttsManager.setEnabled(value);
            if (key === 'ttsRate') this.ttsManager.setRate(value);
            if (key === 'ttsPitch') this.ttsManager.setPitch(value);
        }
    }

    _applyTTS() {
        if (!this.ttsManager) return;
        this.ttsManager.setEnabled(this.state.ttsEnabled);
        this.ttsManager.setRate(this.state.ttsRate);
        this.ttsManager.setPitch(this.state.ttsPitch);
    }

    _bindTTS() {
        if (!this.ttsManager) return;
        const toggle = document.getElementById('voice-feature-toggle');
        const rateSlider = document.getElementById('tts-rate');
        const pitchSlider = document.getElementById('tts-pitch');
        const testBtn = document.getElementById('tts-test-btn');

        if (toggle) {
            toggle.checked = this.state.ttsEnabled;
            const h = e => this.set('ttsEnabled', e.target.checked);
            toggle.addEventListener('change', h);
            this._bindings.push(() => toggle.removeEventListener('change', h));
        }
        if (rateSlider) {
            rateSlider.value = this.state.ttsRate;
            const rateLabel = document.getElementById('tts-rate-label');
            if (rateLabel) rateLabel.textContent = this.state.ttsRate.toFixed(1) + 'x';
            const h = e => {
                const v = parseFloat(e.target.value);
                this.set('ttsRate', v);
                const lbl = document.getElementById('tts-rate-label');
                if (lbl) lbl.textContent = v.toFixed(1) + 'x';
            };
            rateSlider.addEventListener('input', h);
            this._bindings.push(() => rateSlider.removeEventListener('input', h));
        }
        if (pitchSlider) {
            pitchSlider.value = this.state.ttsPitch;
            const pitchLabel = document.getElementById('tts-pitch-label');
            if (pitchLabel) pitchLabel.textContent = this.state.ttsPitch.toFixed(1);
            const h = e => {
                const v = parseFloat(e.target.value);
                this.set('ttsPitch', v);
                const lbl = document.getElementById('tts-pitch-label');
                if (lbl) lbl.textContent = v.toFixed(1);
            };
            pitchSlider.addEventListener('input', h);
            this._bindings.push(() => pitchSlider.removeEventListener('input', h));
        }
        if (testBtn && this.ttsManager) {
            testBtn.onclick = () => {
                // 调用当前引擎后端整段合成试听文本（不受语音开关限制）
                this.ttsManager?.preview(TTS_PREVIEW_TEXT);
            };
        }
        const engineSelect = document.getElementById('tts-engine-select');
        if (engineSelect) {
            engineSelect.value = this.ttsManager.engine || 'auto';
            const h = e => {
                this.ttsManager?.setEngine(e.target.value);
            };
            engineSelect.addEventListener('change', h);
            this._bindings.push(() => engineSelect.removeEventListener('change', h));
        }
    }

    get(key) { return this.state[key]; }
    getAll() { return { ...this.state }; }
}

window.SettingsManager = SettingsManager;
