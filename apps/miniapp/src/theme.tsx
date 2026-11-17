import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'hod-theme';

function readTheme(): Theme {
  try {
    const theme = localStorage.getItem(STORAGE_KEY);
    if (theme === 'light' || theme === 'dark') return theme;
  } catch {
    /* Storage may be restricted inside a webview. */
  }
  return 'system';
}

export function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function initializeTheme(): void {
  applyTheme(readTheme());
}

export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Keep this session's choice. */
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => applyTheme(theme);
    media?.addEventListener?.('change', update);
    return () => media?.removeEventListener?.('change', update);
  }, [theme]);
  return (
    <label className="theme-picker">
      <span className="sr-only">Тема оформления</span>
      <select
        aria-label="Тема оформления"
        value={theme}
        onChange={(event) => setTheme(event.target.value as Theme)}
      >
        <option value="system">◐ Как на устройстве</option>
        <option value="light">☀ Светлая</option>
        <option value="dark">☾ Тёмная</option>
      </select>
    </label>
  );
}
