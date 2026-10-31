import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, HardDrive, PlugZap, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DOWNLOAD_URL = 'https://github.com/383158353-sys/cine-prompt/releases/latest/download/CinePrompt-Photoshop-Windows.exe';

const steps = [
  ['下载安装包', '下载 CinePrompt-Photoshop-Windows.exe。'],
  ['双击安装', '双击安装程序即可。不需要管理员权限，也不需要另装 Node.js。'],
  ['设置一次 API', '安装完成会打开影词魔方。在“API 设置”中填写自己的接口信息并保存。'],
  ['打开 Photoshop', '从“增效工具”打开“局部改图”，在修改要求右侧点击“✨ 优化”。'],
];

export default function InstallPhotoshop() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 sticky top-0 bg-background/80 backdrop-blur-md z-10">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← 返回工作台</Link>
          <span className="text-xs text-muted-foreground">Photoshop 联动安装</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-10">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-foreground flex items-center justify-center mx-auto mb-4">
            <PlugZap className="w-7 h-7 text-background" />
          </div>
          <h1 className="text-2xl font-bold mb-2">安装 Photoshop 连接器</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Windows 一键安装包同时配置影词魔方桌面悬浮版、局部改图插件和本机连接服务。macOS 请使用 Releases 中的 CinePrompt-Photoshop-Mac.dmg，或见 INSTALL-其他电脑.md。换电脑后重新安装即可。
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-6 text-center mb-8">
          <Button asChild className="w-full sm:w-auto h-12 px-8 text-base bg-foreground text-background hover:bg-foreground/90">
            <a href={DOWNLOAD_URL}>
              <Download className="w-5 h-5 mr-2" />
              下载 Windows 一键安装包
            </a>
          </Button>
          <p className="text-xs text-muted-foreground mt-3">Windows 10/11 · Photoshop 2024/2025 · 无需 Node.js</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-10">
          {[
            { Icon: HardDrive, title: '本机保存', desc: '原图、历史和 API Key 只保存在自己的电脑。' },
            { Icon: ShieldCheck, title: '本机接口', desc: '连接器只监听 127.0.0.1，不开放局域网访问。' },
            { Icon: CheckCircle2, title: '自动启动', desc: '登录 Windows 后自动运行，无需手动敲命令。' },
          ].map(({ Icon, title, desc }) => (
            <div key={title} className="rounded-xl border border-border/50 bg-card p-4">
              <Icon className="w-5 h-5 mb-3" />
              <h2 className="text-sm font-semibold mb-1">{title}</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <h2 className="font-semibold text-lg mb-4">安装步骤</h2>
        <div className="space-y-3 mb-8">
          {steps.map(([title, desc], index) => (
            <div key={title} className="flex gap-4 rounded-xl border border-border/50 bg-card p-4">
              <div className="shrink-0 w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold">{index + 1}</div>
              <div>
                <h3 className="text-sm font-semibold mb-1">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border/50 bg-muted/30 p-5 text-xs text-muted-foreground leading-relaxed">
          安装包不会把 API Key 写进插件。局部改图与影词魔方仍是两个独立程序，只通过本机 HTTP 接口联动；关闭影词魔方时，插件原有生成能力仍可单独使用。
        </div>
      </main>
    </div>
  );
}
