import { AppText as Text } from '../../components/AppText.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  StyleSheet,
  View,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import { useRoleTheme } from '../../hooks/useRoleTheme';
import EmptyState from '../../components/EmptyState';
import AnimatedButton from '../../components/AnimatedButton';
import OrderStatusAnimation from '../../components/OrderStatusAnimation';
import HelpButton from '../../components/HelpButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCOP } from '../../utils/formatters';
import { useTranslation } from '../../hooks/useTranslation';
import { getProfilePhotoUrl } from '../../services/onboardingMedia';
import {
  getCustomerDeliveryMinutes,
  getCustomerPreparationMinutes,
} from '../../utils/deliveryEtas.js';

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

const ClientOrdersScreen = ({ navigation }) => {
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const theme = useRoleTheme();
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  const t = useTranslation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [deliveryCodes, setDeliveryCodes] = useState({});
  const [pickupClaimCodes, setPickupClaimCodes] = useState({});
  const [deliveryIncidents, setDeliveryIncidents] = useState({});
  const [blockStates, setBlockStates] = useState({});
  const [updatingBlockOrderId, setUpdatingBlockOrderId] = useState(null);
  const [now, setNow] = useState(0);
  const orderStatusSnapshot = useRef(new Map());
  const hasOrderStatusSnapshot = useRef(false);
  const userId = profile?.id || user?.id;

  useEffect(() => {
    const initialClock = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(initialClock);
      clearInterval(timer);
    };
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!userId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          businesses(store_name),
          drivers(plate_number, profile_id),
          order_refunds(status, status_message, amount_in_cents)
        `)
        .eq('client_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const ordersWithDrivers = data || [];
      const newlyDeliveredOrders = hasOrderStatusSnapshot.current
        ? ordersWithDrivers.filter((order) => (
          order.status === 'entregado'
          && orderStatusSnapshot.current.get(order.id) !== 'entregado'
        ))
        : [];
      orderStatusSnapshot.current = new Map(ordersWithDrivers.map((order) => [order.id, order.status]));
      hasOrderStatusSnapshot.current = true;
      const codeResults = await Promise.all(ordersWithDrivers
        .filter((order) => order.delivery_mode !== 'pickup' && [
          'pagado',
          'preparando',
          'listo_para_repartidor',
          'repartidor_asignado',
          'recogido',
          'en_camino',
        ].includes(order.status))
        .map(async (order) => {
          const { data: verification, error: codeError } = await supabase.rpc('get_order_verification_codes', {
            p_order_id: order.id,
          });
          if (codeError) {
            console.error('No se pudo cargar el código de entrega:', codeError.message);
            return null;
          }
          return [order.id, verification?.delivery_code];
        }));
      setDeliveryCodes(Object.fromEntries(codeResults.filter(Boolean)));
      const pickupResults = await Promise.all(ordersWithDrivers
        .filter((order) => order.delivery_mode === 'pickup' && ['pagado', 'preparando'].includes(order.status))
        .map(async (order) => {
          const { data: code, error: codeError } = await supabase.rpc('get_my_pickup_claim_code', { p_order_id: order.id });
          if (codeError) { console.error('No se pudo cargar el código para reclamar:', codeError.message); return null; }
          return [order.id, code];
        }));
      setPickupClaimCodes(Object.fromEntries(pickupResults.filter(Boolean)));
      const blockableOrders = ordersWithDrivers.filter((order) => (
        ['preparando', 'repartidor_asignado', 'recogido', 'en_camino', 'no_entregado', 'entregado'].includes(order.status)
        && order.drivers?.profile_id
      ));
      const profileIds = [...new Set(blockableOrders.map((order) => order.drivers.profile_id))];
      if (profileIds.length) {
        const { data: driverProfiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', profileIds);
        if (profilesError) throw profilesError;
        const profilesById = new Map();
        await Promise.all((driverProfiles || []).map(async (driverProfile) => {
          let avatarUrl = null;
          if (driverProfile.avatar_url) {
            try {
              avatarUrl = await getProfilePhotoUrl(driverProfile.avatar_url);
            } catch (photoError) {
              console.error('No se pudo cargar la foto del repartidor:', photoError.message);
            }
          }
          profilesById.set(driverProfile.id, { ...driverProfile, avatar_url: avatarUrl });
        }));
        setOrders(ordersWithDrivers.map((order) => ({
          ...order,
          drivers: order.drivers ? { ...order.drivers, profiles: profilesById.get(order.drivers.profile_id) || null } : null,
        })));
      } else {
        setOrders(ordersWithDrivers);
      }
      if (newlyDeliveredOrders.length && navigation.isFocused()) {
        const completedOrder = newlyDeliveredOrders[0];
        setTimeout(() => {
          if (navigation.isFocused()) {
            navigation.navigate('ClientOrderFeedback', { orderId: completedOrder.id });
          }
        }, 0);
      }

      const orderIds = ordersWithDrivers.map((order) => order.id);
      if (orderIds.length) {
        const { data: incidents, error: incidentError } = await supabase
          .from('order_delivery_incidents')
          .select('id, order_id, driver_id, reason, status, reported_at, returned_at')
          .in('order_id', orderIds)
          .order('reported_at', { ascending: false });
        if (incidentError) throw incidentError;
        const latestIncidents = {};
        for (const incident of incidents || []) {
          if (!latestIncidents[incident.order_id]) latestIncidents[incident.order_id] = incident;
        }
        setDeliveryIncidents(latestIncidents);

        const states = await Promise.all(blockableOrders.map(async (order) => {
          const { data: state, error: blockError } = await supabase.rpc(
            'get_order_participant_block_state',
            { p_order_id: order.id },
          );
          if (blockError) throw blockError;
          return [order.id, state || { blocked_by_me: false, blocked_by_other: false }];
        }));
        setBlockStates(Object.fromEntries(states));
      } else {
        setDeliveryIncidents({});
        setBlockStates({});
      }
    } catch (error) {
      console.error('Error cargando pedidos:', error.message);
    } finally {
      setLoading(false);
    }
  }, [navigation, userId]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void fetchOrders();
    }, 0);
    if (!userId) return () => clearTimeout(initialLoad);

    const channel = supabase
      .channel(`client-orders:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `client_id=eq.${userId}`,
        },
        () => fetchOrders(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime order subscription failed: ${status}`);
        }
      });

    const refundsChannel = supabase
      .channel(`client-order-refunds:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'order_refunds',
      }, () => fetchOrders())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime order refund subscription failed: ${status}`);
        }
      });
    const incidentsChannel = supabase
      .channel(`client-order-incidents:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'order_delivery_incidents',
      }, () => fetchOrders())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'order_participant_blocks',
      }, () => fetchOrders())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime delivery incident subscription failed: ${status}`);
        }
      });

    return () => {
      clearTimeout(initialLoad);
      supabase.removeChannel(channel);
      supabase.removeChannel(refundsChannel);
      supabase.removeChannel(incidentsChannel);
    };
  }, [fetchOrders, userId]);

  const toggleDriverBlock = async (orderId, blockedByMe) => {
    setUpdatingBlockOrderId(orderId);
    try {
      const { data, error } = await supabase.rpc('set_order_participant_block', {
        p_order_id: orderId,
        p_blocked: !blockedByMe,
      });
      if (error) throw error;
      setBlockStates((current) => ({ ...current, [orderId]: data }));
    } catch (error) {
      Alert.alert('No se pudo actualizar el bloqueo', error.message);
    } finally {
      setUpdatingBlockOrderId(null);
    }
  };

  const cancelOrder = (orderId) => {
    Alert.alert(
      'Cancelar pedido',
      '¿Confirmas que quieres cancelar este pedido? Si ya fue pagado, el reembolso se solicitará a Wompi y su confirmación puede tardar.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Cancelar pedido',
          style: 'destructive',
          onPress: async () => {
            setCancellingOrderId(orderId);
            try {
              const { data, error } = await supabase.functions.invoke('cancel-order', {
                body: { orderId, action: 'client_cancel' },
              });
              if (error) throw error;
              if (data?.error) throw new Error(data.error);
              await fetchOrders();
              Alert.alert(
                'Pedido cancelado',
                data?.refunds?.some((refund) => refund.status === 'pending')
                  ? 'Wompi recibió la solicitud. El reembolso está pendiente de confirmación.'
                  : 'El pedido fue cancelado. Consulta aquí el estado del reembolso.',
              );
            } catch (error) {
              Alert.alert('No se pudo cancelar el pedido', error.message);
            } finally {
              setCancellingOrderId(null);
            }
          },
        },
      ],
    );
  };

  const renderOrder = ({ item }) => {
    const driver = item.drivers;
    const chatAvailable = CHAT_STATUSES.includes(item.status);
    const blockState = blockStates[item.id] || { blocked_by_me: false, blocked_by_other: false };
    const prepEtaMinutes = now > 0 && ['preparando', 'listo_para_repartidor', 'repartidor_asignado'].includes(item.status)
      ? getCustomerPreparationMinutes(item.business_prep_eta_at, now)
      : null;
    const deliveryEtaMinutes = now > 0 && item.status === 'en_camino'
      ? getCustomerDeliveryMinutes(item.driver_arrival_eta_at, now)
      : null;
    const canCancel = item.status === 'pendiente'
      || (now > 0 && item.status === 'pagado' && item.cancel_until_at && new Date(item.cancel_until_at).getTime() > now);
    const refundStatus = item.order_refunds?.[0]?.status;
    const refundLabels = {
      requested: 'Reembolso solicitado a Wompi',
      submitting: 'Enviando solicitud de reembolso',
      pending: 'Reembolso pendiente de confirmación de Wompi',
      uncertain: 'Reembolso en conciliación; soporte verificará su estado',
      error: 'Wompi no aceptó la solicitud de reembolso; requiere revisión',
      approved: 'Reembolso confirmado por Wompi',
      declined: 'Wompi rechazó el reembolso; requiere revisión',
      cancelled: 'Reembolso cancelado; requiere revisión',
    };

    return (
      <View style={[styles.orderCard, { backgroundColor: colors.surface }]}>
        <View style={styles.header}>
          <Text style={[styles.storeName, { color: colors.text }]}>{item.businesses?.store_name}</Text>
          <Text style={[styles.status, { color: theme.primary }]}>
            {item.status.replace(/_/g, ' ').toUpperCase()}
          </Text>
        </View>
        <Text style={[styles.details, { color: colors.muted }]}>
          Pedido #{item.order_number || item.id.slice(0, 8)} · {t('orders.total')} {formatCOP(item.total_amount, locale)}
        </Text>
        {item.delivery_mode === 'pickup' ? <Text style={[styles.etaText, { color: colors.primary, fontWeight: '800' }]}>RETIRO EN TIENDA · No se asignará repartidor ni se cobrará domicilio.</Text> : null}
        {pickupClaimCodes[item.id] ? <View style={styles.pickupCodeCard}><Text style={styles.pickupCodeLabel}>Código para reclamar el pedido</Text><Text selectable style={styles.pickupCode}>{pickupClaimCodes[item.id]}</Text><Text style={styles.etaText}>Muéstralo en el negocio al recoger.</Text></View> : null}
        <OrderStatusAnimation status={item.status} />
        {item.status === 'entregado' && item.driver_id ? (
          <AnimatedButton
            title="Calificar o comentar la entrega"
            onPress={() => navigation.navigate('ClientOrderFeedback', { orderId: item.id })}
            style={styles.feedbackButton}
          />
        ) : null}
        {prepEtaMinutes !== null ? (
          <Text style={[styles.etaText, { color: colors.muted }]}>
            Tiempo aproximado de preparación: {prepEtaMinutes} min
          </Text>
        ) : null}
        {deliveryEtaMinutes !== null ? (
          <Text style={[styles.etaText, { color: colors.muted }]}>
            Llegada aproximada del repartidor: {deliveryEtaMinutes} min
          </Text>
        ) : null}
        {item.status === 'no_entregado' ? (
          <View style={styles.incidentCard}>
            <Text style={styles.incidentTitle}>Entrega no completada</Text>
            <Text style={styles.incidentText}>
              Motivo: {deliveryIncidents[item.id]?.reason || 'El repartidor registró una incidencia.'}
            </Text>
            <Text style={styles.incidentText}>
              El negocio debe confirmar la devolución antes de reasignar o cancelar el pedido.
            </Text>
          </View>
        ) : null}
        {deliveryCodes[item.id] ? (
          <View style={styles.deliveryCodeCard}>
            <Text style={styles.deliveryCodeLabel}>Código para recibir tu pedido</Text>
            <Text selectable style={styles.deliveryCode}>{deliveryCodes[item.id]}</Text>
            <Text style={styles.deliveryCodeHint}>Compártelo con el repartidor solo cuando tengas el pedido.</Text>
          </View>
        ) : null}

        {refundStatus ? (
          <Text style={[styles.refundStatus, { color: colors.muted }]}>
            {refundLabels[refundStatus] || 'Estado del reembolso actualizado'}
          </Text>
        ) : null}

        {item.delivery_mode !== 'pickup' && ['preparando', 'repartidor_asignado', 'recogido', 'en_camino'].includes(item.status) && driver && (
          <View style={styles.driverCard}>
            <Image
              source={{ uri: driver.profiles?.avatar_url || 'https://via.placeholder.com/50' }}
              style={styles.driverPhoto}
            />
            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>
                {driver.profiles?.full_name || t('orders.driver')}
              </Text>
              <Text style={styles.plateText}>
                {t('orders.plate')} <Text style={styles.plateValue}>{driver.plate_number || t('orders.pending')}</Text>
              </Text>
              {blockState.blocked_by_me ? (
                <Text style={styles.blockNotice}>Bloqueaste la interacción directa con este repartidor.</Text>
              ) : blockState.blocked_by_other ? (
                <Text style={styles.blockNotice}>Este repartidor bloqueó la interacción directa contigo.</Text>
              ) : null}
            </View>
            <Text style={styles.bikeEmoji}>🛵</Text>
          </View>
        )}
        {driver && item.delivery_mode !== 'pickup' && (
          <AnimatedButton
            title={updatingBlockOrderId === item.id
              ? 'Actualizando...'
              : blockState.blocked_by_other
                ? 'Bloqueo activo por el repartidor'
                : blockState.blocked_by_me ? 'Desbloquear repartidor' : 'Bloquear repartidor'}
            onPress={() => toggleDriverBlock(item.id, blockState.blocked_by_me)}
            disabled={updatingBlockOrderId === item.id || blockState.blocked_by_other}
            variant="secondary"
            style={styles.blockButton}
          />
        )}

        <AnimatedButton
          title={chatAvailable ? t('orders.chat') : t('orders.chatUnavailable')}
          onPress={() => navigation.navigate('OrderChat', { orderId: item.id })}
          disabled={!chatAvailable || blockState.pair_blocked}
          style={styles.chatButton}
          buttonStyle={styles.chatButtonSurface}
        />
        {canCancel ? (
          <AnimatedButton
            title={cancellingOrderId === item.id ? 'Cancelando...' : 'Cancelar pedido'}
            onPress={() => cancelOrder(item.id)}
            disabled={cancellingOrderId === item.id}
            style={styles.cancelButton}
            buttonStyle={styles.cancelButtonSurface}
          />
        ) : null}
        <HelpButton navigation={navigation} context="pedido" orderId={item.id} />
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.topBar}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text style={[styles.title, { color: colors.text }]}>{t('orders.title')}</Text>
        <AnimatedButton variant="home" navigation={navigation} />
      </View>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState title={t('orders.empty')} message={t('orders.emptyDetail')} icon="🛒" />
        }
        ListFooterComponent={<HelpButton navigation={navigation} context="cliente" />}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#222222' },
  list: { padding: 16, paddingBottom: 28, flexGrow: 1 },
  orderCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 15, marginBottom: 18, elevation: 3 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  storeName: { flex: 1, fontSize: 17, fontWeight: 'bold', color: '#1A237E' },
  status: { fontSize: 11, fontWeight: '700', marginLeft: 8 },
  details: { fontSize: 14, color: '#666666' },
  etaText: { fontSize: 14, fontWeight: '700', marginTop: 8 },
  incidentCard: { backgroundColor: '#FFF3E0', borderRadius: 10, padding: 12, marginTop: 12 },
  incidentTitle: { color: '#7A4300', fontSize: 15, fontWeight: '700' },
  incidentText: { color: '#5D4037', fontSize: 13, lineHeight: 18, marginTop: 6 },
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8EAF6',
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
  },
  driverPhoto: { width: 45, height: 45, borderRadius: 23, marginRight: 12 },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 15, fontWeight: 'bold', color: '#333333' },
  plateText: { fontSize: 13, color: '#757575' },
  plateValue: { fontWeight: 'bold', color: '#1A237E' },
  bikeEmoji: { fontSize: 24 },
  blockNotice: { fontSize: 12, color: '#8A3B12', marginTop: 5 },
  blockButton: { alignSelf: 'stretch', marginTop: 8 },
  chatButton: { alignSelf: 'stretch', marginTop: 12 },
  feedbackButton: { alignSelf: 'stretch', marginTop: 12 },
  chatButtonSurface: { width: '100%' },
  cancelButton: { alignSelf: 'stretch', marginTop: 8 },
  cancelButtonSurface: { width: '100%', borderColor: '#B3261E' },
  refundStatus: { fontSize: 13, lineHeight: 18, marginTop: 10 },
  pickupCodeCard: { backgroundColor: '#FFF3D6', borderRadius: 10, padding: 12, marginTop: 12, alignItems: 'center' },
  pickupCodeLabel: { color: '#704900', fontWeight: '700', fontSize: 13 },
  pickupCode: { color: '#704900', fontSize: 26, fontWeight: '900', letterSpacing: 5, marginTop: 2 },
  deliveryCodeCard: { backgroundColor: '#E8F5E9', borderRadius: 10, padding: 12, marginTop: 12, alignItems: 'center' },
  deliveryCodeLabel: { color: '#1B5E20', fontWeight: '700', fontSize: 13 },
  deliveryCode: { color: '#1B5E20', fontSize: 26, fontWeight: '900', letterSpacing: 5, marginTop: 2 },
  deliveryCodeHint: { color: '#33683A', fontSize: 11, textAlign: 'center', marginTop: 4 },
});

export default ClientOrdersScreen;
