// app/src/screens/driver/DriverProfileScreen.js
import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  Alert, ScrollView, Image, ActivityIndicator 
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';

const DriverProfileScreen = () => {
  const { profile } = useAuthStore();
  const [driverData, setDriverData] = useState({});
  const [uploading, setUploading] = useState(false);
  const [vehicle, setVehicle] = useState('');
  const [plateNumber, setPlateNumber] = useState('');

  useEffect(() => {
    loadDriverProfile();
  }, []);

  const loadDriverProfile = async () => {
    const { data } = await supabase.from('drivers').select('*').eq('profile_id', profile.id).single();
    if (data) {
      setDriverData(data);
      setVehicle(data.vehicle_type || '');
      setPlateNumber(data.plate_number || '');
    }
  };

  // FUNCIÓN MAESTRA PARA SUBIR IMÁGENES
  const uploadDocument = async (type) => {
    try {
      // 1. Pedir permiso y seleccionar imagen
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.5,
      });

      if (result.canceled) return;

      setUploading(true);
      const file = result.assets[0];
      const fileExt = file.uri.split('.').pop();
      const fileName = `${profile.id}_${type}_${Date.now()}.${fileExt}`;
      const filePath = `verification/${fileName}`;

      // 2. Convertir imagen a Blob para Supabase
      const response = await fetch(file.uri);
      const blob = await response.blob();

      // 3. Subir al Bucket 'driver-docs'
      const { error: uploadError } = await supabase.storage
        .from('driver-docs')
        .upload(filePath, blob);

      if (uploadError) throw uploadError;

      // 4. Obtener la URL pública
      const { data: { publicUrl } } = supabase.storage.from('driver-docs').getPublicUrl(filePath);

      // 5. Actualizar la tabla 'drivers'
      const updateField = {
        id_card_url: type === 'cc' ? publicUrl : driverData.id_card_url,
        plate_url: type === 'plate' ? publicUrl : driverData.plate_url,
        photo_url: type === 'photo' ? publicUrl : driverData.photo_url,
      };

      const { error: dbError } = await supabase.from('drivers').update(updateField).eq('profile_id', profile.id);
      if (dbError) throw dbError;

      setDriverData({ ...driverData, ...updateField });
      Alert.alert('Éxito', `Documento de ${type} cargado correctamente`);

    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setUploading(false);
    }
  };

  const saveTextData = async () => {
    try {
      const { error } = await supabase
        .from('drivers')
        .update({ vehicle_type: vehicle, plate_number: plateNumber })
        .eq('profile_id', profile.id);

      if (error) throw error;
      Alert.alert('Éxito', 'Datos actualizados');
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const VerificationItem = ({ label, type, currentUrl }) => (
    <View style={styles.verifyCard}>
      <View style={styles.verifyInfo}>
        <Text style={styles.verifyLabel}>{label}</Text>
        <Text style={styles.verifyStatus}>{currentUrl ? '✅ Verificado' : '❌ Pendiente'}</Text>
      </View>
      <TouchableOpacity 
        style={styles.uploadBtn} 
        onPress={() => uploadDocument(type)}
        disabled={uploading}
      >
        {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadText}>Subir</Text>}
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          {driverData.photo_url ? (
            <Image source={{ uri: driverData.photo_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>{profile.full_name[0]}</Text>
            </View>
          )}
        </View>
        <Text style={styles.userName}>{profile.full_name}</Text>
        <TouchableOpacity style={styles.changePhotoBtn} onPress={() => uploadDocument('photo')}>
          <Text style={styles.changePhotoText}>Cambiar Foto</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Información del Vehículo</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Tipo de Vehículo (Ej: Moto Yamaha)" 
          value={vehicle} 
          onChangeText={setVehicle} 
        />
        <TextInput 
          style={styles.input} 
          placeholder="Placa del Vehículo (Ej: ABC-123)" 
          value={plateNumber} 
          onChangeText={setPlateNumber} 
        />
        <TouchableOpacity style={styles.saveBtn} onPress={saveTextData}>
          <Text style={styles.saveBtnText}>Guardar Datos</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Verificación de Identidad</Text>
        <VerificationItem label="Foto de la Cédula/DNI" type="cc" currentUrl={driverData.id_card_url} />
        <VerificationItem label="Foto de la Placa" type="plate" currentUrl={driverData.plate_url} />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: { alignItems: 'center', padding: 30, backgroundColor: '#fff', marginBottom: 20 },
  avatarContainer: { marginBottom: 10 },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: '#1A237E' },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#1A237E', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 40, fontWeight: 'bold' },
  userName: { fontSize: 22, fontWeight: 'bold', color: '#1A237E' },
  changePhotoBtn: { marginTop: 10 },
  changePhotoText: { color: '#1A237E', fontSize: 14, fontWeight: '600' },
  section: { padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 15 },
  input: { backgroundColor: '#fff', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 15 },
  saveBtn: { backgroundColor: '#1A237E', padding: 15, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  verifyCard: { 
    backgroundColor: '#fff', padding: 15, borderRadius: 12, 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    marginBottom: 10, borderWidth: 1, borderColor: '#E0E0E0' 
  },
  verifyInfo: { flex: 1 },
  verifyLabel: { fontSize: 15, color: '#333', fontWeight: '600' },
  verifyStatus: { fontSize: 13, color: '#757575', marginTop: 2 },
  uploadBtn: { backgroundColor: '#1A237E', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8 },
  uploadText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
});

export default DriverProfileScreen;
