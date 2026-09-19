# -*- coding: utf-8 -*-
# Windows 侧:同步 Android 资产 → iOS 资源目录(www)
# 用法:python sync_assets.py  (在 IOS/scripts/ 下执行)
import os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '..', 'app-dev', 'app', 'src', 'main', 'assets')
DST = os.path.join(ROOT, 'app', 'TianyiStories', 'Resources', 'www')

if not os.path.isdir(SRC):
    print('未找到资产目录:', SRC)
    sys.exit(1)

# 清理目标(排除已生成的 iOS 专属文件后全量重建,保证与 Android 资产一致)
if os.path.isdir(DST):
    shutil.rmtree(DST)
os.makedirs(DST)

# robocopy 语义:镜像复制
for root, dirs, files in os.walk(SRC):
    rel = os.path.relpath(root, SRC)
    dst_root = DST if rel == '.' else os.path.join(DST, rel)
    os.makedirs(dst_root, exist_ok=True)
    for f in files:
        shutil.copy2(os.path.join(root, f), os.path.join(dst_root, f))

# 清理 Android 专属/构建残留(不进 iOS 包)
for p in (
    os.path.join(DST, 'dexopt'),
    os.path.join(DST, 'asr', 'model_packs.json'),  # iOS 端无 FunASR 运行时,模型包机制不适用
):
    if os.path.isdir(p):
        shutil.rmtree(p)
    elif os.path.isfile(p):
        os.remove(p)

total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(DST) for f in fs)
print('www 同步完成: %d 文件, %.1f MB' % (sum(len(fs) for _, _, fs in os.walk(DST)), total / 1e6))
