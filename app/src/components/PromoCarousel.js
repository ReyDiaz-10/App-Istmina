import { AppText as Text } from './AppText.js';
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  ImageBackground,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../api/supabaseClient';

const FALLBACK_SLIDES = [
  { id: 'brand-local', title: 'Lo mejor de Istmina', subtitle: 'El mercado local, en un clic.' },
  { id: 'brand-discover', title: 'Descubre negocios locales', subtitle: 'Encuentra productos cerca de ti.' },
  { id: 'brand-order', title: 'IstmiYa', subtitle: 'Compra local. Recibe en casa.' },
];

const PromoCarousel = () => {
  const [slides, setSlides] = useState(FALLBACK_SLIDES);
  const listRef = useRef(null);
  const currentIndex = useRef(0);
  const { width: screenWidth } = useWindowDimensions();
  const itemWidth = Math.min(screenWidth - 32, 800);

  useEffect(() => {
    let active = true;

    const fetchPromotionalSlides = async () => {
      try {
        // Colombia uses UTC-5 year-round; evaluate subscription dates in the app's market timezone.
        const today = new Date(Date.now() - (5 * 60 * 60 * 1000)).toISOString().slice(0, 10);
        const { data: subscriptions, error: subscriptionsError } = await supabase
          .from('subscriptions')
          .select('business_id')
          .eq('is_active', true)
          .lte('start_date', today)
          .gte('end_date', today);
        if (subscriptionsError) throw subscriptionsError;

        const subscribedIds = [...new Set((subscriptions || []).map((item) => item.business_id).filter(Boolean))];
        if (!subscribedIds.length) return;

        const { data: businesses, error: businessesError } = await supabase
          .from('businesses')
          .select('id, store_name')
          .eq('status', 'activo')
          .in('id', subscribedIds);
        if (businessesError) throw businessesError;

        const eligibleBusinesses = businesses || [];
        const eligibleIds = eligibleBusinesses.map((business) => business.id);
        if (!eligibleIds.length) return;

        const [bannerResult, productResult] = await Promise.all([
          supabase
            .from('banners')
            .select('id, business_id, title, image_url')
            .eq('is_active', true)
            .in('business_id', eligibleIds),
          supabase
            .from('products')
            .select('id, business_id, name, image_url, is_available, inventory_enabled, stock_quantity')
            .in('business_id', eligibleIds)
            .not('image_url', 'is', null)
            .limit(24),
        ]);
        if (bannerResult.error) throw bannerResult.error;
        if (productResult.error) throw productResult.error;

        const businessNames = new Map(eligibleBusinesses.map((business) => [business.id, business.store_name]));
        const bannerSlides = (bannerResult.data || [])
          .filter((banner) => banner.image_url)
          .map((banner) => ({
            id: `banner-${banner.id}`,
            image_url: banner.image_url,
            title: banner.title || businessNames.get(banner.business_id) || 'Promoción local',
            subtitle: businessNames.get(banner.business_id) || 'Negocio local de Istmina',
          }));
        const productSlides = (productResult.data || [])
          .filter((product) => (
            product.image_url
            && product.is_available !== false
            && (!product.inventory_enabled
              || Number(product.stock_quantity || 0) > 0)
          ))
          .map((product) => ({
            id: `product-${product.id}`,
            image_url: product.image_url,
            title: product.name,
            subtitle: businessNames.get(product.business_id) || 'Negocio local de Istmina',
          }));
        const imageSlides = [...bannerSlides, ...productSlides]
          .filter((slide, index, all) => all.findIndex((item) => item.image_url === slide.image_url) === index);

        if (active && imageSlides.length) {
          setSlides([...imageSlides, ...FALLBACK_SLIDES]);
        }
      } catch (error) {
        console.warn('Error cargando promociones e imágenes de productos:', error.message);
      }
    };

    fetchPromotionalSlides();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    currentIndex.current = 0;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    const timer = setInterval(() => {
      currentIndex.current = (currentIndex.current + 1) % slides.length;
      listRef.current?.scrollToOffset({
        offset: currentIndex.current * itemWidth,
        animated: true,
      });
    }, 5000);

    return () => clearInterval(timer);
  }, [slides.length, itemWidth]);

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={slides}
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
          currentIndex.current = Math.min(
            slides.length - 1,
            Math.max(0, Math.round(event.nativeEvent.contentOffset.x / itemWidth)),
          );
        }}
        renderItem={({ item }) => (
          <ImageBackground
            source={item.image_url
              ? { uri: item.image_url }
              : require('../../assets/images/istmiya-local-market-hero.jpg')}
            style={[styles.banner, { width: itemWidth }]}
            imageStyle={styles.bannerImage}
            resizeMode="cover"
            accessibilityLabel={`${item.title}. ${item.subtitle}`}
          >
            <View style={styles.caption}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.subtitle}>{item.subtitle}</Text>
            </View>
          </ImageBackground>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 156,
    marginVertical: 10,
    alignItems: 'center',
  },
  banner: {
    height: 156,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: '#FFF0DF',
  },
  bannerImage: { borderRadius: 14 },
  caption: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: 'rgba(27, 22, 18, 0.66)',
  },
  title: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  subtitle: { color: '#FFFFFF', fontSize: 13, marginTop: 4 },
});

export default PromoCarousel;
