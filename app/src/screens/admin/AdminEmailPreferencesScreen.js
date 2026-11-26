import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAuthStore } from '../../store/authStore';
import { isAdminRole } from '../../utils/roles';
import { getEmailPreferences, setEmailPreferences } from '../../services/notifications';

const OPTIONS = [
  ['profilePending', 'Perfiles pendientes de aprobación'],
  ['inappropriateLanguage', 'Lenguaje inapropiado moderado en chat'],
  ['financialException', 'Excepciones financieras y de retiro'],
];

export default function AdminEmailPreferencesScreen({ navigation }) {
  const profile = useAuthStore((state) => state.profile);
  const { colors } = useAppTheme();
  const [preferences, setPreferences] = useState({ profilePending: true, inappropriateLanguage: true, financialException: true, email: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    if (!profile?.id || !isAdminRole(profile.role)) { setLoading(false); return undefined; }
    getEmailPreferences(profile.id)
      .then((value) => { if (active) setPreferences(value); })
      .catch((loadError) => { if (active) setError(loadError.message || 'No se pudieron cargar las preferencias.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profile?.id, profile?.role]);

  const save = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const email = preferences.email.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ingresa un correo válido.');
      await setEmailPreferences(profile.id, { ...preferences, email });
      setSuccess('Preferencias de correo guardadas.');
    } catch (saveError) {
      setError(saveError.message || 'No se pudieron guardar las preferencias.');
    } finally { setSaving(false); }
  };

  if (!isAdminRole(profile?.role)) return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={{ color: colors.text }}>Esta sección requiere una cuenta administradora.</Text></View>;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <View style={styles.header}><AnimatedButton variant="back" navigation={navigation} /><Text style={[styles.title, { color: colors.text }]}>Preferencias de alertas</Text></View>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.description, { color: colors.muted }]}>Elige qué avisos administrativos quieres recibir por correo. Remitente: istmiyanotificaciones@gmail.com · Soporte: istmiyasoporte@gmail.com.</Text>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {success ? <Text accessibilityRole="alert" style={styles.success}>{success}</Text> : null}
        <Text style={[styles.label, { color: colors.text }]}>Correo de destino</Text>
        <TextInput accessibilityLabel="Correo destinatario de alertas" autoCapitalize="none" keyboardType="email-address" placeholder="correo@ejemplo.com" value={preferences.email} onChangeText={(email) => { setSuccess(''); setPreferences((current) => ({ ...current, email })); }} style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} />
        {OPTIONS.map(([key, label]) => (
          <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: Boolean(preferences[key]) }} onPress={() => { setSuccess(''); setPreferences((current) => ({ ...current, [key]: !current[key] })); }}>
            <Text style={[styles.option, { color: colors.text }]}>{preferences[key] ? '☑' : '☐'} {label}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" disabled={saving || loading} onPress={() => void save()} style={[styles.save, { backgroundColor: colors.primary }, (saving || loading) && styles.disabled]}>
          <Text style={styles.saveText}>{saving ? 'Guardando…' : 'Guardar preferencias'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 40 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 }, title: { fontSize: 23, fontWeight: '800', flex: 1 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 18 }, description: { lineHeight: 20 },
  label: { fontWeight: '700', marginTop: 16 }, input: { borderWidth: 1, borderRadius: 9, padding: 12, marginTop: 7, minHeight: 44 },
  option: { marginTop: 12 }, save: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderRadius: 8, paddingHorizontal: 14, marginTop: 18 },
  saveText: { color: '#FFFFFF', fontWeight: '800' }, disabled: { opacity: 0.65 }, error: { color: '#B42318', marginTop: 10 }, success: { color: '#146C43', marginTop: 10 },
});
