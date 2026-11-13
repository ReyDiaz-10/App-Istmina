import { Appearance } from 'react-native';

export function applyAppearancePreference(appearance) {
  if (typeof Appearance.setColorScheme !== 'function') return;
  const hour = new Date().getHours();
  const mode = appearance === 'clock'
    ? hour >= 6 && hour < 18 ? 'light' : 'dark'
    : appearance === 'system' ? 'auto' : appearance;
  Appearance.setColorScheme(mode);
}
