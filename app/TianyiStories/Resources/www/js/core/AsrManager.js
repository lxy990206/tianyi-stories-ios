/**
 * 语音识别(ASR)管理器
 * 双引擎:cloud(硅基流动 SenseVoiceSmall,原生桥上传) / device(端侧 FunASR,动态下载模型包)
 * 状态机: idle → requesting_permission → starting → recording → recognizing → idle
 * 原生回调契约(window.TianyiASRCallback)由本文件注册并路由到 window.asrManager
 */
class AsrManager {
    constructor() {
        this.state = 'idle';        // idle | requesting_permission | recording | recognizing
        this.engine = 'off';        // off | cloud | device
        this._settings = null;
        // 205:DOM 目标参数化——同一识别器实例服务聊天页与 Live2D 页两套输入 UI,
        //     页面侧在点击麦克风时 setDomTarget 绑定本页输入框/按钮/状态条(页面互斥,无状态残留)
        this._domTarget = { input: 'chat-input', button: 'chat-mic-btn', status: 'chat-status' };
        this._registerNativeCallback();
    }

    /** 205:切换识别结果落点(输入框 id/麦克风按钮 id/状态条 id),缺省=聊天页三件套 */
    setDomTarget(inputId, buttonId, statusId) {
        this._domTarget = {
            input: inputId || 'chat-input',
            button: buttonId || 'chat-mic-btn',
            status: statusId || 'chat-status',
        };
        this._syncMicButton();
    }

    init(settingsManager) {
        this._settings = settingsManager;
        const saved = settingsManager?.state?.asrEngine;
        if (saved) this.engine = saved;
        this._bindSettingsUI();
        this.refreshEngineStatus();
        this._syncMicButton();
    }

    setEngine(engine) {
        this.engine = engine;
        this._syncMicButton();
    }

    /** 麦克风按钮主入口:开始/停止 */
    toggleRecord() {
        if (!window.TianyiASR) {
            window.showToast?.('语音输入仅 Android 端可用', 'error');
            return;
        }
        if (this.engine === 'off') {
            window.showToast?.('请先在 设置→语音 中开启语音识别引擎', 'error');
            return;
        }
        if (this.state === 'recording' || this.state === 'recognizing') {
            if (this.state === 'recording') window.TianyiASR.stopRecording();
            return;
        }
        if (this.state !== 'idle') return;
        window.TianyiASR.startRecording(this.engine === 'device' ? 'device' : 'cloud');
    }

    // ---- 原生回调(由 window.TianyiASRCallback 路由) ----

    _onRecordStart() {
        this.state = 'recording';
        this._syncMicButton();
        this._setStatus('聆听中…再次点击结束', 'thinking');
    }

    _onLevel(percent) {
        const btn = document.getElementById(this._domTarget.button);
        if (btn && this.state === 'recording') {
            btn.style.setProperty('--mic-level', String(Math.max(8, Math.min(100, percent | 0))));
        }
    }

    _onState(state) {
        if (state === 'requesting_permission') {
            this.state = 'requesting_permission';
            this._setStatus('等待麦克风权限…', 'thinking');
        } else if (state === 'recognizing') {
            this.state = 'recognizing';
            this._syncMicButton();
            this._setStatus('识别中…', 'thinking');
        } else if (state === 'starting') {
            this.state = 'starting';
        } else if (state === 'cancelled') {
            this.state = 'idle';
            this._syncMicButton();
            this._setStatus('', '');
        }
    }

    _onResult(text) {
        this.state = 'idle';
        this._syncMicButton();
        this._setStatus('', '');
        if (!text) {
            window.showToast?.('没有听清,再试一次吗?', 'error');
            return;
        }
        // 专有名词校正:云端/端侧 ASR 均常把「天依」识作「天一」(语音识别通病)
        text = text.replace(/天一/g, '天依');
        // 专属优化词校正(1.1.12/133):V 家及相关角色名 ASR 同音误标——长词优先,防子串误伤
        text = AsrManager.optimizeTerms(text);
        // 填入输入框供确认/编辑后发送(不自动发送,避免误识别直接发出)
        // 205:落点=当前 DOM 目标(聊天页 chat-input 或 Live2D 页 l2-chat-input)
        const input = document.getElementById(this._domTarget.input);
        if (!input) return;
        input.value = input.value ? input.value + text : text;
        input.focus();
    }

    _onError(message) {
        this.state = 'idle';
        this._syncMicButton();
        this._setStatus('', '');
        window.showToast?.(message || '语音识别失败', 'error');
    }

    _onDownloadProgress(json) {
        try {
            const d = JSON.parse(json);
            this._renderPackRow(d.packId, d);
            if (d.state === 'ready') {
                window.showToast?.('端侧模型下载完成', 'success');
                this.refreshEngineStatus();
            } else if (d.state === 'deleted') {
                window.showToast?.('端侧模型已删除,本地文件已清理', 'success');
            } else if (d.state === 'failed') {
                window.showToast?.('端侧模型操作失败', 'error');
            }
        } catch (_) {}
    }

    // ---- 设置面板(端侧模型包下载 UI) ----

    async refreshEngineStatus() {
        if (!window.TianyiASR) return;
        try {
            const status = JSON.parse(window.TianyiASR.getEngineStatus() || '{}');
            (status.packs || []).forEach(p => {
                this._renderPackRow(p.id, {
                    packId: p.id,
                    state: p.status === 'ready' ? 'ready' : (p.status === 'downloading' ? 'downloading' : p.status),
                    percent: p.percent || 0,
                    enabled: p.enabled,
                    engineAvailable: status.engineAvailable
                });
            });
            const hint = document.getElementById('asr-device-hint');
            if (hint) {
                const rt = (status.packs || []).find(p => p.id === 'asr-runtime');
                if (status.engineAvailable) {
                    hint.textContent = '端侧引擎已就绪,识别完全离线;运行时/模型包可随时删除释放空间';
                } else if (!rt || rt.status !== 'ready') {
                    hint.textContent = '端侧识别需先下载「端侧引擎运行时」(约20MB)与识别模型;仅用云端识别则无需下载';
                } else {
                    hint.textContent = '运行时已就绪,下载识别模型后即可离线识别';
                }
            }
        } catch (_) {}
    }

    /**
     * 模型包行状态渲染(状态机:未下载→下载中→已就绪→删除中→未下载)
     * ready 态按钮变为「删除」;enabled=false 的预留包保持禁用(不会误启用)
     */
    _renderPackRow(packId, d) {
        const row = document.getElementById('asr-pack-' + packId);
        if (!row) return;
        const statusEl = row.querySelector('.asr-pack-status');
        const btn = row.querySelector('.asr-pack-btn');
        if (!statusEl) return;
        const enabled = d.enabled !== false;
        const setBtn = (text, action, dis) => {
            if (!btn) return;
            btn.textContent = text;
            btn.dataset.action = action;
            btn.disabled = !!dis;
        };
        if (d.state === 'downloading') {
            statusEl.textContent = `下载中 ${d.percent || 0}%`;
            setBtn('下载', 'download', true);
        } else if (d.state === 'deleting') {
            statusEl.textContent = '删除中…';
            setBtn('删除', 'delete', true);
        } else if (d.state === 'ready') {
            statusEl.textContent = '✓ 已就绪';
            setBtn('删除', 'delete', false);
        } else if (d.state === 'failed') {
            statusEl.textContent = '操作失败,可重试';
            setBtn('下载', 'download', false);
        } else {
            // deleted / not_downloaded / 未知态:未下载(enabled=false 显示预留并禁用)
            statusEl.textContent = '未下载';
            setBtn(enabled ? '下载' : '预留', 'download', !enabled);
        }
    }

    _bindSettingsUI() {
        // 引擎选择
        const select = document.getElementById('asr-engine-select');
        if (select) {
            select.value = this.engine;
            select.onchange = () => {
                this.setEngine(select.value);
                if (this._settings) this._settings.set('asrEngine', select.value);
            };
        }
        // 模型包按钮:按当前 dataset.action 分发(下载 / 删除)
        document.querySelectorAll('.asr-pack-btn[data-pack]').forEach(btn => {
            if (!btn.dataset.action) btn.dataset.action = 'download';
            btn.addEventListener('click', () => {
                if (!window.TianyiASR) {
                    window.showToast?.('仅 Android 端支持端侧模型', 'error');
                    return;
                }
                if (btn.dataset.action === 'delete') {
                    if (window.confirm('确认删除端侧模型文件?删除后可随时重新下载。')) {
                        btn.disabled = true;
                        window.TianyiASR.deleteModel(btn.dataset.pack);
                    }
                    return;
                }
                // 识别模型下载前置门控:运行时未就绪时先引导下载运行时
                if (btn.dataset.pack !== 'asr-runtime') {
                    try {
                        const st = JSON.parse(window.TianyiASR.getEngineStatus() || '{}');
                        const rt = (st.packs || []).find(p => p.id === 'asr-runtime');
                        if (st.engineAvailable !== true && (!rt || rt.status !== 'ready')) {
                            window.showToast?.('请先下载「端侧引擎运行时」,再下载识别模型', 'error');
                            return;
                        }
                    } catch (_) {}
                }
                btn.disabled = true;
                window.TianyiASR.downloadModel(btn.dataset.pack);
            });
        });
        // 面板打开时刷新状态
        const voicePanel = document.querySelector('.settings-tab-panel[data-panel="voice"]');
        if (voicePanel && !voicePanel._asrObserved) {
            voicePanel._asrObserved = true;
            const mo = new MutationObserver(() => {
                if (voicePanel.style.display !== 'none') this.refreshEngineStatus();
            });
            mo.observe(voicePanel, { attributes: true, attributeFilter: ['style'] });
        }
    }

    // ---- UI 辅助 ----

    _syncMicButton() {
        const btn = document.getElementById(this._domTarget.button);
        if (!btn) return;
        if (this.engine === 'off' || !window.TianyiASR) {
            btn.style.display = 'none';
            return;
        }
        btn.style.display = '';
        btn.classList.toggle('recording', this.state === 'recording');
        btn.classList.toggle('busy', this.state === 'recognizing' || this.state === 'starting'
            || this.state === 'requesting_permission');
        if (this.state !== 'recording') btn.style.removeProperty('--mic-level');
    }

    _setStatus(text, cls) {
        const status = document.getElementById(this._domTarget.status);
        if (!status) return;
        status.textContent = text;
        status.className = text ? ('chat-status ' + (cls || '')) : 'chat-status';
    }

    _registerNativeCallback() {
        if (typeof window === 'undefined') return;
        window.TianyiASRCallback = {
            onRecordStart: () => this._onRecordStart(),
            onLevel: (p) => this._onLevel(Number(p) || 0),
            onState: (s) => this._onState(String(s || '')),
            onResult: (t) => this._onResult(String(t || '')),
            onError: (m) => this._onError(String(m || '')),
            onDownloadProgress: (j) => this._onDownloadProgress(String(j || '{}')),
            onEngineStatus: () => this.refreshEngineStatus()
        };
    }
    /**
     * 专属优化词字典(1.1.12/133):识别结果后处理,把 V 家/相关角色名的常见同音
     * 误标替换为正确写法。双引擎通用(云端/端侧 ASR 均无 hotword 接口,后处理为
     * 通用方案;词条依真机实测持续增补)。**必须长词在前**——「乐正隆牙」先于
     * 「隆牙」、「徵羽魔柯」先于「魔柯」,否则子串替换会破坏长词。
     */
    static optimizeTerms(text) {
        if (!text) return text;
        for (const [from, to] of AsrManager.TERM_FIXES) {
            if (text.includes(from)) text = text.split(from).join(to);
        }
        return text;
    }
}

// 优化词表(误标 → 正确):长词全部排在短词之前
AsrManager.TERM_FIXES = [
    // 乐正龙牙(长词形态优先)
    ['乐正隆牙', '乐正龙牙'], ['乐正龙呀', '乐正龙牙'], ['乐正龙崖', '乐正龙牙'], ['乐正龙芽', '乐正龙牙'],
    // 徵羽摩柯(长词形态优先)
    ['徵羽魔柯', '徵羽摩柯'], ['徵羽莫柯', '徵羽摩柯'], ['徵羽摩科', '徵羽摩柯'],
    ['智羽摩柯', '徵羽摩柯'], ['志羽摩柯', '徵羽摩柯'], ['徵羽摩卡', '徵羽摩柯'],
    // 墨清玄(长词形态优先)
    ['莫清玄', '墨清玄'], ['墨清悬', '墨清玄'], ['墨青玄', '墨清玄'], ['莫清悬', '墨清玄'], ['墨清轩', '墨清玄'], ['默清玄', '墨清玄'],
    // 初音未来(长词形态优先)
    ['竹音未来', '初音未来'], ['出音未来', '初音未来'],
    // 乐正绫
    ['乐正玲', '乐正绫'], ['乐正凌', '乐正绫'], ['乐正灵', '乐正绫'], ['乐正铃', '乐正绫'],
    // 阿绫
    ['阿玲', '阿绫'], ['阿凌', '阿绫'], ['阿灵', '阿绫'], ['阿铃', '阿绫'],
    // 摩可(单称,须在长词之后)
    ['魔可', '摩可'], ['莫可', '摩可'], ['摩科', '摩可'], ['魔柯', '摩可'], ['莫柯', '摩可'],
    // 墨姐
    ['默姐', '墨姐'], ['莫姐', '墨姐'],
    // 龙牙(单称,须在乐正龙牙之后)
    ['龙呀', '龙牙'], ['隆牙', '龙牙'], ['龙崖', '龙牙'], ['龙芽', '龙牙'],
    // 大小写规范(中V/日V/老V/MIKU)
    ['miku', 'MIKU'], ['密库', 'MIKU'], ['米库', 'MIKU'],
    ['老v', '老V'], ['中v', '中V'], ['日v', '日V'],
];

window.AsrManager = AsrManager;
