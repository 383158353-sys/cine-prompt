# 另一台电脑安装说明（影词魔方）

## 最快：安装桌面版（推荐）

1. 打开发布页：https://github.com/383158353-sys/cine-prompt/releases
2. 下载最新的 `CinePrompt-Photoshop-Windows.exe`
3. 双击安装（无需预先安装 Node.js）
4. 从开始菜单打开「影词魔方」
5. 首次使用在「API 设置」填写自己的 Base URL / API Key / 模型，保存即可
6. 安装包会同时部署配套的 Photoshop「局部改图」UXP 插件；打开 PS 后在增效工具中加载面板

本机设置与历史数据在重装时会保留；**不要**把 `.env` / `.env.local` 或含密钥的文件拷到公开仓库。

## macOS（双平台）

1. 发布页下载 `CinePrompt-Photoshop-Mac.dmg`（未签名时需在「系统设置 → 隐私与安全性」允许打开），或源码：`npm install && npm run desktop`
2. 安装包会把「局部改图」拷到  
   `~/Library/Application Support/Adobe/UXP/Plugins/External/com.local.lk888.psedit`
3. 打开 Photoshop → 增效工具 →「局部改图」；影词魔方里填 API
4. 源码辅助入口：`installer/macos/启动影词魔方.command`、`installer/macos/安装PS插件到UXP.command`
5. 打包：`PS_PLUGIN_SOURCE=/path/to/ps-local-edit/plugin npm run package:mac`  
   （本助手 box 默认 `/workspace/push-ps/ps-local-edit/plugin`）

macOS 一期：桌面壳 + 桥接 + 插件安装可用；系统听写/拖入接图层/一键插入到任意输入框为二期。

## 开发/源码方式

1. 安装 Node.js 22+ LTS
2. `git clone https://github.com/383158353-sys/cine-prompt.git`
3. `cd cine-prompt && npm install && npm start`
4. 浏览器打开 http://127.0.0.1:5173 ，在网页里配置 API

也可双击 `启动影词模方.bat`。

## 与 Photoshop 联动

- 桌面安装包已含插件与本机助手
- 单独维护插件仓库：https://github.com/383158353-sys/ps-local-edit
- 详见该仓库 `INSTALL-其他电脑.md`

## 仓库分支

- `main`：当前完整可用源码（含桌面桥接与提示词工作台）
- 大安装包不进 git，只放在 GitHub Releases
