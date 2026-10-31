
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

// Register Service Worker for offline capability
if ('serviceWorker' in navigator && process.env.NODE_ENV !== 'development') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('Bazaar-Sense SW registered:', reg.scope))
      .catch((err) => console.log('Bazaar-Sense SW registration failed:', err));
  });
} else if ('serviceWorker' in navigator) {
  // Also register in dev/preview if available for offline testing
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('Bazaar-Sense SW active:', reg.scope))
      .catch((err) => console.log('Bazaar-Sense SW failed:', err));
  });
}
