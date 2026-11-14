import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../api/supabaseClient';
import { useAppTheme } from '../hooks/useAppTheme';
import AnimatedButton from './AnimatedButton';

export default function PayoutAccountCard({ account, onSaved }) {
  const { colors } = useAppTheme();
  const [banks, setBanks] = useState([]);
  const [bank, setBank] = useState(null);
  const [accountType, setAccountType] = useState('AHORROS');
  const [accountNumber, setAccountNumber] = useState('');
  const [documentType, setDocumentType] = useState('CC');
  const [documentNumber, setDocumentNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(!account);
  useEffect(() => {
    supabase.functions.invoke('payout-banks').then(({ data, error }) => {
      if (!error && data?.banks) setBanks(data.banks);
    });
  }, []);
  const save = async () => {
    if (!bank || !accountNumber || !documentNumber) return Alert.alert('Faltan datos', 'Selecciona un banco e ingresa tu cuenta y documento.');
    setSaving(true);
    const { error } = await supabase.rpc('save_driver_payout_account', { p_bank_id: String(bank.id), p_bank_name: String(bank.name), p_account_type: accountType, p_account_number: accountNumber, p_legal_id_type: documentType, p_legal_id: documentNumber });
    setSaving(false);
    if (error) return Alert.alert('No se pudo guardar', error.message);
    setAccountNumber(''); setDocumentNumber(''); setShowForm(false); onSaved?.();
    Alert.alert('Cuenta guardada', 'Los datos bancarios quedaron cifrados y solo se muestra su terminación.');
  };
  const fieldStyle = [styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.input }];
  return (
    <View style={[styles.box, { borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Cuenta para recibir retiros</Text>
      {!showForm && account ? <>
        <Text style={[styles.copy, { color: colors.muted }]}>{account.bank_name} · {account.account_type} ···· {account.account_number_last4}</Text>
        <AnimatedButton title="Actualizar cuenta" variant="secondary" onPress={() => setShowForm(true)} />
      </> : <>
        {banks.length ? <>
          <Text style={[styles.hint, { color: colors.muted }]}>Bancos disponibles (toca para elegir)</Text>
          <View style={styles.bankList}>{banks.map((item) => <Text key={item.id} onPress={() => setBank(item)} style={[styles.bank, { color: colors.text, borderColor: bank?.id === item.id ? colors.primary : colors.border }]}>{item.name}</Text>)}</View>
        </> : <ActivityIndicator color={colors.primary} />}
        <TextInput value={accountNumber} onChangeText={setAccountNumber} placeholder="Número de cuenta" placeholderTextColor={colors.muted} keyboardType="number-pad" secureTextEntry style={fieldStyle} />
        <View style={styles.inline}>{['AHORROS', 'CORRIENTE'].map((value) => <Text key={value} onPress={() => setAccountType(value)} style={[styles.choice, { color: colors.text, borderColor: accountType === value ? colors.primary : colors.border }]}>{value}</Text>)}</View>
        <View style={styles.inline}>{['CC', 'CE', 'NIT'].map((value) => <Text key={value} onPress={() => setDocumentType(value)} style={[styles.choice, { color: colors.text, borderColor: documentType === value ? colors.primary : colors.border }]}>{value}</Text>)}</View>
        <TextInput value={documentNumber} onChangeText={setDocumentNumber} placeholder="Número de documento" placeholderTextColor={colors.muted} keyboardType="number-pad" secureTextEntry style={fieldStyle} />
        <Text style={[styles.hint, { color: colors.muted }]}>Tus datos se cifran; nunca mostramos el número completo. Nequi se recibe mediante el banco y tipo de cuenta que Wompi habilite.</Text>
        <AnimatedButton title={saving ? 'Guardando…' : 'Guardar cuenta'} onPress={save} disabled={saving} />
        {account ? <AnimatedButton title="Cancelar" variant="secondary" onPress={() => setShowForm(false)} /> : null}
      </>}
    </View>
  );
}

const styles = StyleSheet.create({ box: { marginTop: 18, padding: 14, borderWidth: 1, borderRadius: 14 }, title: { fontSize: 15, fontWeight: '800' }, copy: { marginTop: 8, marginBottom: 8 }, hint: { fontSize: 12, lineHeight: 17, marginTop: 8, marginBottom: 8 }, input: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, marginTop: 10 }, bankList: { maxHeight: 130, flexDirection: 'row', flexWrap: 'wrap', overflow: 'scroll', gap: 6 }, bank: { borderWidth: 1, borderRadius: 9, padding: 8, fontSize: 12 }, inline: { flexDirection: 'row', gap: 8, marginTop: 8 }, choice: { borderWidth: 1, borderRadius: 8, padding: 9, fontSize: 12 } });
