import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../../components/AppText.js';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAuthStore } from '../../store/authStore';
import AnimatedButton from '../../components/AnimatedButton';
import { getEmailPreferences } from '../../services/notifications';
import { createControlReportDownloadUrl, listControlReports, processControlReport, requestControlReport } from '../../services/controlReports';

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
  const [emailRequested, setEmailRequested] = useState(false);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openingId, setOpeningId] = useState(null);
  const [retryingId, setRetryingId] = useState(null);
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

  const create = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
      Alert.alert('Rango no válido', 'Usa fechas AAAA-MM-DD y asegúrate de que la fecha final no sea anterior.');
      return;
    }
    if (emailRequested && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert('Correo requerido', 'Indica un correo administrativo válido para recibir el enlace del PDF.');
      return;
    }
    setCreating(true);
    try {
      const { result } = await requestControlReport({ start, end, emailRequested, email: email.trim() });
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
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: emailRequested }} onPress={() => setEmailRequested((value) => !value)} style={styles.checkRow}>
          <Text style={[styles.check, { color: colors.primary }]}>{emailRequested ? '☑' : '☐'}</Text>
          <Text style={[styles.label, { color: colors.text }]}>Enviar enlace de descarga al correo administrativo</Text>
        </Pressable>
        {emailRequested ? <TextInput accessibilityLabel="Correo administrativo del informe" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="admin@ejemplo.com" placeholderTextColor={colors.muted} style={fieldStyle} /> : null}
        <AnimatedButton title={creating ? 'Generando PDF…' : 'Generar informe PDF'} onPress={create} disabled={creating} variant="secondary" />
        <Text style={[styles.smallNote, { color: colors.muted }]}>Incluye comparativa, pedidos por estado, horas pico, conciliación Wompi, liquidaciones netas registradas y alertas de calidad de datos. No estima costos que la plataforma no registra.</Text>
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
          {report.ai_summary ? <Text style={[styles.note, { color: colors.text }]}>{report.ai_summary}</Text> : null}
          {report.error_code ? <Text style={[styles.smallNote, { color: '#B3261E' }]}>Detalle: {report.error_code}</Text> : null}
          {report.email_error ? <Text style={[styles.smallNote, { color: '#B65C00' }]}>PDF listo, correo no enviado: {report.email_error}</Text> : null}
          {report.status === 'processing' ? (
            <Pressable disabled={retryingId === report.id} onPress={() => void retryReport(report.id)}>
              <Text style={[styles.action, { color: colors.primary }]}>{retryingId === report.id ? 'Reintentando…' : 'Reintentar informe'}</Text>
            </Pressable>
          ) : null}
          {report.status === 'ready' ? <Pressable disabled={openingId === report.id} onPress={() => void openPdf(report.id)}><Text style={[styles.action, { color: colors.primary }]}>{openingId === report.id ? 'Abriendo PDF…' : 'Descargar PDF'}</Text></Pressable> : null}
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
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }, check: { fontSize: 21 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  report: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 10 }, reportHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  reportTitle: { flex: 1, fontWeight: '700' }, status: { fontWeight: '800' }, action: { fontWeight: '800', textAlign: 'right', paddingTop: 10 }, error: { marginTop: 8 },
});
