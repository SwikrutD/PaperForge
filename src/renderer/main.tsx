import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design-system/tokens.css';
import './design-system/base.css';
import { App } from './app/App';
import { AppErrorBoundary } from './app/AppErrorBoundary';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('PaperForge: the renderer root element is missing.');
}

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary region="application">
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
