/**
 * Theme store — one design system, two themes.
 *
 * Resolution order:
 *   1. explicit user choice persisted in localStorage ('polaris-theme')
 *   2. OS preference via prefers-color-scheme (tracked live until the
 *      user makes an explicit choice)
 *   3. dark (mission-control default)
 *
 * The <html data-theme="…"> attribute is the single switch; index.css
 * re-points every design token under [data-theme="light"]. An inline
 * script in index.html applies the attribute before first paint.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'polaris-theme';

function systemTheme(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

interface ThemeCtx {
  theme: Theme;
  /** Explicit user toggle — persists the choice. */
  toggleTheme: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());

  // Reflect state onto <html> whenever it changes.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Follow OS changes only while the user has not chosen explicitly.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const onChange = () => {
      if (storedTheme() === null) setTheme(mq.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ theme, toggleTheme }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
