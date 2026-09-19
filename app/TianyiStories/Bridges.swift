import AVFoundation
import WebKit

/// iOS 原生桥(契约对齐 Android,前端零改动):
/// - bridge:'tts' → window.TTSBridge.speak/stop + TTSBridgeCallback.onStart/onDone/onLevel
///   (AVSpeechSynthesizer;时长按字数估算供音画同步;电平模拟振幅驱动口型)
/// - bridge:'secure' → localStorage 兜底的键值存取(前端 SecureStore 缺位时回退表单)
/// - AppInfo/DeviceProfile 经 FetchShim 注入胶水提供(同步契约)
class NativeBridges: NSObject, AVSpeechSynthesizerDelegate {
    private let synth = AVSpeechSynthesizer()
    private var speaking = false
    private var levelTimer: Timer?
    private weak var webView: WKWebView?

    func attach(webView: WKWebView) {
        self.webView = webView
        synth.delegate = self
    }

    /// 分发(ViewController 收到 ios 通道消息后调用)
    func handle(body: [String: Any]) {
        let reply = { [weak self] (js: String) in
            DispatchQueue.main.async { self?.webView?.evaluateJavaScript(js, completionHandler: nil) }
        }
        switch body["bridge"] as? String {
        case "tts":
            switch body["op"] as? String {
            case "speak":
                let text = (body["text"] as? String) ?? ""
                let u = AVSpeechUtterance(string: text)
                u.voice = AVSpeechSynthesisVoice(language: "zh-CN")
                u.rate = 0.5
                synth.stopSpeaking(at: .immediate)
                synth.speak(u)
                speaking = true
                // onStart(估算时长:约 260ms/字,下限 800ms;供音画同步)
                let est = max(800, Int(Double(text.count) * 260))
                reply("window.TTSBridgeCallback && window.TTSBridgeCallback.onStart(\(est));")
                // 口型电平:模拟振幅 60ms 节流(tts:level 契约对齐 Android)
                levelTimer?.invalidate()
                levelTimer = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) { [weak self] _ in
                    guard let self = self, self.speaking else { return }
                    let lv = Int(30 + 60 * abs(sin(Date().timeIntervalSince1970 * 11)))
                    reply("window.TTSBridgeCallback && window.TTSBridgeCallback.onLevel(\(lv));")
                }
            case "stop":
                synth.stopSpeaking(at: .immediate)
                speaking = false
                levelTimer?.invalidate()
                reply("window.TTSBridgeCallback && window.TTSBridgeCallback.onDone();")
            default:
                break
            }
        case "secure":
            switch body["op"] as? String {
            case "set":
                if let k = body["key"] as? String, let v = body["value"] as? String {
                    UserDefaults.standard.set(v, forKey: "tianyi_ios_" + k)
                }
            default:
                break
            }
        default:
            break
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        speaking = false
        levelTimer?.invalidate()
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "window.TTSBridgeCallback && window.TTSBridgeCallback.onDone();", completionHandler: nil)
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        speaking = false
        levelTimer?.invalidate()
    }
}
