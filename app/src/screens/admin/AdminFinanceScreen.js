import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
  const [driverExceptions, setDriverExceptions] = useState([]);
  const [walletReconciliationCases, setWalletReconciliationCases] = useState([]);
  const [minimumOpenDeliveryOrders, setMinimumOpenDeliveryOrders] = useState('5');
  const [minimumCourierRatio, setMinimumCourierRatio] = useState('1.5');
  const [minimumPayout, setMinimumPayout] = useState('20000');
  const [maximumPayout, setMaximumPayout] = useState('5000000');
  const [savingDemandSettings, setSavingDemandSettings] = useState(false);
  const [savingWalletCase, setSavingWalletCase] = useState(null);
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
    }
    try {
      const [payoutResult, demandResult, casesResult] = await Promise.all([
        supabase.from('driver_payout_settings')
          .select('minimum_amount_cop, maximum_amount_cop')
          .eq('id', true)
          .maybeSingle(),
        supabase.from('delivery_demand_settings')
          .select('minimum_open_delivery_orders, minimum_courier_ratio')
          .eq('id', true)
          .maybeSingle(),
        supabase.from('business_wallet_transfer_reconciliation_cases')
          .select('id, transfer_id, business_id, reason, observed_wallet_count, status, admin_note, created_at')
          .order('created_at', { ascending: false }),
      ]);
      if (payoutResult.error) throw payoutResult.error;
      if (demandResult.error) throw demandResult.error;
      if (casesResult.error) throw casesResult.error;
      if (payoutResult.data) {
        setMinimumPayout(String(payoutResult.data.minimum_amount_cop));
        setMaximumPayout(String(payoutResult.data.maximum_amount_cop));
      }
      if (demandResult.data) {
        setMinimumOpenDeliveryOrders(String(demandResult.data.minimum_open_delivery_orders));
        setMinimumCourierRatio(String(demandResult.data.minimum_courier_ratio));
      }
      setWalletReconciliationCases(casesResult.data || []);
    } catch (error) {
      Alert.alert('No se pudo cargar la configuración financiera', error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  useEffect(() => {
    let active = true;
    supabase.rpc('admin_driver_withdrawal_exceptions').then(({ data, error }) => {
      if (error) { Alert.alert('No se pudieron cargar excepciones de retiro', error.message); return; }
      if (active) setDriverExceptions(data || []);
    });
    return () => { active = false; };
  }, []);

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

  const reviewDriverException = async (item, status) => {
    const note = (reviewNotes[item.id] || '').trim();
    if (!note) { Alert.alert('Nota requerida', 'Documenta qué verificaste con el banco o la plataforma.'); return; }
    setSavingException(item.id);
    try {
      const { error } = await supabase.rpc('admin_review_driver_withdrawal_exception', {
        p_exception_id: item.id, p_status: status, p_note: note,
      });
      if (error) throw error;
      const { data, error: refreshError } = await supabase.rpc('admin_driver_withdrawal_exceptions');
      if (refreshError) throw refreshError;
      setDriverExceptions(data || []);
    } catch (error) { Alert.alert('No se pudo guardar la revisión', error.message); }
    finally { setSavingException(null); }
  };

  const openEvidence = async (path) => {
    if (path.startsWith('system/')) {
      Alert.alert('Caso automático', 'El payout quedó en revisión porque no había cuenta configurada. El repartidor debe adjuntar capturas y constancia para completar el caso.');
      return;
    }
    const { data, error } = await supabase.storage.from('driver-documents').createSignedUrl(path, 120);
    if (error) Alert.alert('No se pudo abrir la evidencia', error.message);
    else if (data?.signedUrl) await Linking.openURL(data.signedUrl);
  };

  const refreshAll = async () => {
    await load();
    const { data, error } = await supabase.rpc('admin_driver_withdrawal_exceptions');
    if (error) Alert.alert('No se pudieron cargar excepciones de retiro', error.message);
    else setDriverExceptions(data || []);
  };

  const savePayoutSettings = async () => {
    const minimum = Number(minimumPayout);
    const maximum = Number(maximumPayout);
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 20000 || maximum < minimum) {
      Alert.alert('Límites inválidos', 'El mínimo no puede ser menor de $20.000 COP y el máximo debe ser igual o superior.');
      return;
    }
    try {
      const { error } = await supabase.rpc('set_driver_payout_settings', {
        p_minimum_amount_cop: minimum,
        p_maximum_amount_cop: maximum,
        p_supported_methods: ['bank_account'],
      });
      if (error) throw error;
      Alert.alert('Configuración guardada', 'El desembolso automático sigue habilitado solo para cuentas bancarias vía Wompi.');
    } catch (error) {
      Alert.alert('No se pudieron guardar los límites', error.message);
    }
  };

  const saveDemandSettings = async () => {
    const minimumOrders = Number(minimumOpenDeliveryOrders);
    const courierRatio = Number(minimumCourierRatio);
    if (!Number.isInteger(minimumOrders) || minimumOrders < 1 || minimumOrders > 100000
      || !Number.isFinite(courierRatio) || courierRatio <= 0 || courierRatio > 10000) {
      Alert.alert('Umbrales inválidos', 'Indica pedidos enteros entre 1 y 100.000 y una razón de repartidores mayor que 0.');
      return;
    }
    setSavingDemandSettings(true);
    try {
      const { error } = await supabase.rpc('set_delivery_demand_settings', {
        p_minimum_open_delivery_orders: minimumOrders,
        p_minimum_courier_ratio: courierRatio,
      });
      if (error) throw error;
      Alert.alert('Umbrales guardados', 'La sugerencia de pausa usará estos umbrales y la oferta real de repartidores.');
    } catch (error) {
      Alert.alert('No se pudieron guardar los umbrales', error.message);
    } finally {
      setSavingDemandSettings(false);
    }
  };

  const resolveWalletCase = async (item) => {
    const note = (reviewNotes[`wallet-${item.id}`] || item.admin_note || '').trim();
    if (!note) {
      Alert.alert('Nota requerida', 'Documenta la conciliación realizada antes de cerrar el caso.');
      return;
    }
    setSavingWalletCase(item.id);
    try {
      const { error } = await supabase.rpc('admin_resolve_business_wallet_transfer_case', {
        p_case_id: item.id,
        p_note: note,
      });
      if (error) throw error;
      await load();
    } catch (error) {
      Alert.alert('No se pudo resolver el caso de wallet', error.message);
    } finally {
      setSavingWalletCase(null);
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
        <Pressable onPress={refreshAll}><Text style={{ color: colors.primary, fontWeight: '700' }}>Actualizar</Text></Pressable>
      </View>
      <Text style={[styles.note, { color: colors.muted }]}>Los retiros programados son reservas internas; cuando Pagos a Terceros de Wompi está configurado, se envían por la cuenta bancaria registrada. Solo los eventos o la conciliación autenticada de Wompi actualizan el resultado; una nota administrativa no lo cambia.</Text>

      <Text style={[styles.section, { color: colors.text }]}>Excepciones por conciliar</Text>
      <Text style={[styles.note, { color: colors.muted }]}>
        Registrar una revisión no cambia el estado financiero ni reenvía dinero. Confirma el resultado en Wompi antes de cerrar cada caso; solo un evento verificado o la conciliación autenticada del proveedor actualiza el estado final.
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

      <Text style={[styles.section, { color: colors.text }]}>Excepciones de retiro de repartidores</Text>
      {!driverExceptions.length ? <Text style={[styles.note, { color: colors.muted }]}>No hay casos abiertos.</Text> : driverExceptions.map((item) => (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.name, { color: colors.text }]}>{item.driver_name} · {item.reason === 'missing_account' ? 'Cuenta no configurada' : item.reason === 'outside_limits' ? 'Monto fuera de límites' : 'Retiro no recibido'}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{item.withdrawal_id ? `Retiro ${item.withdrawal_id} · ${formatCOP(item.amount_cop)} · ${item.withdrawal_status}` : 'Sin retiro previamente programado'}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{item.verification_provider} · Folio {item.verification_reference}</Text>
          {item.evidence_paths?.map((path) => <Pressable key={path} onPress={() => openEvidence(path)}><Text style={[styles.reviewAction, { color: colors.primary }]}>Abrir evidencia</Text></Pressable>)}
          <TextInput accessibilityLabel="Nota de revisión de retiro" value={reviewNotes[item.id] || ''} onChangeText={(value) => setReviewNotes((current) => ({ ...current, [item.id]: value }))} placeholder="Resultado de la verificación" placeholderTextColor={colors.muted} multiline style={[styles.reviewInput, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} />
          <View style={styles.exceptionActions}>
            <Pressable disabled={savingException === item.id} onPress={() => reviewDriverException(item, 'under_review')}><Text style={[styles.reviewAction, { color: colors.primary }]}>En revisión</Text></Pressable>
            <Pressable disabled={savingException === item.id} onPress={() => reviewDriverException(item, 'resolved')}><Text style={[styles.reviewAction, { color: colors.primary }]}>Resolver</Text></Pressable>
            <Pressable disabled={savingException === item.id} onPress={() => reviewDriverException(item, 'rejected')}><Text style={[styles.reviewAction, { color: '#B3261E' }]}>Rechazar</Text></Pressable>
          </View>
        </View>
      ))}

      <Text style={[styles.section, { color: colors.text }]}>Billeteras y ventas de negocios</Text>
      {(summary?.businesses || []).map((item) => (
        <View key={item.business_id} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.name, { color: colors.text }]}>{item.store_name}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{item.owner_name || 'Titular sin nombre'}</Text>
          <Text style={[styles.meta, { color: colors.text }]}>Billetera: {formatCOP(item.wallet_balance)}</Text>
          <Text style={[styles.meta, { color: colors.text }]}>Ventas netas: {formatCOP(item.sales_net)}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{item.pro_active ? 'Suscripción activa Pro · $50.000 COP/mes' : `Comisión estimada (10%): ${formatCOP(item.commission_10_percent)}`}</Text>
        </View>
      ))}

      <Text style={[styles.section, { color: colors.text }]}>Conciliación de billeteras de negocio</Text>
      {!walletReconciliationCases.length
        ? <Text style={[styles.note, { color: colors.muted }]}>No hay casos de wallets pendientes de conciliación.</Text>
        : walletReconciliationCases.map((item) => (
          <View key={item.id} style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.name, { color: colors.text }]}>
              {item.reason === 'duplicate_wallets' ? 'Wallets duplicadas' : 'Wallet faltante'} · {item.status}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Negocio {item.business_id} · {item.observed_wallet_count} wallet(s)
              {item.transfer_id ? ` · Transferencia ${item.transfer_id}` : ''}
            </Text>
            <TextInput
              accessibilityLabel="Nota de conciliación de wallet"
              value={reviewNotes[`wallet-${item.id}`] ?? item.admin_note ?? ''}
              onChangeText={(value) => setReviewNotes((current) => ({
                ...current,
                [`wallet-${item.id}`]: value,
              }))}
              placeholder="Describe cómo se corrigió la wallet duplicada o faltante"
              placeholderTextColor={colors.muted}
              multiline
              editable={item.status !== 'resolved'}
              style={[styles.reviewInput, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            />
            {item.status !== 'resolved' ? (
              <Pressable disabled={savingWalletCase === item.id} onPress={() => resolveWalletCase(item)}>
                <Text style={[styles.reviewAction, { color: colors.primary }]}>
                  {savingWalletCase === item.id ? 'Guardando...' : 'Resolver tras corregir la wallet'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}

      <Text style={[styles.section, { color: colors.text }]}>Umbrales de demanda de domicilios</Text>
      <Text style={[styles.note, { color: colors.muted }]}>
        Se recomienda pausar pedidos nuevos cuando se alcance el mínimo de pedidos abiertos y la razón pedidos/repartidor configurada.
      </Text>
      <TextInput
        accessibilityLabel="Mínimo de pedidos abiertos para alta demanda"
        value={minimumOpenDeliveryOrders}
        onChangeText={(value) => setMinimumOpenDeliveryOrders(value.replace(/\D/g, ''))}
        keyboardType="number-pad"
        placeholder="Mínimo de pedidos abiertos"
        style={[styles.reviewInput, { color: colors.text, borderColor: colors.border }]}
      />
      <TextInput
        accessibilityLabel="Razón mínima de pedidos por repartidor"
        value={minimumCourierRatio}
        onChangeText={setMinimumCourierRatio}
        keyboardType="decimal-pad"
        placeholder="Pedidos abiertos por repartidor"
        style={[styles.reviewInput, { color: colors.text, borderColor: colors.border }]}
      />
      <AnimatedButton
        title={savingDemandSettings ? 'Guardando umbrales...' : 'Guardar umbrales de demanda'}
        onPress={saveDemandSettings}
        disabled={savingDemandSettings}
        variant="secondary"
      />

      <Text style={[styles.section, { color: colors.text }]}>Saldo de repartidores</Text>
      {(summary?.drivers || []).map((item) => (
        <View key={item.driver_id} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.name, { color: colors.text }]}>{item.full_name || 'Repartidor sin nombre'}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>Ganado: {formatCOP(item.earned)} · Retirado: {formatCOP(item.withdrawn)}</Text>
          <Text style={[styles.balance, { color: colors.primary }]}>Disponible: {formatCOP(item.available_balance)}</Text>
        </View>
      ))}

      <Text style={[styles.section, { color: colors.text }]}>Programados y en proceso · umbral $20.000 COP · ciclo 3:00 a. m. Bogotá</Text>
      <Text style={[styles.note, { color: colors.muted }]}>Límites configurables para nuevos retiros programados. Los métodos alternativos se habilitarán cuando exista una integración de desembolso comprobada.</Text>
      <TextInput value={minimumPayout} onChangeText={(value) => setMinimumPayout(value.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Monto mínimo COP" style={[styles.reviewInput, { color: colors.text, borderColor: colors.border }]} />
      <TextInput value={maximumPayout} onChangeText={(value) => setMaximumPayout(value.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Monto máximo COP" style={[styles.reviewInput, { color: colors.text, borderColor: colors.border }]} />
      <AnimatedButton title="Guardar límites de retiros" onPress={savePayoutSettings} variant="secondary" />
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
