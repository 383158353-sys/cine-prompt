# 另一台电脑安装说明（影词魔方）

## 最快：打开网页，或从同一页下载安装包

1. 打开 https://cine-prompt-tau.vercel.app
2. 直接使用网页：进入「API 设置」，填写自己的 Base URL / API Key / 模型并保存。密钥只留在这台浏览器，不要分享。
3. 想安装到电脑：在同一页点击「下载 Windows」或「下载 Mac（Apple 芯片 / Intel）」。安装包是当前版本，不含密钥，不需要先安装 Node.js。
4. Windows：双击 `CinePrompt-Photoshop-Windows.exe`，从开始菜单打开「影词魔方」。安装包会部署 Photoshop「局部改图」插件；打开 PS 25+ 后在增效工具中加载面板，并填写自己的生图 Key。
5. Mac：解压 zip，把「影词魔方」拖进「应用程序」。若系统拦截未公证应用，右键打开，或到「系统设置 → 隐私与安全性」选择「仍要打开」。Mac 版是完整工作台；Photoshop 语音和拖放助手目前只随 Windows 安装包提供。

发布页（安装包文件本体）：https://github.com/383158353-sys/cine-prompt/releases/tag/desktop-v0.3.0

本机设置与历史数据在重装时会保留；**不要**把 `.env` / `.env.local` 或含密钥的文件拷到公开仓库。

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
