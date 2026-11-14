// app/src/components/BannerUploader.js
import React, { useState, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../api/supabaseClient';
import AnimatedButton from './AnimatedButton';
import { useAppTheme } from '../hooks/useAppTheme';

const BannerUploader = ({ businessId, subscriptionActive, onUpgrade }) => {
  const { colors } = useAppTheme();
  const [loading, setLoading] = useState(false);
  const [bannerCount, setBannerCount] = useState(0);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let active = true;
    const loadBanners = async () => {
      setError(null);
      try {
        const { count, error: countError } = await supabase
          .from('banners')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('is_active', true);

        if (countError) throw countError;
        if (active) setBannerCount(count || 0);
      } catch (loadError) {
        if (active) setError(`No se pudo cargar el límite de banners: ${loadError.message}`);
      }
    };

    if (businessId) loadBanners();
    return () => {
      active = false;
    };
  }, [businessId]);

  const handleUpload = async () => {
    if (bannerCount >= 2) {
      setError('Tu plan permite un máximo de 2 banners activos.');
      return;
    }

    let uploadedPath;
    try {
      setLoading(true);
      setError(null);
      setFeedback(null);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.6,
      });
      if (result.canceled) return;

      const file = result.assets[0];
      const mimeType = file.mimeType || 'image/jpeg';
      const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      uploadedPath = `${businessId}/${Date.now()}.${extension}`;

      const response = await fetch(file.uri);
      const blob = await response.blob();

      const { error: upError } = await supabase.storage
        .from('promotions')
        .upload(uploadedPath, blob, { contentType: mimeType, upsert: false });
      if (upError) throw upError;

      const { data: { publicUrl } } = supabase.storage.from('promotions').getPublicUrl(uploadedPath);
      const { error: dbError } = await supabase.from('banners').insert([{
        business_id: businessId,
        image_url: publicUrl,
        is_active: true,
      }]);
      if (dbError) {
        const { error: cleanupError } = await supabase.storage
          .from('promotions')
          .remove([uploadedPath]);
        if (cleanupError) console.error('Error limpiando un banner sin registro:', cleanupError.message);
        throw dbError;
      }

      setBannerCount((current) => current + 1);
      setFeedback('Banner publicado correctamente.');
    } catch (uploadError) {
      setError(`No se pudo publicar el banner: ${uploadError.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (subscriptionActive === null || subscriptionActive === undefined) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!subscriptionActive) {
    return (
      <View style={[styles.upsellContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.upsellText, { color: colors.text }]}>
          Con IstmiYa Pro puedes publicar hasta 2 banners publicitarios.
        </Text>
        <AnimatedButton title="Activar Pro por $35.000/mes" onPress={onUpgrade} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.text }]}>Publicidad Premium</Text>
      <AnimatedButton
        title={loading ? 'Publicando...' : `Subir banner (${bannerCount}/2)`}
        onPress={handleUpload}
        disabled={loading || bannerCount >= 2}
        style={styles.uploadButton}
      />
      {feedback ? <Text style={[styles.feedback, { color: colors.primary }]}>{feedback}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 18, borderRadius: 16, marginBottom: 20 },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  uploadButton: { alignSelf: 'stretch' },
  upsellContainer: { padding: 18, borderRadius: 16, marginBottom: 20, borderWidth: 1 },
  upsellText: { fontWeight: '600', lineHeight: 20, marginBottom: 12 },
  feedback: { fontSize: 13, marginTop: 10 },
  error: { color: '#B3261E', fontSize: 13, lineHeight: 19, marginTop: 10 },
});

export default BannerUploader;
