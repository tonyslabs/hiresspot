import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, PlatformProvider } from '@hiresspot/ui';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
// Mismos tokens y materiales que el escritorio ("Cristal de Estudio")
import '../../desktop/src/renderer/index.css';
import { App as CapApp } from '@capacitor/app';
import { createAndroidPlatform } from './platform';

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');

createRoot(container).render(
  <React.StrictMode>
    <PlatformProvider platform={createAndroidPlatform()}>
      <App />
    </PlatformProvider>
  </React.StrictMode>
);

// Botón/gesto Atrás: primero cierra lo que esté abierto encima (Reproduciendo, buscador, menús),
// luego retrocede en la navegación y, en la pantalla inicial, minimiza sin cortar la música.
void CapApp.addListener('backButton', () => {
  if (document.querySelector('[role="dialog"], [role="menu"]')) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return;
  }
  const atHome = ['', '#', '#/'].includes(window.location.hash);
  if (atHome) void CapApp.minimizeApp();
  else window.history.back();
});
