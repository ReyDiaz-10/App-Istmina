// app/src/screens/auth/RegisterScreen.js
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
import { getRoleTheme } from '../../constants/roleTheme';
import { useAppTheme } from '../../hooks/useAppTheme';

const RegisterScreen = ({ navigation, route }) => {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    role: 'cliente',
  });

  const { signUp, loading } = useAuthStore();
  const { colors } = useAppTheme();
  const { returnTo, returnParams } = route.params || {};

  const handleRegister = async () => {
    const { fullName, phone, email, password } = formData;
    
    if (!fullName || !phone || !email || !password) {
      Alert.alert('Campos Incompletos', 'Por favor, llena todos los campos.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Contraseña Débil', 'La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    const result = await signUp(formData);
    
    if (result.success) {
      Alert.alert('¡Éxito!', 'Cuenta creada correctamente.', [
        {
          text: 'Continuar',
          onPress: () => {
            const roleRoute = {
              negocio: 'BusinessHome',
              repartidor: 'DriverHome',
              superadmin: 'AdminDashboard',
            }[formData.role];
            const allowedRoutes = ['Cart', 'StoreDetail'];
            const destination = roleRoute
              || (allowedRoutes.includes(returnTo) ? returnTo : 'ClientHome');
            navigation.reset({
              index: 0,
              routes: [{ name: destination, params: roleRoute ? undefined : returnParams }],
            });
          },
        }
      ]);
    } else {
      Alert.alert('Error', result.error || 'Ocurrió un problema al crear la cuenta.');
    }
  };

  const selectRole = (role) => {
    setFormData({ ...formData, role });
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView 
        contentContainerStyle={styles.scrollContainer} 
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Únete a IstmiYa</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>Crea tu cuenta y comienza hoy</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Nombre Completo</Text>
          <TextInput 
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]} 
            placeholder="Ej. Juan Pérez" 
            value={formData.fullName} 
            onChangeText={(t) => setFormData({...formData, fullName: t})} 
          />

          <Text style={styles.label}>Teléfono</Text>
          <TextInput 
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]} 
            placeholder="Ej. 3001234567" 
            value={formData.phone} 
            onChangeText={(t) => setFormData({...formData, phone: t})} 
            keyboardType="phone-pad" 
          />

          <Text style={styles.label}>Correo electrónico</Text>
          <TextInput 
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]} 
            placeholder="correo@ejemplo.com" 
            value={formData.email} 
            onChangeText={(t) => setFormData({...formData, email: t})} 
            keyboardType="email-address" 
            autoCapitalize="none" 
          />

          <Text style={styles.label}>Contraseña</Text>
          <TextInput 
            style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]} 
            placeholder="Mínimo 6 caracteres" 
            value={formData.password} 
            onChangeText={(t) => setFormData({...formData, password: t})} 
            secureTextEntry 
          />

          <AnimatedButton
            title="Leer política de tratamiento de datos"
            onPress={() => navigation.navigate('Privacy')}
            variant="secondary"
            style={styles.linkButton}
          />

          <Text style={styles.label}>¿Cuál es tu rol?</Text>
          <View style={styles.roleContainer}>
            {['cliente', 'negocio', 'repartidor'].map((role) => (
              <AnimatedButton
                key={role} 
                title={role === 'cliente' ? 'Usuario' : role === 'negocio' ? 'Negocio' : 'Repartidor'}
                onPress={() => selectRole(role)}
                variant="secondary"
                style={styles.roleAction}
                buttonStyle={[
                  styles.roleButton,
                  formData.role === role && {
                    backgroundColor: getRoleTheme(role).primary,
                    borderColor: getRoleTheme(role).primary,
                  },
                ]}
                textStyle={[
                  styles.roleText,
                  formData.role === role && styles.roleTextActive,
                ]}
              />
            ))}
          </View>

          {loading ? (
            <ActivityIndicator color="#1A237E" style={styles.loadingIndicator} />
          ) : (
            <AnimatedButton
              title="Crear Cuenta"
              onPress={handleRegister}
              style={styles.animatedButton}
              buttonStyle={styles.button}
              textStyle={styles.buttonText}
            />
          )}

          <AnimatedButton
            title="¿Ya tienes cuenta? Inicia sesión"
            onPress={() => navigation.navigate('Login', { returnTo, returnParams })}
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
  container: { 
    flex: 1, 
    backgroundColor: '#F5F7FA' 
  },
  scrollContainer: { 
    flexGrow: 1, 
    justifyContent: 'center', 
    padding: 25, 
    paddingBottom: 50 
  },
  header: { 
    alignItems: 'center', 
    marginBottom: 30 
  },
  title: { 
    fontSize: 32, 
    fontWeight: 'bold', 
    color: '#1A237E' 
  },
  subtitle: { 
    fontSize: 16, 
    color: '#5C6BC0', 
    marginTop: 5 
  },
  form: { 
    width: '100%' 
  },
  label: { 
    fontSize: 14, 
    fontWeight: 'bold', 
    color: '#333', 
    marginBottom: 5, 
    marginTop: 15 
  },
  input: { 
    backgroundColor: '#fff', 
    padding: 15, 
    borderRadius: 12, 
    fontSize: 16, 
    borderWidth: 1, 
    borderColor: '#E0E0E0' 
  },
  roleContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginBottom: 25, 
    marginTop: 5 
  },
  roleAction: { flex: 1, alignSelf: 'stretch', marginHorizontal: 2 },
  roleButton: { 
    width: '100%',
    flex: 1, 
    padding: 12, 
    borderRadius: 10, 
    borderWidth: 1, 
    borderColor: '#1A237E', 
    alignItems: 'center', 
    marginHorizontal: 4, 
    backgroundColor: '#fff' 
  },
  roleText: { 
    color: '#1A237E', 
    fontWeight: '600', 
    fontSize: 13 
  },
  roleTextActive: { color: '#FFFFFF' },
  button: { 
    backgroundColor: '#1A237E', 
    padding: 18, 
    borderRadius: 12, 
    alignItems: 'center', 
    marginTop: 20 
  },
  buttonDisabled: { 
    backgroundColor: '#9FA8DA' 
  },
  buttonText: { 
    color: '#fff', 
    fontSize: 18, 
    fontWeight: 'bold' 
  },
  animatedButton: { alignSelf: 'stretch' },
  loadingIndicator: { marginTop: 22 },
  linkButton: { alignSelf: 'stretch', marginTop: 16, marginBottom: 20 },
  linkSurface: { borderWidth: 0, backgroundColor: 'transparent' },
  linkBold: { 
    color: '#1A237E', 
    fontSize: 15, 
    fontWeight: 'bold' 
  },
});

export default RegisterScreen;
