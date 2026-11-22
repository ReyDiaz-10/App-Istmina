import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../api/supabaseClient';
import { useAppTheme } from '../../hooks/useAppTheme';
import { getDriverDocumentUrl, getProfilePhotoUrl } from '../../services/onboardingMedia';

const Metric = ({ label, value, colors }) => (
  <View style={[styles.metric, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <Text style={[styles.metricValue, { color: colors.primary }]}>{value}</Text>
    <Text style={[styles.muted, { color: colors.muted }]}>{label}</Text>
  </View>
);

const prettyStatus = (value) => String(value || 'Sin estado').replaceAll('_', ' ');

export default function AdminUserDetailsScreen({ navigation, route }) {
  const profileId = route?.params?.profileId;
  const { colors } = useAppTheme();
  const [profile, setProfile] = useState(null);
  const [entity, setEntity] = useState(null);
  const [verification, setVerification] = useState(null);
  const [documentUrls, setDocumentUrls] = useState({ face: null, plate: null, identity: null });
  const [documentError, setDocumentError] = useState('');
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState({ total: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [reason, setReason] = useState('');
  const [blockDays, setBlockDays] = useState(7);
  const [saving, setSaving] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const loadDetails = useCallback(async () => {
    if (!profileId) {
      setError('No se recibió el perfil que se debe consultar.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id,full_name,nickname,phone,avatar_url,role,status,created_at,account_blocked_until,account_status_reason,account_deactivated_at')
        .eq('id', profileId)
        .single();
      if (profileError) throw profileError;
      setProfile(profileData);

      let ownerType;
      let ownerId;
      let entityData = null;
      let verificationData = null;
      if (profileData.role === 'negocio') {
        const { data, error: entityError } = await supabase
          .from('businesses')
          .select('id,store_name,address,status,created_at,store_image_url')
          .eq('profile_id', profileId)
          .maybeSingle();
        if (entityError) throw entityError;
        entityData = data;
        ownerType = 'business_id';
        ownerId = data?.id;
        if (data?.id) {
          const { data: verifyData, error: verifyError } = await supabase
            .from('business_verifications')
            .select('verification_status,legal_name,registration_id_type,registration_id,complaint_email,review_note,reviewed_at')
            .eq('business_id', data.id)
            .maybeSingle();
          if (verifyError) throw verifyError;
          verificationData = verifyData;
        }
      } else if (profileData.role === 'repartidor') {
        const { data, error: entityError } = await supabase
          .from('drivers')
          .select('id,vehicle_type,plate_number,is_available,verification_status,created_at')
          .eq('profile_id', profileId)
          .maybeSingle();
        if (entityError) throw entityError;
        entityData = data;
        ownerType = 'driver_id';
        ownerId = data?.id;
        if (data?.id) {
          const { data: verifyData, error: verifyError } = await supabase
            .from('driver_verifications')
            .select('verification_status,review_note,reviewed_at,plate_photo_path,identity_document_path,face_photo_attested')
            .eq('driver_id', data.id)
            .maybeSingle();
          if (verifyError) throw verifyError;
          verificationData = verifyData;
        }
      } else {
        ownerType = 'client_id';
        ownerId = profileId;
      }
      setEntity(entityData);
      setVerification(verificationData);
      setDocumentUrls({ face: null, plate: null, identity: null });
      setDocumentError('');
      if (profileData.role === 'repartidor' && verificationData) {
        const [faceResult, plateResult, identityResult] = await Promise.allSettled([
          getProfilePhotoUrl(profileData.avatar_url),
          getDriverDocumentUrl(verificationData.plate_photo_path),
          getDriverDocumentUrl(verificationData.identity_document_path),
        ]);
        const urls = {
          face: faceResult.status === 'fulfilled' ? faceResult.value : null,
          plate: plateResult.status === 'fulfilled' ? plateResult.value : null,
          identity: identityResult.status === 'fulfilled' ? identityResult.value : null,
        };
        setDocumentUrls(urls);
        if (faceResult.status === 'rejected' || plateResult.status === 'rejected' || identityResult.status === 'rejected') {
          setDocumentError('No se pudieron abrir todos los documentos del perfil.');
        }
      }

      const makeOrderQuery = (completedOnly = false, countOnly = false) => {
        let query = supabase.from('orders').select(
          countOnly ? 'id' : 'id,order_number,status,total_amount,created_at,business_id,client_id,delivery_address',
          countOnly ? { count: 'exact', head: true } : undefined,
        );
        if (ownerId) query = query.eq(ownerType, ownerId);
        else return null;
        if (completedOnly) query = query.eq('status', 'entregado');
        if (!countOnly) query = query.order('created_at', { ascending: false }).limit(100);
        return query;
      };
      const totalQuery = makeOrderQuery(false, true);
      const completedQuery = makeOrderQuery(true, true);
      const historyQuery = makeOrderQuery(false, false);
      const results = await Promise.all([
        totalQuery || Promise.resolve({ count: 0, error: null }),
        completedQuery || Promise.resolve({ count: 0, error: null }),
        historyQuery || Promise.resolve({ data: [], error: null }),
      ]);
      for (const result of results) if (result.error) throw result.error;
      const [totalResult, completedResult, historyResult] = results;
      const rows = historyResult.data || [];

      const businessIds = [...new Set(rows.map((row) => row.business_id).filter(Boolean))];
      const clientIds = profileData.role === 'negocio' || profileData.role === 'repartidor'
        ? [...new Set(rows.map((row) => row.client_id).filter(Boolean))]
        : [];
      const [businessResult, clientResult] = await Promise.all([
        businessIds.length
          ? supabase.from('businesses').select('id,store_name,address').in('id', businessIds)
          : Promise.resolve({ data: [], error: null }),
        clientIds.length
          ? supabase.from('profiles').select('id,full_name').in('id', clientIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (businessResult.error) throw businessResult.error;
      if (clientResult.error) throw clientResult.error;
      const businessById = new Map((businessResult.data || []).map((item) => [item.id, item]));
      const clientById = new Map((clientResult.data || []).map((item) => [item.id, item]));
      setHistory(rows.map((row) => ({
        ...row,
        business: businessById.get(row.business_id),
        client: clientById.get(row.client_id),
      })));
      setMetrics({ total: totalResult.count || 0, completed: completedResult.count || 0 });
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el detalle del perfil.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => { void loadDetails(); }, [loadDetails]);

  const accountAction = async (action) => {
    setSaving(true);
    setFeedback(null);
    try {
      const blockedUntil = action === 'block'
        ? new Date(Date.now() + blockDays * 24 * 60 * 60 * 1000).toISOString()
        : null;
      const { data, error: invokeError } = await supabase.functions.invoke('admin-manage-account', {
        body: { profileId, action, blockedUntil, reason: reason.trim() },
      });
      if (invokeError) {
        let message = invokeError.message;
        try {
          const responseBody = await invokeError.context?.json();
          message = responseBody?.error || message;
        } catch {
          // Use the Functions SDK message when the response has no JSON body.
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      setFeedback({
        type: 'success',
        text: action === 'block'
          ? `Cuenta bloqueada hasta ${new Date(blockedUntil).toLocaleString()}.`
          : action === 'activate' ? 'La cuenta bloqueada fue reactivada.' : 'La cuenta fue dada de baja definitivamente.',
      });
      setReason('');
      setConfirmDeactivate(false);
      await loadDetails();
    } catch (actionError) {
      setFeedback({ type: 'error', text: actionError.message || 'No se pudo cambiar el estado de la cuenta.' });
    } finally {
      setSaving(false);
    }
  };

  const approveVerification = async () => {
    if (!entity?.id || !profile?.role) return;
    setSaving(true);
    setFeedback(null);
    try {
      const { error: reviewError } = await supabase.rpc('admin_review_role_verification', {
        p_entity_type: profile.role,
        p_entity_id: entity.id,
        p_approved: true,
        p_note: 'Aprobado desde el detalle de usuarios del panel administrador.',
      });
      if (reviewError) throw reviewError;
      setFeedback({ type: 'success', text: 'Perfil aprobado y activado.' });
      await loadDetails();
    } catch (reviewError) {
      setFeedback({ type: 'error', text: reviewError.message || 'No se pudo aprobar el perfil.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !profile) return <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} size="large" /></SafeAreaView>;

  const permanent = Boolean(profile?.account_deactivated_at);
  const blocked = profile?.status === 'bloqueado' && !permanent;
  const pendingVerification = verification?.verification_status === 'pendiente';
  const verificationReady = profile?.role === 'negocio'
    ? Boolean(entity?.store_image_url && verification?.legal_name?.trim() && verification?.registration_id?.trim() && verification?.complaint_email?.trim())
    : profile?.role === 'repartidor'
      ? Boolean(documentUrls.face && documentUrls.plate && entity?.vehicle_type?.trim() && entity?.plate_number?.trim() && verification?.face_photo_attested)
      : false;
  const completedLabel = profile?.role === 'cliente' ? 'Pedidos entregados' : profile?.role === 'negocio' ? 'Pedidos entregados' : 'Entregas realizadas';
  const totalLabel = profile?.role === 'cliente' ? 'Pedidos hechos' : profile?.role === 'negocio' ? 'Pedidos recibidos' : 'Pedidos asignados';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={[styles.back, { borderColor: colors.border }]}>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>‹ Usuarios y perfiles</Text>
        </Pressable>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {profile ? <>
          <Text style={[styles.title, { color: colors.text }]}>{profile.full_name || profile.nickname || 'Perfil sin nombre'}</Text>
          <Text style={[styles.muted, { color: colors.muted }]}>{profile.role} · {profile.phone || 'Sin teléfono'}</Text>
          <Text style={[styles.muted, { color: colors.muted }]}>Registrado: {profile.created_at ? new Date(profile.created_at).toLocaleString() : 'Fecha no disponible'}</Text>
          <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.section, { color: colors.text }]}>Estado de la cuenta</Text>
            <Text style={[styles.status, { color: permanent || blocked ? '#B42318' : colors.primary }]}>
              {permanent ? 'Baja definitiva' : blocked ? 'Bloqueo temporal' : prettyStatus(profile.status)}
            </Text>
            {blocked && profile.account_blocked_until ? <Text style={[styles.muted, { color: colors.muted }]}>Bloqueado hasta {new Date(profile.account_blocked_until).toLocaleString()}</Text> : null}
            {profile.account_status_reason ? <Text style={[styles.muted, { color: colors.muted }]}>Motivo: {profile.account_status_reason}</Text> : null}
            {entity ? <Text style={[styles.muted, { color: colors.muted, marginTop: 8 }]}>
              {profile.role === 'negocio'
                ? `${entity.store_name} · ${entity.address || 'Sin dirección'} · estado del local: ${prettyStatus(entity.status)}`
                : `${entity.vehicle_type || 'Vehículo sin registrar'} · placa ${entity.plate_number || 'sin placa'} · ${entity.is_available ? 'En línea' : 'Fuera de línea'}`}
            </Text> : profile.role !== 'cliente' ? <Text style={[styles.muted, { color: colors.muted }]}>No se encontró el registro del perfil asociado.</Text> : null}
            {profile.role === 'negocio' && entity?.store_image_url ? <Image source={{ uri: entity.store_image_url }} style={styles.businessImage} /> : null}
            {profile.role === 'negocio' && verification ? <Text style={[styles.muted, { color: colors.muted, marginTop: 6 }]}>
              Razón social: {verification.legal_name || 'No registrada'} · {verification.registration_id_type || 'Documento'} {verification.registration_id || 'sin número'} · PQRS: {verification.complaint_email || 'Sin correo'}
            </Text> : null}
            {profile.role === 'repartidor' ? <View style={styles.documentImages}>
              {documentUrls.face ? <Image source={{ uri: documentUrls.face }} style={styles.documentImage} /> : null}
              {documentUrls.plate ? <Image source={{ uri: documentUrls.plate }} style={styles.documentImage} /> : null}
              {documentUrls.identity ? <Image source={{ uri: documentUrls.identity }} style={styles.documentImage} /> : null}
            </View> : null}
            {documentError ? <Text accessibilityRole="alert" style={styles.warning}>{documentError}</Text> : null}
            {verification ? <Text style={[styles.muted, { color: colors.muted, marginTop: 6 }]}>Verificación: {prettyStatus(verification.verification_status)}{verification.review_note ? ` · ${verification.review_note}` : ''}</Text> : null}
          </View>

          <Text style={[styles.section, { color: colors.text }]}>Actividad del perfil</Text>
          <View style={styles.metrics}>
            <Metric label={totalLabel} value={metrics.total} colors={colors} />
            <Metric label={completedLabel} value={metrics.completed} colors={colors} />
          </View>
          <Text style={[styles.section, { color: colors.text }]}>Historial reciente · hasta 100 pedidos</Text>
          {history.length ? history.map((order) => (
            <View key={order.id} style={[styles.orderCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.orderTitle, { color: colors.text }]}>Pedido {order.order_number || order.id.slice(0, 8)} · {prettyStatus(order.status)}</Text>
              {order.business?.store_name ? <Text style={[styles.muted, { color: colors.muted }]}>Negocio: {order.business.store_name}</Text> : null}
              {order.client?.full_name ? <Text style={[styles.muted, { color: colors.muted }]}>Cliente: {order.client.full_name}</Text> : null}
              {order.delivery_address ? <Text style={[styles.muted, { color: colors.muted }]}>Dirección: {order.delivery_address}</Text> : null}
              <Text style={[styles.muted, { color: colors.muted }]}>{order.created_at ? new Date(order.created_at).toLocaleString() : 'Fecha no disponible'} · ${Number(order.total_amount || 0).toLocaleString('es-CO')} COP</Text>
            </View>
          )) : <Text style={[styles.muted, { color: colors.muted }]}>No hay pedidos en el historial.</Text>}

          <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.section, { color: colors.text }]}>Administrar acceso</Text>
            {pendingVerification ? <>
              <Text style={[styles.muted, { color: colors.muted }]}>Este perfil todavía requiere aprobación administrativa para operar.</Text>
              <ActionButton title={verificationReady ? 'Aprobar y activar perfil' : 'Completa los requisitos para aprobar'} onPress={() => void approveVerification()} colors={colors} disabled={saving || blocked || permanent || !verificationReady} />
            </> : null}
            {blocked ? <ActionButton title="Dar de alta / quitar bloqueo" onPress={() => void accountAction('activate')} colors={colors} disabled={saving} /> : null}
            {!blocked && !permanent ? <>
              <Text style={[styles.muted, { color: colors.muted }]}>Bloquear temporalmente</Text>
              <View style={styles.durationRow}>
                {[1, 7, 30].map((days) => (
                  <Pressable key={days} accessibilityRole="radio" accessibilityState={{ checked: blockDays === days }} onPress={() => setBlockDays(days)} style={[styles.duration, { borderColor: blockDays === days ? colors.primary : colors.border, backgroundColor: blockDays === days ? colors.elevated : colors.surface }]}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{days} {days === 1 ? 'día' : 'días'}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                accessibilityLabel="Motivo del bloqueo o de la baja"
                value={reason}
                onChangeText={setReason}
                placeholder="Motivo (opcional)"
                placeholderTextColor={colors.muted}
                maxLength={500}
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              />
              <ActionButton title={`Bloquear por ${blockDays} ${blockDays === 1 ? 'día' : 'días'}`} onPress={() => void accountAction('block')} colors={colors} disabled={saving || profile?.role === 'admin'} />
              {!confirmDeactivate ? (
                <Pressable accessibilityRole="button" disabled={saving} onPress={() => setConfirmDeactivate(true)} style={[styles.dangerButton, saving && styles.disabled]}>
                  <Text style={styles.dangerText}>Dar de baja definitivamente</Text>
                </Pressable>
              ) : <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>La cuenta no podrá iniciar sesión y sus datos e historial se conservarán. Confirma la baja definitiva.</Text>
                <View style={styles.durationRow}>
                  <Pressable accessibilityRole="button" onPress={() => setConfirmDeactivate(false)} style={[styles.duration, { borderColor: colors.border }]}><Text style={{ color: colors.text }}>Cancelar</Text></Pressable>
                  <Pressable accessibilityRole="button" disabled={saving} onPress={() => void accountAction('deactivate')} style={[styles.dangerButton, saving && styles.disabled]}><Text style={styles.dangerText}>Confirmar baja</Text></Pressable>
                </View>
              </View>}
            </> : null}
            {permanent ? <Text style={styles.warning}>La baja es permanente desde este panel. Se conservan los datos necesarios para el historial.</Text> : null}
            {feedback ? <Text accessibilityRole="alert" style={[styles.feedback, { color: feedback.type === 'error' ? '#B42318' : '#146C43' }]}>{feedback.text}</Text> : null}
            {saving ? <ActivityIndicator color={colors.primary} style={{ marginTop: 10 }} /> : null}
          </View>
          {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} /> : null}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({ title, onPress, colors, disabled }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.actionButton, { backgroundColor: colors.primary }, disabled && styles.disabled]}>
    <Text style={{ color: colors.onPrimary, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 36, gap: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  back: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 10 },
  title: { fontSize: 24, fontWeight: '900', marginTop: 8 },
  muted: { fontSize: 13, lineHeight: 19 },
  section: { fontSize: 17, fontWeight: '900', marginBottom: 8 },
  profileCard: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 8 },
  status: { textTransform: 'capitalize', fontWeight: '900', fontSize: 15, marginBottom: 6 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { borderWidth: 1, borderRadius: 10, padding: 12, minWidth: '48%', flexGrow: 1 },
  metricValue: { fontSize: 23, fontWeight: '900' },
  orderCard: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 3 },
  orderTitle: { fontWeight: '800', marginBottom: 3 },
  businessImage: { width: '100%', height: 170, resizeMode: 'cover', borderRadius: 10, marginTop: 10 },
  documentImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  documentImage: { width: 104, height: 104, resizeMode: 'cover', borderRadius: 9 },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  duration: { borderWidth: 1, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, marginTop: 10 },
  actionButton: { borderRadius: 9, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, marginTop: 10 },
  dangerButton: { borderRadius: 9, minHeight: 42, justifyContent: 'center', alignItems: 'center', backgroundColor: '#B42318', paddingHorizontal: 12, marginTop: 10 },
  dangerText: { color: '#FFFFFF', fontWeight: '800' },
  confirmBox: { backgroundColor: '#FEF3F2', borderRadius: 10, padding: 12, marginTop: 10 },
  confirmText: { color: '#7A271A', lineHeight: 19 },
  warning: { color: '#7A271A', marginTop: 8, lineHeight: 19 },
  feedback: { fontWeight: '700', marginTop: 10, lineHeight: 20 },
  error: { color: '#B42318', backgroundColor: '#FEE4E2', padding: 12, borderRadius: 9 },
  disabled: { opacity: 0.6 },
});
