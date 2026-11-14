import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import { useAuthStore } from '../../store/authStore';
import {
  getDriverDocumentUrl,
  getProfilePhotoUrl,
  uploadDriverIdentityPhoto,
  uploadDriverPhoto,
  uploadDriverPlatePhoto,
} from '../../services/onboardingMedia';

const DriverProfileScreen = () => {
  const { profile } = useAuthStore();
  const [profileData, setProfileData] = useState(profile);
  const [driverData, setDriverData] = useState(null);
  const [verification, setVerification] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [platePhotoUrl, setPlatePhotoUrl] = useState(null);
  const [identityPhotoUrl, setIdentityPhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [vehicle, setVehicle] = useState('');
  const [plateNumber, setPlateNumber] = useState('');

  const loadDriverProfile = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const [driverResult, profileResult] = await Promise.all([
        supabase.from('drivers').select('*').eq('profile_id', profile.id).single(),
        supabase.from('profiles').select('full_name, avatar_url').eq('id', profile.id).single(),
      ]);
      if (driverResult.error) throw driverResult.error;
      if (profileResult.error) throw profileResult.error;
      const driver = driverResult.data;
      setProfileData(profileResult.data);

      const { data: verificationData, error: verificationError } = await supabase
        .from('driver_verifications')
        .select('*')
        .eq('driver_id', driver.id)
        .single();
      if (verificationError) throw verificationError;

      const [avatar, plateImage, identityImage] = await Promise.all([
        getProfilePhotoUrl(profileResult.data.avatar_url),
        getDriverDocumentUrl(verificationData.plate_photo_path),
        getDriverDocumentUrl(verificationData.identity_document_path),
      ]);
      setDriverData(driver);
      setVerification(verificationData);
      setPhotoUrl(avatar);
      setPlatePhotoUrl(plateImage);
      setIdentityPhotoUrl(identityImage);
      setVehicle(driver.vehicle_type || '');
      setPlateNumber(driver.plate_number || '');
    } catch (error) {
      setFeedback({ type: 'error', text: `No se pudo cargar el perfil: ${error.message}` });
    }
  }, [profile?.id]);

  useEffect(() => {
    loadDriverProfile();
  }, [loadDriverProfile]);

  const uploadDocument = async (type) => {
    setFeedback(null);
    try {
      const pickerOptions = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
      };
      const useCamera = Platform.OS !== 'web' && type !== 'identity';
      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ ...pickerOptions, aspect: [4, 3] })
        : await ImagePicker.launchImageLibraryAsync({ ...pickerOptions, aspect: [4, 3] });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploading(true);
      const mediaUpload = {
        face: uploadDriverPhoto,
        plate: uploadDriverPlatePhoto,
        identity: uploadDriverIdentityPhoto,
      }[type];
      await mediaUpload({ userId: profile.id, uri: result.assets[0].uri });
      await loadDriverProfile();
      setFeedback({ type: 'success', text: 'La imagen quedó guardada de forma privada para revisión.' });
    } catch (error) {
      setFeedback({ type: 'error', text: `No se pudo cargar la foto: ${error.message}` });
    } finally {
      setUploading(false);
    }
  };

  const saveTextData = async () => {
    setFeedback(null);
    if (!vehicle.trim() || !plateNumber.trim()) {
      setFeedback({ type: 'error', text: 'Completa el tipo de vehículo y la placa.' });
      return;
    }

    setSavingProfile(true);
    try {
      if (driverData.verification_status === 'aprobado') {
        Alert.alert('Cambios restringidos', 'Contacta a SuperAdmin para modificar la información de un perfil aprobado.');
        return;
      }

      const { error } = await supabase
        .from('drivers')
        .update({ vehicle_type: vehicle.trim(), plate_number: plateNumber.trim().toUpperCase() })
        .eq('profile_id', profile.id)
        .select('id')
        .single();
      if (error) throw error;
      await loadDriverProfile();
      setFeedback({ type: 'success', text: 'Los datos del vehículo quedaron guardados.' });
    } catch (error) {
      setFeedback({ type: 'error', text: `No se pudieron guardar los datos: ${error.message}` });
    } finally {
      setSavingProfile(false);
    }
  };

  const resubmitVerification = async () => {
    setFeedback(null);
    try {
      if (!profileData?.avatar_url || !verification.plate_photo_path) {
        setFeedback({ type: 'error', text: 'Carga una foto del rostro y una foto legible de la placa antes de reenviar.' });
        return;
      }

      const { error } = await supabase.rpc('resubmit_role_verification', {
        p_entity_type: 'repartidor',
        p_entity_id: driverData.id,
      });
      if (error) throw error;
      await loadDriverProfile();
      setFeedback({ type: 'success', text: 'El equipo revisará nuevamente tu perfil.' });
    } catch (error) {
      setFeedback({ type: 'error', text: `No se pudo reenviar el perfil: ${error.message}` });
    }
  };

  if (!driverData || !verification) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1A237E" />
        <Text style={styles.muted}>Cargando perfil de repartidor...</Text>
      </View>
    );
  }

  const verificationStatus = {
    pendiente: 'Pendiente de revisión',
    aprobado: 'Perfil aprobado',
    rechazado: 'Necesitas corregir los datos',
  }[verification.verification_status] || 'Pendiente de revisión';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        {photoUrl
          ? <Image source={{ uri: photoUrl }} style={styles.avatar} />
          : <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>{profileData?.full_name?.[0] || 'R'}</Text>
          </View>}
        <Text style={styles.userName}>{profileData?.full_name}</Text>
        <Text style={styles.status}>{verificationStatus}</Text>
        <Text style={styles.note}>
          No podrás conectarte para recibir pedidos hasta que SuperAdmin apruebe tu perfil.
        </Text>
        {feedback ? (
          <Text
            accessibilityRole="alert"
            style={[styles.feedback, { color: feedback.type === 'success' ? '#237A3B' : '#B3261E' }]}
          >
            {feedback.text}
          </Text>
        ) : null}
        {verification.review_note
          ? <Text style={styles.reviewNote}>Observación: {verification.review_note}</Text>
          : null}
        {verification.verification_status === 'rechazado' && (
          <AnimatedButton
            title="Reenviar a revisión"
            onPress={resubmitVerification}
            style={styles.fullButton}
          />
        )}
        <AnimatedButton
          title="Cambiar foto de perfil"
          onPress={() => uploadDocument('face')}
          variant="secondary"
          disabled={uploading}
          style={styles.fullButton}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Información del vehículo</Text>
        <TextInput
          style={styles.input}
          placeholder="Tipo de vehículo (ej. Motocicleta)"
          value={vehicle}
          onChangeText={setVehicle}
          editable={driverData.verification_status !== 'aprobado'}
        />
        <TextInput
          style={styles.input}
          placeholder="Placa del vehículo"
          value={plateNumber}
          onChangeText={setPlateNumber}
          autoCapitalize="characters"
          editable={driverData.verification_status !== 'aprobado'}
        />
        <AnimatedButton
          title={savingProfile ? 'Guardando...' : 'Guardar datos'}
          onPress={saveTextData}
          disabled={savingProfile || driverData.verification_status === 'aprobado'}
          style={styles.fullButton}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Documentos para revisión</Text>
        <DocumentItem
          label="Foto actual del rostro"
          imageUrl={photoUrl}
          uploaded={Boolean(profileData?.avatar_url)}
          onUpload={() => uploadDocument('face')}
          uploading={uploading}
          disabled={driverData.verification_status === 'aprobado'}
        />
        <DocumentItem
          label="Foto legible de la placa"
          imageUrl={platePhotoUrl}
          uploaded={Boolean(verification.plate_photo_path)}
          onUpload={() => uploadDocument('plate')}
          uploading={uploading}
          disabled={driverData.verification_status === 'aprobado'}
        />
        <DocumentItem
          label="Documento de identidad (opcional)"
          imageUrl={identityPhotoUrl}
          uploaded={Boolean(verification.identity_document_path)}
          onUpload={() => uploadDocument('identity')}
          uploading={uploading}
          disabled={driverData.verification_status === 'aprobado'}
        />
      </View>
    </ScrollView>
  );
};

const DocumentItem = ({ label, imageUrl, uploaded, onUpload, uploading, disabled = false }) => (
  <View style={styles.documentCard}>
    <View style={styles.documentInfo}>
      <Text style={styles.documentLabel}>{label}</Text>
      <Text style={styles.muted}>{uploaded ? 'Cargado de forma privada' : 'Pendiente'}</Text>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.documentImage} /> : null}
    </View>
    <AnimatedButton
      title={uploaded ? 'Cambiar' : 'Subir'}
      onPress={onUpload}
      variant="secondary"
      disabled={uploading || disabled}
      style={styles.uploadAction}
    />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F7FA' },
  header: { alignItems: 'center', padding: 24, backgroundColor: '#FFFFFF', marginBottom: 16 },
  avatar: { width: 104, height: 104, borderRadius: 52, borderWidth: 3, borderColor: '#1A237E' },
  avatarPlaceholder: { backgroundColor: '#1A237E', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 40, fontWeight: '700' },
  userName: { fontSize: 22, fontWeight: '700', color: '#1A237E', marginTop: 10 },
  status: { fontSize: 15, fontWeight: '700', color: '#8A5A00', marginTop: 8 },
  note: { color: '#5F6368', textAlign: 'center', lineHeight: 20, marginVertical: 8 },
  feedback: { fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center', marginVertical: 8 },
  reviewNote: { color: '#8A3B12', textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  section: { paddingHorizontal: 20, paddingVertical: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#333333', marginBottom: 14 },
  input: { backgroundColor: '#FFFFFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 12 },
  fullButton: { alignSelf: 'stretch', marginTop: 8 },
  documentCard: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  documentInfo: { flex: 1, paddingRight: 10 },
  documentLabel: { fontSize: 14, color: '#333333', fontWeight: '600' },
  documentImage: { width: 100, height: 70, borderRadius: 8, marginTop: 8 },
  uploadAction: { alignSelf: 'center' },
  muted: { fontSize: 13, color: '#757575', marginTop: 4 },
});

export default DriverProfileScreen;
