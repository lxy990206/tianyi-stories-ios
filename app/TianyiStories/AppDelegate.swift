import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 常亮(对齐 Android FLAG_KEEP_SCREEN_ON;用户可在系统层干预)
        UIApplication.shared.isIdleTimerDisabled = true
        return true
    }
}
