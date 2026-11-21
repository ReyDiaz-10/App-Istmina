import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { formatCOP } from '../../utils/formatters';
import { createIdempotencyKey } from '../../services/orders';

export default function BusinessWalletTransfersScreen({ navigation }) {
  const { colors } = useAppTheme();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [transfers, setTransfers] = useState([]);
  const [businessId, setBusinessId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult?.user?.id) throw new Error('Debes iniciar sesión para consultar transferencias.');
      const { data: business, error: businessError } = await supabase.from('businesses')
        .select('id')
        .eq('profile_id', userResult.user.id)
        .single();
      if (businessError) throw businessError;
      const { data, error } = await supabase.from('business_wallet_transfers')
        .select('id, sender_business_id, recipient_business_id, amount_cop, status, created_at')
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      setBusinessId(business.id);
      setTransfers(data || []);
    } catch (error) {
      Alert.alert('No se pudieron cargar transferencias', error.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initialLoad = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const propose = async () => {
    const recipientId = recipient.trim();
    const amountValue = Number(amount);
    if (!recipientId || !Number.isFinite(amountValue) || amountValue <= 0) {
      Alert.alert('Revisa los datos', 'Ingresa el ID del negocio receptor y un monto válido.');
      return;
    }
    setSaving(true);
    try {
      const key = idempotencyKey || createIdempotencyKey();
      setIdempotencyKey(key);
      const { error } = await supabase.rpc('propose_business_wallet_transfer', {
        p_recipient_business_id: recipientId,
        p_amount_cop: amountValue,
        p_idempotency_key: key,
      });
      if (error) throw error;
      setRecipient(''); setAmount(''); setIdempotencyKey(null);
      Alert.alert('Solicitud enviada', 'El saldo no se mueve hasta que el otro negocio acepte.');
      await load();
    } catch (error) {
      Alert.alert('No se pudo enviar', error.message || 'Revisa la conexión e inténtalo de nuevo.');
    } finally { setSaving(false); }
  };

  const respond = async (id, accept) => {
    try {
      const { error } = await supabase.rpc('respond_business_wallet_transfer', {
        p_transfer_id: id, p_accept: accept,
      });
      if (error) throw error;
      await load();
    } catch (error) { Alert.alert('No se pudo actualizar la transferencia', error.message); }
  };

  const cancel = async (id) => {
    try {
      const { error } = await supabase.rpc('cancel_business_wallet_transfer', {
        p_transfer_id: id,
      });
      if (error) throw error;
      await load();
    } catch (error) {
      Alert.alert('No se pudo cancelar la propuesta', error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}><AnimatedButton variant="back" navigation={navigation} /><Text style={[styles.title, { color: colors.text }]}>Transferir saldo prepago</Text></View>
      <Text style={[styles.note, { color: colors.muted }]}>El saldo de billetera es prepago para comisiones. No se devuelve en efectivo; una transferencia solo se aplica cuando el negocio receptor la acepta.</Text>
      <TextInput value={recipient} onChangeText={(value) => { setRecipient(value); setIdempotencyKey(null); }} placeholder="ID del negocio receptor" style={styles.input} autoCapitalize="none" />
      <TextInput value={amount} onChangeText={(value) => { setAmount(value.replace(/[^\d.]/g, '')); setIdempotencyKey(null); }} placeholder="Monto COP" keyboardType="decimal-pad" style={styles.input} />
      <AnimatedButton title={saving ? 'Enviando...' : 'Solicitar transferencia'} onPress={propose} disabled={saving} />
      <Text style={[styles.section, { color: colors.text }]}>Solicitudes</Text>
      {loading ? <ActivityIndicator color={colors.primary} /> : transfers.map((item) => (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{formatCOP(item.amount_cop)} · {item.status}</Text>
          <Text style={[styles.note, { color: colors.muted }]}>ID {item.id}</Text>
          <Text style={[styles.note, { color: colors.muted }]}>
            {item.sender_business_id === businessId ? 'Propuesta enviada' : 'Propuesta recibida'}
          </Text>
          {item.status === 'pending' && item.recipient_business_id === businessId ? <View style={styles.actions}>
            <AnimatedButton title="Aceptar" onPress={() => respond(item.id, true)} />
            <AnimatedButton title="Rechazar" variant="secondary" onPress={() => respond(item.id, false)} />
          </View> : null}
          {item.status === 'pending' && item.sender_business_id === businessId ? (
            <AnimatedButton title="Cancelar propuesta" variant="secondary" onPress={() => cancel(item.id)} />
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 18, gap: 10 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '800' }, note: { fontSize: 13, lineHeight: 19 }, input: { borderWidth: 1, borderColor: '#AAB2BF', borderRadius: 9, padding: 12 },
  section: { fontSize: 18, fontWeight: '800', marginTop: 14 }, card: { borderRadius: 12, padding: 12 }, actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
});
