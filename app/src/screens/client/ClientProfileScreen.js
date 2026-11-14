import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAuthStore } from '../../store/authStore';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ClientProfileScreen({ navigation }) {
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const updateProfileDetails = useAuthStore((state) => state.updateProfileDetails);
  const requestEmailChange = useAuthStore((state) => state.requestEmailChange);
  const updatePassword = useAuthStore((state) => state.updatePassword);
  const loading = useAuthStore((state) => state.loading);
  const { colors } = useAppTheme();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [nickname, setNickname] = useState(profile?.nickname || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [feedback, setFeedback] = useState(null);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');

  useEffect(() => {
    setFullName(profile?.full_name || '');
    setNickname(profile?.nickname || '');
    setPhone(profile?.phone || '');
    setEmail(user?.email || '');
  }, [profile, user]);

  const handleSaveProfile = async () => {
    if (!fullName.trim() || !nickname.trim() || !phone.trim()) {
      setFeedback({ type: 'error', text: 'Completa tu nombre completo, apodo y teléfono.' });
      return;
    }

    const result = await updateProfileDetails({ fullName, nickname, phone });
    setFeedback({
      type: result.success ? 'success' : 'error',
      text: result.success
        ? 'Tu nombre, apodo y teléfono quedaron guardados.'
        : result.error || 'No se pudo guardar el perfil.',
    });
  };

  const handleChangeEmail = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setFeedback({ type: 'error', text: 'Ingresa una dirección de correo válida.' });
      return;
    }
    if (normalizedEmail === user?.email?.toLowerCase()) {
      setFeedback({ type: 'error', text: 'Ese ya es el correo asociado a tu cuenta.' });
      return;
    }

    const result = await requestEmailChange(normalizedEmail);
    setFeedback({
      type: result.success ? 'success' : 'error',
      text: result.success
        ? result.confirmationRequired
          ? 'Solicitud enviada. Confirma el cambio desde el enlace enviado a tu nuevo correo.'
          : 'El correo de tu cuenta fue actualizado.'
        : result.error || 'No se pudo solicitar el cambio de correo.',
    });
  };

  const handleChangePassword = async () => {
    if (password !== passwordConfirmation) {
      setFeedback({ type: 'error', text: 'Las contraseñas no coinciden.' });
      return;
    }
    const result = await updatePassword(password);
    setFeedback({
      type: result.success ? 'success' : 'error',
      text: result.success ? 'La contraseña se actualizó correctamente.' : result.error || 'No se pudo actualizar la contraseña.',
    });
    if (result.success) { setPassword(''); setPasswordConfirmation(''); }
  };

  const renderInput = (label, value, onChangeText, options = {}) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
        placeholderTextColor={colors.muted}
        {...options}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={styles.topActions}>
        <AnimatedButton variant="home" navigation={navigation} />
        <AnimatedButton variant="back" navigation={navigation} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.text }]}>Mi perfil</Text>
        <Text style={[styles.description, { color: colors.muted }]}>
          Actualiza tus datos. Para cambiar el correo, confirma la solicitud desde el mensaje que te enviaremos.
        </Text>

        {renderInput('Nombre completo', fullName, setFullName, {
          autoCapitalize: 'words',
          accessibilityLabel: 'Nombre completo',
        })}
        {renderInput('Apodo o ¿cómo quieres que te llamemos?', nickname, setNickname, {
          autoCapitalize: 'words',
          accessibilityLabel: 'Apodo o cómo quieres que te llamemos',
        })}
        <Text style={[styles.hint, { color: colors.muted }]}>Este nombre aparecerá en tu saludo de bienvenida.</Text>
        {renderInput('Teléfono', phone, setPhone, {
          keyboardType: 'phone-pad',
          accessibilityLabel: 'Teléfono',
        })}
        {renderInput('Correo electrónico', email, setEmail, {
          keyboardType: 'email-address',
          autoCapitalize: 'none',
          accessibilityLabel: 'Correo electrónico',
        })}
        {renderInput('Nueva contraseña', password, setPassword, {
          secureTextEntry: true,
          autoCapitalize: 'none',
          accessibilityLabel: 'Nueva contraseña',
        })}
        {renderInput('Confirmar nueva contraseña', passwordConfirmation, setPasswordConfirmation, {
          secureTextEntry: true,
          autoCapitalize: 'none',
          accessibilityLabel: 'Confirmar nueva contraseña',
        })}

        {feedback ? (
          <Text
            accessibilityRole="alert"
            style={[
              styles.feedback,
              { color: feedback.type === 'success' ? colors.primary : colors.danger || '#B3261E' },
            ]}
          >
            {feedback.text}
          </Text>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <>
            <AnimatedButton title="Guardar perfil" onPress={handleSaveProfile} style={styles.action} />
            <AnimatedButton
              title="Solicitar cambio de correo"
              onPress={handleChangeEmail}
              variant="secondary"
              style={styles.action}
            />
            <AnimatedButton
              title="Actualizar contraseña"
              onPress={handleChangePassword}
              variant="secondary"
              style={styles.action}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  content: { flexGrow: 1, padding: 22, paddingBottom: 40 },
  title: { fontSize: 30, fontWeight: '800', marginBottom: 8 },
  description: { fontSize: 15, lineHeight: 22, marginBottom: 18 },
  field: { marginTop: 12 },
  label: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  hint: { fontSize: 12, marginTop: 6 },
  feedback: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 16 },
  action: { alignSelf: 'stretch', marginTop: 16 },
  loader: { marginTop: 22 },
});
