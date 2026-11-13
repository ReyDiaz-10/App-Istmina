import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { supabase } from '../api/supabaseClient';

const PromoCarousel = () => {
  const [banners, setBanners] = useState([]);
  const listRef = useRef(null);
  const currentIndex = useRef(0);
  const { width: screenWidth } = useWindowDimensions();
  const itemWidth = Math.min(screenWidth - 32, 800);

  useEffect(() => {
    let active = true;

    const fetchActiveBanners = async () => {
      try {
        const { data, error } = await supabase
          .from('banners')
          .select('*, businesses(subscriptions(is_active))')
          .eq('is_active', true)
          .eq('businesses.subscriptions.is_active', true);

        if (error) throw error;
        if (active) setBanners(data || []);
      } catch (error) {
        console.error('Error cargando banners promocionales:', error.message);
      }
    };

    fetchActiveBanners();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    currentIndex.current = 0;
    if (banners.length < 2) return undefined;

    const timer = setInterval(() => {
      currentIndex.current = (currentIndex.current + 1) % banners.length;
      listRef.current?.scrollToOffset({
        offset: currentIndex.current * itemWidth,
        animated: true,
      });
    }, 5000);

    return () => clearInterval(timer);
  }, [banners, itemWidth]);

  return (
    <View style={styles.container}>
      {banners.length > 0 ? (
        <FlatList
          ref={listRef}
          data={banners}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          getItemLayout={(_, index) => ({
            length: itemWidth,
            offset: itemWidth * index,
            index,
          })}
          onMomentumScrollEnd={(event) => {
            currentIndex.current = Math.round(
              event.nativeEvent.contentOffset.x / itemWidth,
            );
          }}
          renderItem={({ item }) => (
            <Image
              source={{ uri: item.image_url }}
              style={[styles.bannerImage, { width: itemWidth }]}
              resizeMode="cover"
              accessibilityLabel={item.title || 'Banner promocional'}
            />
          )}
        />
      ) : (
        <View style={[styles.emptyBanner, { width: itemWidth }]}>
          <Text style={styles.emptyTitle}>Promociones locales</Text>
          <Text style={styles.emptyText}>Descubre negocios y ofertas de Istmina.</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 140,
    marginVertical: 10,
    alignItems: 'center',
  },
  bannerImage: {
    height: 140,
    borderRadius: 14,
  },
  emptyBanner: {
    height: 140,
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: '#FFF0DF',
  },
  emptyTitle: {
    color: '#A64B00',
    fontSize: 20,
    fontWeight: '800',
  },
  emptyText: {
    color: '#694326',
    fontSize: 14,
    marginTop: 6,
  },
});

export default PromoCarousel;
