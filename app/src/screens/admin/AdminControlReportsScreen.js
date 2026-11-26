import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../../components/AppText.js';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAuthStore } from '../../store/authStore';
import AnimatedButton from '../../components/AnimatedButton';
import { getEmailPreferences } from '../../services/notifications';
import { createControlReportDownloadUrl, listControlReports, processControlReport, requestControlReport, retryControlReportAI, sendControlReportEmail } from '../../services/controlReports';

const bogotaDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const statusLabel = {
  queued: 'En cola', processing: 'Procesando', ready: 'Listo', error: 'Con error',
};

export default function AdminControlReportsScreen({ navigation }) {
  const { colors } = useAppTheme();
  const profile = useAuthStore((state) => state.profile);
  const [start, setStart] = useState(bogotaDate());
  const [end, setEnd] = useState(bogotaDate());
  const [email, setEmail] = useState('');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openingId, setOpeningId] = useState(null);
  const [retryingId, setRetryingId] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [retryingAiId, setRetryingAiId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setReports(await listControlReports()); }
    catch (loadError) { setError(loadError.message || 'No se pudieron cargar los informes.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!profile?.id) return;
    getEmailPreferences(profile.id).then((value) => setEmail(value.email || '')).catch(() => {});
  }, [profile?.id]);

  useEffect(() => {
    if (!reports.some((report) => report.status === 'ready' && report.error_code === 'gemini_pending')) return undefined;
    const timer = setInterval(() => { listControlReports().then(setReports).catch(() => {}); }, 8000);
    return () => clearInterval(timer);
  }, [reports]);

  const create = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
      Alert.alert('Rango no válido', 'Usa fechas AAAA-MM-DD y asegúrate de que la fecha final no sea anterior.');
      return;
    }
    setCreating(true);
    try {
      const { result } = await requestControlReport({ start, end });
      await load();
      if (result?.status === 'error') Alert.alert('Informe con error', result.error || 'Revisa los detalles del informe.');
      else if (result?.email_error) Alert.alert('PDF listo; correo pendiente', result.email_error);
    } catch (createError) {
      await load();
      Alert.alert('No se pudo generar el informe', createError.message || 'Inténtalo nuevamente.');
    } finally { setCreating(false); }
  };

  const openPdf = async (jobId) => {
    setOpeningId(jobId);
    try {
      const url = await createControlReportDownloadUrl(jobId);
      await Linking.openURL(url);
    } catch (openError) { Alert.alert('No se pudo abrir el PDF', openError.message); }
    finally { setOpeningId(null); }
  };

  const retryReport = async (jobId) => {
    setRetryingId(jobId);
    try {
      const result = await processControlReport(jobId);
      await load();
      if (result?.status === 'error') Alert.alert('Informe con error', result.error || 'Revisa los detalles del informe.');
      else if (result?.status === 'processing') Alert.alert('Informe en proceso', 'Si lleva menos de 15 minutos, la cola aún lo considera activo. Si continúa atascado, espera y vuelve a intentar este mismo informe.');
    } catch (retryError) {
      await load();
      Alert.alert('No se pudo reintentar el informe', retryError.message || 'Revisa los logs de control-istmiya-reports.');
    } finally { setRetryingId(null); }
  };

  const sendReport = async (jobId) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert('Correo requerido', 'Ingresa un correo válido para recibir el enlace del PDF.');
      return;
    }
    setSendingId(jobId);
    try {
      await sendControlReportEmail(jobId, email.trim());
      await load();
      Alert.alert('Correo enviado', 'El enlace seguro de descarga se envió correctamente.');
    } catch (sendError) {
      await load();
      Alert.alert('No se pudo enviar', sendError.message || 'Revisa la configuración de correo y vuelve a intentar.');
    } finally { setSendingId(null); }
  };

  const retryAi = async (jobId) => {
    setRetryingAiId(jobId);
    try {
      await retryControlReportAI(jobId);
      await load();
    } catch (retryError) {
      Alert.alert('No se pudo reintentar Gemini', retryError.message || 'Inténtalo nuevamente más tarde.');
    } finally { setRetryingAiId(null); }
  };

  const fieldStyle = [styles.input, { color: colors.text, backgroundColor: colors.input, borderColor: colors.border }];
  return (
    <ScrollView style={[styles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text style={[styles.title, { color: colors.text }]}>Control IstmiYa</Text>
      </View>
      <Text style={[styles.note, { color: colors.muted }]}>Informes operativos y financieros calculados en PostgreSQL. Las fechas usan la zona horaria America/Bogota.</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.section, { color: colors.text }]}>Solicitar informe</Text>
        <Text style={[styles.label, { color: colors.muted }]}>Fecha inicial (AAAA-MM-DD)</Text>
        <TextInput accessibilityLabel="Fecha inicial del informe" value={start} onChangeText={setStart} placeholder="2026-11-01" placeholderTextColor={colors.muted} style={fieldStyle} />
        <Text style={[styles.label, { color: colors.muted }]}>Fecha final (AAAA-MM-DD)</Text>
        <TextInput accessibilityLabel="Fecha final del informe" value={end} onChangeText={setEnd} placeholder="2026-11-22" placeholderTextColor={colors.muted} style={fieldStyle} />
        <AnimatedButton title={creating ? 'Generando PDF…' : 'Generar informe PDF'} onPress={create} disabled={creating} variant="secondary" />
        <Text style={[styles.smallNote, { color: colors.muted }]}>Primero genera el PDF con métricas calculadas en PostgreSQL. El resumen IA se completa en segundo plano y el envío se habilita al quedar listo.</Text>
      </View>

      <View style={styles.listHeader}>
        <Text style={[styles.section, { color: colors.text }]}>Historial de informes</Text>
        <Pressable onPress={load}><Text style={{ color: colors.primary, fontWeight: '700' }}>Actualizar</Text></Pressable>
      </View>
      {loading ? <ActivityIndicator color={colors.primary} /> : error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger || '#B3261E' }]}>{error}</Text> : reports.length === 0 ? <Text style={[styles.note, { color: colors.muted }]}>Aún no hay informes.</Text> : reports.map((report) => (
        <View key={report.id} style={[styles.report, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.reportHeader}>
            <Text style={[styles.reportTitle, { color: colors.text }]}>{report.report_kind === 'daily' ? 'Informe diario' : 'Informe solicitado'} · {report.period_start} a {report.period_end}</Text>
            <Text style={[styles.status, { color: report.status === 'ready' ? '#16804A' : report.status === 'error' ? '#B3261E' : '#B65C00' }]}>{statusLabel[report.status] || report.status}</Text>
          </View>
          {report.ai_summary ? <Text style={[styles.note, { color: colors.text }]}>{report.ai_summary}</Text> : report.error_code === 'gemini_pending' ? <Text style={[styles.smallNote, { color: colors.muted }]}>PDF listo; preparando el resumen de Gemini…</Text> : null}
          {report.error_code === 'gemini_pending' && Date.now() - new Date(report.completed_at || report.created_at).getTime() > 120000 ? (
            <Pressable disabled={retryingAiId === report.id} onPress={() => void retryAi(report.id)}>
              <Text style={[styles.action, { color: colors.primary }]}>{retryingAiId === report.id ? 'Reintentando resumen…' : 'Reintentar resumen IA'}</Text>
            </Pressable>
          ) : null}
          {report.error_code && report.error_code.startsWith('gemini_') && report.error_code !== 'gemini_pending' ? (
            <View>
              <Text style={[styles.smallNote, { color: '#B65C00' }]}>El PDF está listo; Gemini no pudo completar el resumen ahora. Puedes volver a intentarlo.</Text>
              <Pressable disabled={retryingAiId === report.id} onPress={() => void retryAi(report.id)}>
                <Text style={[styles.action, { color: colors.primary }]}>{retryingAiId === report.id ? 'Reintentando resumen…' : 'Reintentar resumen IA'}</Text>
              </Pressable>
            </View>
          ) : report.error_code && report.error_code !== 'gemini_pending' ? <Text style={[styles.smallNote, { color: '#B3261E' }]}>Detalle: {report.error_code}</Text> : null}
          {report.email_error ? <Text style={[styles.smallNote, { color: '#B65C00' }]}>PDF listo, correo no enviado: {report.email_error}</Text> : null}
          {report.status === 'processing' ? (
            <Pressable disabled={retryingId === report.id} onPress={() => void retryReport(report.id)}>
              <Text style={[styles.action, { color: colors.primary }]}>{retryingId === report.id ? 'Reintentando…' : 'Reintentar informe'}</Text>
            </Pressable>
          ) : null}
          {report.status === 'ready' ? (
            <View>
              {report.email_sent_at ? <Text style={[styles.smallNote, { color: '#16804A' }]}>Correo enviado a {report.email_to || 'la dirección configurada'}.</Text> : (
                <View style={styles.emailActions}>
                  <TextInput accessibilityLabel="Correo destinatario del informe" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="admin@ejemplo.com" placeholderTextColor={colors.muted} style={[fieldStyle, styles.emailInput]} />
                  <Pressable disabled={sendingId === report.id} onPress={() => void sendReport(report.id)}>
                    <Text style={[styles.action, { color: colors.primary }]}>{sendingId === report.id ? 'Enviando…' : 'Enviar enlace por correo'}</Text>
                  </Pressable>
                </View>
              )}
              <Pressable disabled={openingId === report.id} onPress={() => void openPdf(report.id)}><Text style={[styles.action, { color: colors.primary }]}>{openingId === report.id ? 'Abriendo PDF…' : 'Descargar PDF'}</Text></Pressable>
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 }, container: { padding: 18, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 }, title: { fontSize: 25, fontWeight: '800' },
  note: { fontSize: 13, lineHeight: 19, marginTop: 8 }, smallNote: { fontSize: 12, lineHeight: 17, marginTop: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 18 }, section: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 9 }, input: { borderWidth: 1, borderRadius: 9, padding: 12, marginTop: 6, minHeight: 44 },
  emailActions: { marginTop: 10 }, emailInput: { marginTop: 4 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  report: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 10 }, reportHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  reportTitle: { flex: 1, fontWeight: '700' }, status: { fontWeight: '800' }, action: { fontWeight: '800', textAlign: 'right', paddingTop: 10 }, error: { marginTop: 8 },
});
