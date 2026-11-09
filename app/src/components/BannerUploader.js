// app/src/components/BannerUploader.js
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../api/supabaseClient';

const BannerUploader = ({ businessId }) => {
  const [loading, setLoading] = useState(false);
  const [subscriptionActive, setSubscriptionActive] = useState(null);
  const [bannerCount, setBannerCount] = useState(0);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    // 1. Verificar suscripción activa
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('is_active')
      .eq('business_id', businessId)
      .single();
    
    setSubscriptionActive(sub?.is_active);

    // 2. Contar banners actuales
    const { count } = await supabase
      .from('banners')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('is_active', true);
    
    setBannerCount(count || 0);
  };

  const handleUpload = async () => {
    // Bloqueo estricto de negocio: Max 2 banners
    if (bannerCount >= 2) {
      Alert.alert('Límite alcanzado', 'Tu plan permite un máximo de 2 banners activos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.6,
    });

    if (result.canceled) return;

    try {
      setLoading(true);
      const file = result.assets[0];
      const fileName = `${businessId}_${Date.now()}.jpg`;
      const filePath = `promotions/${fileName}`;

      const response = await fetch(file.uri);
      const blob = await response.blob();

      const { error: upError } = await supabase.storage.from('promotions').upload(filePath, blob);
      if (upError) throw upError;

      const { data: { publicUrl } } = supabase.storage.from('promotions').getPublicUrl(filePath);

      const { error: dbError } = await supabase.from('banners').insert([{ business_id: businessId, image_url: publicUrl, is_active: true }]);
      if (dbError) throw dbError;

      Alert.alert('Éxito', 'Banner publicado correctamente');
      checkPermissions(); // Actualizar contador
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  if (subscriptionActive === false || subscriptionActive === null) {
    return (
      <View style={styles.upsellContainer}>
        <Text style={styles.upsellText}>🚀 Mejora a Suscripción para publicar hasta 2 banners publicitarios</Text>
        <TouchableOpacity style={styles.upgradeBtn} onPress={() => { /* Navegar a Pagos */ }}>
          <Text style={styles.upgradeText}>Mejorar Plan</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Publicidad Premium</Text>
      <TouchableOpacity style={styles.uploadBtn} onPress={handleUpload} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Subir Banner ({bannerCount}/2)</Text>}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#fff', borderRadius: 15, margin: 15 },
  title: { fontSize: 18, fontWeight: 'bold', color: '#1A237E', marginBottom: 10 },
  uploadBtn: { backgroundColor: '#1A237E', padding: 15, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  upsellContainer: { padding: 20, backgroundColor: '#FFF9C4', borderRadius: 15, margin: 15, borderWidth: 1, borderColor: '#FBC02D' },
  upsellText: { color: '#856404', fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  upgradeBtn: { backgroundColor: '#1A237E', padding: 10, borderRadius: 8, alignItems: 'center' },
  upgradeText: { color: '#fff', fontWeight: 'bold' },
});

export default BannerUploader;
