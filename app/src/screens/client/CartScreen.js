// app/src/screens/client/CartScreen.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import { useRoleTheme } from '../../hooks/useRoleTheme';
import { createOrder, createOrderPaymentLink } from '../../services/orders';
import { useAppTheme } from '../../hooks/useAppTheme';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCOP } from '../../utils/formatters';

const CartScreen = ({ navigation }) => {
  const { items, getTotal, clearCart, updateQuantity, removeItem } = useCartStore();
  const { user } = useAuthStore();
  const theme = useRoleTheme();
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  const [loading, setLoading] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState(null);
  const paymentChannel = useRef(null);
  const completedOrder = useRef(null);

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
    setLoading(true);

    try {
      const orderId = pendingOrderId || await createOrder({
        businessId: items[0].businessId,
        items,
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text style={[styles.title, { color: colors.text }]}>Mi Carrito</Text>
        <AnimatedButton variant="home" navigation={navigation} />
      </View>
      
      <FlatList 
        data={items} 
        keyExtractor={(item) => item.id} 
        renderItem={({ item }) => (
          <View style={[styles.itemCard, { backgroundColor: colors.surface }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, { color: colors.text }]}>{item.name}</Text>
              <Text style={styles.itemPrice}>${item.price}</Text>
            </View>
            <View style={styles.quantityControls}>
              <AnimatedButton
                title="-"
                accessibilityLabel={`Disminuir cantidad de ${item.name}`}
                onPress={() => updateQuantity(item.id, -1)}
                buttonStyle={styles.qtyBtn}
                textStyle={styles.qtyText}
              />
              <Text style={styles.qtyNumber}>{item.quantity}</Text>
              <AnimatedButton
                title="+"
                accessibilityLabel={`Aumentar cantidad de ${item.name}`}
                onPress={() => updateQuantity(item.id, 1)}
                buttonStyle={styles.qtyBtn}
                textStyle={styles.qtyText}
              />
              <AnimatedButton
                title="Quitar"
                accessibilityLabel={`Quitar ${item.name} del carrito`}
                onPress={() => removeItem(item.id)}
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
        <Text style={[styles.totalLabel, { color: colors.text }]}>Total: <Text style={styles.totalAmount}>{formatCOP(getTotal(), locale)}</Text></Text>
        <Text style={[styles.paymentLabel, { color: colors.muted }]}>Pago seguro en línea con Wompi</Text>

        <AnimatedButton
          title={loading
            ? 'Procesando...'
            : user
              ? pendingOrderId ? 'Reintentar pago con Wompi' : 'Pagar con Wompi'
              : 'Iniciar sesión para pedir'}
          onPress={handleCheckout}
          disabled={loading || (Boolean(user) && items.length === 0)}
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
  itemPrice: { fontSize: 14, color: '#2E7D32', fontWeight: '600' },
  quantityControls: { flexDirection: 'row', alignItems: 'center' },
  qtyBtn: { backgroundColor: '#E0E0E0', width: 36, height: 36, minHeight: 36, padding: 0, borderRadius: 18 },
  qtyText: { fontSize: 18, fontWeight: 'bold' },
  qtyNumber: { marginHorizontal: 10, fontSize: 16, fontWeight: 'bold' },
  removeBtn: { marginLeft: 8 },
  removeSurface: { borderWidth: 0, paddingHorizontal: 8, minHeight: 36 },
  removeText: { fontSize: 12 },
  footer: { backgroundColor: '#fff', padding: 20, borderRadius: 20, elevation: 5, marginTop: 20 },
  totalLabel: { fontSize: 20, fontWeight: 'bold', textAlign: 'right', marginBottom: 15 },
  totalAmount: { color: '#2E7D32' },
  paymentLabel: { fontSize: 16, fontWeight: 'bold', color: '#555', marginBottom: 10 },
  checkoutBtn: { alignSelf: 'stretch' },
  checkoutSurface: { width: '100%', padding: 18 },
  checkoutText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  checkoutLoader: { position: 'absolute', right: 36, bottom: 35 },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#757575' },
});

export default CartScreen;
