import { AppText as Text } from './AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ImageBackground, Pressable, StyleSheet, View } from 'react-native';
import { supabase } from '../api/supabaseClient';

function describe(entry) {
  if (!entry) return 'Aún no hay actividad reciente registrada.';
  const name = entry.actor_name || 'Un usuario';
  const role = entry.metadata?.role || entry.actor_role;
  if (entry.entity_type === 'profile' && entry.action.includes('registr')) {
    return `Nuevo usuario: ${name} se registró como ${role || 'usuario'}.`;
  }
  if (entry.entity_type === 'order' && entry.action.includes('creó')) {
    const business = entry.businessName || 'un negocio local';
    return `${name} creó un pedido en ${business}.`;
  }
  return `${name} ${entry.action}.`;
}

export default function AdminActivityBanner({ onPress }) {
  const [entries, setEntries] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase.from('system_audit_logs')
      .select('id,actor_name,actor_role,action,entity_type,entity_id,metadata,created_at')
      .order('created_at', { ascending: false }).limit(12);
    if (queryError) {
      console.warn('No se pudo cargar la actividad reciente del panel:', queryError.message);
      setError(true);
      setLoading(false);
      return;
    }
    const rows = data || [];
    const businessIds = [...new Set(rows.map((entry) => entry.metadata?.business_id).filter(Boolean))];
    let businessNames = new Map();
    if (businessIds.length) {
      const { data: businesses, error: businessError } = await supabase.from('businesses').select('id,store_name').in('id', businessIds);
      if (!businessError) businessNames = new Map((businesses || []).map((business) => [business.id, business.store_name]));
    }
    setEntries(rows.map((entry) => ({ ...entry, businessName: businessNames.get(entry.metadata?.business_id) })));
    setIndex(0);
    setError(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase.channel('admin-dashboard-activity-banner')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_audit_logs' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  useEffect(() => {
    if (entries.length < 2) return undefined;
    const timer = setInterval(() => setIndex((current) => (current + 1) % entries.length), 6000);
    return () => clearInterval(timer);
  }, [entries.length]);

  const current = entries[index];
  const message = error ? 'No se pudo cargar la actividad reciente. Toca para abrir la auditoría.' : describe(current);
  const timestamp = current?.created_at
    ? new Date(current.created_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' })
    : '';

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Actividad reciente. ${message} Ver toda la actividad.`} onPress={onPress} style={styles.wrapper}>
      <ImageBackground source={require('../../assets/images/istmiya-local-market-hero.jpg')} imageStyle={styles.image} style={styles.banner} resizeMode="cover">
        <View style={styles.scrim}>
          <View style={styles.topLine}>
            <Text style={styles.eyebrow}>ACTIVIDAD RECIENTE</Text>
            {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.count}>{entries.length ? `${index + 1} / ${entries.length}` : 'EN VIVO'}</Text>}
          </View>
          <Text style={styles.message} numberOfLines={3}>{message}</Text>
          <View style={styles.bottomLine}>
            <Text style={styles.timestamp}>{timestamp || (entries.length ? 'IstmiYa · actividad de la plataforma' : 'Nuevos registros y pedidos aparecerán aquí')}</Text>
            <Text style={styles.link}>Ver toda la actividad ›</Text>
          </View>
          {entries.length > 1 ? <View style={styles.dots}>{entries.map((entry, dotIndex) => <View key={entry.id} style={[styles.dot, dotIndex === index && styles.activeDot]} />)}</View> : null}
        </View>
      </ImageBackground>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 14 }, banner: { minHeight: 142, justifyContent: 'flex-end', overflow: 'hidden', borderRadius: 14, backgroundColor: '#6B3A17' },
  image: { borderRadius: 14 }, scrim: { minHeight: 142, justifyContent: 'space-between', padding: 15, backgroundColor: 'rgba(15, 18, 24, 0.67)' },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { color: '#FFB45C', fontSize: 11, fontWeight: '900', letterSpacing: 1 }, count: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  message: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', lineHeight: 23, marginVertical: 9 }, bottomLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  timestamp: { color: '#E8E8E8', fontSize: 11, flex: 1 }, link: { color: '#FFB45C', fontSize: 12, fontWeight: '800' }, dots: { flexDirection: 'row', gap: 4, marginTop: 8 }, dot: { width: 5, height: 5, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.45)' }, activeDot: { width: 14, backgroundColor: '#FF9C32' },
});
