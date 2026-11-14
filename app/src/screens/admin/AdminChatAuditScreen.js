import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';

export default function AdminChatAuditScreen({ navigation }) {
  const { colors } = useAppTheme();
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    const { data: chatRows, error: chatError } = await supabase.from('chats')
      .select('order_id').order('created_at', { ascending: false }).limit(1000);
    if (chatError) {
      console.error('No se pudieron localizar chats activos:', chatError.message);
      setLoading(false);
      return;
    }
    const orderIds = [...new Set((chatRows || []).map((row) => row.order_id).filter(Boolean))];
    if (!orderIds.length) { setOrders([]); setLoading(false); return; }
    const { data, error } = await supabase.from('orders')
      .select('id, status, created_at, profiles(full_name), businesses(store_name)')
      .in('id', orderIds)
      .in('status', ['pagado', 'preparando', 'listo_para_repartidor', 'en_camino'])
      .order('created_at', { ascending: false }).limit(200);
    if (error) console.error('No se pudieron cargar chats activos:', error.message);
    else setOrders(data || []);
    setLoading(false);
  }, []);

  const loadMessages = useCallback(async (orderId) => {
    if (!orderId) { setMessages([]); return; }
    const { data, error } = await supabase.from('chats')
      .select('id, order_id, sender_id, message, created_at, profiles(full_name, role)')
      .eq('order_id', orderId).order('created_at', { ascending: true }).limit(500);
    if (error) console.error('No se pudo abrir el chat para auditoría:', error.message);
    else setMessages(data || []);
  }, []);

  useEffect(() => {
    loadOrders();
    const channel = supabase.channel('admin-chat-audit-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chats' }, ({ new: message }) => {
        if (message.order_id === selectedOrder?.id) loadMessages(message.order_id);
        loadOrders();
      }).subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadOrders, loadMessages, selectedOrder?.id]);

  const openOrder = (order) => {
    setSelectedOrder(order);
    loadMessages(order.id);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}><AnimatedButton variant="back" navigation={navigation} /><Text style={[styles.title, { color: colors.text }]}>Auditoría de chats</Text></View>
      <Text style={[styles.note, { color: colors.muted }]}>Solo lectura · pedidos activos</Text>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <AnimatedButton
            title={`${item.businesses?.store_name || 'Negocio'} · ${item.profiles?.full_name || 'Cliente'} · ${item.status}`}
            variant={selectedOrder?.id === item.id ? 'primary' : 'secondary'}
            onPress={() => openOrder(item)}
            style={styles.orderButton}
          />
        )}
        ListEmptyComponent={!loading ? <Text style={[styles.note, { color: colors.muted }]}>No hay pedidos activos para revisar.</Text> : null}
      />
      {selectedOrder ? (
        <View style={[styles.chatPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.chatTitle, { color: colors.text }]}>{selectedOrder.businesses?.store_name} · {selectedOrder.profiles?.full_name}</Text>
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            renderItem={({ item }) => (
              <View style={[styles.message, { borderColor: colors.border }]}>
                <Text style={[styles.sender, { color: colors.primary }]}>{item.profiles?.full_name || 'Usuario'} · {item.profiles?.role || 'perfil'}</Text>
                <Text style={{ color: colors.text }}>{item.message}</Text>
                <Text style={[styles.time, { color: colors.muted }]}>{new Date(item.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={[styles.note, { color: colors.muted }]}>Este pedido aún no tiene mensajes.</Text>}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12 }, title: { fontSize: 23, fontWeight: '800' }, note: { fontSize: 13, marginVertical: 8 },
  list: { paddingBottom: 10 }, orderButton: { alignSelf: 'stretch', marginVertical: 4 },
  chatPanel: { height: '48%', borderWidth: 1, borderRadius: 12, padding: 12 }, chatTitle: { fontWeight: '800', fontSize: 15, marginBottom: 8 }, messageList: { paddingBottom: 8 },
  message: { borderBottomWidth: 1, paddingVertical: 9 }, sender: { fontSize: 12, fontWeight: '700' }, time: { fontSize: 11, marginTop: 4 },
});
