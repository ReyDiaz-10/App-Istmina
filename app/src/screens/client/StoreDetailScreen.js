import { AppText as Text } from '../../components/AppText.js';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
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
  const [loading, setLoading] = useState(Boolean(selectedBusinessId));
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [requestedProducts, setRequestedProducts] = useState({});
  const user = useAuthStore((state) => state.user);
  const addItem = useCartStore((state) => state.addItem);
  const theme = useRoleTheme();
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);

  useEffect(() => {
    let active = true;
    const fetchProducts = async () => {
      if (!selectedBusinessId) return;
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*, product_options(*)')
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
    if (!selectedBusinessId) return () => { active = false; };
    const channel = supabase
      .channel(`store-products:${selectedBusinessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products', filter: `business_id=eq.${selectedBusinessId}` },
        fetchProducts,
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime product subscription failed: ${status}`);
        }
      });
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [selectedBusinessId]);

  const isProductAvailable = (product) => (
    product.is_available !== false
    && (!product.inventory_enabled
      || Number(product.stock_quantity) - Number(product.reserved_quantity || 0) > 0)
  );

  const requestAvailability = async (product) => {
    if (!user) {
      navigation.navigate('Login', {
        returnTo: 'StoreDetail',
        returnParams: { businessId: selectedBusinessId, storeName },
      });
      return;
    }
    try {
      const { error } = await supabase.rpc('request_product_availability', {
        p_product_id: product.id,
      });
      if (error) throw error;
      setRequestedProducts((current) => ({ ...current, [product.id]: true }));
      Alert.alert(
        'Solicitud enviada',
        'El negocio recibió tu solicitud para revisar y actualizar la disponibilidad. No se abrió un chat.',
      );
    } catch (error) {
      Alert.alert('No se pudo enviar la solicitud', error.message);
    }
  };

  const handleAddToCart = (item, optionIds = []) => {
    if (!user) {
      navigation.navigate('Login', {
        returnTo: 'StoreDetail',
        returnParams: { businessId: selectedBusinessId, storeName },
      });
      return;
    }

    const options = (item.product_options || []).filter((option) => (
      optionIds.includes(option.id)
    ));
    addItem({
      id: item.id,
      name: options.length
        ? `${item.name} · ${options.map((option) => option.name).join(', ')}`
        : item.name,
      price: Number(item.price) + options.reduce((total, option) => total + Number(option.price_delta || 0), 0),
      businessId: item.business_id,
      optionIds,
      optionNames: options.map((option) => `${option.option_group}: ${option.name}`),
    });
    setSelectedProduct(null);
    setSelectedOptions([]);
  };

  const chooseProductOptions = (item) => {
    const options = (item.product_options || []).filter((option) => option.is_available);
    if (!options.length) {
      handleAddToCart(item);
      return;
    }
    const requiredByGroup = new Map();
    options.forEach((option) => {
      if (option.is_required && !requiredByGroup.has(option.option_group)) {
        requiredByGroup.set(option.option_group, option.id);
      }
    });
    setSelectedProduct(item);
    setSelectedOptions([...requiredByGroup.values()]);
  };

  const confirmProductOptions = () => {
    const requiredGroups = new Set((selectedProduct?.product_options || [])
      .filter((option) => option.is_available && option.is_required)
      .map((option) => option.option_group));
    const selectedGroups = new Set((selectedProduct?.product_options || [])
      .filter((option) => selectedOptions.includes(option.id))
      .map((option) => option.option_group));
    if ([...requiredGroups].some((group) => !selectedGroups.has(group))) {
      Alert.alert('Selecciona una variante', 'Este producto requiere una opción obligatoria antes de agregarlo.');
      return;
    }
    handleAddToCart(selectedProduct, selectedOptions);
  };

  const renderProduct = ({ item }) => {
    const available = isProductAvailable(item);
    return (
      <View style={[styles.productCard, { backgroundColor: colors.surface }]}>
        <View style={styles.productInfo}>
          <Text style={[styles.productName, { color: colors.text }]}>{item.name}</Text>
          <Text style={[styles.productDesc, { color: colors.muted }]}>{item.description}</Text>
          {item.inventory_enabled ? (
            <Text style={[styles.productDesc, { color: colors.muted }]}>
              Disponibles: {Math.max(0, Number(item.stock_quantity || 0) - Number(item.reserved_quantity || 0))}
            </Text>
          ) : null}
          <Text style={[styles.productDesc, { color: available ? colors.primary : '#B3261E', fontWeight: '700' }]}>
            {available ? 'Disponible' : 'Agotado'}
          </Text>
          <Text style={[styles.productPrice, { color: theme.primary }]}>{formatCOP(item.price, locale)}</Text>
        </View>
        {available ? (
          <AnimatedButton
            title="+"
            accessibilityLabel={`Agregar ${item.name} al carrito`}
            onPress={() => chooseProductOptions(item)}
            style={styles.addButton}
            buttonStyle={styles.addButtonSurface}
            textStyle={styles.addButtonText}
          />
        ) : (
          <View style={styles.unavailableActions}>
            <Text style={[styles.productDesc, { color: colors.muted }]}>Temporalmente no disponible</Text>
            <AnimatedButton
              title={requestedProducts[item.id] ? 'Solicitud enviada' : 'Solicitar actualización'}
              accessibilityLabel={`Solicitar al negocio actualizar la disponibilidad de ${item.name}`}
              onPress={() => requestAvailability(item)}
              disabled={Boolean(requestedProducts[item.id])}
              variant="secondary"
            />
          </View>
        )}
      </View>
    );
  };

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
              <Text style={styles.emptyText}>Este negocio aún no tiene productos en su catálogo.</Text>
            }
          />
          <Modal
            visible={Boolean(selectedProduct)}
            transparent
            animationType="slide"
            onRequestClose={() => setSelectedProduct(null)}
          >
            <View style={styles.modalBackdrop}>
              <View style={[styles.optionsModal, { backgroundColor: colors.surface }]}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>{selectedProduct?.name}</Text>
                <FlatList
                  data={selectedProduct?.product_options?.filter((option) => option.is_available) || []}
                  keyExtractor={(option) => option.id}
                  renderItem={({ item: option }) => {
                    const selected = selectedOptions.includes(option.id);
                    return (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        style={[styles.optionRow, { borderColor: colors.border }]}
                        onPress={() => setSelectedOptions((current) => {
                          const sameGroup = selectedProduct.product_options
                            .filter((entry) => entry.is_available
                              && entry.option_type === 'variant'
                              && entry.option_group === option.option_group)
                            .map((entry) => entry.id);
                          if (selected) return current.filter((id) => id !== option.id);
                          return [
                            ...current.filter((id) => !sameGroup.includes(id)),
                            option.id,
                          ];
                        })}
                      >
                        <View style={styles.optionCopy}>
                          <Text style={[styles.optionGroup, { color: colors.muted }]}>
                            {option.option_group} · {option.option_type === 'variant' ? 'Variante' : 'Extra'}
                            {option.is_required ? ' · Obligatorio' : ''}
                          </Text>
                          <Text style={[styles.optionName, { color: colors.text }]}>{option.name}</Text>
                        </View>
                        <Text style={[styles.optionPrice, { color: theme.primary }]}>
                          {Number(option.price_delta) ? `+${formatCOP(option.price_delta, locale)}` : 'Incluido'}
                          {selected ? ' ✓' : ''}
                        </Text>
                      </Pressable>
                    );
                  }}
                  ListEmptyComponent={<Text style={{ color: colors.muted }}>Este producto no tiene opciones disponibles.</Text>}
                />
                <View style={styles.modalActions}>
                  <AnimatedButton title="Cancelar" variant="secondary" onPress={() => setSelectedProduct(null)} />
                  <AnimatedButton
                    title="Agregar al carrito"
                    onPress={confirmProductOptions}
                  />
                </View>
              </View>
            </View>
          </Modal>
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
  unavailableActions: { alignItems: 'flex-end', gap: 6 },
  addButtonSurface: { width: 42, height: 42, minHeight: 42, borderRadius: 21, padding: 0 },
  addButtonText: { fontSize: 22, lineHeight: 24 },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#757575', fontSize: 16 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  optionsModal: { maxHeight: '80%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 10 },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, paddingVertical: 12, gap: 12 },
  optionCopy: { flex: 1 },
  optionGroup: { fontSize: 11 },
  optionName: { fontSize: 15, fontWeight: '600', marginTop: 3 },
  optionPrice: { fontWeight: '700' },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingTop: 12 },
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
