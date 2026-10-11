import { useState, useEffect, useRef, useCallback } from 'react';

// 浏览器原生语音识别（Web Speech API），实时把麦克风语音转成文字
/** @param {{lang?: string, onResult?: (text:string)=>void, onError?: (error:string, type?:string)=>void}} options */
export function useSpeechRecognition({ lang = 'zh-CN', onResult, onError } = {}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef(null);
  const finalTextRef = useRef('');
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    setSupported(true);
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTextRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      onResultRef.current?.(finalTextRef.current + interim);
    };
    rec.onend = () => { setListening(false); };
    rec.onerror = (e) => {
      setListening(false);
      const errType = e?.error || 'unknown';
      const map = {
        'not-allowed': '请允许浏览器使用麦克风',
        'service-not-allowed': '请允许浏览器使用麦克风',
        'no-speech': '未检测到语音，请重试',
        'audio-capture': '未找到麦克风设备',
        'network': '语音服务网络错误，请检查网络',
        'aborted': '',
      };
      const msg = map[errType];
      if (msg) onErrorRef.current?.(msg, errType);
    };
    recRef.current = rec;
    return () => { try { rec.abort(); } catch {} };
  }, [lang]);

  // start(initialText)：以当前已有文本为基底，语音在其上追加，不会清空已输入内容
  const start = useCallback((initialText = '') => {
    if (!recRef.current) return;
    finalTextRef.current = initialText || '';
    try { recRef.current.start(); setListening(true); } catch {}
  }, []);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch {}
    setListening(false);
  }, []);

  const toggle = useCallback((initialText = '') => { listening ? stop() : start(initialText); }, [listening, start, stop]);

  return { listening, supported, start, stop, toggle };
}