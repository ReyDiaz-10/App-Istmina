import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { formatCOP } from '../../utils/formatters';

export default function AdminFinanceScreen({ navigation }) {
  const { colors } = useAppTheme();
  const [summary, setSummary] = useState(null);
  const [exceptions, setExceptions] = useState({ payments: [], refunds: [], business_payouts: [] });
  const [reviewNotes, setReviewNotes] = useState({});
  const [savingException, setSavingException] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_financial_summary');
      if (error) throw error;
      setSummary(data || { businesses: [], drivers: [], withdrawals: [] });
    } catch (error) {
      Alert.alert('No se pudo cargar Finanzas', error.message);
    }
    try {
      const { data, error } = await supabase.rpc('admin_financial_exceptions');
      if (error) throw error;
      setExceptions(data || { payments: [], refunds: [], business_payouts: [] });
    } catch (error) {
      Alert.alert('No se pudo cargar la conciliación', error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveExceptionReview = async (item, status) => {
    const note = (reviewNotes[item.exception_id] || item.review_note || '').trim();
    if (!note) {
      Alert.alert('Nota requerida', 'Registra la revisión o evidencia consultada antes de guardar el caso.');
      return;
    }
    setSavingException(item.exception_id);
    try {
      const { error } = await supabase.rpc('admin_review_financial_exception', {
        p_exception_type: item.exception_type,
        p_exception_id: item.exception_id,
        p_status: status,
        p_note: note,
      });
      if (error) throw error;
      await load();
    } catch (error) {
      Alert.alert('No se pudo guardar la revisión', error.message);
    } finally {
      setSavingException(null);
    }
  };

  if (loading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} size="large" /></View>;

  const withdrawals = summary?.withdrawals || [];
  const scheduled = withdrawals.filter((item) => ['scheduled', 'processing'].includes(item.status));
  const historical = withdrawals.filter((item) => ['paid', 'failed', 'cancelled'].includes(item.status));
  const financialExceptions = [
    ...(exceptions.payments || []),
    ...(exceptions.refunds || []),
    ...(exceptions.business_payouts || []),
  ];
  const exceptionTitles = {
    payment: 'Pago incierto',
    refund: 'Reembolso pendiente o fallido',
    business_payout: 'Liquidación de comercio',
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text style={[styles.title, { color: colors.text }]}>Finanzas</Text>
        <Pressable onPress={load}><Text style={{ color: colors.primary, fontWeight: '700' }}>Actualizar</Text></Pressable>
      </View>
      <Text style={[styles.note, { color: colors.muted }]}>Los retiros programados son reservas internas. Se necesita configurar un proveedor de desembolsos antes de ejecutar transferencias automáticas.</Text>

      <Text style={[styles.section, { color: colors.text }]}>Excepciones por conciliar</Text>
      <Text style={[styles.note, { color: colors.muted }]}>
        Registrar una revisión no cambia el estado financiero ni reenvía dinero. Confirma el resultado en Wompi antes de cerrar cada caso; los estados finales solo los actualiza el webhook firmado.
      </Text>
      {!financialExceptions.length ? (
        <Text style={[styles.note, { color: colors.muted }]}>No hay pagos, reembolsos ni liquidaciones que requieran revisión.</Text>
      ) : financialExceptions.map((item) => (
        <View key={`${item.exception_type}:${item.exception_id}`} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.name, { color: colors.text }]}>{exceptionTitles[item.exception_type]} · {item.status}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {item.order_number ? `Pedido #${item.order_number} · ` : ''}{item.business_name || 'Negocio'} · {formatCOP(item.amount_cop)}
          </Text>
          {item.reference ? <Text style={[styles.meta, { color: colors.muted }]}>Referencia: {item.reference}</Text> : null}
          {item.provider_refund_id ? <Text style={[styles.meta, { color: colors.muted }]}>ID de reembolso Wompi: {item.provider_refund_id}</Text> : null}
          {item.transaction_ids?.length ? <Text style={[styles.meta, { color: colors.muted }]}>Transacciones: {item.transaction_ids.join(', ')}</Text> : null}
          {item.reason || item.detail ? <Text style={[styles.meta, { color: colors.muted }]}>{item.reason || item.detail}</Text> : null}
          <Text style={[styles.meta, { color: item.review_status === 'reviewed' ? colors.primary : colors.muted }]}>
            Revisión: {item.review_status === 'reviewed' ? 'Revisado' : 'Pendiente'}
          </Text>
          <TextInput
            accessibilityLabel="Nota de conciliación financiera"
            value={reviewNotes[item.exception_id] ?? item.review_note ?? ''}
            onChangeText={(value) => setReviewNotes((current) => ({ ...current, [item.exception_id]: value }))}
            placeholder="Describe la verificación y su evidencia"
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.reviewInput, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
          />
          <Pressable
            disabled={savingException === item.exception_id}
            onPress={() => saveExceptionReview(item, item.review_status === 'reviewed' ? 'open' : 'reviewed')}
          >
            <Text style={[styles.reviewAction, { color: colors.primary }]}>
              {savingException === item.exception_id
                ? 'Guardando...'
                : item.review_status === 'reviewed' ? 'Reabrir revisión' : 'Guardar y marcar revisado'}
            </Text>
          </Pressable>
        </View>
      ))}

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
  reviewInput: { borderWidth: 1, borderRadius: 8, minHeight: 60, padding: 10, textAlignVertical: 'top', marginTop: 8 },
  reviewAction: { paddingVertical: 8, fontWeight: '800', textAlign: 'right' },
});
