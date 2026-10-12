# 影词模方本地版

安装 Node.js 22 或更新的 LTS 版本。解压后：

1. 在项目文件夹打开终端，执行 `npm install`。
2. 执行 `npm start`，浏览器打开 http://127.0.0.1:5173 。
3. 点击首页右上角「API 设置」，填写 Base URL、API Key 和模型名称，点击「测试连接」或「保存设置」。保存后立即生效，测试不会保存修改。

Windows 可直接双击 `启动影词模方.bat`。也仍支持用 `配置API.bat` 编辑配置。

面向普通用户的 Windows 联动包可运行 `npm run package:windows` 生成。安装包自带 Node 运行时、影词魔方本地网页和 Photoshop「局部改图」插件；用户解压后双击“安装.cmd”即可，不需要预装 Node.js。构建机需设置 `PS_PLUGIN_SOURCE` 指向 `ps-local-edit/plugin`，未设置时会尝试本机开发路径 `D:\PS2025\ps-local-edit\plugin`。生成文件位于 `release/CinePrompt-Photoshop-Windows.zip`。

```env
AI_PROVIDER=compatible
AI_BASE_URL=https://api.lingkeai.ai/api/v1
AI_API_KEY=填入你自己的密钥
AI_MODEL=填入平台实际支持的模型ID
```

Gemini 官方 API 可直接在网页选择“Gemini 官方 API”，地址使用 `https://generativelanguage.googleapis.com/v1beta`，稳定模型可填写 `gemini-3.1-flash-lite`。API Key 在 Google AI Studio 的 API Keys 页面创建。Gemini/Google One 的消费者会员与开发者 API 计费相互独立，会员不会自动提供付费 API 额度。

九视/LingkeAI 聚合平台选择“OpenAI 兼容 / 聚合平台”，Base URL 使用 `https://api.lingkeai.ai/api/v1`。填写密钥后点击“读取模型列表”，直接从账号读取准确模型 ID。页面可以分别指定默认、Gemini、GPT、Claude 按钮所用模型；留空的专属模型会回退到默认模型。

涉及参考图的功能需要支持视觉输入的模型。原界面的自动/Gemini/GPT/Claude 按钮默认都使用 `AI_MODEL`；如需分别指定，填写 `AI_MODEL_GEMINI`、`AI_MODEL_GPT`、`AI_MODEL_CLAUDE`。`AI_IMAGE_MODEL` 可选，用于 `/images/generations` 生成风格缩略图；未配置时文本风格仍能保存，但没有自动缩略图。

`AI_JSON_MODE=prompt` 默认通过提示词要求 JSON 并在本地校验。平台支持时可设置 `json_object`。网络超时可通过 `AI_TIMEOUT_MS` 调整。手动编辑文件后需要重启；网页保存无需重启。

运行 `npm run check:api` 验证真实模型文本和 JSON 调用；运行 `npm run check:api -- --vision` 同时检查图片输入（会消耗少量 API 用量）。开发用 `npm run dev`；重新打包前执行 `npm run build`；测试用 `npm test`。

密钥只由 Node 服务从环境变量或 `.env.local` 读取，不使用 `VITE_` 密钥字段。启动时环境变量优先于文件；网页保存会覆盖当前进程设置并写入文件。如果系统另外设置了同名环境变量，重启时会再次以系统环境变量为准。不要分享 `.env.local`。前端仅请求本地服务。

历史、收藏、自定义方向、风格库保存在 `local-data/db.json`；上传图片保存在 `local-data/uploads/`。备份整个 `local-data` 文件夹即可。原 Base44 云端数据不包含在源码 ZIP 中，不会自动迁移。本地版无需注册登录，仅监听本机地址。

保留原有 UI、提示词与业务流程：普通增强仍包括输入整理，多视角仍逐个生成 14 个视角；这些调用使用你的聚合 API 用量。分镜 CSV/XLSX 在本地解析，不消耗 AI。旧版 `.xls` 请另存为 `.xlsx`。

浏览器扩展的跨网站调用不属于本次本地网页迁移，原扩展文件仅保留作参考。不要在扩展中填写聚合 API 密钥。
