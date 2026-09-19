/**
 * Android 内存桥接兼容层
 * 真正实现由原生 Java 端提供 (AndroidMemoryBridge.kt)，这里仅做检测与全局挂载。
 */
(function () {
    'use strict';
    const logger = console;
    if (typeof window === 'undefined') return;
    // 在 Android 端，原生 Java 已注入 window.AndroidMemoryBridge / window.AndroidMemoryCallback。
    // 这里提供回调路由：原生 invoke 回调 -> window.MemoryBridge 路由到 _callbacks
    if (!window.AndroidMemoryCallback) {
        window.AndroidMemoryCallback = {
            resolve(id, result) {
                logger.log('[AndroidMemoryCallback] resolve', id);
            },
            reject(id, error) {
                logger.warn('[AndroidMemoryCallback] reject', id, error);
            }
        };
    }
    logger.log('[AndroidMemoryBridge] 桥接兼容层已就绪');
})();
