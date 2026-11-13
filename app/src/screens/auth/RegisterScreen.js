// app/src/screens/auth/RegisterScreen.js
import React, { useState } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TextInput, 
  Image,
  ActivityIndicator, 
  Alert, 
  KeyboardAvoidingView, 
  Platform, 
  ScrollView 
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../store/authStore';
import AnimatedButton from '../../components/AnimatedButton';
import { getRoleTheme } from '../../constants/roleTheme';
import { useAppTheme } from '../../hooks/useAppTheme';
import { uploadRegistrationMedia } from '../../services/onboardingMedia';

const RegisterScreen = ({ navigation, route }) => {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    role: 'cliente',
    storeName: '',
    legalName: '',
    registrationIdType: 'NIT',
    registrationId: '',
    address: '',
    complaintEmail: '',
    slogan: '',
    vehicleType: '',
    plateNumber: '',
  });
  const [photos, setPhotos] = useState({ business: null, face: null, plate: null });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { signUp, loading } = useAuthStore();
  const { colors } = useAppTheme();
  const { returnTo, returnParams } = route.params || {};
  const updateField = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const selectPhoto = async (target) => {
    try {
      const options = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
      };
      const captureWithCamera = Platform.OS !== 'web' && target !== 'business';
      const result = !captureWithCamera
        ? await ImagePicker.launchImageLibraryAsync({ ...options, aspect: [4, 3] })
        : await ImagePicker.launchCameraAsync({ ...options, aspect: [4, 3] });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setPhotos((current) => ({ ...current, [target]: result.assets[0].uri }));
      }
    } catch (error) {
      Alert.alert('No se pudo seleccionar la foto', error.message);
    }
  };

  const handleRegister = async () => {
    const { fullName, phone, email, password } = formData;
    
    if (![fullName, phone, email, password].every((value) => value.trim())) {
      Alert.alert('Campos Incompletos', 'Por favor, llena todos los campos.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Contraseña Débil', 'La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (formData.role === 'negocio') {
      const businessFields = [
        formData.storeName,
        formData.legalName,
        formData.registrationId,
        formData.address,
        formData.complaintEmail,
      ];
      if (!businessFields.every((value) => value.trim()) || !photos.business) {
        Alert.alert('Datos del negocio incompletos', 'Completa los datos legales y selecciona una foto real del local.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.complaintEmail.trim())) {
        Alert.alert('Correo inválido', 'Ingresa un correo válido para recibir quejas y solicitudes.');
        return;
      }
    }

    if (formData.role === 'repartidor') {
      if (!formData.vehicleType.trim() || !formData.plateNumber.trim() || !photos.face || !photos.plate) {
        Alert.alert('Datos del repartidor incompletos', 'Indica vehículo y placa, toma una foto de tu rostro y una foto de la placa.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const result = await signUp(formData);
      if (!result.success) {
        Alert.alert('Error', result.error || 'Ocurrió un problema al crear la cuenta.');
        return;
      }

      if (result.requiresEmailConfirmation) {
        Alert.alert(
          'Confirma tu correo',
          'La cuenta se creó. Confirma el correo y luego inicia sesión para completar o revisar la verificación de tu perfil.',
          [{ text: 'Ir a iniciar sesión', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) }],
        );
        return;
      }

      let photoWarning = '';
      try {
        await uploadRegistrationMedia({
          userId: result.userId,
          role: formData.role,
          businessPhotoUri: photos.business,
          driverPhotoUri: photos.face,
          platePhotoUri: photos.plate,
        });
        await useAuthStore.getState().fetchProfile(result.userId);
      } catch (error) {
        photoWarning = `\n\nNo se pudieron cargar todas las fotos: ${error.message}. Podrás intentarlo de nuevo desde tu perfil.`;
      }

      const roleRoute = {
        negocio: 'BusinessHome',
        repartidor: 'DriverHome',
      }[formData.role];
      const allowedRoutes = ['Cart', 'StoreDetail'];
      const destination = roleRoute
        || (allowedRoutes.includes(returnTo) ? returnTo : 'ClientHome');
      Alert.alert(
        'Cuenta creada',
        formData.role === 'cliente'
          ? `Tu cuenta está lista.${photoWarning}`
          : `Tu perfil quedó pendiente de revisión por el equipo de IstmiYa.${photoWarning}`,
        [{
          text: 'Continuar',
          onPress: () => navigation.reset({
            index: 0,
            routes: [{ name: destination, params: roleRoute ? undefined : returnParams }],
          }),
        }],
      );
    } catch (error) {
      Alert.alert('Error', error.message || 'Ocurrió un problema al crear la cuenta.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectRole = (role) => {
    updateField('role', role);
  };

  const renderInput = (label, field, placeholder, options = {}) => (
    <View>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={formData[field]}
        onChangeText={(value) => updateField(field, value)}
        {...options}
      />
    </View>
  );

  const renderPhotoPicker = (label, target, cameraOnly = false) => (
    <View style={styles.photoPicker}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      {photos[target] ? <Image source={{ uri: photos[target] }} style={styles.photoPreview} /> : null}
      <AnimatedButton
        title={photos[target]
          ? 'Cambiar foto'
          : cameraOnly && Platform.OS !== 'web'
            ? 'Tomar foto'
            : 'Seleccionar foto real'}
        onPress={() => selectPhoto(target)}
        variant="secondary"
        style={styles.photoAction}
      />
    </View>
  );

  const isBusy = loading || isSubmitting;

  const renderRoleFields = () => {
    if (formData.role === 'negocio') {
      return (
        <View style={styles.roleFields}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Datos del negocio</Text>
          {renderInput('Nombre comercial', 'storeName', 'Ej. Restaurante IstmiYa')}
          {renderInput('Razón social', 'legalName', 'Nombre legal registrado')}
          <Text style={[styles.label, { color: colors.text }]}>Tipo de identificación</Text>
          <View style={styles.roleContainer}>
            {['NIT', 'CC'].map((type) => (
              <AnimatedButton
                key={type}
                title={type}
                onPress={() => updateField('registrationIdType', type)}
                variant="secondary"
                style={styles.roleAction}
                buttonStyle={[
                  styles.roleButton,
                  formData.registrationIdType === type && {
                    backgroundColor: getRoleTheme(formData.role).primary,
                    borderColor: getRoleTheme(formData.role).primary,
                  },
                ]}
                textStyle={formData.registrationIdType === type && styles.roleTextActive}
              />
            ))}
          </View>
          {renderInput('Número de identificación', 'registrationId', 'NIT o cédula')}
          {renderInput('Dirección del local', 'address', 'Dirección completa')}
          {renderInput('Correo para quejas y solicitudes', 'complaintEmail', 'contacto@negocio.com', {
            keyboardType: 'email-address',
            autoCapitalize: 'none',
          })}
          {renderInput('Eslogan (opcional)', 'slogan', 'Una frase para tu negocio')}
          {renderPhotoPicker('Foto real del local', 'business')}
          <Text style={[styles.helperText, { color: colors.muted }]}>
            El negocio permanecerá inactivo hasta que el equipo revise y apruebe los datos.
          </Text>
        </View>
      );
    }

    if (formData.role === 'repartidor') {
      return (
        <View style={styles.roleFields}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Datos del repartidor</Text>
          {renderInput('Tipo de vehículo', 'vehicleType', 'Ej. Motocicleta')}
          {renderInput('Placa', 'plateNumber', 'Ej. ABC123', { autoCapitalize: 'characters' })}
          {renderPhotoPicker('Foto actual del rostro (tomada con cámara)', 'face', true)}
          {renderPhotoPicker('Foto de la placa (tomada con cámara)', 'plate', true)}
          <Text style={[styles.helperText, { color: colors.muted }]}>
            Toma fotos reales, nítidas y sin ocultar el rostro o la placa. Tu cuenta quedará pendiente de aprobación.
          </Text>
        </View>
      );
    }
    return null;
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
          {renderInput('Nombre completo', 'fullName', 'Ej. Juan Pérez', { autoCapitalize: 'words' })}
          {renderInput('Teléfono', 'phone', 'Ej. 3001234567', { keyboardType: 'phone-pad' })}
          {renderInput('Correo electrónico', 'email', 'correo@ejemplo.com', {
            keyboardType: 'email-address',
            autoCapitalize: 'none',
          })}
          {renderInput('Contraseña', 'password', 'Mínimo 6 caracteres', { secureTextEntry: true })}

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

          {renderRoleFields()}

          {isBusy ? (
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
  roleFields: { marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 16 },
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
  helperText: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  photoPicker: { marginTop: 8 },
  photoPreview: { width: '100%', height: 170, borderRadius: 12, marginBottom: 8 },
  photoAction: { alignSelf: 'stretch' },
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
