
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Service worker (offline support) is production-only. In development it served stale,
// cached copies of the code, so edits and fixes never showed up in the browser.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('Bazaar-Sense SW registered:', reg.scope))
        .catch((err) => console.log('Bazaar-Sense SW registration failed:', err));
    });
  } else {
    // Remove any worker/cache left over from earlier runs.
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
}
