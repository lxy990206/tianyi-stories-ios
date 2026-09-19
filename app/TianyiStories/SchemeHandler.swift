import Foundation
import WebKit

/// 自定义 scheme 处理:tianyi://www/... → Bundle 内 www 资源
/// 定制 origin 使 IndexedDB/localStorage 在 WKWebView 内可用(file:// 下不可靠)
/// 响应统一附加 CORS 头(页面经 fetch/XHR 加载相对 JSON/字体不受阻)
class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let mimeTypes: [String: String] = [
        "html": "text/html", "js": "application/javascript", "css": "text/css",
        "json": "application/json", "png": "image/png", "jpg": "image/jpeg",
        "jpeg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml",
        "webp": "image/webp", "mp3": "audio/mpeg", "wav": "audio/wav",
        "ttf": "font/ttf", "otf": "font/otf", "woff": "font/woff", "woff2": "font/woff2",
        "moc3": "application/octet-stream", "ico": "image/x-icon"
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return urlSchemeTask.didFailWithError(NSError(domain: "tianyi", code: 404)) }
        var path = url.path
        if path.hasPrefix("/www/") { path = String(path.dropFirst("/www".count)) }
        // 防目录穿越
        let rel = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !rel.contains("..") else {
            return urlSchemeTask.didFailWithError(NSError(domain: "tianyi", code: 403))
        }
        guard let base = Bundle.main.resourceURL?.appendingPathComponent("www") else {
            return urlSchemeTask.didFailWithError(NSError(domain: "tianyi", code: 500))
        }
        let file = base.appendingPathComponent(rel)
        guard FileManager.default.fileExists(atPath: file.path),
              let data = try? Data(contentsOf: file) else {
            let resp = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!
            urlSchemeTask.didReceive(resp)
            urlSchemeTask.didFinish()
            return
        }
        let ext = file.pathExtension.lowercased()
        let mime = mimeTypes[ext] ?? "application/octet-stream"
        var headers = ["Content-Type": mime, "Content-Length": String(data.count),
                       "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"]
        if ext == "ttf" || ext == "otf" || ext == "woff" || ext == "woff2" {
            headers["Access-Control-Allow-Origin"] = "*"
        }
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(resp)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
