# 影词魔方 + Photoshop 局部改图：完整交付包

## 给 Codex 的一句话

把整个 ZIP 交给 Codex，并发送：

> 请解压这个安装包，读取根目录 AGENTS.md，先校验文件，再执行 install.ps1，完成影词魔方和 Photoshop 局部改图插件安装。检查本机服务和插件文件，保留现有配置及历史，不要只给我操作说明。不要使用发送者的密钥；最后让我在软件中填写自己的 API Key。遇到系统确认或缺少 Photoshop 时准确告诉我。

Codex 必须运行在需要安装软件的 Windows 电脑上，并具有本机文件和终端访问能力。仅上传到没有本机访问权限的网页聊天不能安装你的电脑。

## 访问地址

- 影词魔方源码：https://github.com/383158353-sys/cine-prompt
- PS 插件源码：https://github.com/383158353-sys/ps-local-edit
- 完整交付包发布页：https://github.com/383158353-sys/cine-prompt/releases/tag/handoff-2026-10-15
- 原桌面安装程序：https://github.com/383158353-sys/cine-prompt/releases/download/desktop-v0.2.1/CinePrompt-Photoshop-Windows.exe
- PS 插件发布页：https://github.com/383158353-sys/ps-local-edit/releases/tag/plugin-v0.1.1

## 文件组成

- `install.ps1`、`一键安装.cmd`：自动安装、补丁、插件部署、启动检查。
- `installer/CinePrompt-Photoshop-Windows.exe`：原 v0.2.1 安装程序，内置 Electron/Node 运行时。
- `patch/app/`：修复模型列表溢出与聊天模型过滤后的前端和服务端补丁。
- `patch/ps-plugin/`、`patch/ps-companion/`：v0.1.1 插件和本机语音、剪贴板等助手。
- `source/cine-prompt/`、`source/ps-local-edit/`：两套完整仓库跟踪文件，保留许可与开发说明，不含密钥、历史或 node_modules。
- `manifest.json`：所有交付文件的 SHA-256 校验值。

普通安装不需要安装 Node.js、拉仓库、改代码或重新编译。源码供后续维护，开发时按各仓库说明安装依赖。

## 手动安装（没有 Codex 时）

解压整个 ZIP，双击 `一键安装.cmd`。不要在 ZIP 内直接运行。安装较慢时等待完成，不要重复点击。结果写入 `installation-report.json`。

## 首次使用与完整流程

1. 影词魔方：API 设置 → 填自己的 Base URL/API Key → 读取聊天模型 → 搜索并选择 → 保存。选择具备图片理解能力的聊天模型才能分析参考图。设置与历史在本机保存。
2. Photoshop：需要已安装 Photoshop 25+。安装时 PS 已打开则重启 PS；增效工具中打开「局部改图」，在插件设置里保存自己的 LK888 API Key。
3. 提示词工作台：输入创作要求，按需添加参考图，用聊天模型整理或优化提示词。
4. 局部改图：打开 RGB 文档 → 框选/套索选区 → 更新选区 → 输入修改要求/添加参考图 → 选择图像模型 → 生成 → 点击候选图添加独立图层，保留选区蒙版。
5. 联动：PS 面板提供的影词优化入口通过本机桥接服务唤起影词魔方，完成优化后返回面板；保持影词魔方后台运行。聊天设置中的模型与 PS 生图模型分开配置。
6. 关闭影词窗口会留在托盘；彻底退出用托盘菜单「退出」。更新后彻底退出再打开。

## 自动化边界

这是 Windows x64 安装包，不是 macOS/Linux 通用包。没有 Photoshop、缺少有效 API Key、账号没有相应模型额度，或系统要求确认时，无法承诺零人工操作。安装脚本能自动完成文件校验、桌面安装、补丁、插件部署、快捷方式和服务检查；使用者自己的密钥及系统授权由本人处理。没有打包任何人的付费账号。

## 验证与许可

聊天过滤及设置接口专项测试、构建、ESLint 已通过；长模型列表已在 416px 宽窗口验证搜索、滚动到末项和选择。原仓库全量测试另有 local/palette 测试失败，完整 typecheck 另有现存类型/依赖错误，因此不宣称全量检查通过。未在另一台全新电脑完成真实 PS 生图验收；脚本报告会区分文件部署与实际功能验证。

影词魔方许可见对应源码 LICENSE；PS 插件保留 FromPS/ToPS 的 CC BY-NC-SA 4.0 许可和来源说明。不要把本插件源码或助手作为收费软件销售，具体使用范围以 LICENSE 为准。
