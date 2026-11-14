import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../api/supabaseClient';
import { useAppTheme } from '../hooks/useAppTheme';
import { formatCOP } from '../utils/formatters';
import AnimatedButton from './AnimatedButton';
import PayoutAccountCard from './PayoutAccountCard';

export default function DriverPayoutWalletCard({ locale }) {
  const { colors } = useAppTheme();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data, error } = await supabase.rpc('driver_payout_summary');
    if (error) { setLoadError(error.message); Alert.alert('No se pudo cargar la billetera', error.message); }
    else { setSummary(data); setLoadError(null); }
    setLoading(false);
    setRefreshing(false);
  }, []);
  useEffect(() => {
    load();
    const channel = supabase.channel('driver-payout-summary')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_withdrawals' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payout_transactions' }, () => load(true))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);
  if (loading) return <ActivityIndicator style={{ margin: 20 }} color={colors.primary} />;
  if (!summary) return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.copy, { color: colors.muted }]}>{loadError || 'No se pudo cargar el resumen de retiros.'}</Text><AnimatedButton title="Reintentar" onPress={() => load()} /></View>;
  const available = Number(summary?.available_balance || 0);
  const threshold = Number(summary?.threshold_cop || 20000);
  const needed = Math.max(0, threshold - available);
  const scheduled = summary?.scheduled || [];
  const history = summary?.history || [];
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.text }]}>Ganancias y retiros</Text>
        <AnimatedButton title={refreshing ? 'Actualizando…' : 'Actualizar'} variant="secondary" onPress={() => { setRefreshing(true); load(true); }} />
      </View>
      <Text style={[styles.label, { color: colors.muted }]}>Saldo disponible</Text>
      <Text style={[styles.balance, { color: colors.text }]}>{formatCOP(available, locale)}</Text>
      <Text style={[styles.copy, { color: colors.muted }]}>
        {needed > 0 ? `Te faltan ${formatCOP(needed, locale)} para alcanzar el mínimo de ${formatCOP(threshold, locale)}.` : 'Superaste el mínimo. Tu retiro se programa para la próxima ventana de las 3:00 a. m.'}
      </Text>
      <Text style={[styles.section, { color: colors.text }]}>Próximos retiros programados</Text>
      {scheduled.length ? scheduled.map((item) => (
        <View key={item.id} style={[styles.row, { borderColor: colors.border }]}>
          <View style={styles.flex}><Text style={[styles.amount, { color: colors.text }]}>{formatCOP(item.amount_cop, locale)}</Text><Text style={[styles.copy, { color: colors.muted }]}>{item.bank_name || 'Cuenta bancaria'} ···· {item.account_number_last4 || '----'}</Text></View>
          <Text style={[styles.status, { color: colors.primary }]}>{item.payout_status === 'pending' ? 'En proceso' : item.status === 'processing' ? 'Procesando' : 'Programado'}</Text>
        </View>
      )) : <Text style={[styles.copy, { color: colors.muted }]}>Aún no hay retiros programados.</Text>}
      <PayoutAccountCard account={summary?.payout_account} locale={locale} onSaved={() => load(true)} />
      <Text style={[styles.section, { color: colors.text }]}>Histórico de retiros</Text>
      {history.length ? history.map((item) => (
        <View key={item.id} style={[styles.row, { borderColor: colors.border }]}>
          <View style={styles.flex}><Text style={[styles.amount, { color: colors.text }]}>{formatCOP(item.amount_cop, locale)}</Text><Text style={[styles.copy, { color: colors.muted }]}>{item.bank_name || 'Cuenta'} ···· {item.account_number_last4 || '----'} · {item.paid_at ? new Date(item.paid_at).toLocaleDateString() : 'Sin fecha'}</Text></View>
          <Text style={[styles.status, { color: item.status === 'paid' ? '#17834B' : '#B3261E' }]}>{item.status === 'paid' ? 'Pagado' : item.status === 'failed' ? 'Fallido' : 'Cancelado'}</Text>
        </View>
      )) : <Text style={[styles.copy, { color: colors.muted }]}>Los retiros completados aparecerán aquí.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({ card: { margin: 16, padding: 18, borderRadius: 18, borderWidth: 1 }, heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { fontSize: 19, fontWeight: '800' }, label: { marginTop: 18, fontSize: 13 }, balance: { marginTop: 4, fontSize: 28, fontWeight: '800' }, copy: { marginTop: 6, fontSize: 13, lineHeight: 19 }, section: { marginTop: 20, marginBottom: 8, fontWeight: '800', fontSize: 15 }, row: { borderTopWidth: 1, paddingVertical: 11, flexDirection: 'row', alignItems: 'center' }, flex: { flex: 1 }, amount: { fontSize: 15, fontWeight: '700' }, status: { fontSize: 12, fontWeight: '700' } });
