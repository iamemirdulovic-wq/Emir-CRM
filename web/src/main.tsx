import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App.js';
import { applyDirection } from './lib/i18n.js';
import { initTheme } from './design/theme.js';
import './styles/index.css';

/**
 * VITE_PREVIEW=1 builds a self-contained demo: the API is served from memory
 * and routing uses the hash, so the bundle runs from any static host with no
 * backend and no server-side rewrite. A normal build replaces the constant with
 * undefined, so the branch and the mock module are dropped entirely.
 */
const PREVIEW = import.meta.env.VITE_PREVIEW === '1';

async function start(): Promise<void> {
  if (PREVIEW) {
    const { installMockApi } = await import('./preview/mock-api.js');
    installMockApi();
  }

  applyDirection();
  initTheme();

  const container = document.getElementById('root');
  if (!container) throw new Error('Root element is missing from index.html');

  const Router = PREVIEW ? HashRouter : BrowserRouter;

  createRoot(container).render(
    <StrictMode>
      <Router>
        <App />
      </Router>
    </StrictMode>,
  );
}

void start();

// Installable PWA: the service worker is registered after first paint so it
// never delays the initial render. The preview has no server to cache from.
if (!PREVIEW && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unavailable service worker must never break the app.
    });
  });
}
