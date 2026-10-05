#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
独立部署 dsh-shinki-sidebar-tools（**不使用符号链接 / 硬链接**）。

背景：该插件在 profile 里是通过 `file:…/plugin/web/dsh-shinki-sidebar-tools` 安装的；
pnpm 默认把源码文件**硬链接**进 `.pnpm` store，并让 `node_modules/<pkg>` 指向它。
于是"源码 / 安装源 / 运行时"实际上共享同一份文件：改一处即改全部，排查时很容易被"到底改的是哪一份"误导。

本脚本把每个目标目录**删除后从源码整树复制**（复制产生全新 inode，链接数为 1），
并把运行时那处的 pnpm 符号链接替换成真实目录，使三处彼此独立、内容与源码一致。

用法：
    python3 tools/deploy-independent.py                     # 干跑：只报告现状，不改动
    python3 tools/deploy-independent.py --apply             # 执行独立部署
    python3 tools/deploy-independent.py --apply --profile <profile 目录>

可选参数：
    --web PATH      安装源目录（默认 <app>/plugin/web/dsh-shinki-sidebar-tools）
    --profile PATH  dsh profile 目录（默认 <app>/data/dsh/profiles/shinki-desktop，可在本机改动）
    其中 <app> 默认取 /Users/huanxuantian/work/AI/new-claude-app，可用 --app 覆盖。

注意：以后若再次执行 `pnpm install`，pnpm 会按自己的规则重建符号链接/硬链接布局，
      需要独立副本时请重跑本脚本。
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys

APP_DEFAULT = '/Users/huanxuantian/work/AI/new-claude-app'
PROFILE_DEFAULT = os.path.join(APP_DEFAULT, 'data/dsh/profiles/shinki-desktop')
PKG = 'dsh-shinki-sidebar-tools'
SKIP = {'.git', '.DS_Store', 'node_modules', '__pycache__'}
IGNORE = shutil.ignore_patterns(*SKIP)


def md5(path: str) -> str | None:
    try:
        with open(path, 'rb') as fh:
            return hashlib.md5(fh.read()).hexdigest()
    except OSError:
        return None


def store_dirs(profile: str) -> list[str]:
    """`.pnpm/dsh-shinki-sidebar-tools@<hash>/node_modules/dsh-shinki-sidebar-tools`（hash 不写死）。"""
    pnpm = os.path.join(profile, 'node_modules', '.pnpm')
    if not os.path.isdir(pnpm):
        return []
    return sorted(
        os.path.join(pnpm, name, 'node_modules', PKG)
        for name in os.listdir(pnpm)
        if name.startswith(PKG + '@') and os.path.isdir(os.path.join(pnpm, name, 'node_modules', PKG))
    )


def main() -> int:
    ap = argparse.ArgumentParser(description='把插件以独立实体副本部署到安装源与运行时')
    ap.add_argument('--app', default=APP_DEFAULT)
    ap.add_argument('--web', default=None)
    ap.add_argument('--profile', default=PROFILE_DEFAULT)
    ap.add_argument('--apply', action='store_true', help='真正执行（默认只报告）')
    args = ap.parse_args()

    src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))       # 本脚本在 tools/ 下
    web = args.web or os.path.join(args.app, 'plugin', 'web', PKG)
    run = os.path.join(args.profile, 'node_modules', PKG)
    targets = [('WEB', web), ('RUN', run)] + [(f'STORE{i or ""}', p) for i, p in enumerate(store_dirs(args.profile))]

    src_client = os.path.join(src, 'lib', 'client.js')
    print(f'源码   {src}')
    print(f'       client.js md5={md5(src_client)}')
    for name, path in targets:
        print('目标   %-7s %s' % (name, path))
        print('         存在=%s 符号链接=%s md5=%s' % (os.path.exists(path), os.path.islink(path), md5(os.path.join(path, 'lib', 'client.js'))))

    if not args.apply:
        print('\n（干跑：未改动。加 --apply 执行独立部署）')
        return 0

    want = md5(src_client)
    for name, path in targets:
        real = os.path.realpath(path)
        if os.path.basename(real) != PKG:
            print(f'拒绝操作：{path} 解析后不是 {PKG} 目录', file=sys.stderr)
            return 2
        if os.path.islink(path):
            os.unlink(path)                     # 断开 pnpm 符号链接
        elif os.path.exists(path):
            shutil.rmtree(path)                 # 删掉旧目录（含硬链接文件）
        shutil.copytree(src, path, ignore=IGNORE, symlinks=False)
        print(f'已部署 {name} -> {path}')

    print('\n=== 校验 ===')
    inodes: dict[int, list[str]] = {}
    ok = True
    for name, path in [('SRC', src)] + targets:
        f = os.path.join(path, 'lib', 'client.js')
        st = os.stat(f)
        inodes.setdefault(st.st_ino, []).append(name)
        good = (md5(f) == want and st.st_nlink == 1)
        ok = ok and good
        print('  %-7s md5=%s inode=%s nlink=%s %s' % (name, md5(f), st.st_ino, st.st_nlink, '' if good else '✗ 与源码不一致或仍是硬链接'))
    shared = {k: v for k, v in inodes.items() if len(v) > 1}
    print('  共享 inode 的分组：', shared or '无（各自独立）')
    print('  运行时是符号链接吗：', os.path.islink(run))
    print('\n' + ('✅ 完成：均为独立实体副本，内容与源码一致' if ok and not shared else '❌ 校验未通过'))
    return 0 if ok and not shared else 1


if __name__ == '__main__':
    raise SystemExit(main())
