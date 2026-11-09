// app/src/screens/business/BusinessOrdersScreen.js
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';

const BusinessOrdersScreen = () => {
  const { profile } = useAuthStore();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders();
    // Escuchar cambios en tiempo real en la tabla de órdenes
    const subscription = supabase
      .channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
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
        .select('*, order_items(*)')
        .eq('business_id', (await getBusinessId()).id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const getBusinessId = async () => {
    const { data } = await supabase.from('businesses').select('*').eq('profile_id', profile.id).single();
    return data;
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      const { error } = await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
      if (error) throw error;
      Alert.alert('Actualizado', `El pedido ahora está en estado: ${newStatus}`);
      fetchOrders();
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const renderOrder = ({ item }) => (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <Text style={styles.orderId}>Pedido #{item.id.slice(0,8)}</Text>
        <Text style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>{item.status}</Text>
      </View>
      
      <View style={styles.orderItems}>
        {item.order_items?.map((prod, index) => (
          <Text key={index} style={styles.itemText}>• {prod.quantity}x {prod.product_id}</Text>
        ))}
      </View>

      <Text style={styles.totalText}>Total: ${item.total_amount}</Text>

      <View style={styles.actionRow}>
        {item.status === 'pendiente' && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => updateOrderStatus(item.id, 'pagado')}>
            <Text style={styles.actionBtnText}>Confirmar Pago</Text>
          </TouchableOpacity>
        )}
        {item.status === 'pagado' && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => updateOrderStatus(item.id, 'preparando')}>
            <Text style={styles.actionBtnText}>Iniciar Preparación</Text>
          </TouchableOpacity>
        )}
        {item.status === 'preparando' && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => updateOrderStatus(item.id, 'en_camino')}>
            <Text style={styles.actionBtnText}>Listo para Repartidor</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const getStatusColor = (status) => {
    switch(status) {
      case 'pendiente': return '#FFA000';
      case 'pagado': return '#4CAF50';
      case 'preparando': return '#2196F3';
      case 'en_camino': return '#9C27B0';
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
        ListEmptyComponent={<Text style={styles.empty}>No hay pedidos actuales</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 20 },
  orderCard: { backgroundColor: '#fff', borderRadius: 15, padding: 15, marginBottom: 15, elevation: 3 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  orderId: { fontSize: 16, fontWeight: 'bold', color: '#1A237E' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  statusText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  orderItems: { marginVertical: 10 },
  itemText: { fontSize: 14, color: '#666', marginBottom: 2 },
  totalText: { fontSize: 18, fontWeight: 'bold', color: '#333', textAlign: 'right', marginBottom: 15 },
  actionRow: { flexDirection: 'row', justifyContent: 'center' },
  actionBtn: { backgroundColor: '#1A237E', padding: 12, borderRadius: 10, width: '100%', alignItems: 'center' },
  actionBtnText: { color: '#fff', fontWeight: 'bold' },
  empty: { textAlign: 'center', marginTop: 50, color: '#757575' }
});

export default BusinessOrdersScreen;
