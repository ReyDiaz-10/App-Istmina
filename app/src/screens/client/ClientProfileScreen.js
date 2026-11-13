import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ClientProfileScreen({ navigation }) {
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const updateProfileDetails = useAuthStore((state) => state.updateProfileDetails);
  const requestEmailChange = useAuthStore((state) => state.requestEmailChange);
  const loading = useAuthStore((state) => state.loading);
  const { colors } = useAppTheme();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [email, setEmail] = useState(user?.email || '');

  useEffect(() => {
    setFullName(profile?.full_name || '');
    setUsername(profile?.username || '');
    setPhone(profile?.phone || '');
    setEmail(user?.email || '');
  }, [profile, user]);

  const handleSaveProfile = async () => {
    const normalizedUsername = username.trim().toLowerCase();
    if (!fullName.trim() || !phone.trim()) {
      Alert.alert('Datos incompletos', 'El nombre y el teléfono son obligatorios.');
      return;
    }
    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      Alert.alert('Usuario inválido', 'Usa de 3 a 24 letras minúsculas, números o guion bajo.');
      return;
    }

    const result = await updateProfileDetails({ fullName, username: normalizedUsername, phone });
    Alert.alert(
      result.success ? 'Perfil actualizado' : 'No se pudo actualizar',
      result.success
        ? 'Guardamos tu nombre, usuario y teléfono.'
        : result.error.includes('profiles_username_lower_idx')
          ? 'Ese nombre de usuario ya está en uso.'
          : result.error,
    );
  };

  const handleChangeEmail = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      Alert.alert('Correo inválido', 'Ingresa una dirección de correo válida.');
      return;
    }
    if (normalizedEmail === user?.email?.toLowerCase()) {
      Alert.alert('Sin cambios', 'Ese ya es el correo asociado a tu cuenta.');
      return;
    }

    const result = await requestEmailChange(normalizedEmail);
    Alert.alert(
      result.success ? 'Solicitud enviada' : 'No se pudo cambiar el correo',
      result.success
        ? result.confirmationRequired
          ? 'Confirma el cambio desde el enlace enviado a tu nuevo correo.'
          : 'El correo de tu cuenta fue actualizado.'
        : result.error,
    );
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
        {renderInput('Nombre de usuario', username, (value) => setUsername(value.toLowerCase()), {
          autoCapitalize: 'none',
          accessibilityLabel: 'Nombre de usuario',
        })}
        <Text style={[styles.hint, { color: colors.muted }]}>De 3 a 24 caracteres: letras, números y guion bajo.</Text>
        {renderInput('Teléfono', phone, setPhone, {
          keyboardType: 'phone-pad',
          accessibilityLabel: 'Teléfono',
        })}
        {renderInput('Correo electrónico', email, setEmail, {
          keyboardType: 'email-address',
          autoCapitalize: 'none',
          accessibilityLabel: 'Correo electrónico',
        })}

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
  action: { alignSelf: 'stretch', marginTop: 16 },
  loader: { marginTop: 22 },
});
