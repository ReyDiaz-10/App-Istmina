import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
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
  'no_entregado',
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
  const [prepMinutesByOrder, setPrepMinutesByOrder] = useState({});
  const [deliveryIncidents, setDeliveryIncidents] = useState({});
  const [resolvingIncidentOrderId, setResolvingIncidentOrderId] = useState(null);
  const [demandStatus, setDemandStatus] = useState(null);
  const [pickupCodesFromClient, setPickupCodesFromClient] = useState({});
  const [updatingOrderPause, setUpdatingOrderPause] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let loadingTimer;
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
    else {
      loadingTimer = setTimeout(() => {
        if (active) setLoading(false);
      }, 0);
    }

    return () => {
      active = false;
      clearTimeout(loadingTimer);
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
      const { data: demand, error: demandError } = await supabase.rpc('delivery_demand_status', {
        p_business_id: businessId,
      });
      if (demandError) throw demandError;
      setDemandStatus(demand || null);
      const undeliveredOrderIds = (data || [])
        .filter((order) => order.status === 'no_entregado')
        .map((order) => order.id);
      if (undeliveredOrderIds.length) {
        const { data: incidents, error: incidentsError } = await supabase
          .from('order_delivery_incidents')
          .select('id, order_id, driver_id, reason, status, reported_at, returned_at')
          .in('order_id', undeliveredOrderIds)
          .order('reported_at', { ascending: false });
        if (incidentsError) throw incidentsError;
        const latestIncidents = {};
        for (const incident of incidents || []) {
          if (!latestIncidents[incident.order_id]) latestIncidents[incident.order_id] = incident;
        }
        setDeliveryIncidents(latestIncidents);
      } else {
        setDeliveryIncidents({});
      }
      const codeResults = await Promise.all((data || [])
        .filter((order) => order.delivery_mode !== 'pickup' && ['pagado', 'preparando', 'listo_para_repartidor', 'repartidor_asignado'].includes(order.status))
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
    const initialLoad = setTimeout(() => {
      void fetchOrders();
    }, 0);

    const channel = supabase
      .channel(`business-orders:${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `business_id=eq.${businessId}` },
        () => fetchOrders(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_delivery_incidents' },
        () => fetchOrders(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime business order subscription failed: ${status}`);
        }
      });

    return () => {
      clearTimeout(initialLoad);
      supabase.removeChannel(channel);
    };
  }, [businessId, fetchOrders]);

  const getPrepMinutes = (orderId) => {
    const rawMinutes = prepMinutesByOrder[orderId] || '';
    const minutes = Number(rawMinutes);
    if (!/^\d{1,4}$/.test(rawMinutes) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      Alert.alert('Tiempo inválido', 'Indica entre 1 y 1440 minutos para terminar la preparación.');
      return null;
    }
    return minutes;
  };

  const acceptOrder = async (orderId) => {
    const minutes = getPrepMinutes(orderId);
    if (minutes === null) return;
    try {
      const { data: fee, error } = await supabase.rpc('business_accept_order_with_prep_eta', {
        p_order_id: orderId,
        p_minutes: minutes,
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

  const updatePrepEta = async (orderId) => {
    const minutes = getPrepMinutes(orderId);
    if (minutes === null) return;
    try {
      const { error } = await supabase.rpc('business_update_prep_eta', {
        p_order_id: orderId,
        p_minutes: minutes,
      });
      if (error) throw error;
      await fetchOrders();
    } catch (error) {
      Alert.alert('No se pudo actualizar el tiempo', error.message);
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

  const toggleOrderPause = async () => {
    const paused = demandStatus?.orders_paused === true;
    setUpdatingOrderPause(true);
    try {
      const { error } = await supabase.rpc('set_business_order_pause', {
        p_is_paused: !paused,
      });
      if (error) throw error;
      await fetchOrders();
    } catch (error) {
      Alert.alert('No se pudo actualizar la recepción de pedidos', error.message);
    } finally {
      setUpdatingOrderPause(false);
    }
  };

  const completePickup = async (orderId) => {
    const code = pickupCodesFromClient[orderId] || '';
    if (!/^\d{6}$/.test(code)) { Alert.alert('Código requerido', 'Ingresa el código de seis dígitos que muestra el cliente.'); return; }
    try {
      const { data, error } = await supabase.rpc('complete_pickup_order_with_code', { p_order_id: orderId, p_code: code });
      if (error) throw error;
      if (!data) throw new Error('El código no coincide. El pedido sigue pendiente de entrega.');
      await fetchOrders();
      Alert.alert('Retiro confirmado', 'El pedido se cerró y quedó registrado para liquidación.');
    } catch (error) { Alert.alert('No se pudo confirmar el retiro', error.message); }
  };

  const confirmUndeliveredReturn = async (orderId) => {
    setResolvingIncidentOrderId(orderId);
    try {
      const { error } = await supabase.rpc('confirm_undelivered_return', { p_order_id: orderId });
      if (error) throw error;
      await fetchOrders();
    } catch (error) {
      Alert.alert('No se pudo confirmar la devolución', error.message);
    } finally {
      setResolvingIncidentOrderId(null);
    }
  };

  const reassignReturnedOrder = async (orderId) => {
    setResolvingIncidentOrderId(orderId);
    try {
      const { error } = await supabase.rpc('reassign_returned_order', { p_order_id: orderId });
      if (error) throw error;
      await fetchOrders();
      Alert.alert('Pedido disponible', 'Se generaron nuevos códigos y el pedido quedó disponible para otro repartidor.');
    } catch (error) {
      Alert.alert('No se pudo reasignar el pedido', error.message);
    } finally {
      setResolvingIncidentOrderId(null);
    }
  };

  const cancelUndeliveredOrder = (orderId) => {
    Alert.alert(
      'Cancelar pedido no entregado',
      'La devolución debe estar confirmada. Si existe un pago, se solicitará el reembolso o se registrará para conciliación.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Cancelar pedido',
          style: 'destructive',
          onPress: async () => {
            setResolvingIncidentOrderId(orderId);
            try {
              const { data, error } = await supabase.functions.invoke('cancel-order', {
                body: { orderId, action: 'business_delivery_failed' },
              });
              if (error) throw error;
              if (data?.error) throw new Error(data.error);
              await fetchOrders();
              Alert.alert(
                'Pedido cancelado',
                data?.reconciliation_required
                  ? 'La cancelación quedó registrada; el pago requiere conciliación.'
                  : 'La cancelación quedó registrada y el reembolso se gestionará según el estado del pago.',
              );
            } catch (error) {
              Alert.alert('No se pudo cancelar el pedido', error.message);
            } finally {
              setResolvingIncidentOrderId(null);
            }
          },
        },
      ],
    );
  };

  const cancelForStockOut = (orderId) => {
    Alert.alert(
      'Cancelar por falta de stock',
      'El pedido se cancelará y se revertirá el inventario reservado. Si el pago ya existe, se registrará el reembolso o conciliación.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Cancelar por stock',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.functions.invoke('cancel-order', {
                body: { orderId, action: 'business_stock_out' },
              });
              if (error) throw error;
              if (data?.error) throw new Error(data.error);
              await fetchOrders();
              Alert.alert(
                'Pedido cancelado',
                data?.reconciliation_required
                  ? 'La cancelación quedó registrada y el pago requiere conciliación.'
                  : 'La cancelación quedó registrada y el reembolso se gestionará automáticamente.',
              );
            } catch (error) {
              Alert.alert('No se pudo cancelar el pedido', error.message);
            }
          },
        },
      ],
    );
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
      {item.delivery_mode === 'pickup' ? (
        <Text style={styles.pickupOrderNotice}>RETIRO EN TIENDA: el cliente recogerá este pedido en el negocio.</Text>
      ) : null}
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
      {item.delivery_mode !== 'pickup' && pickupCodes[item.id] ? (
        <View style={styles.pickupCodeCard}>
          <Text style={styles.pickupCodeLabel}>Código de recogida para el repartidor</Text>
          <Text selectable style={styles.pickupCode}>{pickupCodes[item.id]}</Text>
          <Text style={styles.pickupCodeHint}>El repartidor debe ingresarlo cuando recoja el pedido.</Text>
        </View>
      ) : null}
      {item.status === 'pendiente' && (
        <AnimatedButton
          title="Cancelar por falta de stock"
          variant="secondary"
          onPress={() => cancelForStockOut(item.id)}
          style={styles.action}
          buttonStyle={styles.actionSurface}
        />
      )}
      {item.status === 'pagado' && (
        <>
          <Text style={styles.etaLabel}>¿En cuántos minutos estará listo? (1-1440)</Text>
          <TextInput
            accessibilityLabel="Minutos para que el pedido esté listo"
            value={prepMinutesByOrder[item.id] || ''}
            onChangeText={(value) => setPrepMinutesByOrder((current) => ({
              ...current,
              [item.id]: value.replace(/\D/g, '').slice(0, 4),
            }))}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="Ej. 20"
            style={styles.etaInput}
          />
          <AnimatedButton
            title="Aceptar pedido y avisar tiempo de preparación"
            onPress={() => acceptOrder(item.id)}
            disabled={!prepMinutesByOrder[item.id]}
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
          <AnimatedButton
            title="Cancelar por falta de stock"
            variant="secondary"
            onPress={() => cancelForStockOut(item.id)}
            style={styles.action}
            buttonStyle={styles.actionSurface}
          />
        </>
      )}
      {item.status === 'preparando' && (
        item.delivery_mode === 'pickup' ? (
          <>
            <Text style={styles.etaLabel}>Pedido de retiro en tienda. Cuando el cliente llegue, solicita su código de recogida.</Text>
            <TextInput accessibilityLabel="Código de recogida indicado por el cliente" value={pickupCodesFromClient[item.id] || ''} onChangeText={(value) => setPickupCodesFromClient((current) => ({ ...current, [item.id]: value.replace(/\D/g, '').slice(0, 6) }))} keyboardType="number-pad" maxLength={6} placeholder="Código de 6 dígitos" style={styles.etaInput} />
            <AnimatedButton title="Confirmar entrega en tienda" onPress={() => completePickup(item.id)} style={styles.action} buttonStyle={styles.actionSurface} />
          </>
        ) : <>
          <Text style={styles.etaLabel}>
            Tiempo real estimado: {item.business_prep_minutes || 'sin definir'} min
          </Text>
          <Text style={styles.etaLabel}>Actualizar estimación (1-1440 min)</Text>
          <TextInput
            accessibilityLabel="Minutos estimados de preparación"
            value={prepMinutesByOrder[item.id] || ''}
            onChangeText={(value) => setPrepMinutesByOrder((current) => ({
              ...current,
              [item.id]: value.replace(/\D/g, '').slice(0, 4),
            }))}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="Ej. 20"
            style={styles.etaInput}
          />
          <AnimatedButton
            title="Actualizar tiempo estimado"
            onPress={() => updatePrepEta(item.id)}
            style={styles.action}
            buttonStyle={styles.actionSurface}
          />
          <AnimatedButton
            title={item.driver_id ? 'Pedido listo para el repartidor asignado' : 'Pedido listo para repartidor'}
            onPress={() => markReady(item.id)}
            style={styles.action}
            buttonStyle={styles.actionSurface}
          />
          <AnimatedButton
            title="Cancelar por falta de stock"
            variant="secondary"
            onPress={() => cancelForStockOut(item.id)}
            style={styles.action}
            buttonStyle={styles.actionSurface}
          />
        </>
      )}
      {item.status === 'no_entregado' && (
        <View style={styles.incidentCard}>
          <Text style={styles.incidentTitle}>Entrega no completada</Text>
          <Text style={styles.incidentText}>
            Motivo: {deliveryIncidents[item.id]?.reason || 'Incidencia registrada; verifica los detalles.'}
          </Text>
          {deliveryIncidents[item.id]?.status === 'returning' ? (
            <AnimatedButton
              title={resolvingIncidentOrderId === item.id ? 'Confirmando...' : 'Confirmar que el pedido regresó'}
              onPress={() => confirmUndeliveredReturn(item.id)}
              disabled={resolvingIncidentOrderId === item.id}
              style={styles.action}
              buttonStyle={styles.actionSurface}
            />
          ) : deliveryIncidents[item.id]?.status === 'returned' ? (
            <>
              <Text style={styles.incidentText}>Devolución confirmada. Elige cómo resolver el pedido.</Text>
              <AnimatedButton
                title={resolvingIncidentOrderId === item.id ? 'Procesando...' : 'Reasignar a otro repartidor'}
                onPress={() => reassignReturnedOrder(item.id)}
                disabled={resolvingIncidentOrderId === item.id}
                style={styles.action}
                buttonStyle={styles.actionSurface}
              />
              <AnimatedButton
                title="Cancelar y gestionar pago o reembolso"
                variant="secondary"
                onPress={() => cancelUndeliveredOrder(item.id)}
                disabled={resolvingIncidentOrderId === item.id}
                style={styles.action}
                buttonStyle={styles.actionSurface}
              />
            </>
          ) : null}
        </View>
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
      {demandStatus?.suggest_pause || demandStatus?.orders_paused ? (
        <View style={styles.demandNotice}>
          <Text style={styles.demandNoticeText}>
            {demandStatus.orders_paused
              ? 'La recepción de pedidos nuevos está pausada. Los pedidos existentes continúan sin cambios.'
              : `Alta demanda y pocos repartidores (${demandStatus.open_delivery_orders} pedidos / ${demandStatus.available_drivers} disponibles). Puedes pausar temporalmente los pedidos nuevos.`}
          </Text>
          <AnimatedButton
            title={updatingOrderPause
              ? 'Actualizando...'
              : demandStatus.orders_paused ? 'Reanudar pedidos nuevos' : 'Pausar pedidos nuevos'}
            variant={demandStatus.orders_paused ? 'primary' : 'secondary'}
            disabled={updatingOrderPause}
            onPress={toggleOrderPause}
          />
        </View>
      ) : null}
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
  pickupOrderNotice: { fontSize: 14, fontWeight: '800', color: '#805000', backgroundColor: '#FFF3D6', padding: 10, borderRadius: 8 },
  demandNotice: { margin: 16, padding: 12, gap: 8, borderRadius: 10, backgroundColor: '#FFF3D6' },
  demandNoticeText: { color: '#704900', fontWeight: '700' },
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
  etaLabel: { color: '#424242', fontSize: 13, marginTop: 10 },
  etaInput: { borderWidth: 1, borderColor: '#B0BEC5', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, marginTop: 6 },
  incidentCard: { backgroundColor: '#FFF3E0', borderRadius: 10, padding: 12, marginTop: 12 },
  incidentTitle: { color: '#7A4300', fontSize: 15, fontWeight: '700' },
  incidentText: { color: '#5D4037', fontSize: 13, lineHeight: 18, marginTop: 6 },
});

export default BusinessOrdersScreen;
