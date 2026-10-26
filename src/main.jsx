import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import ErrorBoundary from '@/components/ErrorBoundary';
import { installPublicWeb } from '@/lib/publicWeb';
import '@/index.css'

if (import.meta.env.VITE_PUBLIC_WEB === 'true') installPublicWeb();

// Register service worker for PWA desktop installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)