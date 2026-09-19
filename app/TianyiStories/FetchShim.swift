import Foundation
import WebKit

/// 跨域请求 shim + iOS 侧胶水(1.1.10Beta/154 iOS):
/// - documentStart 注入:跨域 http(s) fetch 改走原生 NSURLSession(绕过 custom scheme CORS);
///   注入 window.TTSBridge(iOS AVSpeech 实现)/window.SecureStore(localStorage 兜底)/
///   window.AppInfo(同步版本信息,值来自 Info.plist)
/// - 同域(tianyi://)请求不拦截
enum FetchShim {
    static func script(appVersion: String, appCode: Int) -> String {
        """
        (function(){
            if (window.__tianyiShimInstalled) return;
            window.__tianyiShimInstalled = true;
            // ---- AppInfo(同步,值来自 Info.plist) ----
            window.AppInfo = {
                getVersionName: function(){ return '\(appVersion)'; },
                getVersionCode: function(){ return \(appCode); },
                checkAppUpdate: function(){ return JSON.stringify({ hasUpdate: false }); },
                openUrl: function(u){ location.href = u; }
            };
            // ---- SecureStore(localStorage 兜底,iOS 无原生 XOR 需求) ----
            window.SecureStore = {
                get: function(k){ try { return localStorage.getItem('tianyi_ios_' + k) || ''; } catch(e){ return ''; } },
                set: function(k, v){ try { localStorage.setItem('tianyi_ios_' + k, v); } catch(e){} }
            };
            // ---- TTS 桥(AVSpeechSynthesizer 经原生通道) ----
            window.TTSBridge = {
                speak: function(text){ window.webkit.messageHandlers.ios.postMessage(JSON.stringify({ bridge:'tts', op:'speak', text:String(text) })); },
                stop: function(){ window.webkit.messageHandlers.ios.postMessage(JSON.stringify({ bridge:'tts', op:'stop' })); },
                isAvailable: function(){ return true; },
                setEngine: function(){}
            };
            // ---- 跨域 fetch 拦截 ----
            var pending = {};
            var seq = 0;
            window.__tianyiHttpResolve = function(id, status, body) {
                var p = pending[id];
                if (!p) return;
                delete pending[id];
                if (status >= 200 && status < 300) p.resolve(new Response(body, { status: status }));
                else p.reject(new Error('HTTP ' + status + ': ' + String(body).slice(0, 200)));
            };
            function viaNative(url, options) {
                return new Promise(function(resolve, reject) {
                    var id = 'h' + (++seq);
                    pending[id] = { resolve: resolve, reject: reject };
                    try {
                        window.webkit.messageHandlers.ios.postMessage(JSON.stringify({
                            type: 'http', id: id, url: url,
                            method: (options && options.method) || 'GET',
                            headers: (options && options.headers) || {},
                            body: (options && options.body) || ''
                        }));
                    } catch (e) { reject(e); }
                });
            }
            var origFetch = window.fetch;
            window.fetch = function(input, init) {
                try {
                    var url = (typeof input === 'string') ? input : (input && input.url) || '';
                    if (/^https?:/i.test(url) && location.protocol === 'tianyi:') {
                        return viaNative(url, init);
                    }
                } catch (e) {}
                return origFetch.apply(this, arguments);
            };
        })();
        """
    }

    /// 原生侧执行跨域请求并回注结果
    static func handle(body: [String: Any], webView: WKWebView) {
        guard body["type"] as? String == "http",
              let id = body["id"] as? String,
              let urlStr = body["url"] as? String,
              let url = URL(string: urlStr) else { return }
        let method = (body["method"] as? String) ?? "GET"
        var request = URLRequest(url: url, timeoutInterval: 240)
        request.httpMethod = method
        if let headers = body["headers"] as? [String: Any] {
            headers.forEach { k, v in request.setValue(String(describing: v), forHTTPHeaderField: k) }
        }
        if let b = body["body"] as? String, method != "GET" {
            request.httpBody = b.data(using: .utf8)
        }
        URLSession.shared.dataTask(with: request) { data, resp, err in
            let status = (resp as? HTTPURLResponse)?.statusCode ?? (err == nil ? 200 : 502)
            let text = String(data: data ?? Data(), encoding: .utf8) ?? ""
            var escaped = text
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "`", with: "\\`")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
            escaped = escaped.replacingOccurrences(of: "\r", with: "")
            DispatchQueue.main.async {
                webView.evaluateJavaScript(
                    "window.__tianyiHttpResolve('\(id)', \(status), '\(escaped)');",
                    completionHandler: nil)
            }
        }.resume()
    }
}
