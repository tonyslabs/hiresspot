import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, PlatformProvider } from '@hiresspot/ui';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container not found');
}

createRoot(container).render(
  <React.StrictMode>
    <PlatformProvider platform={window.hiresspot}>
      <App />
    </PlatformProvider>
  </React.StrictMode>
);
