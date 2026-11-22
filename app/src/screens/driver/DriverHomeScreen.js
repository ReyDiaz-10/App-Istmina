import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
// app/src/screens/driver/DriverHomeScreen.js
import React, { useCallback, useState, useEffect } from 'react';
import NotificationBell from '../../components/NotificationBell';
import {
  StyleSheet,
  View,
  FlatList,
  Linking,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import OrderStatusAnimation from '../../components/OrderStatusAnimation';
import { useRoleTheme } from '../../hooks/useRoleTheme';
import HelpButton from '../../components/HelpButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAuthStore } from '../../store/authStore';
import { formatCOP } from '../../utils/formatters';
import DriverPayoutWalletCard from '../../components/DriverPayoutWalletCard';
import { usePreferencesStore } from '../../store/preferencesStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDriverBusinessTargetMinutes } from '../../utils/deliveryEtas.js';

const DriverHomeScreen = ({ navigation }) => {
  const { profile } = useAuthStore();
  const signOut = useAuthStore((state) => state.signOut);
  const theme = useRoleTheme();
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);

  // Estados de Datos
  const [driverData, setDriverData] = useState(null);
  const [availableOrders, setAvailableOrders] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [pickupCode, setPickupCode] = useState('');
  const [deliveryCode, setDeliveryCode] = useState('');
  const [arrivalMinutes, setArrivalMinutes] = useState('');
  const [deliveryFailureReason, setDeliveryFailureReason] = useState('');
  const [activeIncident, setActiveIncident] = useState(null);
  const [blockState, setBlockState] = useState({ blocked_by_me: false, blocked_by_other: false });
  const [loading, setLoading] = useState(true);
  const [updatingAvailability, setUpdatingAvailability] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [now, setNow] = useState(0);

  // --- LÓGICA DE DATOS ---

  const fetchAvailableOrders = useCallback(async (driver = driverData) => {
    if (!driver?.is_available || driver.verification_status !== 'aprobado') return;

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, businesses(store_name, address)')
        .in('status', ['preparando', 'listo_para_repartidor'])
        .eq('delivery_mode', 'delivery')
        .is('driver_id', null);
      if (error) throw error;
      setAvailableOrders((data || []).filter((order) => (
        order.status === 'listo_para_repartidor' || order.business_prep_eta_at
      )));
    } catch (error) {
      console.error(error);
    }
  }, [driverData]);

  const fetchActiveOrder = useCallback(async (driverId = driverData?.id) => {
    if (!driverId) return;
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, businesses(store_name, address), profiles(full_name)')
        .eq('driver_id', driverId)
        .in('status', ['preparando', 'repartidor_asignado', 'recogido', 'en_camino', 'no_entregado'])
        .maybeSingle();

      if (error) throw error;
      setActiveOrder(data);
      if (data?.status === 'no_entregado') {
        const { data: incident, error: incidentError } = await supabase
          .from('order_delivery_incidents')
          .select('reason, status, reported_at')
          .eq('order_id', data.id)
          .eq('driver_id', driverId)
          .order('reported_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (incidentError) throw incidentError;
        setActiveIncident(incident);
      } else {
        setActiveIncident(null);
      }
      if (data?.driver_id) {
        const { data: currentBlockState, error: blockError } = await supabase.rpc(
          'get_order_participant_block_state',
          { p_order_id: data.id },
        );
        if (blockError) throw blockError;
        setBlockState(currentBlockState || { blocked_by_me: false, blocked_by_other: false });
      } else {
        setBlockState({ blocked_by_me: false, blocked_by_other: false });
      }
    } catch (error) {
      console.error(error);
    }
  }, [driverData?.id]);

  const initializeDriver = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('profile_id', profile.id)
        .single();

      if (error) throw error;
      setDriverData(data);
      await fetchActiveOrder(data.id);
      await fetchAvailableOrders(data);
    } catch {
      Alert.alert('Error', 'No se pudo cargar el perfil de repartidor');
    } finally {
      setLoading(false);
    }
  }, [fetchActiveOrder, fetchAvailableOrders, profile]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void initializeDriver();
    }, 0);
    if (!profile?.id) {
      return () => clearTimeout(initialLoad);
    }
    const subscription = supabase
      .channel('driver-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchAvailableOrders();
        fetchActiveOrder();
      })
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `profile_id=eq.${profile.id}` },
        ({ new: updatedDriver }) => {
          setDriverData(updatedDriver);
          if (updatedDriver.verification_status === 'aprobado' && updatedDriver.is_available) {
            fetchAvailableOrders(updatedDriver);
          } else {
            setAvailableOrders([]);
          }
        },
      )
      .subscribe();

    return () => {
      clearTimeout(initialLoad);
      supabase.removeChannel(subscription);
    };
  }, [fetchActiveOrder, fetchAvailableOrders, initializeDriver, profile?.id]);

  useEffect(() => {
    const initialClock = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearTimeout(initialClock);
      clearInterval(timer);
    };
  }, []);

  const toggleAvailability = async (value) => {
    if (driverData?.verification_status !== 'aprobado') {
      Alert.alert('Verificación pendiente', 'Tu perfil debe ser aprobado antes de conectarte.');
      return;
    }

    setUpdatingAvailability(true);
    try {
      const { data: updatedDriver, error } = await supabase
        .from('drivers')
        .update({ is_available: value })
        .eq('profile_id', profile.id)
        .select('id, profile_id, is_available, verification_status')
        .single();

      if (error) throw error;
      setDriverData((current) => ({ ...current, ...updatedDriver }));

      if (value) await fetchAvailableOrders({ ...driverData, ...updatedDriver });
      else setAvailableOrders([]);
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setUpdatingAvailability(false);
    }
  };

  const acceptOrder = async (orderId) => {
    setLoading(true);
    try {
      const { error } = await supabase.rpc('driver_accept_order', { p_order_id: orderId });
      if (error) throw error;

      Alert.alert('¡Pedido Aceptado!', 'Dirígete al negocio para recoger el pedido.');
      await fetchActiveOrder();
      setAvailableOrders([]);
    } catch (error) {
      Alert.alert(
        'No se pudo aceptar el pedido',
        error.message?.includes('PARTICIPANT_BLOCKED')
          ? 'No puedes aceptar este pedido porque existe un bloqueo entre tu cuenta y el cliente.'
          : 'Este pedido ya fue tomado o no está disponible.',
      );
    } finally {
      setLoading(false);
    }
  };

  const completeOrder = async () => {
    if (!/^\d{6}$/.test(deliveryCode)) {
      Alert.alert('Código requerido', 'Pide al cliente el código de seis dígitos para confirmar la entrega.');
      return;
    }
    try {
      const { data, error } = await supabase.rpc('driver_complete_order_with_code', {
        p_order_id: activeOrder.id,
        p_code: deliveryCode,
      });
      if (error) throw error;
      if (!data) {
        Alert.alert('Código incorrecto o bloqueado', 'Después de cinco intentos fallidos, la verificación se bloquea durante 15 minutos.');
        return;
      }

      const completedOrderId = activeOrder.id;
      setActiveOrder(null);
      setDeliveryCode('');
      void fetchAvailableOrders();
      navigation.navigate('DriverOrderClosureFeedback', { orderId: completedOrderId });
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const markPickedUp = async () => {
    if (!/^\d{6}$/.test(pickupCode)) {
      Alert.alert('Código requerido', 'Pide al negocio el código de seis dígitos para confirmar la recogida.');
      return;
    }
    const { data, error } = await supabase.rpc('driver_verify_order_pickup', {
      p_order_id: activeOrder.id,
      p_code: pickupCode,
    });
    if (error) {
      Alert.alert('No se pudo actualizar el pedido', error.message);
      return;
    }
    if (!data) {
      Alert.alert('Código incorrecto o bloqueado', 'Después de cinco intentos fallidos, la verificación se bloquea durante 15 minutos.');
      return;
    }
    setPickupCode('');
    await fetchActiveOrder();
  };

  const startDelivery = async () => {
    const minutes = Number(arrivalMinutes);
    if (!/^\d{1,4}$/.test(arrivalMinutes) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      Alert.alert('Tiempo inválido', 'Indica entre 1 y 1440 minutos para llegar al cliente.');
      return;
    }
    const { error } = await supabase.rpc('driver_start_delivery_with_eta', {
      p_order_id: activeOrder.id,
      p_minutes: minutes,
    });
    if (error) {
      Alert.alert('No se pudo iniciar la entrega', error.message);
      return;
    }
    setArrivalMinutes('');
    await fetchActiveOrder();
  };

  const reportDeliveryFailure = async () => {
    const reason = deliveryFailureReason.trim();
    if (!reason) {
      Alert.alert('Motivo requerido', 'Describe brevemente por qué no fue posible entregar el pedido.');
      return;
    }
    try {
      const { error } = await supabase.rpc('report_order_delivery_failure', {
        p_order_id: activeOrder.id,
        p_reason: reason,
      });
      if (error) throw error;
      setDeliveryFailureReason('');
      await fetchActiveOrder();
      Alert.alert('Incidencia registrada', 'Regresa al negocio con el pedido. El comercio debe confirmar la devolución para resolverlo.');
    } catch (error) {
      Alert.alert('No se pudo registrar la incidencia', error.message);
    }
  };

  const toggleClientBlock = async () => {
    try {
      const { data, error } = await supabase.rpc('set_order_participant_block', {
        p_order_id: activeOrder.id,
        p_blocked: !blockState.blocked_by_me,
      });
      if (error) throw error;
      setBlockState(data || { blocked_by_me: false, blocked_by_other: false });
    } catch (error) {
      Alert.alert('No se pudo actualizar el bloqueo', error.message);
    }
  };

  const openDeliveryLocation = async (order) => {
    if (order.delivery_latitude == null || order.delivery_longitude == null) return;
    const coordinates = encodeURIComponent(`${order.delivery_latitude},${order.delivery_longitude}`);
    try {
      await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${coordinates}`);
    } catch (error) {
      Alert.alert('No se pudo abrir el mapa', error.message);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const result = await signOut();
      if (!result.success) throw new Error(result.error || 'No se pudo cerrar la sesión.');
      navigation.reset({ index: 0, routes: [{ name: 'ClientHome' }] });
    } catch (error) {
      Alert.alert('No se pudo cerrar la sesión', error.message || 'Intenta nuevamente.');
    } finally {
      setSigningOut(false);
    }
  };

  // --- COMPONENTES DE INTERFAZ ---

  const renderOrderCard = ({ item }) => (
    <View style={styles.orderCard}>
      <View style={styles.orderInfo}>
        <Text style={styles.storeName}>📦 Pedido #{item.order_number || item.id.slice(0, 8)} · {item.businesses?.store_name}</Text>
        <Text style={styles.addressText}>📍 {item.businesses?.address}</Text>
        <Text style={styles.amountText}>
          Ganancia (100% del domicilio): {formatCOP(item.delivery_fee_cop)}
        </Text>
        {item.business_prep_eta_at ? (
          <Text style={styles.etaText}>
            Llega al negocio en {getDriverBusinessTargetMinutes(item.business_prep_eta_at, now)} min o antes
          </Text>
        ) : null}
      </View>
      <AnimatedButton
        title="Aceptar"
        onPress={() => acceptOrder(item.id)}
        buttonStyle={[styles.acceptBtn, { backgroundColor: theme.primary }]}
        textStyle={styles.acceptBtnText}
      />
    </View>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1A237E" /></View>;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <HelpButton navigation={navigation} context="repartidor" orderId={activeOrder?.id} compact />
      <View style={styles.sessionActions}>
        <AnimatedButton title="Mi perfil" variant="secondary" onPress={() => navigation.navigate('DriverProfile')} />
        <AnimatedButton title="Elogios y sugerencias" variant="secondary" onPress={() => navigation.navigate('DriverFeedback')} />
        <AnimatedButton title="Configuración" variant="secondary" onPress={() => navigation.navigate('Settings')} />
        <AnimatedButton
          title={signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
          variant="secondary"
          onPress={handleSignOut}
          disabled={signingOut}
        />
      </View>
      {/* HEADER DE DISPONIBILIDAD */}
      <View style={styles.header}>
        <View style={styles.availabilityInfo}>
          <Text style={[styles.welcomeText, { color: colors.text }]}>Hola, {profile?.full_name || 'Repartidor'}</Text>
          <Text style={[styles.statusCaption, { color: colors.muted }]}>Estado de disponibilidad</Text>
          <View style={[
            styles.statusBadge,
            driverData?.verification_status !== 'aprobado'
              ? styles.pendingBadge
              : driverData?.is_available ? styles.onlineBadge : styles.offlineBadge,
          ]}>
            <Text style={[
              styles.statusText,
              driverData?.verification_status !== 'aprobado'
                ? styles.pendingStatus
                : driverData?.is_available ? styles.onlineStatus : styles.offlineStatus,
            ]}>
              {driverData?.verification_status !== 'aprobado'
                ? '⏳ Pendiente de aprobación'
                : driverData?.is_available ? '● EN LÍNEA · Disponible' : '○ FUERA DE LÍNEA'}
            </Text>
          </View>
        </View>
        <NotificationBell navigation={navigation} compact />
        <View style={styles.availabilityControl}>
          <Text style={[styles.switchLabel, { color: colors.text }]}>
            {driverData?.is_available ? 'Desconectarme' : 'Ponerme en línea'}
          </Text>
          <Switch
            accessibilityLabel={driverData?.is_available ? 'Desconectarme' : 'Ponerme en línea'}
            accessibilityState={{ checked: Boolean(driverData?.is_available), disabled: updatingAvailability || driverData?.verification_status !== 'aprobado' }}
            value={driverData?.verification_status === 'aprobado' && driverData?.is_available}
            onValueChange={toggleAvailability}
            disabled={updatingAvailability || driverData?.verification_status !== 'aprobado'}
            trackColor={{ false: '#667085', true: '#146C43' }}
            thumbColor="#FFFFFF"
            ios_backgroundColor="#667085"
          />
        </View>
      </View>

      {driverData?.verification_status === 'aprobado' ? <DriverPayoutWalletCard locale={locale} /> : null}

      {driverData?.verification_status !== 'aprobado' && (
        <View style={[styles.offlineBox, styles.pendingBox]}>
          <Text style={styles.offlineText}>
            Tu perfil está pendiente de revisión. Completa las fotos en “Mi perfil”; no podrás recibir pedidos hasta ser aprobado.
          </Text>
          <AnimatedButton
            title="Completar perfil"
            onPress={() => navigation.navigate('DriverProfile')}
            style={styles.pendingAction}
          />
        </View>
      )}

      {/* PANEL DE PEDIDO ACTIVO */}
      {activeOrder ? (
        <View style={[styles.activeOrderPanel, { backgroundColor: colors.surface }]}>
          <Text style={styles.panelTitle}>📦 Pedido #{activeOrder.order_number || activeOrder.id.slice(0, 8)} en curso</Text>
          <View style={styles.activeOrderCard}>
            <Text style={styles.detailLabel}>Recoger en:</Text>
            <Text style={styles.detailValue}>{activeOrder.businesses?.store_name} - {activeOrder.businesses?.address}</Text>

            <View style={styles.divider} />

            <Text style={styles.detailLabel}>Entregar a:</Text>
            <Text style={styles.detailValue}>{activeOrder.profiles?.full_name}</Text>
            {blockState.blocked_by_me ? (
              <Text style={styles.blockNotice}>Bloqueaste a este cliente; el chat directo está deshabilitado.</Text>
            ) : blockState.blocked_by_other ? (
              <Text style={styles.blockNotice}>Este cliente bloqueó la interacción directa contigo.</Text>
            ) : null}
            {blockState.blocked_by_other ? null : (
              <AnimatedButton
                title={blockState.blocked_by_other
                  ? 'Bloqueo activo por el cliente'
                  : blockState.blocked_by_me ? 'Desbloquear cliente' : 'Bloquear cliente'}
                variant="secondary"
                onPress={toggleClientBlock}
                style={styles.blockButton}
              />
            )}
            <AnimatedButton
              title="Abrir chat con el cliente"
              variant="secondary"
              onPress={() => navigation.navigate('OrderChat', { orderId: activeOrder.id })}
              disabled={blockState.blocked_by_me || blockState.blocked_by_other}
            />
            <Text style={styles.detailLabel}>Destino:</Text>
            <Text style={styles.detailValue}>{activeOrder.delivery_address}</Text>
            {activeOrder.delivery_instructions ? (
              <Text style={styles.detailValue}>Referencia: {activeOrder.delivery_instructions}</Text>
            ) : null}
            <Text style={styles.detailValue}>
              GPS: {activeOrder.delivery_latitude}, {activeOrder.delivery_longitude}
            </Text>
            <AnimatedButton
              title="Abrir ubicación en mapas"
              onPress={() => openDeliveryLocation(activeOrder)}
              variant="secondary"
            />
            <Text style={styles.detailLabel}>
              Tu ganancia por domicilio: {formatCOP(activeOrder.delivery_fee_cop)}
            </Text>
            <OrderStatusAnimation
              status={activeOrder.status}
              driverAssignedToPreparing={activeOrder.status === 'preparando'}
            />
            {activeOrder.status === 'repartidor_asignado' && activeOrder.business_prep_eta_at ? (
              <Text style={styles.etaText}>
                Llega al negocio en {getDriverBusinessTargetMinutes(activeOrder.business_prep_eta_at, now)} min o antes
              </Text>
            ) : null}
            {activeOrder.status === 'preparando' ? (
              <Text style={styles.etaText}>
                El negocio sigue preparando. Llega en {getDriverBusinessTargetMinutes(activeOrder.business_prep_eta_at, now)} min o antes.
              </Text>
            ) : activeOrder.status === 'repartidor_asignado' ? (
              <>
                <Text style={styles.codeHint}>Solicita el código de recogida al negocio:</Text>
                <TextInput
                  accessibilityLabel="Código de recogida del negocio"
                  value={pickupCode}
                  onChangeText={(value) => setPickupCode(value.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder="Código de 6 dígitos"
                  style={styles.codeInput}
                  maxLength={6}
                />
                <AnimatedButton
                  title="Validar código y confirmar recogida"
                  onPress={markPickedUp}
                  buttonStyle={[styles.completeBtn, { backgroundColor: theme.primary }]}
                  textStyle={styles.completeBtnText}
                />
              </>
            ) : activeOrder.status === 'recogido' ? (
              <>
                <Text style={styles.codeHint}>¿En cuántos minutos llegarás al cliente? (1–1440)</Text>
                <TextInput
                  accessibilityLabel="Minutos estimados para llegar al cliente"
                  value={arrivalMinutes}
                  onChangeText={(value) => setArrivalMinutes(value.replace(/\D/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  placeholder="Ej. 15"
                  style={styles.codeInput}
                  maxLength={4}
                />
                <AnimatedButton
                  title="Iniciar ruta al cliente"
                  onPress={startDelivery}
                  buttonStyle={[styles.completeBtn, { backgroundColor: theme.primary }]}
                  textStyle={styles.completeBtnText}
                />
                <Text style={styles.codeHint}>Si no puedes entregar después de recogerlo, registra el motivo:</Text>
                <TextInput
                  accessibilityLabel="Motivo de entrega no completada"
                  value={deliveryFailureReason}
                  onChangeText={(value) => setDeliveryFailureReason(value.slice(0, 500))}
                  placeholder="Motivo de la incidencia"
                  style={styles.codeInput}
                  maxLength={500}
                  multiline
                />
                <AnimatedButton
                  title="Reportar pedido no entregado"
                  variant="secondary"
                  onPress={reportDeliveryFailure}
                />
              </>
            ) : activeOrder.status === 'en_camino' ? (
              <>
                <Text style={styles.codeHint}>Solicita al cliente el código de entrega:</Text>
                <TextInput
                  accessibilityLabel="Código de entrega del cliente"
                  value={deliveryCode}
                  onChangeText={(value) => setDeliveryCode(value.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder="Código de 6 dígitos"
                  style={styles.codeInput}
                  maxLength={6}
                />
                <AnimatedButton
                  title="Validar código y marcar entregado"
                  onPress={completeOrder}
                  buttonStyle={[styles.completeBtn, { backgroundColor: theme.primary }]}
                  textStyle={styles.completeBtnText}
                />
                <Text style={styles.codeHint}>Si no puedes entregar, registra el motivo para coordinar el retorno:</Text>
                <TextInput
                  accessibilityLabel="Motivo de entrega no completada"
                  value={deliveryFailureReason}
                  onChangeText={(value) => setDeliveryFailureReason(value.slice(0, 500))}
                  placeholder="Motivo de la incidencia"
                  style={styles.codeInput}
                  maxLength={500}
                  multiline
                />
                <AnimatedButton
                  title="Reportar pedido no entregado"
                  variant="secondary"
                  onPress={reportDeliveryFailure}
                />
              </>
            ) : (
              <View style={styles.incidentCard}>
                <Text style={styles.incidentTitle}>Pedido no entregado</Text>
                <Text style={styles.incidentText}>
                  Motivo: {activeIncident?.reason || 'Incidencia registrada'}
                </Text>
                <Text style={styles.incidentText}>
                  Regresa al negocio. El comercio debe confirmar la devolución antes de reasignar o cancelar el pedido.
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        /* LISTA DE PEDIDOS DISPONIBLES */
        <View style={styles.availableSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Pedidos Disponibles</Text>
          {!driverData?.is_available ? (
            <View style={styles.offlineBox}>
              <Text style={styles.offlineText}>Ponte en línea para ver pedidos disponibles</Text>
            </View>
          ) : (
            <FlatList
              data={availableOrders}
              keyExtractor={(item) => item.id}
              renderItem={renderOrderCard}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<Text style={styles.emptyText}>No hay pedidos disponibles en este momento.</Text>}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  sessionActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginHorizontal: 18, gap: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: '#fff',
    elevation: 2,
  },
  availabilityInfo: { flex: 1, paddingRight: 12 },
  availabilityControl: { alignItems: 'center', justifyContent: 'center', minWidth: 112, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF' },
  switchLabel: { fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  welcomeText: { fontSize: 20, fontWeight: 'bold', color: '#1A237E' },
  statusCaption: { fontSize: 13, fontWeight: '600', marginTop: 8, marginBottom: 5 },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  onlineBadge: { backgroundColor: '#E8F5E9', borderColor: '#2E7D32' },
  offlineBadge: { backgroundColor: '#F2F4F7', borderColor: '#667085' },
  pendingBadge: { backgroundColor: '#FFF4E5', borderColor: '#9A6700' },
  statusText: { fontSize: 14, fontWeight: '800' },
  onlineStatus: { color: '#14532D' },
  offlineStatus: { color: '#344054' },
  pendingStatus: { color: '#7A4300' },

  // Active Order Panel
  activeOrderPanel: { padding: 20 },
  panelTitle: { fontSize: 22, fontWeight: 'bold', color: '#1A237E', marginBottom: 15, textAlign: 'center' },
  activeOrderCard: {
    backgroundColor: '#fff', padding: 20, borderRadius: 20,
    elevation: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10
  },
  detailLabel: { fontSize: 14, color: '#757575', fontWeight: 'bold', marginTop: 10 },
  detailValue: { fontSize: 16, color: '#333', marginBottom: 10 },
  etaText: { fontSize: 14, fontWeight: '700', color: '#1A237E', marginTop: 6 },
  blockNotice: { fontSize: 13, color: '#8A3B12', marginVertical: 6 },
  blockButton: { alignSelf: 'stretch', marginBottom: 8 },
  incidentCard: { backgroundColor: '#FFF3E0', borderRadius: 10, padding: 12, marginTop: 12 },
  incidentTitle: { color: '#7A4300', fontSize: 15, fontWeight: '700' },
  incidentText: { color: '#5D4037', fontSize: 13, lineHeight: 18, marginTop: 6 },
  divider: { height: 1, backgroundColor: '#E0E0E0', marginVertical: 15 },
  completeBtn: {
    backgroundColor: '#2E7D32', padding: 18, borderRadius: 12,
    alignItems: 'center', marginTop: 20
  },
  completeBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  codeHint: { fontSize: 13, fontWeight: '700', color: '#424242', marginTop: 12 },
  codeInput: { borderWidth: 1, borderColor: '#B0BEC5', borderRadius: 9, padding: 12, marginTop: 6, fontSize: 20, letterSpacing: 4, textAlign: 'center', color: '#222222' },

  // Available Orders
  availableSection: { flex: 1, padding: 20 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A237E', marginBottom: 15 },
  list: { paddingBottom: 20 },
  orderCard: {
    backgroundColor: '#fff', borderRadius: 15, padding: 15,
    marginBottom: 15, flexDirection: 'row', alignItems: 'center',
    elevation: 2, borderWidth: 1, borderColor: '#E0E0E0'
  },
  orderInfo: { flex: 1 },
  storeName: { fontSize: 16, fontWeight: 'bold', color: '#1A237E' },
  addressText: { fontSize: 13, color: '#757575', marginVertical: 4 },
  amountText: { fontSize: 15, fontWeight: 'bold', color: '#2E7D32' },
  acceptBtn: { backgroundColor: '#1A237E', padding: 10, borderRadius: 8, minWidth: 80 },
  acceptBtnText: { color: '#fff', fontWeight: 'bold' },
  offlineBox: {
    backgroundColor: '#E0E0E0', padding: 30, borderRadius: 15,
    alignItems: 'center', marginTop: 50
  },
  pendingBox: { marginHorizontal: 20, marginTop: 20 },
  pendingAction: { alignSelf: 'stretch', marginTop: 12 },
  offlineText: { textAlign: 'center', color: '#666', fontSize: 16 },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#757575' },
});

export default DriverHomeScreen;
