/**
 * 设备真实能力分级(DeviceTier)——智能适配核心
 * 必须在 compat.js 之后、业务脚本之前加载;init() 由 main.js 在引擎构建前调用。
 *
 * 数据源纪律(华强北伪装设备防护):
 *   只信任原生桥 DeviceProfileBridge 的内核级数据源
 *   (Runtime.availableProcessors/sysfs cpufreq/sysinfo totalMem/EGL GL_RENDERER),
 *   不信任 Build.MODEL 等机型字符串——伪装机型只骗过字符串,骗不过内核与驱动。
 *   浏览器无桥时保持 compat.js 启发式,不做二次修正。
 *
 * 分级 tier(渐进增强,现代设备零变化):
 *   0=极低配(SL8541E/4xA53@1.4GHz/Mali-T820/2GB 一类)
 *   1=低配  2=中端  3=现代
 * 适配映射:
 *   tier<=1 → html.low-perf(129 CSS 降级 + GameEngine 空闲降频)
 *   tier=0  → html.ultra-low(responsive.css 增强降级)+GameEngine 空闲 15s/5fps
 *             +ChatEffects 装饰特效门控
 *   tier>=2 → 移除误判的 low-perf(修正 compat.js cores<=4 对中端 4 核机的假阳性)
 */
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    /* 纯函数:按真实配置打分分级。供 init 与 Node 单测共用 */
    function computeTier(p) {
        p = p || {};
        var score = 0;
        var cores = Number(p.cores) || 0;
        var khz = Number(p.cpuMaxKhz) || 0;
        var ram = Number(p.totalRamMB) || 0;
        var gpu = String(p.gpu || '').toLowerCase();
        var chrome = Number(p.chromeMajor) || 0;

        if (cores > 0 && cores <= 4) score++;
        if (khz > 0 && khz <= 1500000) score++;              // ≤1.5GHz(28nm A53 档)
        if (ram > 0 && ram <= 2100) score++;                 // 2GB 档(可用常报 ~1.8GiB)
        if (p.isLowRam === true) score++;
        // GPU 低端家族(驱动字符串真值):Mali-4xx/T6xx/T7xx/T8xx、Mali-G2x/G3x、
        // PowerVR Rogue GE8xx、Adreno 2xx/3xx("Adreno (TM) 306" 带 (TM) 后缀)、
        // VideoCore;未知 GPU 不惩罚,高端 GPU 无需显式加分(仅缺少低分信号)
        if (gpu && /mali-4|mali-t[4-8]|mali-g[23][0-9]|powervr|adreno(\s*\(tm\))?\s*[1-3][0-9][0-9]|videocore|gc8|gc2/.test(gpu)) score++;
        if (chrome > 0 && chrome < 66) score++;              // 老 WebView 内核(JS/布局成本高)

        if (score >= 4) return 0;
        if (score === 3) return 1;
        if (score === 2) return 2;
        return 3;
    }

    /* 用户性能设置(三态,设置-游戏-性能适配);无设置管理器时按设备分级(auto) */
    function perfPrefs() {
        var s = null;
        try { s = window.settingsManager && window.settingsManager.state; } catch (_) {}
        return {
            anim: (s && s.perfAnimation) || 'auto',   // auto | off(强制无动画) | full(强制完整动画)
            mem: (s && s.perfMemory) || 'auto'        // auto | on(强制开启) | off(关闭)
        };
    }

    /* 把分级落到 html class 与全局标志;含用户设置覆盖,设置变更后可重复调用 */
    function applyTier(tier) {
        window.__deviceTier = tier;
        var p = perfPrefs();
        var lowPerf, ultra;
        if (p.anim === 'off') {           // 用户强制:全部动画停用(含非低配设备)
            lowPerf = true; ultra = true;
        } else if (p.anim === 'full') {   // 用户强制:完整动画(低配也全开)
            lowPerf = false; ultra = false;
        } else {                          // 跟随设备:tier≤1 降级,tier0 全停
            lowPerf = tier <= 1; ultra = tier === 0;
        }
        window.__perfAnimOff = ultra;     // GameEngine/CSS 据此全动画停用+最省心跳
        window.__isLowPerf = lowPerf;     // 129 语义保持:空闲降频开关
        window.__perfMemoryOn = p.mem === 'on' ? true : (p.mem === 'off' ? false : tier <= 1);
        var cls = document.documentElement.classList;
        if (lowPerf) {
            cls.add('low-perf');
            if (ultra) cls.add('ultra-low'); else cls.remove('ultra-low');
        } else {
            cls.remove('low-perf');
            cls.remove('ultra-low');
        }
    }

    /* 读原生桥→分级→落类;无桥(浏览器)返回 false 保持 compat.js 启发式 */
    function init() {
        var p = null;
        try {
            if (window.DeviceProfile && typeof window.DeviceProfile.getProfile === 'function') {
                p = JSON.parse(window.DeviceProfile.getProfile());
            }
        } catch (e) {
            console.warn('[DeviceTier] 桥读取失败,保持 compat.js 启发式', e);
        }
        if (!p || !p.cores) return false;

        var ua = navigator.userAgent || '';
        var m = ua.match(/Chrome\/(\d+)\./);
        p.chromeMajor = m ? Number(m[1]) : 0;
        p.tier = computeTier(p);
        window.__deviceProfile = p;
        applyTier(p.tier);

        console.log('[DeviceTier] tier=' + p.tier
            + ' cores=' + p.cores + '/' + p.coresSysfs
            + ' freq=' + Math.round((p.cpuMaxKhz || 0) / 1000) + 'MHz'
            + ' ram=' + p.totalRamMB + 'MB'
            + ' gpu=' + p.gpu
            + ' chrome=' + p.chromeMajor
            + ' spoof=' + (p.spoofSuspected === true));
        return true;
    }

    window.DeviceTier = { computeTier: computeTier, applyTier: applyTier, init: init };
    /* 设置-游戏-性能适配变更后实时重应用(设置面板回调) */
    window.applyPerformanceSettings = function () {
        if (typeof window.__deviceTier === 'number') applyTier(window.__deviceTier);
    };
})();
