/**
 * 游戏引擎 - 模块注册表 + 渲染循环
 * 保留核心生命周期 / 模块调用。
 *
 * 发热优化(展锐低端机):
 * ① 可见性暂停——切后台 cancelAnimationFrame 彻底停循环(零 CPU),回前台恢复;
 *    恢复首帧 dt=隐藏时长,CoinSystem 被动收益按墙钟自然补偿(上限 1h 防异常值)。
 * ② 低性能空闲降频——low-perf 且无交互 30s 后,主循环从 rAF 降为 10fps
 *    setTimeout 心跳;任意交互即恢复 rAF。
 *    安全依据:全 assets 无 onTick 订阅者;update 仅 CoinSystem(累积数学,
 *    任意 dt 安全)/CharacterSystem(无 dt 依赖)/TimeSystem(空实现);
 *    文字逐字显现/TTS/AI 请求均走独立计时器,不受主循环影响。
 */
class GameEngine {
    constructor() {
        this.modules = new Map();
        this.initOrder = [];
        this.initialized = false;
        this.ticker = null;
        this.tickerCallbacks = new Set();
        this.lastTime = 0;
        this.elapsed = 0;
        this.paused = false;
        this._destroyed = false;
        // —— 发热优化运行时状态 ——
        this._rafId = null;          // 活动态 rAF 句柄
        this._idleTimerId = null;    // 空闲心跳 setTimeout 句柄
        this._hidden = false;        // 页面不可见(visibilitychange)
        this._lastInteraction = 0;  // 最近一次用户交互时刻
        this._lowPerf = false;       // 低性能设备(compat.js 检测)
        this._idleDelay = 100;       // 空闲心跳间隔 ms(~10fps)
        this._idleThreshold = 30000; // 无交互判定阈值 ms
    }

    addModule(name, instance) {
        this.modules.set(name, instance);
        this.initOrder.push(name);
        return this;
    }

    getModule(name) {
        return this.modules.get(name);
    }

    hasModule(name) {
        return this.modules.has(name);
    }

    async init() {
        console.log('[GameEngine] 开始初始化，模块:', [...this.modules.keys()].join(', '));
        for (const name of this.initOrder) {
            const m = this.modules.get(name);
            if (!m) continue;
            try {
                if (typeof m.init === 'function') {
                    const r = m.init(this);
                    if (r && typeof r.then === 'function') await r;
                }
                console.log(`[GameEngine] ✓ ${name}`);
            } catch (e) {
                console.error(`[GameEngine] ✗ ${name}:`, e);
            }
        }
        this.initialized = true;
        return true;
    }

    start() {
        this.lastTime = performance.now();
        this._lastInteraction = performance.now();
        this._lowPerf = (window.__isLowPerf === true)
            || document.documentElement.classList.contains('low-perf');
        // 智能适配分档(1.1.10/131,DeviceTier):tier0 极低配(SL8541E 级)空闲 15s
        // 即降 5fps 心跳;tier1/未知维持 130 行为(30s/10fps);现代内核无空闲降频
        const tier = window.__deviceTier;
        if (tier === 0) { this._idleThreshold = 15000; this._idleDelay = 200; }
        this._bindLifecycle();
        this._loop();
        console.log('[GameEngine] 渲染循环已启动 lowPerf=' + this._lowPerf
            + ' tier=' + tier + ' idle=' + this._idleThreshold + 'ms/' + this._idleDelay + 'ms');
    }

    /* 挂全局生命周期监听:可见性 + 用户交互标记(交互标记用于空闲降频恢复) */
    _bindLifecycle() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this._onHidden();
            else this._onVisible();
        });
        const markActive = () => { this._lastInteraction = performance.now(); };
        ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(ev => {
            document.addEventListener(ev, markActive, { passive: true });
        });
    }

    _onHidden() {
        this._hidden = true;
        this._cancelPendingFrames();
    }

    _onVisible() {
        if (!this._hidden) return;
        this._hidden = false;
        this._lastInteraction = performance.now();
        // lastTime 保持隐藏前的旧值:恢复首帧 dt=隐藏时长,被动收益按墙钟补偿
        this._scheduleNext();
    }

    _cancelPendingFrames() {
        if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        if (this._idleTimerId !== null) { clearTimeout(this._idleTimerId); this._idleTimerId = null; }
    }

    _loop() {
        this._rafId = null;
        this._idleTimerId = null;
        if (this._destroyed || this._hidden) return;
        const now = performance.now();
        let dt = now - this.lastTime;
        this.lastTime = now;
        if (dt > 3600000) dt = 3600000; // 隐藏补偿上限 1h,防异常大值
        if (!this.paused) {
            this.elapsed += dt;
            for (const m of this.modules.values()) {
                if (typeof m.update === 'function') {
                    try { m.update(dt / 1000, this); } catch (e) { console.warn('Module update error:', e); }
                }
            }
            for (const cb of this.tickerCallbacks) {
                try { cb(dt, this.elapsed); } catch (e) { console.warn('Ticker cb error:', e); }
            }
        }
        this._scheduleNext();
    }

    /* 空闲判定:仅低性能设备启用(现代内核 rAF 成本低,保持既有行为不变);
     * 活跃读取全局标志(1.1.12/134):设置-性能适配变更后即时生效,无需重启 */
    _isIdle() {
        const low = (window.__isLowPerf === true)
            || document.documentElement.classList.contains('low-perf')
            || this._lowPerf;
        if (!low) return false;
        const ultra = (window.__deviceTier === 0) || (window.__perfAnimOff === true);
        const threshold = ultra ? Math.min(this._idleThreshold, 15000) : this._idleThreshold;
        return (performance.now() - this._lastInteraction) > threshold;
    }

    _scheduleNext() {
        if (this._destroyed || this._hidden) return;
        if (this._isIdle()) {
            // 低性能空闲:10fps 心跳(tier0/强制无动画 5fps);交互后下一次心跳即切回 rAF
            const ultra = (window.__deviceTier === 0) || (window.__perfAnimOff === true);
            const delay = ultra ? Math.min(this._idleDelay, 200) : this._idleDelay;
            this._idleTimerId = setTimeout(() => { this._idleTimerId = null; this._loop(); }, delay);
        } else {
            this._rafId = requestAnimationFrame(() => this._loop());
        }
    }

    onTick(cb) {
        this.tickerCallbacks.add(cb);
        return () => this.tickerCallbacks.delete(cb);
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }

    destroy() {
        this._destroyed = true;
        this._cancelPendingFrames();
        for (const m of this.modules.values()) {
            if (typeof m.destroy === 'function') {
                try { m.destroy(); } catch (_) {}
            }
        }
        this.modules.clear();
    }
}

window.GameEngine = GameEngine;
