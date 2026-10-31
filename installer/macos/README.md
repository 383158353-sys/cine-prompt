# macOS 安装入口

- `启动影词魔方.command`：源码模式启动（需本机 Node 22+）。
- `安装PS插件到UXP.command`：把 `ps-local-edit/plugin` 拷到  
  `~/Library/Application Support/Adobe/UXP/Plugins/External/com.local.lk888.psedit`。

打桌面包（在仓库根目录）：

```bash
export PS_PLUGIN_SOURCE=/path/to/ps-local-edit/plugin   # box 默认见下方
npm run package:mac
# 产物：release-desktop/CinePrompt-Photoshop-Mac.dmg 与 .zip
```

在本助手 box 上默认 `PS_PLUGIN_SOURCE=/workspace/push-ps/ps-local-edit/plugin`。

正式分发前需配置 Apple Developer **codesign + notarize**（当前为未签名包，仅供本机/测试）。
