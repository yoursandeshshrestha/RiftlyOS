export const THEME_STORAGE_KEY = 'riftly-theme'

export type ThemePreference = 'light' | 'dark' | 'system'

export function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme === 'dark') return 'dark'
  if (theme === 'light') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyThemeClass(theme: ThemePreference) {
  const root = document.documentElement
  if (resolveTheme(theme) === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}
