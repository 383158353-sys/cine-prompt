import { useEffect, useRef } from 'react';

// 全局监听 Ctrl+V 粘贴图片：仅在剪贴板含图片时拦截，纯文本粘贴不受影响
// 用法：useImagePaste(addFiles) — addFiles 接收 File 数组
export function useImagePaste(onPaste) {
  const fnRef = useRef(onPaste);
  fnRef.current = onPaste;
  useEffect(() => {
    const handler = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        fnRef.current(files);
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, []);
}