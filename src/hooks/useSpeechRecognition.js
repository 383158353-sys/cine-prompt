import { useState, useEffect, useRef, useCallback } from 'react';

// 浏览器原生语音识别（Web Speech API），实时把麦克风语音转成文字
/** @param {{lang?: string, onResult?: (text:string)=>void, onError?: (error:string, type?:string)=>void}} options */
export function useSpeechRecognition({ lang = 'zh-CN', onResult, onError } = {}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef(null);
  const localRef = useRef(null);
  const runRef = useRef(0);
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
        'network': '浏览器语音识别服务不可用。请使用桌面版的本机语音服务，或检查浏览器的语音服务连接。',
        'aborted': '',
      };
      const msg = map[errType];
      if (msg) onErrorRef.current?.(msg, errType);
    };
    recRef.current = rec;
    return () => { ++runRef.current;try { rec.abort(); } catch {} };
  }, [lang]);
  useEffect(()=>{fetch('/api/local/voice/health').then(response=>response.json()).then(data=>{if(data.state==='ready')setSupported(true);}).catch(()=>{});},[]);

  // start(initialText)：以当前已有文本为基底，语音在其上追加，不会清空已输入内容
  const start = useCallback(async (initialText = '') => {
    const run=++runRef.current;
    finalTextRef.current = initialText || '';
    try {
      const health=await fetch('/api/local/voice/health').then(response=>response.json());
      if(run!==runRef.current)return;
      if(health.state==='ready') {
        const response=await fetch('/api/local/voice/start',{method:'POST'}),session=await response.json();
        if(!response.ok)throw new Error(session.message||'本机语音服务启动失败');
        if(run!==runRef.current)return;
        localRef.current={id:session.id,cursor:session.cursor||0};setListening(true);
        const poll=async()=>{
          const current=localRef.current;if(run!==runRef.current||!current)return;
          try {
            const response=await fetch(`/api/local/voice/status?id=${encodeURIComponent(current.id)}&cursor=${current.cursor}`);
            const data=await response.json();if(!response.ok)throw new Error(data.message||'语音识别失败');
            if(run!==runRef.current)return;
            for(const event of data.events||[])if(event.seq>current.cursor){finalTextRef.current+=event.text;current.cursor=event.seq;onResultRef.current?.(finalTextRef.current);}
            if(data.state==='error'){localRef.current=null;setListening(false);onErrorRef.current?.(data.message||'本机语音识别失败','local');return;}
            if(data.state==='complete'){localRef.current=null;setListening(false);if(!current.cursor&&data.message)onErrorRef.current?.(data.message,'local');return;}
            current.timer=setTimeout(poll,350);
          } catch(error){if(run===runRef.current){localRef.current=null;setListening(false);onErrorRef.current?.(error.message,'local');}}
        };poll();return;
      }
    } catch {}
    if(run!==runRef.current)return;
    if(!recRef.current){onErrorRef.current?.('本机中文语音服务未启动。请重新启动影词魔方。','local');return;}
    try { recRef.current.start(); setListening(true); } catch {}
  }, []);

  const stop = useCallback(() => {
    ++runRef.current;
    if(localRef.current){const {id,timer}=localRef.current;clearTimeout(timer);localRef.current=null;fetch(`/api/local/voice/stop?id=${encodeURIComponent(id)}`,{method:'POST'}).catch(()=>{});}
    try { recRef.current?.stop(); } catch {}
    setListening(false);
  }, []);

  const toggle = useCallback((initialText = '') => { listening ? stop() : start(initialText); }, [listening, start, stop]);

  return { listening, supported, start, stop, toggle };
}
