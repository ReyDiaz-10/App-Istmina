import React from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import AnimatedButton from '../../components/AnimatedButton';
import { APP_INFO } from '../../constants/appInfo';
import { useAuthStore } from '../../store/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import MarketplaceBrand from '../../components/MarketplaceBrand';
import { useTranslation } from '../../hooks/useTranslation';
import { usePreferencesStore } from '../../store/preferencesStore';

export default function AboutScreen({ navigation }) {
  const role = useAuthStore((state) => state.profile?.role);
  const { colors } = useAppTheme();
  const t = useTranslation();
  const language = usePreferencesStore((state) => state.language);
  const openContact = async () => {
    if (!APP_INFO.supportEmail) {
      Alert.alert('Contacto por configurar', 'Configura el correo oficial de soporte en app/src/constants/appInfo.js.');
      return;
    }
    const subject = language === 'en' ? 'Help with IstmiYa' : 'Ayuda con IstmiYa';
    const url = `mailto:${APP_INFO.supportEmail}?subject=${encodeURIComponent(subject)}`;
    if (await Linking.canOpenURL(url)) Linking.openURL(url);
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <AnimatedButton variant="back" navigation={navigation} style={styles.backButton} />
      <MarketplaceBrand size={82} />
      <Text style={[styles.brand, { color: colors.text }]}>IstmiYa</Text>
      <Text style={[styles.heading, { color: colors.text }]}>{t('about.heading')}</Text>
      <Text style={[styles.copy, { color: colors.muted }]}>{t('about.copy')}</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.line, { color: colors.text }]}>{t('about.creator')} {APP_INFO.creator}</Text>
        <Text style={[styles.line, { color: colors.text }]}>{t('about.version')} {APP_INFO.version}</Text>
      </View>
      <AnimatedButton title={t('about.contact')} onPress={openContact} />
      <AnimatedButton title={t('about.suggest')} onPress={() => navigation.navigate('Support', { context: 'general' })} />
      <AnimatedButton title={t('home.settings')} onPress={() => navigation.navigate('Settings')} variant="secondary" />
      <AnimatedButton title={t('about.privacy')} onPress={() => navigation.navigate('Privacy')} variant="secondary" />
      <AnimatedButton title={t('about.admin')} onPress={() => navigation.navigate('Login', { adminOnly: true })} variant="secondary" />
      {role === 'superadmin' && <Text style={styles.admin}>{t('about.adminActive')}</Text>}
      <Text style={styles.note}>{t('about.note')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { flexGrow: 1, padding: 24, justifyContent: 'center' }, backButton: { alignSelf: 'flex-start', marginBottom: 8 }, brand: { fontSize: 34, fontWeight: '800', textAlign: 'center' }, heading: { textAlign: 'center', fontSize: 19, fontWeight: '700', marginTop: 8 }, copy: { textAlign: 'center', lineHeight: 22, marginVertical: 14 }, card: { borderRadius: 14, padding: 16, marginVertical: 12 }, line: { marginVertical: 4 }, note: { color: '#777', fontSize: 12, textAlign: 'center', marginTop: 14 }, admin: { textAlign: 'center', color: '#167447', fontWeight: '700', marginTop: 8 } });
