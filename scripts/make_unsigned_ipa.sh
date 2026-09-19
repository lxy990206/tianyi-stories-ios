#!/bin/bash
# macOS 侧:一键产出未签名 IPA(供 爱思助手 自签名安装)
# 依赖:Xcode 15+、XcodeGen(brew install xcodegen)
# 用法:在 IOS/app 目录执行 bash ../scripts/make_unsigned_ipa.sh
set -e
cd "$(dirname "$0")/../app"

echo "[1/4] XcodeGen 生成工程..."
xcodegen generate

echo "[2/4] 归档(真机,不签名)..."
xcodebuild archive \
  -project TianyiStories.xcodeproj \
  -scheme TianyiStories \
  -sdk iphoneos \
  -configuration Release \
  -archivePath build/TianyiStories.xcarchive \
  CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED="NO" CODE_SIGNING_ALLOWED="NO"

echo "[3/4] 组装 Payload..."
APP=$(find build/TianyiStories.xcarchive/Products/Applications -maxdepth 1 -name "*.app" | head -1)
rm -rf build/Payload build/TianyiStories
mkdir -p build/Payload
cp -R "$APP" build/Payload/

echo "[4/4] 打包未签名 IPA..."
cd build
rm -f ../TianyiStories-unsigned.ipa
zip -qry ../TianyiStories-unsigned.ipa Payload
cd ..

cp -f TianyiStories-unsigned.ipa "../构建产物/TianyiStories-unsigned.ipa"

echo "完成:IOS/app/TianyiStories-unsigned.ipa(已同步副本到 IOS/构建产物/)"
echo "下一步:爱思助手 → 工具箱 → IPA 自签名/自签名安装(见 IOS/签名与安装指南.md)"
