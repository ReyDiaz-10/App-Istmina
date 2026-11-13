import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePreferencesStore } from '../../store/preferencesStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import AnimatedButton from '../../components/AnimatedButton';
import { applyAppearancePreference } from '../../utils/appearance';
import { useTranslation } from '../../hooks/useTranslation';
import { useAuthStore } from '../../store/authStore';

export default function AppSettingsScreen({ navigation }) {
  const language = usePreferencesStore((state) => state.language);
  const appearance = usePreferencesStore((state) => state.appearance);
  const setPreference = usePreferencesStore((state) => state.setPreference);
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const { colors } = useAppTheme();
  const t = useTranslation();
  const languageOptions = [
    { value: 'es-419', label: t('settings.spanish'), detail: t('settings.spanishDetail') },
    { value: 'en', label: t('settings.english'), detail: t('settings.englishDetail') },
  ];
  const appearanceOptions = [
    { value: 'clock', label: t('settings.clock'), detail: t('settings.clockDetail') },
    { value: 'system', label: t('settings.system'), detail: t('settings.systemDetail') },
    { value: 'light', label: t('settings.light'), detail: t('settings.lightDetail') },
    { value: 'dark', label: t('settings.dark'), detail: t('settings.darkDetail') },
  ];

  const changeAppearance = async (value) => {
    await setPreference('appearance', value);
    applyAppearancePreference(value);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
      <AnimatedButton variant="back" navigation={navigation} style={styles.backButton} />
      <Text style={[styles.title, { color: colors.text }]}>{t('settings.title')}</Text>
      <Text style={[styles.description, { color: colors.muted }]}>{t('settings.description')}</Text>

      <Text style={[styles.section, { color: colors.text }]}>{t('settings.language')}</Text>
      {languageOptions.map((option) => {
        const selected = language === option.value;
        return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setPreference('language', option.value)} style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }]}>
          <View style={styles.optionRow}>
            <View style={styles.optionCopy}>
              <Text style={[styles.optionTitle, { color: colors.text }]}>{option.label}</Text>
              <Text style={[styles.detail, { color: colors.muted }]}>{option.detail}</Text>
            </View>
            <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.muted }]}>
              {selected && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
            </View>
          </View>
        </Pressable>;
      })}

      <Text style={[styles.section, { color: colors.text }]}>{t('settings.appearance')}</Text>
      {appearanceOptions.map((option) => {
        const selected = appearance === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => changeAppearance(option.value)}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }]}
          >
            <View style={styles.optionRow}>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: colors.text }]}>{option.label}</Text>
                <Text style={[styles.detail, { color: colors.muted }]}>{option.detail}</Text>
              </View>
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.muted }]}>
                {selected && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
              </View>
            </View>
          </Pressable>
        );
      })}
      {user && (
        <AnimatedButton
          title={t('home.logout')}
          variant="secondary"
          style={styles.logoutButton}
          onPress={async () => {
            const result = await signOut();
            if (result.success) navigation.reset({ index: 0, routes: [{ name: 'ClientHome' }] });
          }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { flexGrow: 1, padding: 22, paddingBottom: 48 },
  backButton: { alignSelf: 'flex-start', marginBottom: 8 },
  logoutButton: { marginTop: 18, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '800' },
  description: { fontSize: 15, lineHeight: 22, marginTop: 6, marginBottom: 22 },
  section: { fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 10 },
  optionRow: { flexDirection: 'row', alignItems: 'center' },
  optionCopy: { flex: 1, paddingRight: 12 },
  optionTitle: { fontSize: 16, fontWeight: '700' },
  detail: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  selected: { fontSize: 13, fontWeight: '700', marginTop: 10 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
});
