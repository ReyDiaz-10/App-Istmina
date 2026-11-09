// app/src/screens/admin/AdminDashboardScreen.js
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, Switch, ActivityIndicator, ScrollView } from 'react-native';
import { supabase } from '../../api/supabaseClient';

const AdminDashboardScreen = () => {
  const [metrics, setMetrics] = useState({ users: 0, orders: 0 });
  const [managedUsers, setManagedUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAdminData();
  }, []);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      // 1. Métricas Rápidas (Uso de count exact)
      const { count: userCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
      const { count: orderCount } = await supabase.from('orders').select('*', { count: 'exact', head: true });
      setMetrics({ users: userCount, orders: orderCount });

      // 2. Lista de usuarios para moderación (Negocios y Repartidores)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .neq('role', 'cliente'); // Admin solo modera staff y negocios

      if (error) throw error;
      setManagedUsers(data);
    } catch (error) {
      console.error('Admin Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId, currentStatus) => {
    const newStatus = currentStatus === 'activo' ? 'baneado' : 'activo';
    try {
      // Actualizamos el perfil o el negocio asociado
      const { error } = await supabase.from('profiles').update({ status: newStatus }).eq('id', userId);
      if (error) throw error;
      
      setManagedUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u));
    } catch (error) {
      console.error('Baneo Error:', error);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1A237E" /></View>;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Panel de Administración</Text>

      {/* TARJETAS DE MÉTRICAS */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Total Usuarios</Text>
          <Text style={styles.metricValue}>{metrics.users}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Órdenes Totales</Text>
          <Text style={styles.metricValue}>{metrics.orders}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Moderación de Cuentas</Text>
      <FlatList 
        data={managedUsers}
        keyExtractor={(item) => item.id}
        scrollEnabled={false} // El ScrollView padre maneja el scroll
        renderItem={({ item }) => (
          <View style={styles.userRow}>
            <View>
              <Text style={styles.userName}>{item.full_name}</Text>
              <Text style={styles.userRole}>{item.role}</Text>
            </View>
            <Switch 
              value={item.status === 'activo'} 
              onValueChange={() => toggleUserStatus(item.id, item.status)} 
              trackColor={{ false: '#767577', true: '#4CAF50' }}
            />
          </View>
        )}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#1A237E', marginBottom: 20, marginTop: 10 },
  metricsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30 },
  metricCard: { 
    backgroundColor: '#fff', width: '48%', padding: 20, borderRadius: 15, 
    alignItems: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.1 
  },
  metricLabel: { fontSize: 14, color: '#757575', marginBottom: 5 },
  metricValue: { fontSize: 24, fontWeight: 'bold', color: '#1A237E' },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 15 },
  userRow: { 
    backgroundColor: '#fff', padding: 15, borderRadius: 12, 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', 
    marginBottom: 10, borderWidth: 1, borderColor: '#E0E0E0' 
  },
  userName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  userRole: { fontSize: 13, color: '#757575' },
});

export default AdminDashboardScreen;
