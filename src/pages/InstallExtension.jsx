import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Chrome, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

import manifestRaw from '@/extension-files/manifest.json?raw';
import backgroundRaw from '@/extension-files/background.js?raw';
import contentRaw from '@/extension-files/content.js?raw';
import optionsHtmlRaw from '@/extension-files/optionsHtml.js';
import optionsJsRaw from '@/extension-files/options.js?raw';
import readmeRaw from '@/extension-files/README.md?raw';

const FILES = [
  ['manifest.json', manifestRaw],
  ['background.js', backgroundRaw],
  ['content.js', contentRaw],
  ['options.html', optionsHtmlRaw],
  ['options.js', optionsJsRaw],
  ['README.md', readmeRaw],
];

// 最小化 ZIP 打包器（仅存储，无压缩）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u16 = (dv, o, v) => dv.setUint16(o, v, true);
const u32 = (dv, o, v) => dv.setUint32(o, v, true);

function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = enc.encode(text);
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const size = data.length;
    const lfh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lfh.buffer);
    u32(dv, 0, 0x04034b50); u16(dv, 4, 20); u16(dv, 6, 0); u16(dv, 8, 0);
    u16(dv, 10, 0); u16(dv, 12, 0x21); u32(dv, 14, crc);
    u32(dv, 18, size); u32(dv, 22, size); u16(dv, 26, nameBytes.length); u16(dv, 28, 0);
    lfh.set(nameBytes, 30);
    parts.push(lfh, data);
    const cdr = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdr.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0); u16(cv, 10, 0);
    u16(cv, 12, 0); u16(cv, 14, 0x21); u32(cv, 16, crc); u32(cv, 20, size); u32(cv, 24, size);
    u16(cv, 28, nameBytes.length); u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0);
    u32(cv, 38, 0); u32(cv, 42, offset);
    cdr.set(nameBytes, 46);
    central.push(cdr);
    offset += lfh.length + data.length;
  }
  let centralLen = 0;
  central.forEach((c) => (centralLen += c.length));
  const centralBuf = new Uint8Array(centralLen);
  let p = 0;
  central.forEach((c) => { centralBuf.set(c, p); p += c.length; });
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 8, central.length); u16(ev, 10, central.length);
  u32(ev, 12, centralLen); u32(ev, 16, offset);
  const all = [...parts, centralBuf, eocd];
  let total = 0;
  all.forEach((b) => (total += b.length));
  const out = new Uint8Array(total);
  let q = 0;
  all.forEach((b) => { out.set(b, q); q += b.length; });
  return out;
}

export default function InstallExtension() {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = () => {
    setDownloading(true);
    try {
      const zip = buildZip(FILES.map(([name, text]) => [name, text]));
      const blob = new Blob([zip], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'promptcinema-extension.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
      toast({ title: '扩展包已开始下载' });
    } catch (e) {
      toast({ title: '下载失败', description: e.message, variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  const steps = [
    { title: '下载扩展压缩包', desc: '点上方按钮下载 promptcinema-extension.zip，下载后右键 → 全部解压缩，得到一个 promptcinema-extension 文件夹。' },
    { title: '打开浏览器扩展管理页', desc: '地址栏输入 chrome://extensions 回车（联想浏览器同样输入 chrome://extensions）。' },
    { title: '打开开发者模式', desc: '页面右上角有个「开发者模式」开关，把它打开。' },
    { title: '加载已解压的扩展程序', desc: '点左上角「加载已解压的扩展程序」，选中解压出来的 promptcinema-extension 文件夹（里面直接能看到 manifest.json 的那一层）。' },
    { title: '配置接口地址', desc: '在扩展卡片里点「详情 → 扩展选项」，把 enhancePrompt 接口地址和完整应用地址填进去保存。' },
    { title: '设置快捷键（可选）', desc: '打开 chrome://extensions/shortcuts，给「打开/关闭提示词增强浮窗」设一个你顺手的快捷键，默认 Ctrl+Shift+E。' },
    { title: '开始使用', desc: '在任意普通网页按快捷键，右上角弹出小窗，输入灵感 → 优化生成，英文提示词自动复制。' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 sticky top-0 bg-background/80 backdrop-blur-md z-10">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← 返回工作台</Link>
          <span className="text-xs text-muted-foreground">扩展安装向导</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-foreground flex items-center justify-center mx-auto mb-4">
            <Chrome className="w-7 h-7 text-background" />
          </div>
          <h1 className="text-2xl font-bold mb-2">安装浮窗增强扩展</h1>
          <p className="text-sm text-muted-foreground">一键下载扩展包，装到 Chrome 或联想浏览器，即可在任意网页用快捷键唤起提示词增强小窗。</p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-6 text-center mb-10">
          <Button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full sm:w-auto h-12 px-8 text-base bg-foreground text-background hover:bg-foreground/90"
          >
            {downloading ? (
              <span className="animate-pulse">正在打包…</span>
            ) : downloaded ? (
              <><Check className="w-5 h-5 mr-2" />重新下载扩展包</>
            ) : (
              <><Download className="w-5 h-5 mr-2" />一键下载扩展程序 (.zip)</>
            )}
          </Button>
          <p className="text-xs text-muted-foreground mt-3">包含全部 6 个文件，解压后即可加载</p>
        </div>

        <h2 className="font-semibold text-lg mb-4">安装步骤</h2>
        <div className="space-y-3 mb-10">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-4 rounded-xl border border-border/50 bg-card p-4">
              <div className="shrink-0 w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold">
                {i + 1}
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-1">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 mb-6">
          <h3 className="text-sm font-semibold mb-2">接口地址怎么获取？</h3>
          <p className="text-xs text-muted-foreground leading-relaxed mb-2">
            打开你的完整 PromptCinema 应用并登录 → 按 F12 打开开发者工具 → 点上方「Network / 网络」标签 → 在应用里点一次「优化生成」→ 在网络列表里找到名字含 enhancePrompt 的请求 → 点开看 Headers，复制请求 URL。
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">完整应用地址就是你平时打开应用的网址（https 开头）。</p>
        </div>

        <div className="rounded-xl border border-border/50 bg-muted/30 p-5">
          <h3 className="text-sm font-semibold mb-2">常见问题</h3>
          <ul className="text-xs text-muted-foreground space-y-2 leading-relaxed">
            <li><b>Chrome 和联想浏览器都要装吗？</b>是的，每个浏览器各装一次、各登录一次。两个浏览器都按上面的步骤走一遍即可。</li>
            <li><b>按快捷键没反应？</b>确认打开的是普通网页（不是浏览器设置页），并刷新一下当前网页再试。</li>
            <li><b>提示未登录？</b>点小窗右上角 ⤢ 打开完整应用登录后重试。</li>
            <li><b>多图、反推、视角模式？</b>这些需要上传图片，请在完整应用里用，小窗只支持文字增强。</li>
          </ul>
        </div>
      </main>
    </div>
  );
}