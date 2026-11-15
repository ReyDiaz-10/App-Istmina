// app/src/screens/client/CartScreen.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import { useRoleTheme } from '../../hooks/useRoleTheme';
import { createOrder, createOrderPaymentLink, quoteDeliveryFee } from '../../services/orders';
import { useAppTheme } from '../../hooks/useAppTheme';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCOP } from '../../utils/formatters';

const CartScreen = ({ navigation }) => {
  const { items, getTotal, clearCart, updateQuantity, removeItem } = useCartStore();
  const businessId = items[0]?.businessId || null;
  const { user } = useAuthStore();
  const theme = useRoleTheme();
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  const [loading, setLoading] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState(null);
  const [deliveryLocation, setDeliveryLocation] = useState(null);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [hasSavedAddress, setHasSavedAddress] = useState(false);
  const [addressChoice, setAddressChoice] = useState(null);
  const [deliveryQuote, setDeliveryQuote] = useState(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState(null);
  const [pendingOrderId, setPendingOrderId] = useState(null);
  const paymentChannel = useRef(null);
  const completedOrder = useRef(null);

  useEffect(() => {
    let active = true;
    const loadSavedAddress = async () => {
      if (!user?.id) {
        setHasSavedAddress(false);
        setAddressChoice(null);
        return;
      }
      try {
        const { data, error } = await supabase.rpc('get_my_delivery_preferences');
        if (error) throw error;
        if (!active || !data?.delivery_address) return;
        setDeliveryAddress(data.delivery_address);
        setDeliveryInstructions(data.delivery_instructions || '');
        setHasSavedAddress(true);
      } catch (error) {
        console.error('No se pudo cargar la dirección habitual:', error.message);
      }
    };
    loadSavedAddress();
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    setDeliveryMode(null);
    setDeliveryQuote(null);
    setDeliveryError(null);
    setDeliveryLocation(null);
    setDeliveryAddress('');
    setDeliveryInstructions('');
    if (!businessId) return undefined;

    const loadDeliveryMode = async () => {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('delivery_fee_mode')
          .eq('id', businessId)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('No se encontró la tarifa del negocio.');
        if (active) setDeliveryMode(data.delivery_fee_mode);
      } catch (error) {
        if (active) setDeliveryError(error.message);
      }
    };

    loadDeliveryMode();
    return () => {
      active = false;
    };
  }, [businessId]);

  useEffect(() => {
    let active = true;
    setDeliveryQuote(null);
    if (
      !businessId
      || !deliveryMode
      || !deliveryLocation
    ) {
      setDeliveryLoading(false);
      return undefined;
    }

    const loadQuote = async () => {
      setDeliveryLoading(true);
      setDeliveryError(null);
      try {
        const quote = await quoteDeliveryFee({
          businessId,
          deliveryLatitude: deliveryLocation.latitude,
          deliveryLongitude: deliveryLocation.longitude,
        });
        if (active) setDeliveryQuote(quote);
      } catch (error) {
        if (active) setDeliveryError(error.message);
      } finally {
        if (active) setDeliveryLoading(false);
      }
    };

    loadQuote();
    return () => {
      active = false;
    };
  }, [businessId, deliveryLocation, deliveryMode]);

  const openChatAfterPayment = useCallback((orderId) => {
    if (completedOrder.current === orderId) return;
    completedOrder.current = orderId;
    clearCart();
    navigation.replace('OrderChat', { orderId });
  }, [clearCart, navigation]);

  const checkPaymentStatus = useCallback(async (orderId) => {
    const { data, error } = await supabase
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .maybeSingle();

    if (error) {
      console.error('Error verificando el pago:', error.message);
      return;
    }
    if (data?.status === 'pagado') openChatAfterPayment(orderId);
  }, [openChatAfterPayment]);

  const watchPayment = useCallback((orderId) => {
    if (paymentChannel.current) {
      supabase.removeChannel(paymentChannel.current);
    }

    paymentChannel.current = supabase
      .channel(`order-payment:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        ({ new: order }) => {
          if (order.status === 'pagado') openChatAfterPayment(orderId);
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime payment subscription failed: ${status}`);
        }
      });

    checkPaymentStatus(orderId);
  }, [checkPaymentStatus, openChatAfterPayment]);

  useEffect(() => {
    if (!pendingOrderId) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkPaymentStatus(pendingOrderId);
    });
    return () => subscription.remove();
  }, [checkPaymentStatus, pendingOrderId]);

  useEffect(() => () => {
    if (paymentChannel.current) supabase.removeChannel(paymentChannel.current);
  }, []);

  const handleCheckout = async () => {
    if (!user) {
      navigation.navigate('Login', { returnTo: 'Cart' });
      return;
    }

    if (items.length === 0) return;
    if (items.some((item) => item.businessId !== businessId)) {
      Alert.alert('Un solo negocio por pedido', 'Finaliza este pedido antes de agregar productos de otro negocio.');
      return;
    }
    if (!deliveryMode || !deliveryQuote) {
      Alert.alert(
        'Domicilio pendiente',
        deliveryError || 'Espera a que se calcule la tarifa antes de continuar.',
      );
      return;
    }
    if (!deliveryLocation) {
      Alert.alert('Ubicación necesaria', 'Comparte tu ubicación GPS para coordinar la entrega.');
      return;
    }
    if (!deliveryAddress.trim()) {
      Alert.alert('Dirección necesaria', 'Escribe la dirección o las indicaciones suficientes para llegar a tu domicilio.');
      return;
    }
    if (hasSavedAddress && !addressChoice) {
      Alert.alert('Confirma la dirección', 'Confirma si deseas usar la dirección habitual o edítala antes de continuar.');
      return;
    }
    setLoading(true);

    try {
      const orderId = pendingOrderId || await createOrder({
        businessId,
        items,
        deliveryLatitude: deliveryLocation.latitude,
        deliveryLongitude: deliveryLocation.longitude,
        deliveryAddress: deliveryAddress.trim(),
        deliveryInstructions: deliveryInstructions.trim() || null,
      });
      setPendingOrderId(orderId);
      watchPayment(orderId);

      const paymentUrl = await createOrderPaymentLink(orderId);
      await Linking.openURL(paymentUrl);
      Alert.alert(
        'Pago pendiente',
        'Cuando Wompi confirme el pago, se abrirá el chat con el negocio.',
      );
    } catch (error) {
      Alert.alert('No se pudo iniciar el pago', error.message);
    } finally {
      setLoading(false);
    }
  };

  const requestDeliveryLocation = async () => {
    setLocationLoading(true);
    setDeliveryError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Debes permitir la ubicación para coordinar la entrega.');
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setDeliveryLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (error) {
      setDeliveryError(error.message);
    } finally {
      setLocationLoading(false);
    }
  };

  const deliveryFee = Number(deliveryQuote?.delivery_fee_cop || 0);
  const orderTotal = getTotal() + deliveryFee;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text style={[styles.title, { color: colors.text }]}>Mi Carrito</Text>
        <AnimatedButton variant="home" navigation={navigation} />
      </View>
      
      <FlatList 
        data={items} 
        keyExtractor={(item) => item.cartKey || `${item.id}:`}
        renderItem={({ item }) => (
          <View style={[styles.itemCard, { backgroundColor: colors.surface }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, { color: colors.text }]}>{item.name}</Text>
              {item.optionNames?.length ? (
                <Text style={[styles.itemOptions, { color: colors.muted }]}>{item.optionNames.join(' · ')}</Text>
              ) : null}
              <Text style={styles.itemPrice}>${item.price}</Text>
            </View>
            <View style={styles.quantityControls}>
              <AnimatedButton
                title="-"
                accessibilityLabel={`Disminuir cantidad de ${item.name}`}
                onPress={() => updateQuantity(item.cartKey || `${item.id}:`, -1)}
                buttonStyle={styles.qtyBtn}
                textStyle={styles.qtyText}
              />
              <Text style={styles.qtyNumber}>{item.quantity}</Text>
              <AnimatedButton
                title="+"
                accessibilityLabel={`Aumentar cantidad de ${item.name}`}
                onPress={() => updateQuantity(item.cartKey || `${item.id}:`, 1)}
                buttonStyle={styles.qtyBtn}
                textStyle={styles.qtyText}
              />
              <AnimatedButton
                title="Quitar"
                accessibilityLabel={`Quitar ${item.name} del carrito`}
                onPress={() => removeItem(item.cartKey || `${item.id}:`)}
                variant="secondary"
                style={styles.removeBtn}
                buttonStyle={styles.removeSurface}
                textStyle={styles.removeText}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Tu carrito está vacío</Text>}
      />

      <View style={[styles.footer, { backgroundColor: colors.surface }]}>
        <View style={styles.locationSection}>
          <Text style={[styles.deliveryHint, { color: colors.muted }]}>
            Escribe la dirección y las indicaciones que ayuden al repartidor a llegar a tu domicilio.
          </Text>
          {hasSavedAddress && !pendingOrderId ? (
            <View style={[styles.savedAddressCard, { borderColor: colors.border }]}>
              <Text style={[styles.savedAddressPrompt, { color: colors.text }]}>
                ¿Deseas usar tu dirección e indicaciones habituales?
              </Text>
              <View style={styles.savedAddressActions}>
                <Pressable onPress={() => setAddressChoice('saved')}>
                  <Text style={[styles.savedAddressAction, { color: theme.primary }]}>Usar habituales</Text>
                </Pressable>
                <Pressable onPress={() => setAddressChoice('edit')}>
                  <Text style={[styles.savedAddressAction, { color: theme.primary }]}>Editar</Text>
                </Pressable>
              </View>
              {addressChoice ? (
                <Text style={[styles.deliveryHint, { color: colors.muted }]}>
                  {addressChoice === 'saved' ? 'Usaremos los datos guardados.' : 'Puedes modificar los datos para este pedido.'}
                </Text>
              ) : null}
            </View>
          ) : null}
          <TextInput
            accessibilityLabel="Dirección de entrega"
            value={deliveryAddress}
            onChangeText={(value) => {
              setDeliveryAddress(value);
              if (hasSavedAddress) setAddressChoice('edit');
            }}
            editable={!pendingOrderId}
            placeholder="Dirección para que el repartidor llegue a tu domicilio"
            placeholderTextColor={colors.muted}
            style={[styles.addressInput, { color: colors.text, borderColor: colors.border }]}
            maxLength={300}
          />
          <TextInput
            accessibilityLabel="Referencia e instrucciones de entrega, opcional"
            value={deliveryInstructions}
            onChangeText={(value) => {
              setDeliveryInstructions(value);
              if (hasSavedAddress) setAddressChoice('edit');
            }}
            editable={!pendingOrderId}
            placeholder="Apartamento, referencia o instrucciones (opcional)"
            placeholderTextColor={colors.muted}
            style={[styles.addressInput, styles.instructionsInput, { color: colors.text, borderColor: colors.border }]}
            maxLength={500}
            multiline
          />
          <AnimatedButton
            title={locationLoading
              ? 'Obteniendo ubicación...'
              : deliveryLocation
                ? 'Actualizar ubicación GPS'
                : 'Compartir ubicación GPS'}
            onPress={requestDeliveryLocation}
            disabled={locationLoading || deliveryLoading || Boolean(pendingOrderId)}
            variant="secondary"
            style={styles.locationButton}
          />
          {deliveryLocation ? (
            <Text style={[styles.deliveryHint, { color: colors.muted }]}>
              Ubicación GPS capturada correctamente.
            </Text>
          ) : null}
        </View>
        <View style={styles.feeRow}>
          <Text style={[styles.feeLabel, { color: colors.muted }]}>Subtotal de productos</Text>
          <Text style={[styles.feeValue, { color: colors.text }]}>{formatCOP(getTotal(), locale)}</Text>
        </View>
        <View style={styles.feeRow}>
          <Text style={[styles.feeLabel, { color: colors.muted }]}>Domicilio</Text>
          <Text style={[styles.feeValue, { color: colors.text }]}>
            {deliveryLoading
              ? 'Calculando...'
              : deliveryQuote
                ? formatCOP(deliveryFee, locale)
                : !deliveryLocation
                  ? 'Comparte tu ubicación GPS'
                  : 'Cargando tarifa...'}
          </Text>
        </View>
        {deliveryQuote?.distance_meters != null ? (
          <Text style={[styles.distanceText, { color: colors.muted }]}>
            Distancia directa: {(Number(deliveryQuote.distance_meters) / 1000).toFixed(2)} km
          </Text>
        ) : null}
        {deliveryError ? (
          <Text accessibilityRole="alert" style={styles.deliveryError}>{deliveryError}</Text>
        ) : null}
        <Text style={[styles.totalLabel, { color: colors.text }]}>
          Total a pagar:{' '}
          <Text style={styles.totalAmount}>
            {deliveryQuote ? formatCOP(orderTotal, locale) : 'Pendiente de calcular'}
          </Text>
        </Text>
        <Text style={[styles.paymentLabel, { color: colors.muted }]}>Pago seguro en línea con Wompi</Text>

        <AnimatedButton
          title={loading
            ? 'Procesando...'
            : user
              ? pendingOrderId ? 'Reintentar pago con Wompi' : 'Pagar con Wompi'
              : 'Iniciar sesión para pedir'}
          onPress={handleCheckout}
          disabled={loading || (Boolean(user) && (
            items.length === 0
            || !deliveryQuote
            || deliveryLoading
            || !deliveryLocation
            || !deliveryAddress.trim()
            || (hasSavedAddress && !addressChoice)
          ))}
          style={styles.checkoutBtn}
          buttonStyle={styles.checkoutSurface}
          textStyle={styles.checkoutText}
        />
        {loading && <ActivityIndicator color={theme.onPrimary} style={styles.checkoutLoader} />}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1A237E' },
  itemCard: { 
    backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10, 
    flexDirection: 'row', alignItems: 'center', elevation: 2 
  },
  itemName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  itemOptions: { fontSize: 12, marginTop: 3 },
  itemPrice: { fontSize: 14, color: '#2E7D32', fontWeight: '600' },
  quantityControls: { flexDirection: 'row', alignItems: 'center' },
  qtyBtn: { backgroundColor: '#E0E0E0', width: 36, height: 36, minHeight: 36, padding: 0, borderRadius: 18 },
  qtyText: { fontSize: 18, fontWeight: 'bold' },
  qtyNumber: { marginHorizontal: 10, fontSize: 16, fontWeight: 'bold' },
  removeBtn: { marginLeft: 8 },
  removeSurface: { borderWidth: 0, paddingHorizontal: 8, minHeight: 36 },
  removeText: { fontSize: 12 },
  footer: { backgroundColor: '#fff', padding: 20, borderRadius: 20, elevation: 5, marginTop: 20 },
  locationSection: { marginBottom: 12 },
  deliveryHint: { fontSize: 12, lineHeight: 18, marginBottom: 8 },
  addressInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 8,
  },
  instructionsInput: { minHeight: 54, textAlignVertical: 'top' },
  savedAddressCard: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8 },
  savedAddressPrompt: { fontSize: 13, fontWeight: '700' },
  savedAddressActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  savedAddressAction: { paddingVertical: 6, paddingRight: 12, fontWeight: '700' },
  locationButton: { alignSelf: 'stretch' },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  feeLabel: { fontSize: 14 },
  feeValue: { fontSize: 14, fontWeight: '600' },
  distanceText: { fontSize: 12, textAlign: 'right', marginBottom: 8 },
  deliveryError: { color: '#B3261E', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  totalLabel: { fontSize: 20, fontWeight: 'bold', textAlign: 'right', marginTop: 8, marginBottom: 15 },
  totalAmount: { color: '#2E7D32' },
  paymentLabel: { fontSize: 16, fontWeight: 'bold', color: '#555', marginBottom: 10 },
  checkoutBtn: { alignSelf: 'stretch' },
  checkoutSurface: { width: '100%', padding: 18 },
  checkoutText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  checkoutLoader: { position: 'absolute', right: 36, bottom: 35 },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#757575' },
});

export default CartScreen;
