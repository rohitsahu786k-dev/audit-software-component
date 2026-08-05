import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AppProvider } from './context/AppContext.jsx';
import './index.css';

// One-time cleanup: this app used to cache all data in localStorage. Purge any
// leftover keys from a browser that visited before this migration — MongoDB is
// now the only source of truth, nothing is cached client-side across page loads.
try {
  Object.keys(localStorage)
    .filter(k => k.startsWith('ap_') || k.startsWith('imp_'))
    .forEach(k => localStorage.removeItem(k));
} catch {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
