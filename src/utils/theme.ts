import type { AccentPreference, ThemePreference } from '@shared/types';

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyThemePreference(pref: ThemePreference): void {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
}

export function applyAccent(pref: AccentPreference): void {
  document.documentElement.dataset.accent = pref || 'blue';
}

export function applyChrome(themePref: ThemePreference, accent: AccentPreference): void {
  applyThemePreference(themePref);
  applyAccent(accent);
}

export function watchSystemTheme(
  pref: ThemePreference,
  accent: AccentPreference = 'blue',
): () => void {
  applyChrome(pref, accent);
  if (pref !== 'follow') {
    return () => undefined;
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyChrome('follow', accent);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
