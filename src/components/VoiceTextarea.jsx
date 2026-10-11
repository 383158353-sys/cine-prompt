import React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Mic, MicOff } from 'lucide-react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { toast } from '@/components/ui/use-toast';

// 带原生语音输入的文本框：右下角麦克风按钮，语音实时转写追加到文本
// 按钮始终显示：浏览器不支持时置灰提示，识别出错时弹出原因（如未授权麦克风）
export default function VoiceTextarea({ value, onChange, placeholder, className }) {
  const voice = useSpeechRecognition({
    onResult: (text) => onChange(text),
    onError: (msg) => toast({ title: msg, variant: 'destructive' }),
  });

  const handleClick = () => {
    if (!voice.supported) {
      toast({ title: '当前环境不支持语音输入', description: '请使用 Chrome / Edge 浏览器，并确保页面通过 https 访问', variant: 'destructive' });
      return;
    }
    voice.toggle(value);
  };

  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={voice.listening ? '正在聆听…请说话' : placeholder}
        className={`${className || ''} pr-12`}
      />
      <button
        type="button"
        onClick={handleClick}
        title={
          !voice.supported
            ? '当前环境不支持语音输入（请用 Chrome / Edge）'
            : voice.listening
              ? '停止语音输入'
              : '语音输入'
        }
        className={`absolute right-2 bottom-2 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
          !voice.supported
            ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
            : voice.listening
              ? 'bg-red-500 text-white animate-pulse'
              : 'bg-foreground text-background hover:bg-foreground/90'
        }`}
      >
        {voice.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>
    </div>
  );
}