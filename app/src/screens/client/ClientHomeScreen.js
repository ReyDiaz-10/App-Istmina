import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useEffect, useMemo, useState } from 'react';
import NotificationBell from '../../components/NotificationBell';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import PromoCarousel from '../../components/PromoCarousel';
import { useRoleTheme } from '../../hooks/useRoleTheme';
import { useAuthStore } from '../../store/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import MarketplaceWordmark from '../../components/MarketplaceWordmark';
import { useTranslation } from '../../hooks/useTranslation';
import { usePreferencesStore } from '../../store/preferencesStore';
import { filterBusinesses } from '../../utils/marketplaceFilters.mjs';

const CATEGORIES = [
  { key: 'food', spanish: '🍔 Comida', english: '🍔 Food' },
  { key: 'groceries', spanish: '🛒 Supermercado', english: '🛒 Groceries' },
  { key: 'pharmacy', spanish: '💊 Farmacia', english: '💊 Pharmacy' },
  { key: 'services', spanish: '🛠️ Servicios', english: '🛠️ Services' },
  { key: 'desserts', spanish: '🍰 Postres', english: '🍰 Desserts' },
];

const ClientHomeScreen = ({ navigation }) => {
  const [businesses, setBusinesses] = useState([]);
  const [popularBusinesses, setPopularBusinesses] = useState([]);
  const [failedBusinessImages, setFailedBusinessImages] = useState({});
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('Todos');
  const [searchText, setSearchText] = useState('');
  const theme = useRoleTheme();
  const { colors } = useAppTheme();
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const signOut = useAuthStore((state) => state.signOut);
  const t = useTranslation();
  const language = usePreferencesStore((state) => state.language);
  const isEnglish = language === 'en';
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'home.goodMorning' : hour < 18 ? 'home.goodAfternoon' : 'home.goodEvening');
  const displayName = (
    profile?.nickname
    || profile?.full_name
    || user?.user_metadata?.nickname
    || user?.user_metadata?.full_name
    || ''
  ).trim();

  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('*, products(name, description, category, image_url, is_available, inventory_enabled, stock_quantity)')
          .eq('status', 'activo');

        if (error) throw error;
        setBusinesses((data || []).map((business) => ({
          ...business,
          products: (business.products || []).filter((product) => (
            product.is_available !== false
            && (!product.inventory_enabled || Number(product.stock_quantity) > 0)
          )),
        })));

        const { data: popularData, error: popularError } = await supabase.rpc(
          'get_home_popular_businesses',
          { p_limit: 5 },
        );
        if (popularError) {
          console.warn('No se pudieron cargar los negocios populares:', popularError.message);
        } else {
          setPopularBusinesses(popularData || []);
        }
      } catch (error) {
        console.error('No se pudieron cargar los negocios:', error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchBusinesses();
  }, []);

  const visibleBusinesses = useMemo(() => {
    return filterBusinesses(businesses, category, searchText);
  }, [businesses, category, searchText]);

  const handleSessionButton = async () => {
    if (!user) {
      navigation.navigate('Login');
      return;
    }
    const result = await signOut();
    if (!result.success) return;
    navigation.reset({ index: 0, routes: [{ name: 'ClientHome' }] });
  };

  const renderBusinessCard = ({ item }) => {
    const productImageUrls = (item.products || []).map((product) => product.image_url);
    const imageCandidates = [...new Set([
      ...productImageUrls,
      item.product_image_url,
      item.store_image_url,
    ].filter(Boolean))];
    const failedImages = failedBusinessImages[item.id] || [];
    const imageUrl = imageCandidates.find((url) => !failedImages.includes(url));

    return (
      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.card, { backgroundColor: colors.surface }]}
        onPress={() =>
          navigation.navigate('StoreDetail', {
            businessId: item.id,
            storeName: item.store_name,
          })
        }
      >
        {imageUrl ? (
          <Image
            key={`${item.id}:${imageUrl}`}
            source={{ uri: imageUrl }}
            style={styles.cardImage}
            resizeMode="cover"
            onError={() => setFailedBusinessImages((current) => ({
              ...current,
              [item.id]: [...new Set([...(current[item.id] || []), imageUrl])],
            }))}
          />
        ) : (
          <View style={[styles.cardImage, styles.imagePlaceholder]}>
            <Text style={styles.placeholderIcon}>🍽️</Text>
          </View>
        )}
        <View style={styles.cardContent}>
          <Text style={[styles.storeName, { color: colors.text }]}>{item.store_name}</Text>
          <Text style={[styles.storeInfo, { color: colors.muted }]}>
            ⏱️ {item.prep_time_t} min • {item.address}
          </Text>
          {item.order_count !== undefined ? (
            <Text style={[styles.popularOrderCount, { color: theme.primary }]}>
              {item.order_count} {isEnglish ? 'orders' : 'pedidos'}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const listHeader = (
    <View>
      <View style={styles.brandHeader}>
        <View style={styles.brandCopy}>
          <MarketplaceWordmark width={178} />
          <Text style={[styles.brandSubtitle, { color: colors.text }]}>{t('home.tagline')}</Text>
          <Text style={[styles.marketLabel, { color: theme.primary }]}>{t('home.market')}</Text>
        </View>
        {user ? <NotificationBell navigation={navigation} compact /> : null}
      </View>
      {displayName ? (
        <Text style={[styles.greeting, { color: colors.text }]}>{greeting}, {displayName}</Text>
      ) : null}
      {user && (
        <AnimatedButton
          title={t('home.profile')}
          variant="secondary"
          onPress={() => navigation.navigate('Profile')}
          style={styles.loginCta}
          buttonStyle={[styles.loginCtaSurface, { borderColor: theme.primary }]}
          textStyle={{ color: theme.primary }}
        />
      )}
      {!user && (
        <AnimatedButton
          title={t('home.login')}
          onPress={handleSessionButton}
          style={styles.loginCta}
          buttonStyle={[styles.loginCtaSurface, { backgroundColor: theme.primary, borderColor: theme.primary }]}
          textStyle={{ color: theme.onPrimary }}
        />
      )}
      <View style={styles.quickLinkRow}>
        {user && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.orders')} style={styles.quickLink} onPress={() => navigation.navigate('ClientOrders')}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.orders')}</Text></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.about')} style={styles.quickLink} onPress={() => navigation.navigate('About')}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.about')}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.settings')} style={styles.quickLink} onPress={() => navigation.navigate('Settings')}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.settings')}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.help')} style={styles.quickLink} onPress={() => navigation.navigate('Support', { context: 'general' })}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.help')}</Text></TouchableOpacity>
        {user && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.logout')} style={styles.quickLink} onPress={handleSessionButton}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.logout')}</Text></TouchableOpacity>}
      </View>
      <Image
        source={require('../../../assets/images/istmiya-local-market-hero.jpg')}
        accessibilityLabel="IstmiYa conecta el mercado local de Istmina con sus clientes"
        accessible
        resizeMode="contain"
        style={styles.marketHero}
      />
      {user?.user_metadata?.role && user.user_metadata.role !== 'cliente' && (
        <TouchableOpacity accessibilityRole="button" style={styles.quickLink} onPress={() => navigation.navigate('About')}>
          <Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.about')}</Text>
        </TouchableOpacity>
      )}
      <View style={styles.searchContainer}>
        <TextInput
          nativeID="business-search"
          style={[styles.searchInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
          placeholder={t('home.search')}
          accessibilityLabel={t('home.searchLabel')}
          value={searchText}
          onChangeText={setSearchText}
          returnKeyType="search"
          autoCapitalize="none"
        />
      </View>
      <View style={styles.promoSection}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('home.promotions')}</Text>
        <PromoCarousel />
      </View>
      {popularBusinesses.length > 0 ? (
        <View style={styles.popularSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {isEnglish ? 'Popular in Istmina' : 'Populares en Istmina'}
          </Text>
          {popularBusinesses.map((business) => (
            <View key={`popular-${business.id}`}>
              {renderBusinessCard({ item: business })}
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.categoryContainer}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('home.categories')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryList}
        >
          <TouchableOpacity
            style={[
              styles.categoryItem,
              { backgroundColor: colors.surface, borderColor: colors.border },
              category === 'Todos' && { backgroundColor: theme.primary, borderColor: theme.primary },
            ]}
            onPress={() => setCategory('Todos')}
          >
            <Text style={[styles.categoryText, { color: colors.muted }, category === 'Todos' && styles.categoryTextActive]}>
              {t('home.all')}
            </Text>
          </TouchableOpacity>
          {CATEGORIES.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.categoryItem,
              { backgroundColor: colors.surface, borderColor: colors.border },
              category === item.key && { backgroundColor: theme.primary, borderColor: theme.primary },
              ]}
              onPress={() => setCategory(item.key)}
            >
            <Text style={[styles.categoryText, { color: colors.muted }, category === item.key && styles.categoryTextActive]}>
                {isEnglish ? item.english : item.spanish}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('home.nearby')}</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} style={styles.loader} />
      ) : (
        <FlatList
          style={styles.businessList}
          data={visibleBusinesses}
          keyExtractor={(item) => item.id}
          renderItem={renderBusinessCard}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>{t('home.empty')}</Text>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, overflow: 'hidden', backgroundColor: '#F5F7FA' },
  businessList: { flex: 1, minHeight: 0 },
  listContent: { paddingBottom: 24 },
  brandHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  brandCopy: { flex: 1, minWidth: 0 },
  brandSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '800', marginTop: 5 },
  marketLabel: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.7, marginTop: 4 },
  marketHero: {
    width: '100%',
    maxWidth: 520,
    height: 260,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 14,
    backgroundColor: '#FFF4E2',
  },
  greeting: { marginHorizontal: 20, marginTop: 16, fontSize: 25, lineHeight: 32, fontWeight: '800' },
  loginCta: { alignSelf: 'stretch', marginHorizontal: 20, marginTop: 14 },
  loginCtaSurface: { width: '100%', minHeight: 48 },
  quickLinkRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 14, marginTop: 6 },
  quickLink: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  quickLinkText: { fontSize: 13, fontWeight: '700' },
  searchContainer: { paddingHorizontal: 20, paddingTop: 14 },
  searchInput: {
    backgroundColor: '#FFFFFF',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    fontSize: 16,
  },
  promoSection: { paddingTop: 18 },
  popularSection: { paddingTop: 12 },
  sectionTitle: {
    paddingHorizontal: 20,
    color: '#252525',
    fontSize: 18,
    fontWeight: '700',
  },
  categoryContainer: { paddingTop: 12 },
  categoryList: { paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center' },
  categoryItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    minHeight: 40,
  },
  categoryText: { color: '#757575', fontWeight: '600' },
  categoryTextActive: { color: '#FFFFFF' },
  card: {
    backgroundColor: '#FFFFFF',
    minHeight: 120,
    borderRadius: 15,
    marginHorizontal: 20,
    marginBottom: 16,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardImage: { width: 112, height: 112, margin: 4, borderRadius: 12 },
  imagePlaceholder: { backgroundColor: '#E7EAF2', alignItems: 'center', justifyContent: 'center' },
  placeholderIcon: { fontSize: 30 },
  cardContent: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 14 },
  storeName: { fontSize: 18, fontWeight: 'bold', color: '#1A237E' },
  storeInfo: { fontSize: 14, color: '#757575', marginTop: 5 },
  popularOrderCount: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  loader: { marginTop: 50 },
  emptyText: { textAlign: 'center', marginTop: 28, color: '#757575', fontSize: 16 },
});

export default ClientHomeScreen;
