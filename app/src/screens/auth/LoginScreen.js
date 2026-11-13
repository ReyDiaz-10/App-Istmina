// app/src/screens/auth/LoginScreen.js
import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import { useAuthStore } from '../../store/authStore';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useTranslation } from '../../hooks/useTranslation';

const LoginScreen = ({ navigation, route }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, loading } = useAuthStore();
  const { colors } = useAppTheme();
  const t = useTranslation();
  const { returnTo, returnParams, adminOnly } = route.params || {};

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Por favor completa todos los campos');
      return;
    }

    const result = await signIn(email, password);
    if (result.success) {
      const role = useAuthStore.getState().profile?.role;
      if (adminOnly && role !== 'superadmin') {
        await useAuthStore.getState().signOut();
        Alert.alert('Acceso denegado', 'Esta entrada es exclusiva para cuentas administrativas autorizadas.');
        return;
      }
      const roleRoute = {
        negocio: 'BusinessHome',
        repartidor: 'DriverHome',
        superadmin: 'AdminDashboard',
      }[role];
      const allowedRoutes = ['Cart', 'StoreDetail'];
      const destination = roleRoute
        || (allowedRoutes.includes(returnTo) ? returnTo : 'ClientHome');
      navigation.reset({
        index: 0,
        routes: [{ name: destination, params: roleRoute ? undefined : returnParams }],
      });
    } else {
      Alert.alert('Error de Autenticación', result.error);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>IstmiYa</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{t('login.subtitle')}</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
            placeholder={t('login.email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
            placeholder={t('login.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {loading ? (
            <ActivityIndicator color="#1A237E" style={styles.loadingIndicator} />
          ) : (
            <AnimatedButton
              title={t('login.submit')}
              onPress={handleLogin}
              style={styles.animatedButton}
              buttonStyle={styles.button}
              textStyle={styles.buttonText}
            />
          )}

          <AnimatedButton
            title={t('login.register')}
            onPress={() => navigation.navigate('Register', { returnTo, returnParams })}
            variant="secondary"
            style={styles.linkButton}
            buttonStyle={styles.linkSurface}
            textStyle={styles.linkBold}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  header: { alignItems: 'center', marginBottom: 40 },
  title: { fontSize: 42, fontWeight: 'bold', color: '#1A237E', letterSpacing: -1 },
  subtitle: { fontSize: 16, color: '#5C6BC0', marginTop: 5 },
  form: { width: '100%' },
  input: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  button: {
    backgroundColor: '#1A237E',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#1A237E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  buttonDisabled: { backgroundColor: '#9FA8DA' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  animatedButton: { alignSelf: 'stretch' },
  loadingIndicator: { marginTop: 22 },
  linkButton: { alignSelf: 'stretch', marginTop: 16 },
  linkSurface: { borderWidth: 0, backgroundColor: 'transparent' },
  linkBold: { color: '#1A237E', fontSize: 15, fontWeight: 'bold' },
});

export default LoginScreen;
