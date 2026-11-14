import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme } from './shell/theme';
import './styles/tokens.css';
import './styles/base.css';

// Before the first paint, so a dark theme never flashes light.
applyTheme();

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
