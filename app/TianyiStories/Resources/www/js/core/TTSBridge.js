/**
 * TTS Android/JSBridge 兼容层
 * 在 Android 端，原生 Java 通过 WebView.addJavascriptInterface 注入 window.TTSBridge
 * 这里提供默认空实现，确保在非 Android 环境不报错。
 */
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    // 如果原生已注入，直接使用
    if (window.TTSBridge) {
        console.log('[TTSBridge] 原生桥接已注入');
        return;
    }

    // 默认空实现
    window.TTSBridge = {
        speak: function (text, type, rate, pitch) {
            console.log('[TTSBridge] speak (mock):', text.substring(0, 40) + '...');
        },
        stop: function () {
            console.log('[TTSBridge] stop (mock)');
        },
        isAvailable: function () {
            return false;
        },
        setEngine: function (engine) {
            console.log('[TTSBridge] setEngine (mock):', engine);
        }
    };

    // 注入播放回调路由
    // 原生端调用: window.TTSBridgeCallback.onStart(durationMs) / onDone() / onError()
    window.TTSBridgeCallback = {
        onStart: function (durationMs) {
            if (window.gameEngine) {
                const tts = window.gameEngine.getModule('TTSManager');
                if (tts) tts.onAndroidSpeakStart(durationMs);
            }
        },
        onDone: function () {
            if (window.gameEngine) {
                const tts = window.gameEngine.getModule('TTSManager');
                if (tts) tts.onAndroidSpeakDone();
            }
        },
        onError: function (error) {
            console.warn('[TTSBridge] 播放错误:', error);
            if (window.gameEngine) {
                const tts = window.gameEngine.getModule('TTSManager');
                if (tts) tts.onAndroidSpeakDone();
            }
        },
        onLevel: function (pct) {
            // 播放电平(1.1.10Beta5/144):Live2D 口型驱动数据源(0~100)
            if (window.globalEventBus) {
                window.globalEventBus.emit('tts:level', { level: Number(pct) || 0 });
            }
        }
    };

    console.log('[TTSBridge] 默认空桥接已就绪');
})();