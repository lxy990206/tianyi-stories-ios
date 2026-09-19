# 构建产物存放目录

本目录存放 iOS 构建产物(未签名 IPA / 已签名 IPA):

- `TianyiStories-unsigned.ipa` — macOS 构建产出(见 ../scripts/make_unsigned_ipa.sh)
- 签名后版本建议命名:TianyiStories-signed-YYYYMMDD.ipa

**注意**:Windows 无 iOS 工具链,未签名 IPA 需在 macOS/在线构建环境产出一次
(工程与脚本已 100% 备齐,见 README.md 快速开始)。产物就位后按
../签名与安装指南.md 用爱思助手自签名安装。
