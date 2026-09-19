import UIKit
import WebKit

/// 主控制器:WKWebView 壳(对齐 Android MainActivity)
/// - 自定义 scheme(tianyi://)加载本地资产(定制 origin,IndexedDB/localStorage 可用)
/// - 安全区→CSS 变量链(对齐 Android onApplyWindowInsets:物理 px→CSS px 除 scale)
/// - 键盘高度→--kb-inset(对齐 Android installKeyboardInsetFix 管线)
/// - FetchShim 注入(跨域 fetch→原生;TTSBridge/SecureStore/AppInfo 胶水)
/// - 状态栏与 Home 指示条隐藏(对齐 Android 沉浸全屏);常亮(对齐 KEEP_SCREEN_ON)
class ViewController: UIViewController, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let bridges = NativeBridges()

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.04, green: 0.09, blue: 0.15, alpha: 1)

        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(SchemeHandler(), forURLScheme: "tianyi")
        cfg.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []

        // 胶水注入(AppInfo 版本值取自 Info.plist)+ 跨域 fetch shim
        let verName = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.1.10"
        let verCode = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1") ?? 1
        let glue = WKUserScript(source: FetchShim.script(appVersion: verName, appCode: verCode),
                                injectionTime: .atDocumentStart, forMainFrameOnly: false)
        cfg.userContentController.addUserScript(glue)
        cfg.userContentController.add(self, name: "ios")

        webView = WKWebView(frame: .zero, configuration: cfg)
        bridges.attach(webView: webView)
        webView.navigationDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        // 键盘高度→--kb-inset(前端 145 管线消费)
        NotificationCenter.default.addObserver(self, selector: #selector(kbChanged(_:)),
                                               name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(kbChanged(_:)),
                                               name: UIResponder.keyboardWillHideNotification, object: nil)

        // 主页面(自定义 scheme;allowReadAccess=www 整目录)
        let www = Bundle.main.resourceURL!.appendingPathComponent("www")
        webView.loadFileURL(www.appendingPathComponent("index.html"), allowingReadAccessTo: www)
    }

    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); injectSafeArea() }
    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { _ in self.injectSafeArea() }
    }

    /// 安全区变量链:刘海/手势条真实值→CSS px(除 scale),对齐 Android 注入契约
    private func injectSafeArea() {
        let scale = view.window?.screen.scale ?? 2
        let insets = view.safeAreaInsets
        let js = String(format: "try{var r=document.documentElement.style;"
            + "r.setProperty('--safe-inset-top','%dpx');"
            + "r.setProperty('--safe-inset-bottom','%dpx');"
            + "r.setProperty('--safe-inset-left','%dpx');"
            + "r.setProperty('--safe-inset-right','%dpx');"
            + "r.setProperty('--safe-inset-source','native');}catch(e){}",
                        Int(insets.top / scale), Int(insets.bottom / scale),
                        Int(insets.left / scale), Int(insets.right / scale))
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    @objc private func kbChanged(_ n: Notification) {
        let kbH: CGFloat
        if n.name == UIResponder.keyboardWillHideNotification {
            kbH = 0
        } else {
            let f = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect ?? .zero
            kbH = max(0, view.bounds.height - f.origin.y)
        }
        webView.evaluateJavaScript(
            "try{document.documentElement.style.setProperty('--kb-inset','\(Int(kbH))px');}catch(e){}",
            completionHandler: nil)
    }

    // MARK: - ios 通道统一分发:http→FetchShim;tts/secure→NativeBridges
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if body["type"] as? String == "http" {
            FetchShim.handle(body: body, webView: webView)
        } else {
            bridges.handle(body: body)
        }
    }
}

extension ViewController: WKNavigationDelegate {
    // 外部 http(s) 链接交给系统(对齐 Android openUrl);tianyi:// 内部处理
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.request.url?.scheme == "tianyi" {
            decisionHandler(.allow)
        } else if let url = navigationAction.request.url,
                  url.scheme == "http" || url.scheme == "https",
                  navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }
}
