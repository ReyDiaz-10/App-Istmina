import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import HelpButton from '../../components/HelpButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCOP } from '../../utils/formatters';

const Metric = ({ label, value }) => {
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  return <View style={[styles.metric, { backgroundColor: colors.surface }]}><Text style={[styles.metricValue, { color: colors.primary }]}>{value}</Text><Text style={[styles.muted, { color: colors.muted }]}>{label}</Text></View>;
};

export default function AdminDashboardScreen({ navigation }) {
  const role = useAuthStore((state) => state.profile?.role);
  const signOut = useAuthStore((state) => state.signOut);
  const { colors } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [replies, setReplies] = useState({});
  const [data, setData] = useState({ users: 0, clients: 0, orders: 0, activeOrders: 0, completed: 0, activity: [], businesses: [], drivers: [], topClients: [], tickets: [], feedback: 0 });

  const load = useCallback(async () => {
    if (role !== 'superadmin') return;
    setLoading(true);
    try {
      const [summary, tickets] = await Promise.all([
        supabase.rpc('admin_dashboard_summary'),
        supabase.from('support_tickets').select('*, profiles(full_name, role)').order('created_at', { ascending: false }).limit(100),
      ]);
      for (const result of [summary, tickets]) if (result.error) throw result.error;
      const metrics = summary.data || {};
      const ticketRows = tickets.data || [];
      setData({
        users: metrics.users || 0,
        clients: metrics.clients || 0,
        orders: metrics.orders || 0,
        activeOrders: metrics.active_orders || 0,
        completed: metrics.completed || 0,
        activity: metrics.orders_last_7_days || [],
        businesses: metrics.businesses || [],
        drivers: metrics.drivers || [],
        topClients: metrics.top_clients || [],
        tickets: ticketRows,
        feedback: metrics.feedback || 0,
      });
    } catch (error) {
      Alert.alert('No se pudo cargar el panel', error.message);
    } finally { setLoading(false); }
  }, [role]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const updateTicket = async (ticket, status) => {
    const update = { status };
    if (replies[ticket.id]?.trim()) update.admin_reply = replies[ticket.id].trim();
    const { error } = await supabase.from('support_tickets').update(update).eq('id', ticket.id);
    if (error) Alert.alert('No se pudo actualizar', error.message);
    else load();
  };

  if (role !== 'superadmin') return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={[styles.title, { color: colors.text }]}>Acceso restringido</Text><Text style={{ color: colors.text }}>Esta sección requiere una cuenta SuperAdmin.</Text></View>;
  if (loading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
    <View style={styles.top}><Text style={[styles.title, { color: colors.text }]}>Centro de control</Text><View style={styles.actions}><Pressable onPress={() => navigation.navigate('Settings')}><Text style={[styles.link, { color: colors.primary }]}>Configuración</Text></Pressable><Pressable onPress={load}><Text style={[styles.link, { color: colors.primary }]}>Actualizar</Text></Pressable></View></View>
    <HelpButton navigation={navigation} context="administración" compact />
    <Text style={[styles.subtitle, { color: colors.muted }]}>Indicadores acumulados de la plataforma</Text>
    <View style={styles.grid}>
      <Metric label="Usuarios" value={data.users} /><Metric label="Clientes" value={data.clients} />
      <Metric label="Pedidos totales" value={data.orders} /><Metric label="Pedidos activos" value={data.activeOrders} />
      <Metric label="Entregas completadas" value={data.completed} /><Metric label="Sugerencias y quejas" value={data.feedback} />
    </View>
    <Text style={[styles.section, { color: colors.text }]}>Pedidos por día · últimos 7 días</Text>
    {data.activity.map((day) => {
      const peak = Math.max(1, ...data.activity.map((item) => item.orders));
      return <View key={day.date} style={styles.activityRow}><Text style={[styles.activityDate, { color: colors.muted }]}>{day.date.slice(5)}</Text><View style={styles.barTrack}><View style={[styles.bar, { width: `${day.orders === 0 ? 0 : Math.max(3, (day.orders / peak) * 100)}%` }]} /></View><Text style={[styles.activityCount, { color: colors.text }]}>{day.orders}</Text></View>;
    })}
    <Text style={[styles.section, { color: colors.text }]}>Negocios</Text>
    {data.businesses.map((b) => <View key={b.id} style={[styles.row, { backgroundColor: colors.surface }]}><View style={styles.rowMain}><Text style={[styles.rowTitle, { color: colors.text }]}>{b.store_name}</Text><Text style={[styles.muted, { color: colors.muted }]}>{b.status} · {b.orders} pedidos · {formatCOP(b.sales, locale)}</Text></View></View>)}
    <Text style={[styles.section, { color: colors.text }]}>Clientes con más pedidos</Text>
    {data.topClients.map((client) => <View key={client.profile_id} style={[styles.row, { backgroundColor: colors.surface }]}><Text style={[styles.rowTitle, { color: colors.text }]}>{client.full_name}</Text><Text style={[styles.muted, { color: colors.muted }]}>{client.orders} pedidos · {formatCOP(client.spent, locale)}</Text></View>)}
    <Text style={[styles.section, { color: colors.text }]}>Repartidores</Text>
    {data.drivers.map((d) => <View key={d.id} style={[styles.row, { backgroundColor: colors.surface }]}><View style={styles.rowMain}><Text style={[styles.rowTitle, { color: colors.text }]}>{d.full_name || 'Perfil sin nombre'}</Text><Text style={[styles.muted, { color: colors.muted }]}>{d.is_available ? 'Disponible' : 'No disponible'} · {d.deliveries} entregas completadas</Text></View></View>)}
    <Text style={[styles.section, { color: colors.text }]}>Ayuda y sugerencias</Text>
    {!data.tickets.length && <Text style={styles.muted}>No hay solicitudes recibidas.</Text>}
    {data.tickets.map((t) => <View key={t.id} style={[styles.ticket, { backgroundColor: colors.surface }]}><Text style={[styles.rowTitle, { color: colors.text }]}>{t.subject} · {t.category}</Text><Text style={[styles.muted, { color: colors.muted }]}>De {t.profiles?.full_name || 'usuario'} · {t.context || 'General'} · {t.status}{t.order_id ? ` · Pedido ${t.order_id.slice(0, 8)}` : ''}</Text><Text style={[styles.message, { color: colors.text }]}>{t.message}</Text><TextInput accessibilityLabel="Respuesta al usuario" placeholder={t.admin_reply || 'Escribe una respuesta para el usuario'} placeholderTextColor={colors.muted} value={replies[t.id] ?? t.admin_reply ?? ''} onChangeText={(value) => setReplies((current) => ({ ...current, [t.id]: value }))} style={[styles.replyInput, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} multiline /><View style={styles.actions}><Pressable onPress={() => updateTicket(t, 'en_revision')}><Text style={[styles.link, { color: colors.primary }]}>Guardar / tomar caso</Text></Pressable><Pressable onPress={() => updateTicket(t, 'resuelto')}><Text style={[styles.link, { color: colors.primary }]}>Responder y resolver</Text></Pressable></View></View>)}
    <Pressable style={styles.logout} onPress={async () => {
      const result = await signOut();
      if (result.success) navigation.reset({ index: 0, routes: [{ name: 'ClientHome' }] });
      else Alert.alert('Error', result.error || 'No se pudo cerrar la sesión.');
    }}><Text style={styles.logoutText}>Cerrar sesión</Text></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({ container: { padding: 18, backgroundColor: '#F5F7FA' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, actions: { flexDirection: 'row', alignItems: 'center' }, title: { fontSize: 26, fontWeight: '800', color: '#1A237E' }, subtitle: { color: '#687078', marginTop: 3, marginBottom: 16 }, grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, metric: { width: '48%', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10 }, metricValue: { fontSize: 24, color: '#1A237E', fontWeight: '800' }, muted: { color: '#697279', marginTop: 5, lineHeight: 20 }, section: { fontSize: 20, fontWeight: '800', color: '#263238', marginTop: 20, marginBottom: 8 }, activityRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 }, activityDate: { width: 44, color: '#697279' }, barTrack: { flex: 1, height: 12, backgroundColor: '#E0E4F0', borderRadius: 8, overflow: 'hidden' }, bar: { height: 12, backgroundColor: '#3949AB', borderRadius: 8 }, activityCount: { width: 32, textAlign: 'right', color: '#273238', fontWeight: '700' }, row: { backgroundColor: '#fff', borderRadius: 10, padding: 13, marginBottom: 8 }, rowMain: { flex: 1 }, rowTitle: { fontWeight: '700', color: '#273238' }, ticket: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 }, message: { color: '#30383D', marginTop: 8, lineHeight: 21 }, replyInput: { backgroundColor: '#F5F7FA', padding: 10, borderRadius: 8, minHeight: 60, marginTop: 10, textAlignVertical: 'top' }, actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }, link: { color: '#1A237E', fontWeight: '700', padding: 6 }, logout: { backgroundColor: '#1A237E', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 24, marginBottom: 25 }, logoutText: { color: '#fff', fontWeight: '700' } });
