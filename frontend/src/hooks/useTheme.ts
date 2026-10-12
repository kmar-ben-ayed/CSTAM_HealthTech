import { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'cg-theme';
const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(mode: ThemeMode) {
  const effective = mode === 'system' ? getSystemTheme() : mode;
  document.documentElement.setAttribute('data-theme', effective);
}

// Storage can be unavailable (private windows, blocked site data); the theme
// then simply isn't remembered.
function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : 'light';
  } catch {
    return 'light';
  }
}

function storeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    storeMode(m);
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
