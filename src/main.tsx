import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/theme.css';

if (import.meta.env.DEV) {
  void import('./app/devtools').then((m) => m.installDevtools());
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
