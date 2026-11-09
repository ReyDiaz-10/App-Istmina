// app/src/screens/client/ClientOrdersScreen.js
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator, Image, TouchableOpacity } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import EmptyState from '../../components/EmptyState';

const ClientOrdersScreen = ({ navigation }) => {
  const { profile } = useAuthStore();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders();
    // Suscripción en tiempo real para actualizar el estado del pedido inmediatamente
    const subscription = supabase
      .channel('client-orders')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => supabase.removeChannel(subscription);
  }, []);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          businesses(store_name),
          drivers(plate_number, profiles(full_name, avatar_url))
        `)
        .eq('client_id', profile.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const renderOrder = ({ item }) => {
    const isEnCamino = item.status === 'en_camino';
    const driver = item.drivers;

    return (
      <View style={styles.orderCard}>
        <View style={styles.header}>
          <Text style={styles.storeName}>{item.businesses?.store_name}</Text>
          <Text style={[styles.status, { color: getStatusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
        </View>

        <Text style={styles.details}>Total: ${item.total_amount}</Text>

        {/* TARJETA DE SEGURIDAD: Solo visible cuando el pedido está en camino */}
        {isEnCamino && driver && (
          <View style={styles.driverCard}>
            <Image source={{ uri: driver.profiles?.avatar_url || 'https://via.placeholder.com/50' }} style={styles.driverPhoto} />
            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{driver.profiles?.full_name}</Text>
              <Text style={styles.plateText}>Placa: <Text style={styles.plateValue}>{driver.plate_number}</Text></Text>
            </View>
            <Text style={styles.bikeEmoji}>🛵</Text>
          </View>
        )}

        <TouchableOpacity 
          style={styles.chatBtn} 
          onPress={() => navigation.navigate('OrderChat', { orderId: item.id })}
        >
          <Text style={styles.chatBtnText}>Contactar Negocio 💬</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'pendiente': return '#FFA000';
      case 'pagado': return '#2196F3';
      case 'preparando': return '#9C27B0';
      case 'en_camino': return '#4CAF50';
      default: return '#757575';
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1A237E" /></View>;

  return (
    <View style={styles.container}>
      <FlatList 
        data={orders} 
        keyExtractor={(item) => item.id} 
        renderItem={renderOrder} 
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState title="No hay pedidos" message="Tus compras aparecerán aquí" icon="🛒" />}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 20 },
  orderCard: { backgroundColor: '#fff', borderRadius: 15, padding: 15, marginBottom: 20, elevation: 3 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  storeName: { fontSize: 18, fontWeight: 'bold', color: '#1A237E' },
  status: { fontSize: 12, fontWeight: 'bold' },
  details: { fontSize: 15, color: '#666', marginBottom: 15 },
  driverCard: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8EAF6', 
    padding: 12, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: '#C5CAE9' 
  },
  driverPhoto: { width: 45, height: 45, borderRadius: 22.5, marginRight: 12 },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  plateText: { fontSize: 13, color: '#757575' },
  plateValue: { fontWeight: 'bold', color: '#1A237E' },
  bikeEmoji: { fontSize: 24 },
  chatBtn: { backgroundColor: '#1A237E', padding: 12, borderRadius: 10, alignItems: 'center' },
  chatBtnText: { color: '#fff', fontWeight: 'bold' },
});

export default ClientOrdersScreen;
