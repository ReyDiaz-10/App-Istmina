// app/src/screens/auth/RegisterScreen.js
import React, { useState } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert, 
  KeyboardAvoidingView, 
  Platform, 
  ScrollView 
} from 'react-native';
import { useAuthStore } from '../../store/authStore';

const RegisterScreen = ({ navigation }) => {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    role: 'cliente',
  });

  const { signUp, loading } = useAuthStore();

  const handleRegister = async () => {
    const { fullName, phone, email, password } = formData;
    if (!fullName || !phone || !email || !password) {
      Alert.alert('Error', 'Por favor completa todos los campos');
      return;
    }

    const result = await signUp(formData);
    if (result.success) {
      Alert.alert('Cuenta creada', 'Bienvenido a IstmiYa. Ya puedes iniciar sesión');
      navigation.navigate('Login');
    } else {
      Alert.alert('Error de Registro', result.error);
    }
  };

  const selectRole = (role) => {
    setFormData({ ...formData, role });
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>Únete a IstmiYa</Text>
          <Text style={styles.subtitle}>Crea tu cuenta y comienza hoy</Text>
        </View>

        <View style={styles.form}>
          <TextInput 
            style={styles.input} 
            placeholder="Nombre Completo" 
            value={formData.fullName} 
            onChangeText={(t) => setFormData({...formData, fullName: t})} 
          />
          <TextInput 
            style={styles.input} 
            placeholder="Teléfono" 
            value={formData.phone} 
            onChangeText={(t) => setFormData({...formData, phone: t})} 
            keyboardType="phone-pad" 
          />
          <TextInput 
            style={styles.input} 
            placeholder="Correo electrónico" 
            value={formData.email} 
            onChangeText={(t) => setFormData({...formData, email: t})} 
            keyboardType="email-address" 
            autoCapitalize="none" 
          />
          <TextInput 
            style={styles.input} 
            placeholder="Contraseña" 
            value={formData.password} 
            onChangeText={(t) => setFormData({...formData, password: t})} 
            secureTextEntry 
          />

          <Text style={styles.label}>¿Cuál es tu rol?</Text>
          <View style={styles.roleContainer}>
            {['cliente', 'negocio', 'repartidor'].map((role) => (
              <TouchableOpacity 
                key={role} 
                style={[styles.roleButton, formData.role === role && styles.roleButtonActive]} 
                onPress={() => selectRole(role)}
              >
                <Text style={[styles.roleText, formData.role === role && styles.roleTextActive]}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity 
            style={[styles.button, loading && styles.buttonDisabled]} 
            onPress={handleRegister} 
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Registrarse</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.linkContainer} 
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.linkText}>¿Ya tienes cuenta? </Text>
            <Text style={styles.linkBold}>Inicia sesión</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  scrollContainer: { padding: 20, paddingTop: 60 },
  header: { alignItems: 'center', marginBottom: 30 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#1A237E' },
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
  },
  label: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10, marginTop: 10 },
  roleContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  roleButton: { 
    flex: 1, 
    padding: 12, 
    borderRadius: 10, 
    borderWidth: 1, 
    borderColor: '#1A237E', 
    alignItems: 'center', 
    marginHorizontal: 5,
    backgroundColor: '#fff' 
  },
  roleButtonActive: { backgroundColor: '#1A237E' },
  roleText: { color: '#1A237E', fontWeight: '600', fontSize: 13 },
  roleTextActive: { color: '#fff' },
  button: { 
    backgroundColor: '#1A237E', 
    padding: 18, 
    borderRadius: 12, 
    alignItems: 'center', 
    marginTop: 10,
  },
  buttonDisabled: { backgroundColor: '#9FA8DA' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  linkContainer: { flexDirection: 'row', justifyContent: 'center', marginTop: 20, marginBottom: 30 },
  linkText: { color: '#757575', fontSize: 15 },
  linkBold: { color: '#1A237E', fontSize: 15, fontWeight: 'bold' },
});

export default RegisterScreen;
