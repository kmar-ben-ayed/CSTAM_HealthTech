import { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(mode: ThemeMode) {
  const effective = mode === 'system' ? getSystemTheme() : mode;
  document.documentElement.setAttribute('data-theme', effective);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem('cg-theme') as ThemeMode) || 'light';
  });

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem('cg-theme', m);
    applyTheme(m);
  };

  useEffect(() => {
    applyTheme(mode);
  }, []);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const effectiveTheme =
    mode === 'system' ? getSystemTheme() : mode;

  return { mode, setMode, effectiveTheme };
}
