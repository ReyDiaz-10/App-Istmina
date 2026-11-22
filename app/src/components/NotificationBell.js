import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText as Text } from './AppText.js';
import { supabase } from '../api/supabaseClient';
import { listNotifications, markNotificationRead } from '../services/notifications';

export default function NotificationBell({ navigation, compact = false }) {
  const parentNavigation = useNavigation();
  const nav = navigation || parentNavigation;
  const [items, setItems] = useState([]); const [open, setOpen] = useState(false); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setItems(await listNotifications()); } catch (e) { setError(e.message || 'No se pudieron cargar notificaciones.'); } finally { setLoading(false); } }, []);
  useEffect(() => { let active = true; Promise.resolve().then(() => { if (active) void load(); }); const ch = supabase.channel('my-notifications').on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications' }, () => { void load(); }).subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setError(`Conexión de notificaciones fallida: ${status}`); }); return () => { active = false; void supabase.removeChannel(ch); }; }, [load]);
  const unread = items.filter((x) => !x.read_at).length;
  const pressItem = async (item) => { try { if (!item.read_at) await markNotificationRead(item.id); setItems((prev) => prev.map((n) => n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)); setOpen(false); if (item.order_id && navigation?.navigate) navigation.navigate('ClientOrders', { orderId: item.order_id }); } catch (e) { setError(e.message || 'No se pudo marcar como leída.'); } };
  return <View style={styles.wrap}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${unread} notificaciones sin leer`} onPress={() => { const target = nav.getParent?.() || nav; target.navigate('Notifications'); }} style={styles.bell}><Text style={styles.icon}>🔔</Text><Text style={styles.count}>{unread > 99 ? '99+' : unread}</Text></Pressable>
    {open && <View style={[styles.panel, compact && styles.compact]}><Text style={styles.title}>Notificaciones</Text>{loading ? <ActivityIndicator /> : error ? <Text style={styles.error}>{error}</Text> : items.length ? <ScrollView style={styles.list}>{items.map((x) => <Pressable key={x.id} style={[styles.item, !x.read_at && styles.unread]} onPress={() => void pressItem(x)}><Text style={styles.itemTitle}>{x.title}</Text><Text>{x.body}</Text><Text style={styles.date}>{new Date(x.created_at).toLocaleString()}</Text></Pressable>)}</ScrollView> : <Text>Sin notificaciones.</Text>}</View>}
  </View>;
}
const styles = StyleSheet.create({ wrap: { position: 'relative', zIndex: 20 }, bell: { padding: 8, flexDirection: 'row', alignItems: 'center' }, icon: { fontSize: 23, color: '#1A237E' }, count: { backgroundColor: '#D32F2F', color: '#fff', borderRadius: 10, overflow: 'hidden', paddingHorizontal: 5, fontSize: 11, fontWeight: '800' }, panel: { position: 'absolute', top: 42, right: 0, width: 320, maxHeight: 440, backgroundColor: 'white', padding: 14, borderRadius: 12, elevation: 10, zIndex: 30 }, compact: { width: 280 }, title: { fontWeight: '800', fontSize: 17, marginBottom: 8 }, list: { maxHeight: 390 }, item: { borderTopWidth: 1, borderColor: '#eee', paddingVertical: 10, paddingHorizontal: 5 }, unread: { backgroundColor: '#F1F4FF' }, itemTitle: { fontWeight: '700' }, date: { color: '#777', fontSize: 11, marginTop: 4 }, error: { color: '#B00020' } });
