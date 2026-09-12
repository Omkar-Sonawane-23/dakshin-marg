import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './3d-theme.css';
import './reference-ui.css';
import App from './App.tsx';
import { ThemeProvider } from './state/themeStore';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
