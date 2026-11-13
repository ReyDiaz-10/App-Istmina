import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import PromoCarousel from '../../components/PromoCarousel';
import { useRoleTheme } from '../../hooks/useRoleTheme';
import { useAuthStore } from '../../store/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import MarketplaceBrand from '../../components/MarketplaceBrand';
import { useTranslation } from '../../hooks/useTranslation';
import { usePreferencesStore } from '../../store/preferencesStore';

const CATEGORIES = [
  { key: 'food', spanish: '🍔 Comida', english: '🍔 Food' },
  { key: 'groceries', spanish: '🛒 Supermercado', english: '🛒 Groceries' },
  { key: 'pharmacy', spanish: '💊 Farmacia', english: '💊 Pharmacy' },
  { key: 'services', spanish: '🛠️ Servicios', english: '🛠️ Services' },
  { key: 'desserts', spanish: '🍰 Postres', english: '🍰 Desserts' },
];

const ClientHomeScreen = ({ navigation }) => {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('Todos');
  const theme = useRoleTheme();
  const { colors } = useAppTheme();
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const t = useTranslation();
  const language = usePreferencesStore((state) => state.language);
  const isEnglish = language === 'en';

  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('*, products(image_url)')
          .eq('status', 'activo');

        if (error) throw error;
        setBusinesses(data || []);
      } catch (error) {
        console.error(`${t('home.loadError')}:`, error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchBusinesses();
  }, [t]);

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
    const imageUrl = item.products?.find((product) => product.image_url)?.image_url;

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
          <Image source={{ uri: imageUrl }} style={styles.cardImage} resizeMode="cover" />
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
        </View>
      </TouchableOpacity>
    );
  };

  const listHeader = (
    <View>
      <View style={styles.brandHeader}>
        <MarketplaceBrand size={72} />
        <View style={styles.brandCopy}>
          <Text style={[styles.brandName, { color: colors.text }]}>IstmiYa</Text>
          <Text style={[styles.brandSubtitle, { color: colors.text }]}>{t('home.tagline')}</Text>
          <Text style={[styles.marketLabel, { color: theme.primary }]}>{t('home.market')}</Text>
        </View>
      </View>
      <View style={styles.quickLinkRow}>
        {user && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.orders')} style={styles.quickLink} onPress={() => navigation.navigate('ClientOrders')}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.orders')}</Text></TouchableOpacity>}
        {!user && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.login')} style={styles.quickLink} onPress={handleSessionButton}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.login')}</Text></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.about')} style={styles.quickLink} onPress={() => navigation.navigate('About')}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.about')}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.settings')} style={styles.quickLink} onPress={() => navigation.navigate('Settings')}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.settings')}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.help')} style={styles.quickLink} onPress={() => navigation.navigate('Support', { context: 'general' })}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.help')}</Text></TouchableOpacity>
        {user && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('home.logout')} style={styles.quickLink} onPress={handleSessionButton}><Text style={[styles.quickLinkText, { color: theme.primary }]}>{t('home.logout')}</Text></TouchableOpacity>}
      </View>
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
        />
      </View>
      <View style={styles.promoSection}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('home.promotions')}</Text>
        <PromoCarousel />
      </View>
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
          data={businesses}
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
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  listContent: { paddingBottom: 24 },
  brandHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  brandCopy: { flex: 1, minWidth: 145 },
  brandName: { fontSize: 25, fontWeight: '800' },
  brandSubtitle: { fontSize: 19, lineHeight: 24, fontWeight: '800', marginTop: 1 },
  marketLabel: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.7, marginTop: 4 },
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
    borderRadius: 15,
    marginHorizontal: 20,
    marginBottom: 16,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  cardImage: { width: '100%', height: 170 },
  imagePlaceholder: { backgroundColor: '#E7EAF2', alignItems: 'center', justifyContent: 'center' },
  placeholderIcon: { fontSize: 42 },
  cardContent: { padding: 15 },
  storeName: { fontSize: 18, fontWeight: 'bold', color: '#1A237E' },
  storeInfo: { fontSize: 14, color: '#757575', marginTop: 5 },
  loader: { marginTop: 50 },
  emptyText: { textAlign: 'center', marginTop: 28, color: '#757575', fontSize: 16 },
});

export default ClientHomeScreen;
