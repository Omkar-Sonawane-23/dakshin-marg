import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './3d-theme.css';
import './reference-ui.css';
import './showcase/showcase.css';
import Showcase from './showcase/Showcase.tsx';
import { ThemeProvider } from './state/themeStore';

const ConsoleApp = lazy(() => import('./App.tsx'));

const isConsoleRoute = window.location.pathname === '/console' || window.location.pathname.startsWith('/console/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConsoleRoute ? (
      <ThemeProvider>
        <Suspense fallback={<div className="h-full flex items-center justify-center bg-abyss text-accent font-data text-xs tracking-[0.15em]">LOADING MISSION CONSOLE…</div>}>
          <ConsoleApp />
        </Suspense>
      </ThemeProvider>
    ) : <Showcase />}
  </StrictMode>,
);
