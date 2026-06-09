import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/App';

const container = document.getElementById('root');
if (!container) throw new Error('sidepanel root element missing');
createRoot(container).render(
  <StrictMode>
    <App surface="panel" />
  </StrictMode>,
);
