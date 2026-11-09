// app/src/components/PromoCarousel.js
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, FlatList, Image, Dimensions } from 'react-native';
import { supabase } from '../api/supabaseClient';

const { width } = Dimensions.get('window');

const PromoCarousel = () => {
  const [banners, setBanners] = useState([]);
  const flatListRef = useRef(null);

  useEffect(() => {
    fetchActiveBanners();
  }, []);

  const fetchActiveBanners = async () => {
    // Consulta Relacional: Trae banners donde el negocio asociado tenga suscripción activa
    const { data, error } = await supabase
      .from('banners')
      .select('*, businesses(subscriptions(is_active))')
      .eq('is_active', true)
      .eq('businesses.subscriptions.is_active', true);

    if (!error) setBanners(data);
  };

  useEffect(() => {
    if (banners.length > 0) {
      const interval = setInterval(() => {
        // Lógica de scroll automático simplificada
        flatListRef.current?.scrollToNext(); // Nota: Requiere implementacion de scrollIndex
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [banners]);

  if (banners.length === 0) return null;

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={banners}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Image source={{ uri: item.image_url }} style={styles.bannerImage} />
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { height: 130, marginVertical: 10, paddingHorizontal: 15 },
  bannerImage: { 
    width: width - 30, 
    height: 130, 
    borderRadius: 12, 
    resizeMode: 'cover',
    marginRight: 10
  },
});

export default PromoCarousel;
