/**
 * 老 WebView 兼容垫片(基线:Chrome 59 / 展锐 Android 8.1 实测)
 * 必须在所有业务脚本之前加载(index.html 脚本链首位)。
 * 仅在新内核缺位时生效,现代内核零影响。
 */
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    // AbortController(Chrome 66+):最小垫片。
    // fetch 会忽略不认识的 signal 属性——超时语义退化为"等待响应自然结束",
    // 但不会在 new AbortController() 处抛 ReferenceError 中断对话/记忆整合。
    if (typeof window.AbortController === 'undefined') {
        window.AbortController = function () {
            this.signal = {
                aborted: false,
                onabort: null,
                addEventListener: function () {},
                removeEventListener: function () {},
                dispatchEvent: function () { return false; }
            };
            this.abort = function () { this.signal.aborted = true; };
        };
    }

    // Object.fromEntries(Chrome 73+):与 index.html 内联 polyfill 等价,双保险
    if (typeof Object.fromEntries !== 'function') {
        Object.fromEntries = function (entries) {
            var o = {};
            if (entries) {
                Array.prototype.forEach.call(entries, function (e) { o[e[0]] = e[1]; });
            }
            return o;
        };
    }

    // Promise.prototype.finally(Chrome 63+):最小垫片
    if (typeof Promise.prototype.finally !== 'function') {
        Promise.prototype.finally = function (onFinally) {
            var P = this.constructor || Promise;
            return this.then(
                function (v) { return P.resolve(onFinally && onFinally()).then(function () { return v; }); },
                function (e) { return P.resolve(onFinally && onFinally()).then(function () { throw e; }); }
            );
        };
    }

    // 低性能设备检测:弱 SoC/小内存/老内核 → <html class="low-perf">
    // (CSS 侧据此关闭大半径模糊与常驻大元素动画,见 responsive.css 降级块;
    //  实测依据:展锐 SC9832E 4xA53@1.4GHz + Chrome 59,blur(80px) 大元素动画帧率过低)
    // 同时置 window.__isLowPerf 供 GameEngine 空闲降频判断(JS 侧发热优化)
    try {
        var cores = navigator.hardwareConcurrency || 8;
        var mem = navigator.deviceMemory || 8;
        var ua = navigator.userAgent || '';
        var oldKernel = /Chrome\/(5\d|6[0-4])\./.test(ua);
        if (cores <= 4 || mem <= 2 || oldKernel) {
            document.documentElement.classList.add('low-perf');
            window.__isLowPerf = true;
        }
    } catch (_) {}
})();
