import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
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

const CHAT_STATUSES = [
  'pagado',
  'preparando',
  'listo_para_repartidor',
  'en_camino',
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
  const userId = profile?.id || user?.id;

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
          drivers(plate_number, profile_id)
        `)
        .eq('client_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const ordersWithDrivers = data || [];
      const profileIds = [...new Set(ordersWithDrivers.map((order) => order.drivers?.profile_id).filter(Boolean))];
      if (profileIds.length) {
        const { data: driverProfiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', profileIds);
        if (profilesError) throw profilesError;
        const profilesById = new Map((driverProfiles || []).map((driverProfile) => [driverProfile.id, driverProfile]));
        setOrders(ordersWithDrivers.map((order) => ({
          ...order,
          drivers: order.drivers ? { ...order.drivers, profiles: profilesById.get(order.drivers.profile_id) || null } : null,
        })));
      } else {
        setOrders(ordersWithDrivers);
      }
    } catch (error) {
      console.error('Error cargando pedidos:', error.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchOrders();
    if (!userId) return undefined;

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

    return () => supabase.removeChannel(channel);
  }, [fetchOrders, userId]);

  const renderOrder = ({ item }) => {
    const driver = item.drivers;
    const chatAvailable = CHAT_STATUSES.includes(item.status);

    return (
      <View style={[styles.orderCard, { backgroundColor: colors.surface }]}>
        <View style={styles.header}>
          <Text style={[styles.storeName, { color: colors.text }]}>{item.businesses?.store_name}</Text>
          <Text style={[styles.status, { color: theme.primary }]}>
            {item.status.replace(/_/g, ' ').toUpperCase()}
          </Text>
        </View>
        <Text style={[styles.details, { color: colors.muted }]}>
          Pedido #{item.id.slice(0, 8)} · {t('orders.total')} {formatCOP(item.total_amount, locale)}
        </Text>
        <OrderStatusAnimation status={item.status} />

        {item.status === 'en_camino' && driver && (
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
            </View>
            <Text style={styles.bikeEmoji}>🛵</Text>
          </View>
        )}

        <AnimatedButton
          title={chatAvailable ? t('orders.chat') : t('orders.chatUnavailable')}
          onPress={() => navigation.navigate('OrderChat', { orderId: item.id })}
          disabled={!chatAvailable}
          style={styles.chatButton}
          buttonStyle={styles.chatButtonSurface}
        />
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
  chatButton: { alignSelf: 'stretch', marginTop: 12 },
  chatButtonSurface: { width: '100%' },
});

export default ClientOrdersScreen;
