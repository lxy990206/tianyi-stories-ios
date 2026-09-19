# IOS — 天依物语 iOS 适配

> 1.1.10Beta5(155) 对应 · 性质:iOS 壳工程与打包链(源码+产物目录) · WebView 混合壳对齐 Android 架构

## 是什么

`IOS/` 存放天依物语的 **iOS 端源码与产物**:

- **壳架构与 Android 完全对齐**:WKWebView 加载同一套 `assets`(游戏逻辑/UI/AI 对话 100% 复用),原生侧实现同契约桥(TTS/设备信息/AppInfo/安全存储),前端零改动。
- **产物**:`构建产物/` 存放未签名 IPA 等;`app/` 为 XcodeGen 工程与 Swift 源码;`scripts/` 为资产同步与打包脚本。

## 目录结构

```
IOS/
├── app/
│   ├── project.yml                      # XcodeGen 工程定义(生成 .xcodeproj)
│   └── TianyiStories/
│       ├── AppDelegate.swift            # 生命周期(常亮=对齐 KEEP_SCREEN_ON)
│       ├── ViewController.swift         # WKWebView 壳:安全区变量链/键盘注入/ios 通道路由
│       ├── SchemeHandler.swift          # tianyi:// scheme(IndexedDB/localStorage 可用+CORS 头)
│       ├── FetchShim.swift              # 注入胶水:AppInfo/SecureStore/TTSBridge + 跨域 fetch 走原生
│       ├── Bridges.swift                # 原生桥:AVSpeechSynthesizer TTS(onStart/onDone/onLevel)
│       ├── Info.plist                   # ATS 任意加载/状态栏隐藏/方向/权限文案
│       └── Resources/www/               # Web 资产(scripts/sync_assets.py 从 app-dev 同步)
├── scripts/
│   ├── sync_assets.py                   # Windows 侧:同步 app-dev 资产 → www
│   └── make_unsigned_ipa.sh             # macOS 侧:xcodegen+xcodebuild → 未签名 IPA
└── 构建产物/                            # 未签名 IPA 等产物存放
```

## 快速开始(macOS 构建一次)

```bash
# 0) Windows 上先同步资产:python IOS/scripts/sync_assets.py
# 1) macOS 安装 XcodeGen
brew install xcodegen
# 2) 生成工程并出未签名 IPA
cd IOS/app && xcodegen generate
bash ../scripts/make_unsigned_ipa.sh
# 产物:app/TianyiStories-unsigned.ipa,并自动复制一份到 IOS/构建产物/
```

### 没有 Mac?用 GitHub Actions 云构建

把整个 `IOS/` 推到 GitHub 仓库根(已内置工作流 `.github/workflows/build-ipa.yml`),仓库页 → **Actions → Build unsigned IPA → Run workflow**,跑完在该次运行底部 **Artifacts** 下载 `TianyiStories-unsigned-ipa`(云 macOS 自动完成 xcodegen+xcodebuild+打包)。

## 爱思助手自签名安装(Windows 即可)

1. iPhone 数据线连电脑,打开**爱思助手**,设备信任并配对;
2. 爱思 → **工具箱 → IPA 签名/自签名**;
3. 选择 `构建产物/TianyiStories-unsigned.ipa`,登录你的 **Apple ID**(免费账号签名 7 天有效);
4. 签名完成后自动安装;iPhone 上 **设置 → 通用 → VPN 与设备管理** → 信任对应开发者证书;
5. 首次启动若提示不受信任,重复第 4 步信任即可。

> **IPA vs IPK**:iOS 正常安装使用 **IPA**;IPK(deb)是越狱源包格式(Cydia/Sileo),仅越狱设备可用。本工程按 **IPA(未签名→爱思自签)** 交付;如设备已越狱需真 IPK,可另行用 theos 打包(源码可直接复用)。

## iOS 桥契约(对齐 Android,前端零改动)

| Android | iOS 实现 | 说明 |
| --- | --- | --- |
| window.MimoTTS(AVSpeech 对位) | window.TTSBridge(AVSpeechSynthesizer) | onStart(估算时长)音画同步/onDone/onLevel 口型电平(模拟振幅);中文 zh-CN |
| window.EmbeddingBridge | **无(降级)** | 记忆检索自动降级 bigram 关键词 |
| window.TianyiASR | **无(降级)** | 麦克风按钮隐藏;后续可接 Speech.framework |
| window.DeviceProfile.getProfile | **无(降级)** | DeviceTier 走 compat 启发式(iPhone 均非 low-perf) |
| window.AppInfo | 注入胶水(同步) | 版本取自 Info.plist;checkAppUpdate 恒无更新(iOS 无 dynfs 通道) |
| window.SecureStore | 注入胶水(localStorage) | builtin_api_key 兜底表单 apiKey |

## 与 Android 的差异

- **无内置模型计费通道**:BUILTIN 模式依赖内置网关(占位中),iOS 同状态;
- **无 dynfs 更新通道**:iOS 版本更新走重新签名安装(爱思/TestFlight/上架);
- **IndexedDB/localStorage**:经 tianyi:// 定制 scheme 提供真实 origin,可靠可用;
- **跨域 API 请求**:FetchShim 走原生 NSURLSession(绕过 custom scheme CORS),用户自配 http 端点可用;
- **TTS**:AVSpeechSynthesizer(系统中文语音),非 MiMo 克隆音色;iOS 端如需克隆音色需接入小米 iOS SDK(后续评估)。

## 风险与待验证

- 未签名 IPA 的构建需一次 macOS/Xcode 环境(本工程已备好全部脚本);
- WKWebView 内 IndexedDB 大数据量表现、AVSpeech 语速与 Android 音色差异,待真机验证;
- 首次构建后建议真机回归:对话(fetch shim)/TTS 朗读与逐字显现/存档/记忆。
