// app/src/screens/driver/DriverHomeScreen.js
import React, { useState, useEffect } from 'react';
import {
  StyleSheet, View, Text, FlatList, Linking,
  ActivityIndicator, Alert, Switch, SafeAreaView
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initializeDriver();
    // Suscripción en tiempo real para pedidos disponibles y órdenes activas
    const subscription = supabase
      .channel('driver-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchAvailableOrders();
        fetchActiveOrder();
      })
      .subscribe();

    return () => supabase.removeChannel(subscription);
  }, []);

  // --- LÓGICA DE DATOS ---

  const initializeDriver = async () => {
    setLoading(true);
    try {
      // 1. Obtener o crear el registro en la tabla 'drivers'
      const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('profile_id', profile.id)
        .single();

      if (error) throw error;
      setDriverData(data);

      await fetchActiveOrder(data.id);
      await fetchAvailableOrders(data);
    } catch (error) {
      Alert.alert('Error', 'No se pudo cargar el perfil de repartidor');
    } finally {
      setLoading(false);
    }
  };

  const toggleAvailability = async (value) => {    if (driverData?.verification_status !== 'aprobado') {
      Alert.alert('Verificación pendiente', 'Tu perfil debe ser aprobado antes de conectarte.');
      return;
    }

    try {
      const status = value ? 'disponible' : 'offline';
      const { error } = await supabase
        .from('drivers')
        .update({ is_available: value })
        .eq('profile_id', profile.id);

      if (error) throw error;
      setDriverData({ ...driverData, is_available: value });

      if (!value) setAvailableOrders([]); // Limpiar lista si se pone offline
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const fetchAvailableOrders = async (driver = driverData) => {
    // Solo buscamos pedidos si el repartidor está disponible
    if (!driver?.is_available || driver.verification_status !== 'aprobado') return;

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, businesses(store_name, address)')
        .eq('status', 'listo_para_repartidor')
        .is('driver_id', null); // Que nadie lo haya tomado aún

      if (error) throw error;
      setAvailableOrders(data);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchActiveOrder = async (driverId = driverData?.id) => {
    if (!driverId) return;
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, businesses(store_name, address), profiles(full_name)')
        .eq('driver_id', driverId)
        .eq('status', 'en_camino')
        .maybeSingle();

      if (error) throw error;
      setActiveOrder(data);
    } catch (error) {
      console.error(error);
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
      Alert.alert('Error', 'Este pedido ya fue tomado por otro repartidor');
    } finally {
      setLoading(false);
    }
  };

  const completeOrder = async () => {
    try {
      const { error } = await supabase.rpc('driver_complete_order', {
        p_order_id: activeOrder.id,
      });
      if (error) throw error;

      Alert.alert('Entrega Exitosa', 'Has completado la entrega correctamente.');
      setActiveOrder(null);
      fetchAvailableOrders();
    } catch (error) {
      Alert.alert('Error', error.message);
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
    Alert.alert('Cerrar sesión', '¿Quieres cerrar la sesión?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: async () => {
        const result = await signOut();
        if (result.success) navigation.reset({ index: 0, routes: [{ name: 'ClientHome' }] });
        else Alert.alert('Error', result.error || 'No se pudo cerrar la sesión.');
      } },
    ]);
  };

  // --- COMPONENTES DE INTERFAZ ---

  const renderOrderCard = ({ item }) => (
    <View style={styles.orderCard}>
      <View style={styles.orderInfo}>
        <Text style={styles.storeName}>📦 Recoger en: {item.businesses?.store_name}</Text>
        <Text style={styles.addressText}>📍 {item.businesses?.address}</Text>
        <Text style={styles.amountText}>
          Ganancia (100% del domicilio): {formatCOP(item.delivery_fee_cop)}
        </Text>
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <HelpButton navigation={navigation} context="repartidor" orderId={activeOrder?.id} compact />
      <View style={styles.sessionActions}>
        <AnimatedButton title="Mi perfil" variant="secondary" onPress={() => navigation.navigate('DriverProfile')} />
        <AnimatedButton title="Configuración" variant="secondary" onPress={() => navigation.navigate('Settings')} />
        <AnimatedButton title="Cerrar sesión" variant="secondary" onPress={handleSignOut} />
      </View>
      {/* HEADER DE DISPONIBILIDAD */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.welcomeText, { color: colors.text }]}>Hola, {profile?.full_name || 'Repartidor'}</Text>
          <Text style={[styles.statusText, { color: colors.muted }]}>
            Estado: {driverData?.verification_status !== 'aprobado'
              ? 'Pendiente de aprobación'
              : driverData?.is_available ? 'Disponible' : 'Offline'}
          </Text>
        </View>
        <Switch
          value={driverData?.verification_status === 'aprobado' && driverData?.is_available}
          onValueChange={toggleAvailability}
          disabled={driverData?.verification_status !== 'aprobado'}
          trackColor={{ false: '#767577', true: '#1A237E' }}
          thumbColor={'#fff'}
        />
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
          <Text style={styles.panelTitle}>📦 Pedido en Curso</Text>
          <View style={styles.activeOrderCard}>
            <Text style={styles.detailLabel}>Recoger en:</Text>
            <Text style={styles.detailValue}>{activeOrder.businesses?.store_name} - {activeOrder.businesses?.address}</Text>

            <View style={styles.divider} />

            <Text style={styles.detailLabel}>Entregar a:</Text>
            <Text style={styles.detailValue}>{activeOrder.profiles?.full_name}</Text>
            <AnimatedButton
              title="Abrir chat con el cliente"
              variant="secondary"
              onPress={() => navigation.navigate('OrderChat', { orderId: activeOrder.id })}
            />
            <Text style={styles.detailLabel}>Destino:</Text>
            {activeOrder.delivery_latitude != null && activeOrder.delivery_longitude != null ? (
              <>
                <Text style={styles.detailValue}>
                  {activeOrder.delivery_latitude}, {activeOrder.delivery_longitude}
                </Text>
                <AnimatedButton
                  title="Abrir ubicación en mapas"
                  onPress={() => openDeliveryLocation(activeOrder)}
                  variant="secondary"
                />
              </>
            ) : (
              <Text style={styles.detailValue}>
                Coordina la dirección con el cliente por el chat del pedido.
              </Text>
            )}
            <Text style={styles.detailLabel}>
              Tu ganancia por domicilio: {formatCOP(activeOrder.delivery_fee_cop)}
            </Text>
            <OrderStatusAnimation status={activeOrder.status} />
            <AnimatedButton
              title="Marcar como Entregado"
              onPress={completeOrder}
              buttonStyle={[styles.completeBtn, { backgroundColor: theme.primary }]}
              textStyle={styles.completeBtnText}
            />
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
  sessionActions: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 18, gap: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    elevation: 2
  },
  welcomeText: { fontSize: 20, fontWeight: 'bold', color: '#1A237E' },
  statusText: { fontSize: 14, color: '#757575' },

  // Active Order Panel
  activeOrderPanel: { padding: 20 },
  panelTitle: { fontSize: 22, fontWeight: 'bold', color: '#1A237E', marginBottom: 15, textAlign: 'center' },
  activeOrderCard: {
    backgroundColor: '#fff', padding: 20, borderRadius: 20,
    elevation: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10
  },
  detailLabel: { fontSize: 14, color: '#757575', fontWeight: 'bold', marginTop: 10 },
  detailValue: { fontSize: 16, color: '#333', marginBottom: 10 },
  divider: { height: 1, backgroundColor: '#E0E0E0', marginVertical: 15 },
  completeBtn: {
    backgroundColor: '#2E7D32', padding: 18, borderRadius: 12,
    alignItems: 'center', marginTop: 20
  },
  completeBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

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
