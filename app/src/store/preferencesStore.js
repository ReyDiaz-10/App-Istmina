import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import appConfig from '../../app.json';

const STORAGE_KEY = 'istmiya-app-preferences-v1';
const PREFERENCES_VERSION = 2;
const DEFAULTS = { language: appConfig.expo.extra?.defaultLanguage || 'es-419', appearance: 'clock' };
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
        hydrated: true,
      });
    } catch (error) {
      console.warn('No se pudieron cargar las preferencias locales:', error.message);
      set({ ...DEFAULTS, hydrated: true });
    }
  },
  setPreference: async (key, value) => {
    if (key === 'language' && !supportedLanguages.has(value)) return;
    if (key === 'appearance' && !supportedAppearance.has(value)) return;
    const next = { language: get().language, appearance: get().appearance, [key]: value };
    set(next);
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
