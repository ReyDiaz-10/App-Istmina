import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import HelpButton from '../../components/HelpButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { formatCOP } from '../../utils/formatters';
import { getDriverDocumentUrl, getProfilePhotoUrl } from '../../services/onboardingMedia';
import { isAdminRole } from '../../utils/roles';
import { usePreferencesStore } from '../../store/preferencesStore';

const Metric = ({ label, value }) => {
  const { colors } = useAppTheme();
  return <View style={[styles.metric, { backgroundColor: colors.surface }]}><Text style={[styles.metricValue, { color: colors.primary }]}>{value}</Text><Text style={[styles.muted, { color: colors.muted }]}>{label}</Text></View>;
};

export default function AdminDashboardScreen({ navigation }) {
  const profile = useAuthStore((state) => state.profile);
  const role = profile?.role;
  const signOut = useAuthStore((state) => state.signOut);
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  const [loading, setLoading] = useState(true);
  const [replies, setReplies] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  const [reviewingKey, setReviewingKey] = useState(null);
  const [data, setData] = useState({
    users: 0,
    clients: 0,
    orders: 0,
    activeOrders: 0,
    completed: 0,
    activity: [],
    businesses: [],
    drivers: [],
    topClients: [],
    tickets: [],
    feedback: 0,
    pendingBusinesses: [],
    pendingDrivers: [],
    operational: { active_businesses: 0, drivers: 0, orders_by_area: [] },
  });

  const load = useCallback(async () => {
    if (!isAdminRole(role)) return;
    setLoading(true);
    try {
      const [summary, tickets, pendingBusinesses, pendingDrivers, operational] = await Promise.all([
        supabase.rpc('admin_dashboard_summary'),
        supabase.from('support_tickets').select('*, profiles(full_name, role)').order('created_at', { ascending: false }).limit(100),
        supabase.from('business_verifications')
          .select('*, businesses!inner(id, store_name, store_image_url, profile_id, address, slogan, profiles(full_name, phone))')
          .eq('verification_status', 'pendiente')
          .order('created_at', { ascending: true }),
        supabase.from('driver_verifications')
          .select('*, drivers!inner(id, profile_id, vehicle_type, plate_number, verification_status, profiles(full_name, phone, avatar_url))')
          .eq('verification_status', 'pendiente')
          .order('created_at', { ascending: true }),
        supabase.rpc('admin_operational_metrics'),
      ]);
      for (const result of [summary, tickets, pendingBusinesses, pendingDrivers, operational]) {
        if (result.error) throw result.error;
      }
      const metrics = summary.data || {};
      const ticketRows = tickets.data || [];
      const driverRows = await Promise.all((pendingDrivers.data || []).map(async (item) => {
        const driverProfile = item.drivers?.profiles;
        const resolvePhoto = async (label, resolver, path) => {
          if (!path) return { url: null, failed: false };
          try {
            return { url: await resolver(path), failed: false };
          } catch (error) {
            console.error(`No se pudo cargar ${label} del perfil pendiente:`, error.message);
            return { url: null, failed: true };
          }
        };
        const [face, plate, identity] = await Promise.all([
          resolvePhoto('la foto del rostro', getProfilePhotoUrl, driverProfile?.avatar_url),
          resolvePhoto('la foto de la placa', getDriverDocumentUrl, item.plate_photo_path),
          resolvePhoto('el documento de identidad', getDriverDocumentUrl, item.identity_document_path),
        ]);
        return {
          ...item,
          facePhotoUrl: face.url,
          platePhotoUrl: plate.url,
          identityPhotoUrl: identity.url,
          requiredDocumentLoadError: face.failed || plate.failed,
          identityDocumentLoadError: identity.failed,
        };
      }));
      setData({
        users: metrics.users || 0,
        clients: metrics.clients || 0,
        orders: metrics.orders || 0,
        activeOrders: metrics.active_orders || 0,
        completed: metrics.completed || 0,
        activity: metrics.orders_last_7_days || [],
        businesses: metrics.businesses || [],
        drivers: metrics.drivers || [],
        topClients: metrics.top_clients || [],
        tickets: ticketRows,
        feedback: metrics.feedback || 0,
        pendingBusinesses: pendingBusinesses.data || [],
        pendingDrivers: driverRows,
        operational: operational.data || { active_businesses: 0, drivers: 0, orders_by_area: [] },
      });
    } catch (error) {
      Alert.alert('No se pudo cargar el panel', error.message);
    } finally { setLoading(false); }
  }, [role]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!isAdminRole(role)) return undefined;
    const channel = supabase
      .channel('admin-verification-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_verifications' }, () => {
        void load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_verifications' }, () => {
        void load();
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime verification queue failed: ${status}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, role]);

  const updateTicket = async (ticket, status) => {
    const update = { status };
    if (replies[ticket.id]?.trim()) update.admin_reply = replies[ticket.id].trim();
    const { error } = await supabase.from('support_tickets').update(update).eq('id', ticket.id);
    if (error) Alert.alert('No se pudo actualizar', error.message);
    else load();
  };

  const reviewVerification = async (entityType, entityId, approved) => {
    const reviewKey = `${entityType}:${entityId}`;
    setReviewingKey(reviewKey);
    try {
      const note = reviewNotes[reviewKey]?.trim();
      const { error } = await supabase.rpc('admin_review_role_verification', {
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_approved: approved,
        p_note: approved ? null : note || null,
      });
      if (error) throw error;
      await load();
    } catch (error) {
      Alert.alert('No se pudo guardar la revisión', error.message);
    } finally {
      setReviewingKey(null);
    }
  };

  if (!isAdminRole(role)) return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={[styles.title, { color: colors.text }]}>Acceso restringido</Text><Text style={{ color: colors.text }}>Esta sección requiere una cuenta administradora.</Text></View>;
  if (loading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
    <View style={styles.top}><View><Text style={[styles.title, { color: colors.text }]}>Centro de control</Text><Text style={[styles.muted, { color: colors.muted }]}>Hola, {profile?.nickname || profile?.full_name || 'Administrador'}</Text></View><View style={styles.headerActions}><Pressable onPress={() => navigation.navigate('Profile')}><Text style={[styles.link, { color: colors.primary }]}>Mi perfil</Text></Pressable><Pressable onPress={() => navigation.navigate('Settings')}><Text style={[styles.link, { color: colors.primary }]}>Configuración</Text></Pressable><Pressable onPress={load}><Text style={[styles.link, { color: colors.primary }]}>Actualizar</Text></Pressable></View></View>
    <View style={styles.adminLinks}>
      <Pressable style={[styles.adminLink, { backgroundColor: colors.surface }]} onPress={() => navigation.navigate('AdminFinance')}><Text style={[styles.link, { color: colors.primary }]}>Finanzas y retiros</Text></Pressable>
      <Pressable style={[styles.adminLink, { backgroundColor: colors.surface }]} onPress={() => navigation.navigate('AdminActivity')}><Text style={[styles.link, { color: colors.primary }]}>Auditoría en vivo</Text></Pressable>
      <Pressable style={[styles.adminLink, { backgroundColor: colors.surface }]} onPress={() => navigation.navigate('AdminChatAudit')}><Text style={[styles.link, { color: colors.primary }]}>Auditoría de chats</Text></Pressable>
    </View>
    <HelpButton navigation={navigation} context="administración" compact />
    <Text style={[styles.subtitle, { color: colors.muted }]}>Indicadores acumulados de la plataforma</Text>
    <View style={styles.grid}>
      <Metric label="Usuarios" value={data.users} /><Metric label="Clientes" value={data.clients} />
      <Metric label="Pedidos totales" value={data.orders} /><Metric label="Pedidos activos" value={data.activeOrders} />
      <Metric label="Entregas completadas" value={data.completed} /><Metric label="Sugerencias y quejas" value={data.feedback} />
      <Metric label="Negocios activos" value={data.operational.active_businesses} /><Metric label="Repartidores registrados" value={data.operational.drivers} />
    </View>
    <Text style={[styles.section, { color: colors.text }]}>Pedidos por zona/dirección registrada</Text>
    {data.operational.orders_by_area.map((area) => <Text key={area.area} style={[styles.muted, { color: colors.muted }]}>{area.area}: {area.orders} pedidos</Text>)}
    <Text style={[styles.section, { color: colors.text }]}>Pedidos por día · últimos 7 días</Text>
    {data.activity.map((day) => {
      const peak = Math.max(1, ...data.activity.map((item) => item.orders));
      return <View key={day.date} style={styles.activityRow}><Text style={[styles.activityDate, { color: colors.muted }]}>{day.date.slice(5)}</Text><View style={styles.barTrack}><View style={[styles.bar, { width: `${day.orders === 0 ? 0 : Math.max(3, (day.orders / peak) * 100)}%` }]} /></View><Text style={[styles.activityCount, { color: colors.text }]}>{day.orders}</Text></View>;
    })}
    <Text style={[styles.section, { color: colors.text }]}>Negocios</Text>
    {data.businesses.map((b) => <View key={b.id} style={[styles.row, { backgroundColor: colors.surface }]}><View style={styles.rowMain}><Text style={[styles.rowTitle, { color: colors.text }]}>{b.store_name}</Text><Text style={[styles.muted, { color: colors.muted }]}>{b.status} · {b.orders} pedidos · {formatCOP(b.sales, locale)}</Text></View></View>)}
    <Text style={[styles.section, { color: colors.text }]}>Clientes con más pedidos</Text>
    {data.topClients.map((client) => <View key={client.profile_id} style={[styles.row, { backgroundColor: colors.surface }]}><Text style={[styles.rowTitle, { color: colors.text }]}>{client.full_name}</Text><Text style={[styles.muted, { color: colors.muted }]}>{client.orders} pedidos · {formatCOP(client.spent, locale)}</Text></View>)}
    <Text style={[styles.section, { color: colors.text }]}>Repartidores</Text>
    {data.drivers.map((d) => <View key={d.id} style={[styles.row, { backgroundColor: colors.surface }]}><View style={styles.rowMain}><Text style={[styles.rowTitle, { color: colors.text }]}>{d.full_name || 'Perfil sin nombre'}</Text><Text style={[styles.muted, { color: colors.muted }]}>{d.is_available ? 'Disponible' : 'No disponible'} · {d.deliveries} entregas completadas</Text></View></View>)}
    <Text style={[styles.section, { color: colors.text }]}>Revisión de perfiles</Text>
    {!data.pendingBusinesses.length && !data.pendingDrivers.length && (
      <Text style={[styles.muted, { color: colors.muted }]}>No hay perfiles pendientes de revisión.</Text>
    )}
    {data.pendingBusinesses.map((item) => (
      <View key={item.business_id} style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>{item.businesses?.store_name}</Text>
        <Text style={[styles.muted, { color: colors.muted }]}>
          {item.businesses?.profiles?.full_name} · {item.businesses?.profiles?.phone}
        </Text>
        {item.businesses?.store_image_url
          ? <Image source={{ uri: item.businesses.store_image_url }} style={styles.businessReviewImage} />
          : <Text style={[styles.muted, { color: colors.muted }]}>Falta la foto pública del local.</Text>}
        <Text style={[styles.message, { color: colors.text }]}>
          Razón social: {item.legal_name}{'\n'}
          {item.registration_id_type}: {item.registration_id}{'\n'}
          Correo para quejas: {item.complaint_email}{'\n'}
          Dirección: {item.businesses?.address || 'No registrada'}{'\n'}
          Descripción: {item.businesses?.slogan || 'No registrada'}
        </Text>
        <TextInput
          accessibilityLabel={`Motivo de revisión para ${item.businesses?.store_name || 'negocio'}`}
          value={reviewNotes[`negocio:${item.business_id}`] || ''}
          onChangeText={(value) => setReviewNotes((current) => ({ ...current, [`negocio:${item.business_id}`]: value }))}
          placeholder="Motivo de rechazo (opcional)"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={500}
          style={[styles.reviewNoteInput, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
        />
        <ReviewActions
          onApprove={() => reviewVerification('negocio', item.business_id, true)}
          onReject={() => reviewVerification('negocio', item.business_id, false)}
          disabled={reviewingKey !== null}
          approveDisabled={
            !item.businesses?.store_image_url
            || !item.legal_name?.trim()
            || !item.registration_id?.trim()
            || !item.complaint_email?.trim()
          }
          colors={colors}
        />
        {(reviewingKey === `negocio:${item.business_id}`) ? (
          <Text style={[styles.muted, { color: colors.muted }]}>Guardando revisión...</Text>
        ) : null}
      </View>
    ))}
    {data.pendingDrivers.map((item) => (
      <View key={item.driver_id} style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>{item.drivers?.profiles?.full_name}</Text>
        <Text style={[styles.muted, { color: colors.muted }]}>
          {item.drivers?.vehicle_type} · Placa {item.drivers?.plate_number} · {item.drivers?.profiles?.phone}
        </Text>
        <View style={styles.documentImages}>
          {item.facePhotoUrl ? <Image source={{ uri: item.facePhotoUrl }} style={styles.reviewImage} /> : null}
          {item.platePhotoUrl ? <Image source={{ uri: item.platePhotoUrl }} style={styles.reviewImage} /> : null}
          {item.identityPhotoUrl ? <Image source={{ uri: item.identityPhotoUrl }} style={styles.reviewImage} /> : null}
        </View>
        {!item.facePhotoUrl || !item.platePhotoUrl
          ? <Text style={[styles.muted, { color: colors.muted }]}>Faltan una o más fotos para revisar.</Text>
          : null}
        {item.requiredDocumentLoadError
          ? <Text style={[styles.muted, { color: '#8A3B12' }]}>No se pudieron abrir todos los documentos; verifica los permisos o rutas del almacenamiento.</Text>
          : null}
        {item.identityDocumentLoadError
          ? <Text style={[styles.muted, { color: colors.muted }]}>El documento de identidad opcional no se pudo abrir.</Text>
          : null}
        {item.identityPhotoUrl
          ? <Text style={[styles.muted, { color: colors.muted }]}>Documento de identidad opcional cargado.</Text>
          : null}
        <TextInput
          accessibilityLabel={`Motivo de revisión para ${item.drivers?.profiles?.full_name || 'repartidor'}`}
          value={reviewNotes[`repartidor:${item.driver_id}`] || ''}
          onChangeText={(value) => setReviewNotes((current) => ({ ...current, [`repartidor:${item.driver_id}`]: value }))}
          placeholder="Motivo de rechazo (opcional)"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={500}
          style={[styles.reviewNoteInput, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
        />
        <ReviewActions
          onApprove={() => reviewVerification('repartidor', item.driver_id, true)}
          onReject={() => reviewVerification('repartidor', item.driver_id, false)}
          disabled={reviewingKey !== null}
          approveDisabled={
            !item.facePhotoUrl
            || !item.platePhotoUrl
            || item.requiredDocumentLoadError
            || !item.drivers?.vehicle_type?.trim()
            || !item.drivers?.plate_number?.trim()
          }
          colors={colors}
        />
        {(reviewingKey === `repartidor:${item.driver_id}`) ? (
          <Text style={[styles.muted, { color: colors.muted }]}>Guardando revisión...</Text>
        ) : null}
      </View>
    ))}
    <Text style={[styles.section, { color: colors.text }]}>Ayuda y sugerencias</Text>
    {!data.tickets.length && <Text style={styles.muted}>No hay solicitudes recibidas.</Text>}
    {data.tickets.map((t) => <View key={t.id} style={[styles.ticket, { backgroundColor: colors.surface }]}><Text style={[styles.rowTitle, { color: colors.text }]}>{t.subject} · {t.category}</Text><Text style={[styles.muted, { color: colors.muted }]}>De {t.profiles?.full_name || 'usuario'} · {t.context || 'General'} · {t.status}{t.order_id ? ` · Pedido ${t.order_id.slice(0, 8)}` : ''}</Text><Text style={[styles.message, { color: colors.text }]}>{t.message}</Text><TextInput accessibilityLabel="Respuesta al usuario" placeholder={t.admin_reply || 'Escribe una respuesta para el usuario'} placeholderTextColor={colors.muted} value={replies[t.id] ?? t.admin_reply ?? ''} onChangeText={(value) => setReplies((current) => ({ ...current, [t.id]: value }))} style={[styles.replyInput, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} multiline /><View style={styles.actions}><Pressable onPress={() => updateTicket(t, 'en_revision')}><Text style={[styles.link, { color: colors.primary }]}>Guardar / tomar caso</Text></Pressable><Pressable onPress={() => updateTicket(t, 'resuelto')}><Text style={[styles.link, { color: colors.primary }]}>Responder y resolver</Text></Pressable></View></View>)}
    <Pressable style={styles.logout} onPress={async () => {
      const result = await signOut();
      if (result.success) navigation.reset({ index: 0, routes: [{ name: 'ClientHome' }] });
      else Alert.alert('Error', result.error || 'No se pudo cerrar la sesión.');
    }}><Text style={styles.logoutText}>Cerrar sesión</Text></Pressable>
  </ScrollView>;
}

const ReviewActions = ({ onApprove, onReject, approveDisabled = false, disabled = false, colors }) => (
  <View style={styles.reviewActions}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Rechazar perfil pendiente"
      disabled={disabled}
      onPress={onReject}
      style={[styles.rejectButton, disabled && styles.reviewButtonDisabled]}
    >
      <Text style={styles.rejectButtonText}>Rechazar</Text>
    </Pressable>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Aprobar perfil pendiente"
      disabled={disabled || approveDisabled}
      onPress={onApprove}
      style={[
        styles.approveButton,
        (disabled || approveDisabled) && styles.reviewButtonDisabled,
      ]}
    >
      <Text style={styles.approveButtonText}>Aprobar y activar</Text>
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  container: { padding: 18, backgroundColor: '#F5F7FA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  adminLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  adminLink: { borderRadius: 10, padding: 8 },
  title: { fontSize: 26, fontWeight: '800', color: '#1A237E' },
  subtitle: { color: '#687078', marginTop: 3, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  metric: { width: '48%', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10 },
  metricValue: { fontSize: 24, color: '#1A237E', fontWeight: '800' },
  muted: { color: '#697279', marginTop: 5, lineHeight: 20 },
  section: { fontSize: 20, fontWeight: '800', color: '#263238', marginTop: 20, marginBottom: 8 },
  activityRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 },
  activityDate: { width: 44, color: '#697279' },
  barTrack: { flex: 1, height: 12, backgroundColor: '#E0E4F0', borderRadius: 8, overflow: 'hidden' },
  bar: { height: 12, backgroundColor: '#3949AB', borderRadius: 8 },
  activityCount: { width: 32, textAlign: 'right', color: '#273238', fontWeight: '700' },
  row: { backgroundColor: '#fff', borderRadius: 10, padding: 13, marginBottom: 8 },
  rowMain: { flex: 1 },
  rowTitle: { fontWeight: '700', color: '#273238' },
  ticket: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 },
  reviewCard: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  reviewActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 8 },
  reviewNoteInput: { borderWidth: 1, borderRadius: 8, minHeight: 72, padding: 10, marginTop: 12, textAlignVertical: 'top' },
  rejectButton: { flex: 1, minHeight: 48, borderRadius: 9, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FDECEC', borderWidth: 1, borderColor: '#B42318' },
  rejectButtonText: { color: '#912018', fontWeight: '800' },
  approveButton: { flex: 1, minHeight: 48, borderRadius: 9, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#146C43', borderWidth: 1, borderColor: '#14532D' },
  approveButtonText: { color: '#FFFFFF', fontWeight: '800', textAlign: 'center' },
  reviewButtonDisabled: { opacity: 0.55 },
  businessReviewImage: { width: '100%', height: 140, borderRadius: 8, marginTop: 10 },
  documentImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  reviewImage: { width: 120, height: 85, borderRadius: 8, backgroundColor: '#E0E0E0' },
  message: { color: '#30383D', marginTop: 8, lineHeight: 21 },
  replyInput: { backgroundColor: '#F5F7FA', padding: 10, borderRadius: 8, minHeight: 60, marginTop: 10, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  link: { color: '#1A237E', fontWeight: '700', padding: 6 },
  logout: { backgroundColor: '#1A237E', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 24, marginBottom: 25 },
  logoutText: { color: '#fff', fontWeight: '700' },
});
