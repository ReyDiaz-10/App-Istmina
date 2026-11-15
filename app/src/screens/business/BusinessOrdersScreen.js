import { AppText as Text } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  View,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import { useRoleTheme } from '../../hooks/useRoleTheme';
import AnimatedButton from '../../components/AnimatedButton';
import OrderStatusAnimation from '../../components/OrderStatusAnimation';
import HelpButton from '../../components/HelpButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCOP } from '../../utils/formatters';

const CHAT_STATUSES = [
  'pagado',
  'preparando',
  'listo_para_repartidor',
  'repartidor_asignado',
  'recogido',
  'en_camino',
  'entregado',
];

const BusinessOrdersScreen = ({ navigation }) => {
  const profile = useAuthStore((state) => state.profile);
  const theme = useRoleTheme();
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  const [businessId, setBusinessId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [pickupCodes, setPickupCodes] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchBusiness = async () => {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('id')
          .eq('profile_id', profile?.id)
          .maybeSingle();
        if (error) throw error;
        if (active) setBusinessId(data?.id || null);
      } catch (error) {
        Alert.alert('Error', `No se pudo cargar el negocio: ${error.message}`);
        if (active) setLoading(false);
      }
    };

    if (profile?.id) fetchBusiness();
    else setLoading(false);

    return () => {
      active = false;
    };
  }, [profile?.id]);

  const fetchOrders = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(quantity, unit_price, products(name), order_item_options(option_group, name, price_delta))')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setOrders(data || []);
      const codeResults = await Promise.all((data || [])
        .filter((order) => ['pagado', 'preparando', 'listo_para_repartidor', 'repartidor_asignado'].includes(order.status))
        .map(async (order) => {
          const { data: verification, error: codeError } = await supabase.rpc('get_order_verification_codes', {
            p_order_id: order.id,
          });
          if (codeError) {
            console.error('No se pudo cargar el código de recogida:', codeError.message);
            return null;
          }
          return [order.id, verification?.pickup_code];
        }));
      setPickupCodes(Object.fromEntries(codeResults.filter(Boolean)));
    } catch (error) {
      console.error('Error cargando pedidos del negocio:', error.message);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return undefined;
    fetchOrders();

    const channel = supabase
      .channel(`business-orders:${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `business_id=eq.${businessId}` },
        () => fetchOrders(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime business order subscription failed: ${status}`);
        }
      });

    return () => supabase.removeChannel(channel);
  }, [businessId, fetchOrders]);

  const acceptOrder = async (orderId) => {
    try {
      const { data: fee, error } = await supabase.rpc('accept_business_order', {
        p_order_id: orderId,
      });
      if (error) throw error;
      Alert.alert(
        'Pedido aceptado',
        Number(fee) > 0
          ? `Se descontó la comisión de ${formatCOP(fee, locale)}.`
          : 'La suscripción activa cubre este pedido; no se descontó comisión.',
      );
      await fetchOrders();
    } catch (error) {
      const message = error.message.includes('WALLET_INSUFFICIENT')
        ? 'Saldo insuficiente. Recarga la billetera o activa la suscripción para aceptar el pedido.'
        : error.message;
      Alert.alert('No se pudo aceptar el pedido', message);
    }
  };

  const markReady = async (orderId) => {
    try {
      const { error } = await supabase.rpc('mark_order_ready', { p_order_id: orderId });
      if (error) throw error;
      await fetchOrders();
    } catch (error) {
      Alert.alert('No se pudo actualizar el pedido', error.message);
    }
  };

  const rejectOrder = (orderId) => {
    Alert.alert(
      'Rechazar pedido',
      '¿Confirmas que el comercio no puede aceptar este pedido? Si ya fue pagado, se solicitará un reembolso automático a Wompi.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Rechazar pedido',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.functions.invoke('cancel-order', {
                body: { orderId, action: 'business_reject' },
              });
              if (error) throw error;
              if (data?.error) throw new Error(data.error);
              await fetchOrders();
              Alert.alert(
                'Pedido rechazado',
                data?.refunds?.some((refund) => refund.status === 'pending')
                  ? 'El reembolso quedó pendiente de confirmación de Wompi.'
                  : 'El pedido fue cancelado y el reembolso será visible para el cliente.',
              );
            } catch (error) {
              Alert.alert('No se pudo rechazar el pedido', error.message);
            }
          },
        },
      ],
    );
  };

  const renderOrder = ({ item }) => (
    <View style={[styles.orderCard, { backgroundColor: colors.surface }]}>
      <View style={styles.orderHeader}>
        <Text style={[styles.orderId, { color: colors.text }]}>Pedido #{item.order_number || item.id.slice(0, 8)}</Text>
        <Text style={[styles.status, { color: theme.primary }]}>
          {item.status.replace(/_/g, ' ').toUpperCase()}
        </Text>
      </View>
      <View style={styles.orderItems}>
        {item.order_items?.map((product, index) => (
          <View key={`${item.id}-${index}`}>
            <Text style={styles.itemText}>
              {product.quantity} × {product.products?.name || 'Producto'} — $
              {formatCOP(product.unit_price, locale)}
            </Text>
            {product.order_item_options?.map((option) => (
              <Text key={`${item.id}-${index}-${option.name}`} style={styles.itemOptionText}>
                · {option.option_group}: {option.name}
              </Text>
            ))}
          </View>
        ))}
      </View>
      <View style={styles.amountBreakdown}>
        <Text style={styles.amountText}>
          Productos: {formatCOP(item.product_subtotal_cop ?? item.total_amount, locale)}
        </Text>
        <Text style={styles.amountText}>
          Domicilio (para repartidor): {formatCOP(item.delivery_fee_cop, locale)}
        </Text>
        <Text style={styles.totalText}>
          Total pagado: {formatCOP(item.total_amount, locale)}
        </Text>
      </View>
      <OrderStatusAnimation status={item.status} />
      {pickupCodes[item.id] ? (
        <View style={styles.pickupCodeCard}>
          <Text style={styles.pickupCodeLabel}>Código de recogida para validar con el repartidor</Text>
          <Text selectable style={styles.pickupCode}>{pickupCodes[item.id]}</Text>
          <Text style={styles.pickupCodeHint}>Comparte el código con el repartidor cuando llegue al local.</Text>
        </View>
      ) : null}
      {item.status === 'pagado' && (
        <>
          <AnimatedButton
            title="Aceptar pedido (comisión 10% si no hay suscripción)"
            onPress={() => acceptOrder(item.id)}
            style={styles.action}
            buttonStyle={styles.actionSurface}
          />
          <AnimatedButton
            title="Rechazar pedido y devolver pago"
            variant="secondary"
            onPress={() => rejectOrder(item.id)}
            style={styles.action}
            buttonStyle={styles.actionSurface}
          />
        </>
      )}
      {item.status === 'preparando' && (
        <AnimatedButton
          title="Pedido listo para repartidor"
          onPress={() => markReady(item.id)}
          style={styles.action}
          buttonStyle={styles.actionSurface}
        />
      )}
      {CHAT_STATUSES.includes(item.status) && (
        <AnimatedButton
          title="Abrir chat del pedido"
          variant="secondary"
          navigation={navigation}
          onPress={() => navigation.navigate('OrderChat', { orderId: item.id })}
          style={styles.action}
          buttonStyle={styles.chatSurface}
        />
      )}
      <HelpButton navigation={navigation} context="pedido de negocio" orderId={item.id} compact />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No hay pedidos actuales</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 18, flexGrow: 1 },
  orderCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 15, marginBottom: 15, elevation: 3 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  orderId: { fontSize: 16, fontWeight: 'bold', color: '#1A237E' },
  status: { fontSize: 11, fontWeight: 'bold', marginLeft: 8 },
  orderItems: { marginVertical: 8 },
  itemText: { fontSize: 14, color: '#666666', marginBottom: 3 },
  itemOptionText: { fontSize: 12, color: '#687078', marginLeft: 10, marginBottom: 2 },
  amountBreakdown: { marginTop: 6 },
  amountText: { fontSize: 13, color: '#666666', marginTop: 3, textAlign: 'right' },
  totalText: { fontSize: 17, fontWeight: 'bold', color: '#333333', textAlign: 'right', marginTop: 6 },
  action: { alignSelf: 'stretch', marginTop: 10 },
  actionSurface: { width: '100%' },
  chatSurface: { width: '100%', backgroundColor: '#FFFFFF' },
  empty: { textAlign: 'center', marginTop: 50, color: '#757575' },
  pickupCodeCard: { backgroundColor: '#FFF3E0', borderRadius: 10, padding: 12, marginTop: 12, alignItems: 'center' },
  pickupCodeLabel: { color: '#7A4300', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  pickupCode: { color: '#7A4300', fontSize: 24, fontWeight: '900', letterSpacing: 4, marginTop: 2 },
  pickupCodeHint: { color: '#80572C', fontSize: 11, textAlign: 'center', marginTop: 4 },
});

export default BusinessOrdersScreen;
