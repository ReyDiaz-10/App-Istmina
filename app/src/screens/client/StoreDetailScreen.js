import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { useRoleTheme } from '../../hooks/useRoleTheme';
import { useAppTheme } from '../../hooks/useAppTheme';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCOP } from '../../utils/formatters';

const StoreDetailScreen = ({ route, navigation }) => {
  const { businessId: selectedBusinessId, storeName } = route.params || {};
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const user = useAuthStore((state) => state.user);
  const addItem = useCartStore((state) => state.addItem);
  const theme = useRoleTheme();
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);

  useEffect(() => {
    let active = true;

    const fetchProducts = async () => {
      if (!selectedBusinessId) {
        setProducts([]);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('business_id', selectedBusinessId);

        if (error) throw error;
        if (active) setProducts(data || []);
      } catch (error) {
        console.error('Error cargando productos:', error.message);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchProducts();
    return () => {
      active = false;
    };
  }, [selectedBusinessId]);

  const handleAddToCart = (item) => {
    if (!user) {
      navigation.navigate('Login', {
        returnTo: 'StoreDetail',
        returnParams: { businessId: selectedBusinessId, storeName },
      });
      return;
    }

    addItem({
      id: item.id,
      name: item.name,
      price: item.price,
      businessId: item.business_id,
    });
  };

  const renderProduct = ({ item }) => (
    <View style={[styles.productCard, { backgroundColor: colors.surface }]}>
      <View style={styles.productInfo}>
        <Text style={[styles.productName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.productDesc, { color: colors.muted }]}>{item.description}</Text>
        <Text style={[styles.productPrice, { color: theme.primary }]}>{formatCOP(item.price, locale)}</Text>
      </View>
      <AnimatedButton
        title="+"
        accessibilityLabel={`Agregar ${item.name} al carrito`}
        onPress={() => handleAddToCart(item)}
        style={styles.addButton}
        buttonStyle={styles.addButtonSurface}
        textStyle={styles.addButtonText}
      />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.text }]}>
          {storeName || 'Detalle del negocio'}
        </Text>
        <AnimatedButton variant="home" navigation={navigation} />
      </View>
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} style={styles.loader} />
      ) : (
        <>
          <FlatList
            data={products}
            keyExtractor={(item) => item.id}
            renderItem={renderProduct}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Text style={styles.emptyText}>Este negocio aún no tiene productos disponibles.</Text>
            }
          />
          <AnimatedButton
            title="Ver carrito 🛒"
            navigation={navigation}
            onPress={() => navigation.navigate('Cart')}
            style={styles.cartFloatingButton}
            buttonStyle={styles.cartFloatingSurface}
            textStyle={styles.cartFloatingText}
          />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerTitle: { flex: 1, marginHorizontal: 10, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  loader: { marginTop: 50 },
  listContent: { padding: 20, paddingBottom: 110 },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    elevation: 2,
  },
  productInfo: { flex: 1, marginRight: 10 },
  productName: { fontSize: 16, fontWeight: 'bold', color: '#1A237E' },
  productDesc: { fontSize: 14, color: '#757575', marginVertical: 4 },
  productPrice: { fontSize: 16, fontWeight: 'bold' },
  addButton: { alignSelf: 'center' },
  addButtonSurface: { width: 42, height: 42, minHeight: 42, borderRadius: 21, padding: 0 },
  addButtonText: { fontSize: 22, lineHeight: 24 },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#757575', fontSize: 16 },
  cartFloatingButton: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    left: 20,
    alignSelf: 'stretch',
  },
  cartFloatingSurface: {
    width: '100%',
    padding: 17,
    borderRadius: 30,
  },
  cartFloatingText: { fontSize: 18 },
});

export default StoreDetailScreen;
