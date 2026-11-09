// app/src/screens/driver/DriverHomeScreen.js
import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TouchableOpacity, FlatList, 
  ActivityIndicator, Alert, Switch, SafeAreaView 
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';

const DriverHomeScreen = () => {
  const { profile } = useAuthStore();
  
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
      
      // 2. Verificar si ya tenía una orden asignada antes de cerrar la app
      await fetchActiveOrder();
      await fetchAvailableOrders();
    } catch (error) {
      Alert.alert('Error', 'No se pudo cargar el perfil de repartidor');
    } finally {
      setLoading(false);
    }
  };

  const toggleAvailability = async (value) => {
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

  const fetchAvailableOrders = async () => {
    // Solo buscamos pedidos si el repartidor está disponible
    if (!driverData?.is_available) return;

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, businesses(store_name, address)')
        .eq('status', 'en_camino') // El negocio ya lo marcó como listo para repartidor
        .is('driver_id', null); // Que nadie lo haya tomado aún

      if (error) throw error;
      setAvailableOrders(data);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchActiveOrder = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, businesses(store_name, address), profiles(full_name)')
        .eq('driver_id', driverData?.id)
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
      const { error } = await supabase
        .from('orders')
        .update({ 
          driver_id: driverData.id, 
          status: 'en_camino' // Mantenemos el estado pero ya tiene driver
        })
        .eq('id', orderId);

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
      const { error } = await supabase
        .from('orders')
        .update({ status: 'entregado' })
        .eq('id', activeOrder.id);

      if (error) throw error;
      
      Alert.alert('Entrega Exitosa', 'Has completado la entrega correctamente.');
      setActiveOrder(null);
      fetchAvailableOrders();
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  // --- COMPONENTES DE INTERFAZ ---

  const renderOrderCard = ({ item }) => (
    <View style={styles.orderCard}>
      <View style={styles.orderInfo}>
        <Text style={styles.storeName}>📦 Recoger en: {item.businesses?.store_name}</Text>
        <Text style={styles.addressText}>📍 {item.businesses?.address}</Text>
        <Text style={styles.amountText}>💰 Ganancia: ${item.total_amount * 0.05}</Text> 
      </View>
      <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptOrder(item.id)}>
        <Text style={styles.acceptBtnText}>Aceptar</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1A237E" /></View>;

  return (
    <SafeAreaView style={styles.container}>
      {/* HEADER DE DISPONIBILIDAD */}
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeText}>Hola, Repartidor</Text>
          <Text style={styles.statusText}>
            Estado: {driverData?.is_available ? '🟢 Disponible' : '🔴 Offline'}
          </Text>
        </View>
        <Switch 
          value={driverData?.is_available} 
          onValueChange={toggleAvailability} 
          trackColor={{ false: '#767577', true: '#1A237E' }}
          thumbColor={'#fff'}
        />
      </View>

      {/* PANEL DE PEDIDO ACTIVO */}
      {activeOrder ? (
        <View style={styles.activeOrderPanel}>
          <Text style={styles.panelTitle}>📦 Pedido en Curso</Text>
          <View style={styles.activeOrderCard}>
            <Text style={styles.detailLabel}>Recoger en:</Text>
            <Text style={styles.detailValue}>{activeOrder.businesses?.store_name} - {activeOrder.businesses?.address}</Text>
            
            <View style={styles.divider} />
            
            <Text style={styles.detailLabel}>Entregar a:</Text>
            <Text style={styles.detailValue}>{activeOrder.profiles?.full_name}</Text>
            
            <TouchableOpacity style={styles.completeBtn} onPress={completeOrder}>
              <Text style={styles.completeBtnText}>Marcar como Entregado ✅</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* LISTA DE PEDIDOS DISPONIBLES */
        <View style={styles.availableSection}>
          <Text style={styles.sectionTitle}>Pedidos Disponibles</Text>
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
  acceptBtn: { backgroundColor: '#1A237E', padding: 10, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  acceptBtnText: { color: '#fff', fontWeight: 'bold' },
  offlineBox: { 
    backgroundColor: '#E0E0E0', padding: 30, borderRadius: 15, 
    alignItems: 'center', marginTop: 50 
  },
  offlineText: { textAlign: 'center', color: '#666', fontSize: 16 },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#757575' },
});

export default DriverHomeScreen;
