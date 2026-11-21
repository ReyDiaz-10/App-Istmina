import { AppText as Text } from './AppText.js';
import React, { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../api/supabaseClient';
import { useAppTheme } from '../hooks/useAppTheme';
import AnimatedButton from './AnimatedButton';

export default function DriverWithdrawalExceptionCard({ withdrawals = [], openExceptions = [], onSubmitted }) {
  const { colors } = useAppTheme();
  const [selectedWithdrawal, setSelectedWithdrawal] = useState(withdrawals[0]?.id || null);
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [verificationProvider, setVerificationProvider] = useState('');
  const [verificationReference, setVerificationReference] = useState('');
  const [accountMissing, setAccountMissing] = useState(false);
  const [selectedOpenException, setSelectedOpenException] = useState(null);

  const addEvidence = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5, quality: 0.8,
    });
    if (result.canceled) return;
    setImages((current) => [...current, ...result.assets].slice(0, 5));
  };

  const submit = async () => {
    if (!images.length || !verificationProvider.trim() || !verificationReference.trim()) {
      Alert.alert('Faltan datos', 'Adjunta capturas y registra el banco o plataforma y el folio de verificación.');
      return;
    }
    setSubmitting(true);
    const paths = [];
    let submitted = false;
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult?.user?.id) throw new Error('Debes iniciar sesión para enviar el caso.');
      for (const image of images) {
        const response = await fetch(image.uri);
        const blob = await response.blob();
        const extension = image.fileName?.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
        const path = `${userResult.user.id}/withdrawal-exceptions/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { error } = await supabase.storage.from('driver-documents').upload(path, blob, {
          contentType: image.mimeType || 'image/jpeg', upsert: false,
        });
        if (error) throw error;
        paths.push(path);
      }
      const { error } = await supabase.rpc('submit_driver_withdrawal_exception', {
        p_withdrawal_id: accountMissing ? null : (selectedOpenException?.withdrawal_id || selectedWithdrawal),
        p_reason: accountMissing ? 'missing_account' : selectedOpenException?.reason || 'not_received',
        p_evidence_urls: paths,
        p_verification_provider: verificationProvider.trim(),
        p_verification_reference: verificationReference.trim(),
      });
      if (error) throw error;
      submitted = true;
      setImages([]);
      setVerificationProvider('');
      setVerificationReference('');
      setSelectedOpenException(null);
      Alert.alert('Caso enviado', 'El retiro permanece trazable y quedó pendiente de revisión administrativa.');
      onSubmitted?.();
    } catch (error) {
      if (paths.length && !submitted) {
        const { error: cleanupError } = await supabase.storage.from('driver-documents').remove(paths);
        if (cleanupError) console.error('No se pudieron limpiar evidencias huérfanas:', cleanupError.message);
      }
      Alert.alert('No se pudo enviar el caso', error.message || 'Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>¿No tienes cuenta configurada o no recibiste un retiro?</Text>
      <Text style={[styles.copy, { color: colors.muted }]}>Adjunta capturas del movimiento y la constancia de verificación con tu banco o plataforma. El caso se envía a revisión; no confirma por sí solo un pago.</Text>
      <AnimatedButton title={accountMissing ? 'Reportar cuenta no configurada' : 'Reportar retiro no recibido'} variant="secondary" onPress={() => { setAccountMissing((value) => !value); setSelectedOpenException(null); }} disabled={submitting} />
      {!accountMissing ? withdrawals.filter((withdrawal) => ['scheduled', 'processing', 'paid', 'failed'].includes(withdrawal.status)).map((withdrawal) => (
        <AnimatedButton key={withdrawal.id} title={`${selectedWithdrawal === withdrawal.id && !selectedOpenException ? '✓ ' : ''}Retiro ${withdrawal.id.slice(0, 8)} · ${withdrawal.status}`} variant="secondary" onPress={() => { setSelectedOpenException(null); setSelectedWithdrawal(withdrawal.id); }} disabled={submitting} />
      )) : null}
      {!accountMissing ? openExceptions.map((exception) => (
        <View key={exception.id}>
          <AnimatedButton title={`${selectedOpenException?.id === exception.id ? '✓ ' : ''}Completar caso ${exception.reason === 'missing_account' ? 'de cuenta' : exception.reason === 'outside_limits' ? 'de límite' : 'de retiro'} · ${exception.withdrawal_id?.slice(0, 8) || 'sin retiro'}`} variant="secondary" onPress={() => { setSelectedOpenException(exception); setSelectedWithdrawal(exception.withdrawal_id); }} disabled={submitting} />
          <Text style={[styles.copy, { color: colors.muted }]}>
            {exception.status} · {exception.verification_provider || 'Pendiente de verificación'}
            {exception.verification_reference ? ` · Folio ${exception.verification_reference}` : ''}
          </Text>
        </View>
      )) : null}
      <TextInput value={verificationProvider} onChangeText={setVerificationProvider} placeholder="Banco o plataforma contactada" style={styles.input} />
      <TextInput value={verificationReference} onChangeText={setVerificationReference} placeholder="Folio de atención o referencia de verificación" style={styles.input} />
      <Text style={[styles.copy, { color: colors.muted }]}>{images.length} de 5 capturas seleccionadas</Text>
      <AnimatedButton title="Adjuntar capturas" variant="secondary" onPress={addEvidence} disabled={submitting} />
      <AnimatedButton title={submitting ? 'Enviando caso...' : 'Enviar a revisión administrativa'} onPress={submit} disabled={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 18, gap: 8 },
  input: { borderWidth: 1, borderColor: '#B0B7C3', borderRadius: 8, padding: 10 },
  title: { fontWeight: '800', fontSize: 15 },
  copy: { fontSize: 12, lineHeight: 18 },
});
