import { Appearance } from 'react-native';

export function applyAppearancePreference(appearance) {
  if (typeof Appearance.setColorScheme !== 'function') return;
  Appearance.setColorScheme(appearance === 'system' ? 'auto' : appearance);
}
