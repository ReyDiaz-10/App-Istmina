import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import appConfig from '../../app.json';
import { DEFAULT_FONT_SCALE, normalizeFontScale } from '../utils/fontScale.mjs';

const STORAGE_KEY = 'istmiya-app-preferences-v1';
const PREFERENCES_VERSION = 3;
const DEFAULTS = {
  language: appConfig.expo.extra?.defaultLanguage || 'es-419',
  appearance: 'clock',
  fontScale: DEFAULT_FONT_SCALE,
};
const supportedAppearance = new Set(['clock', 'system', 'light', 'dark']);
const supportedLanguages = new Set(['es-419', 'en']);

export const usePreferencesStore = create((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const preferences = stored ? JSON.parse(stored) : {};
      const savedAppearance = preferences.schemaVersion === PREFERENCES_VERSION
        ? preferences.appearance
        : preferences.appearance === 'system' ? 'clock' : preferences.appearance;
      set({
        language: supportedLanguages.has(preferences.language)
          ? preferences.language
          : preferences.language === 'es-CO' ? 'es-419' : DEFAULTS.language,
        appearance: supportedAppearance.has(savedAppearance) ? savedAppearance : DEFAULTS.appearance,
        fontScale: normalizeFontScale(preferences.fontScale),
        hydrated: true,
      });
    } catch (error) {
      console.warn('No se pudieron cargar las preferencias locales:', error.message);
      set({ ...DEFAULTS, hydrated: true });
    }
  },
  setPreference: async (key, value, { persist = true } = {}) => {
    if (key === 'language' && !supportedLanguages.has(value)) return;
    if (key === 'appearance' && !supportedAppearance.has(value)) return;
    if (key === 'fontScale' && (typeof value !== 'number' || !Number.isFinite(value))) return;
    const next = {
      language: get().language,
      appearance: get().appearance,
      fontScale: get().fontScale,
      [key]: key === 'fontScale' ? normalizeFontScale(value) : value,
    };
    set(next);
    if (!persist) return;
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...next, schemaVersion: PREFERENCES_VERSION }),
      );
    } catch (error) {
      console.warn('No se pudo guardar la preferencia:', error.message);
    }
  },
}));
