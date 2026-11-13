import { useColorScheme } from 'react-native';
import { usePreferencesStore } from '../store/preferencesStore';

const PALETTES = {
  light: {
    background: '#F6F7FA',
    surface: '#FFFFFF',
    elevated: '#FFF4E5',
    text: '#20242A',
    muted: '#67717B',
    border: '#E2E5E9',
    input: '#FFFFFF',
    primary: '#E66A00',
    onPrimary: '#FFFFFF',
  },
  dark: {
    background: '#101318',
    surface: '#1B2028',
    elevated: '#29231C',
    text: '#F4F6F8',
    muted: '#AFB7C1',
    border: '#343B46',
    input: '#1B2028',
    primary: '#FF9A43',
    onPrimary: '#19120B',
  },
};

export function useAppTheme() {
  const systemScheme = useColorScheme();
  const appearance = usePreferencesStore((state) => state.appearance);
  const mode = appearance === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : appearance;
  return { mode, colors: PALETTES[mode] };
}
