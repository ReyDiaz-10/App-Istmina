import { useEffect, useState } from 'react';
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
  const [clockTime, setClockTime] = useState(() => Date.now());

  useEffect(() => {
    if (appearance !== 'clock') return undefined;

    let timeout;
    const updateAtNextBoundary = () => {
      const now = new Date();
      setClockTime(now.getTime());
      const next = new Date(now);
      if (now.getHours() < 6) {
        next.setHours(6, 0, 0, 0);
      } else if (now.getHours() < 18) {
        next.setHours(18, 0, 0, 0);
      } else {
        next.setDate(next.getDate() + 1);
        next.setHours(6, 0, 0, 0);
      }
      timeout = setTimeout(updateAtNextBoundary, next.getTime() - now.getTime() + 100);
    };

    updateAtNextBoundary();
    return () => clearTimeout(timeout);
  }, [appearance]);

  const hour = new Date(clockTime).getHours();
  const mode = appearance === 'clock'
    ? hour >= 6 && hour < 18 ? 'light' : 'dark'
    : appearance === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : appearance;
  return { mode, colors: PALETTES[mode] };
}
