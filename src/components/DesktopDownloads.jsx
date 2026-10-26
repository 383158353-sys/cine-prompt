import React from 'react';
import { Download } from 'lucide-react';
import { DOWNLOADS } from '@/lib/downloads';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium';

export default function DesktopDownloads() {
  return (
    <section className="mb-6 rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Download className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">下载安装到自己的电脑</h2>
          <p className="text-sm text-muted-foreground mt-1">这个网页可以直接用。想要和本机一样的窗口，下载下面的安装包。安装包是当前版本，不含密钥，不需要先安装 Node.js。</p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-4">
            <a className={`${button} bg-foreground text-background hover:bg-foreground/90`} href={DOWNLOADS.windows}>下载 Windows</a>
            <a className={`${button} border border-border hover:bg-muted`} href={DOWNLOADS.macArm}>下载 Mac（Apple 芯片）</a>
            <a className={`${button} border border-border hover:bg-muted`} href={DOWNLOADS.macIntel}>下载 Mac（Intel）</a>
          </div>
          <div className="text-xs text-muted-foreground mt-4 space-y-2 leading-relaxed">
            <p>Windows：双击安装，从开始菜单打开「影词魔方」。进入 API 设置，填写自己的 Base URL、API Key 和模型，然后保存。需要 Photoshop 联动时，打开 Photoshop 25 或更新版本，在增效工具里打开「局部改图」，再填写自己的生图 Key。安装包会带上当前的局部改图插件。</p>
            <p>Mac（macOS 12 及以上）：解压后把「影词魔方」拖进「应用程序」再打开。系统若提示无法验证开发者，请右键点按应用并选择「打开」，或到「系统设置 → 隐私与安全性」选择「仍要打开」。这个 Mac 包没有 Apple 公证。Photoshop 的语音和拖放助手目前只在 Windows 安装包里；Mac 版是完整的影词魔方工作台，并会把插件文件复制到本机 Adobe 目录。</p>
            <p>密钥由使用者自己填写，只保存在自己的浏览器或电脑里。安装包和网页都不含密钥。不要分享 .env 或 .env.local。源代码给需要自己改的人：<a className="underline" href={DOWNLOADS.source}>GitHub</a>。</p>
          </div>
        </div>
      </div>
    </section>
  );
}
