import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCOP } from '../../utils/formatters';
import PayoutAccountCard from '../../components/PayoutAccountCard';

const PAYOUT_LABELS = {
  processing: 'Preparando transferencia',
  pending: 'Pendiente de Wompi',
  success: 'Pagado',
  failed: 'Fallido; el saldo queda disponible para la siguiente liquidación',
  needs_review: 'En conciliación; no se enviará de nuevo automáticamente',
};

export default function BusinessSettlementsScreen() {
  const profile = useAuthStore((state) => state.profile);
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('business_payout_summary');
      if (error) throw error;
      setSummary(data);
    } catch (error) {
      Alert.alert('No se pudo cargar la liquidación', error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    const channel = supabase
      .channel(`business-settlements:${profile?.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'business_payouts',
      }, loadSummary)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime settlement subscription failed: ${status}`);
        }
      });
    return () => supabase.removeChannel(channel);
  }, [loadSummary, profile?.id]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const account = summary?.payout_account;
  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>Liquidaciones de ventas</Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        Las ventas se liquidan cada lunes a las 3:00 a. m. (hora de Bogotá), cuando el saldo disponible alcanza $50.000 COP.
        La comisión se cobra por separado desde tu billetera prepago y no se descuenta otra vez de esta liquidación.
      </Text>

      <View style={[styles.balanceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.balanceLabel, { color: colors.muted }]}>Disponible para liquidar</Text>
        <Text style={[styles.balance, { color: colors.primary }]}>
          {formatCOP(summary?.available_balance || 0, locale)}
        </Text>
        <Text style={[styles.detail, { color: colors.muted }]}>
          En proceso: {formatCOP(summary?.reserved_balance || 0, locale)}
        </Text>
        <Text style={[styles.detail, { color: colors.muted }]}>
          Total pagado: {formatCOP(summary?.paid_balance || 0, locale)}
        </Text>
        <Text style={[styles.detail, { color: colors.muted }]}>
          Mínimo por transferencia: {formatCOP(summary?.minimum_payout_cop || 50000, locale)}
        </Text>
      </View>

      <PayoutAccountCard
        account={account}
        onSaved={loadSummary}
        saveFunction="save_business_payout_account"
        title="Cuenta bancaria para liquidaciones"
      />

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Historial de liquidaciones</Text>
      {(summary?.history || []).length === 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>Todavía no hay liquidaciones.</Text>
      ) : summary.history.map((payout) => (
        <View key={payout.id} style={[styles.historyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.historyRow}>
            <Text style={[styles.historyAmount, { color: colors.text }]}>{formatCOP(payout.amount_cop, locale)}</Text>
            <Text style={[styles.status, { color: payout.status === 'success' ? colors.primary : colors.muted }]}>
              {PAYOUT_LABELS[payout.status] || payout.status}
            </Text>
          </View>
          <Text style={[styles.detail, { color: colors.muted }]}>
            {payout.bank_name} ···· {payout.account_number_last4}
          </Text>
          <Text style={[styles.detail, { color: colors.muted }]}>Referencia: {payout.reference}</Text>
          {payout.failure_reason ? (
            <Text accessibilityRole="alert" style={styles.failure}>{payout.failure_reason}</Text>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  description: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  balanceCard: { borderWidth: 1, borderRadius: 14, padding: 16 },
  balanceLabel: { fontSize: 13 },
  balance: { fontSize: 28, fontWeight: '800', marginTop: 4, marginBottom: 8 },
  detail: { fontSize: 12, marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '800', marginTop: 20, marginBottom: 8 },
  empty: { fontSize: 13, marginTop: 8 },
  historyCard: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  historyAmount: { fontWeight: '800', fontSize: 16, flex: 1 },
  status: { fontSize: 12, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  failure: { color: '#B3261E', fontSize: 12, lineHeight: 17, marginTop: 6 },
});
