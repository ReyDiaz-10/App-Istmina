import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { formatCOP } from '../../utils/formatters';

export default function AdminFinanceScreen({ navigation }) {
  const { colors } = useAppTheme();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_financial_summary');
    if (error) Alert.alert('No se pudo cargar Finanzas', error.message);
    else setSummary(data || { businesses: [], drivers: [], withdrawals: [] });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} size="large" /></View>;

  const withdrawals = summary?.withdrawals || [];
  const scheduled = withdrawals.filter((item) => ['scheduled', 'processing'].includes(item.status));
  const historical = withdrawals.filter((item) => ['paid', 'failed', 'cancelled'].includes(item.status));

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text style={[styles.title, { color: colors.text }]}>Finanzas</Text>
        <Pressable onPress={load}><Text style={{ color: colors.primary, fontWeight: '700' }}>Actualizar</Text></Pressable>
      </View>
      <Text style={[styles.note, { color: colors.muted }]}>Los retiros programados son reservas internas. Se necesita configurar un proveedor de desembolsos antes de ejecutar transferencias automáticas.</Text>

      <Text style={[styles.section, { color: colors.text }]}>Billeteras y ventas de negocios</Text>
      {(summary?.businesses || []).map((item) => (
        <View key={item.business_id} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.name, { color: colors.text }]}>{item.store_name}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{item.owner_name || 'Titular sin nombre'}</Text>
          <Text style={[styles.meta, { color: colors.text }]}>Billetera: {formatCOP(item.wallet_balance)}</Text>
          <Text style={[styles.meta, { color: colors.text }]}>Ventas netas: {formatCOP(item.sales_net)}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{item.pro_active ? 'Suscripción activa Pro · $35.000 COP/mes' : `Comisión estimada (10%): ${formatCOP(item.commission_10_percent)}`}</Text>
        </View>
      ))}

      <Text style={[styles.section, { color: colors.text }]}>Saldo de repartidores</Text>
      {(summary?.drivers || []).map((item) => (
        <View key={item.driver_id} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.name, { color: colors.text }]}>{item.full_name || 'Repartidor sin nombre'}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>Ganado: {formatCOP(item.earned)} · Retirado: {formatCOP(item.withdrawn)}</Text>
          <Text style={[styles.balance, { color: colors.primary }]}>Disponible: {formatCOP(item.available_balance)}</Text>
        </View>
      ))}

      <Text style={[styles.section, { color: colors.text }]}>Programados y en proceso · umbral $20.000 COP · ciclo 3:00 a. m. Bogotá</Text>
      {!scheduled.length && <Text style={[styles.note, { color: colors.muted }]}>No hay retiros programados.</Text>}
      {scheduled.map((item) => (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.name, { color: colors.text }]}>{item.full_name} · {formatCOP(item.amount_cop)}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{new Date(item.scheduled_for).toLocaleString('es-CO')} · {item.status}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>El estado cambia cuando Wompi confirma el resultado de la transferencia.</Text>
        </View>
      ))}

      <Text style={[styles.section, { color: colors.text }]}>Histórico de retiros</Text>
      {!historical.length && <Text style={[styles.note, { color: colors.muted }]}>Aún no hay retiros finalizados.</Text>}
      {historical.map((item) => (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.name, { color: colors.text }]}>{item.full_name} · {formatCOP(item.amount_cop)}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{item.status === 'paid' ? 'Desembolsado' : item.status} · {item.paid_at ? new Date(item.paid_at).toLocaleString('es-CO') : 'Sin fecha de desembolso'}</Text>
          {item.provider_reference ? <Text style={[styles.meta, { color: colors.muted }]}>Referencia: {item.provider_reference}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 }, container: { flexGrow: 1, padding: 18, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 25, fontWeight: '800' }, section: { fontSize: 19, fontWeight: '800', marginTop: 22, marginBottom: 10 },
  note: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  card: { padding: 14, borderRadius: 12, marginBottom: 9 }, name: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 19, marginTop: 4 }, balance: { fontSize: 16, fontWeight: '800', marginTop: 7 },
});
