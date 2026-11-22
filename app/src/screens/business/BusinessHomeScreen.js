import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
// app/src/screens/business/BusinessHomeScreen.js
import React, { useCallback, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import AnimatedButton from '../../components/AnimatedButton';
import WalletCard from '../../components/WalletCard';
import BannerUploader from '../../components/BannerUploader';
import DeliverySettingsCard from '../../components/DeliverySettingsCard';
import { createBusinessPaymentLink } from '../../services/orders';
import { uploadBusinessPhoto } from '../../services/onboardingMedia';
import { SafeAreaView } from 'react-native-safe-area-context';
import HelpButton from '../../components/HelpButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCOP } from '../../utils/formatters';
import { isValidOperatingTime, isOperatingRangeValid, formatOperatingStatus } from '../../utils/operatingHours';

const Metric = ({ label, value, colors }) => (
  <View style={[styles.metric, { backgroundColor: colors.background }]}>
    <Text style={[styles.metricValue, { color: colors.primary }]}>{value}</Text>
    <Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text>
  </View>
);

const BusinessHomeScreen = ({ navigation }) => {
  // Estados de Datos
  const { profile } = useAuthStore();
  const signOut = useAuthStore((state) => state.signOut);
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  const [business, setBusiness] = useState(null);
  const [products, setProducts] = useState([]);
  const [wallet, setWallet] = useState({ balance: 0 });
  const [subscription, setSubscription] = useState({ is_active: false });
  const [verificationStatus, setVerificationStatus] = useState('pendiente');
  const [verification, setVerification] = useState(null);
  const [metrics, setMetrics] = useState({ orders: 0, active_orders: 0, completed_orders: 0, sales: 0, complaints: 0 });
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [uploadingBusinessPhoto, setUploadingBusinessPhoto] = useState(false);
  const [savingVerification, setSavingVerification] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState(null);
  const [photoFeedback, setPhotoFeedback] = useState(null);
  const [operatingHours, setOperatingHours] = useState([
    { day_of_week: 0, opens_at: '08:00', closes_at: '21:00', is_open: true, name: 'Domingo' },
    { day_of_week: 1, opens_at: '08:00', closes_at: '21:00', is_open: true, name: 'Lunes' },
    { day_of_week: 2, opens_at: '08:00', closes_at: '21:00', is_open: true, name: 'Martes' },
    { day_of_week: 3, opens_at: '08:00', closes_at: '21:00', is_open: true, name: 'Miércoles' },
    { day_of_week: 4, opens_at: '08:00', closes_at: '21:00', is_open: true, name: 'Jueves' },
    { day_of_week: 5, opens_at: '08:00', closes_at: '21:00', is_open: true, name: 'Viernes' },
    { day_of_week: 6, opens_at: '08:00', closes_at: '21:00', is_open: true, name: 'Sábado' },
  ]);
  const [savingOperatingHours, setSavingOperatingHours] = useState(false);
  const [operatingHoursFeedback, setOperatingHoursFeedback] = useState(null);
  const [currentOperatingStatus, setCurrentOperatingStatus] = useState(null);
  const [operatingStatusError, setOperatingStatusError] = useState('');
  const [businessStatusFeedback, setBusinessStatusFeedback] = useState(null);
  const [savingBusinessStatus, setSavingBusinessStatus] = useState(false);
  const [savingPickupSettings, setSavingPickupSettings] = useState(false);

  // Estados de Interfaz (UI)
  const [modalVisible, setModalVisible] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    price: '',
    category: '',
  });

  useEffect(() => {
    if (!business?.id) return undefined;

    const channel = supabase
      .channel(`business-finance:${business.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallets', filter: `business_id=eq.${business.id}` },
        ({ new: walletData }) => setWallet({ balance: walletData.balance }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'subscriptions', filter: `business_id=eq.${business.id}` },
        ({ new: subscriptionData }) => {
          const today = new Date().toISOString().slice(0, 10);
          setSubscription({
            is_active: Boolean(
              subscriptionData.is_active
              && subscriptionData.start_date <= today
              && subscriptionData.end_date >= today,
            ),
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'business_verifications', filter: `business_id=eq.${business.id}` },
        async ({ new: verificationData }) => {
          setVerificationStatus(verificationData.verification_status);
          setVerification(verificationData);
          const { data: updatedBusiness, error } = await supabase
            .from('businesses')
            .select('status')
            .eq('id', business.id)
            .single();
          if (error) {
            console.error('No se pudo actualizar el estado del negocio tras la revisión:', error.message);
            return;
          }
          setBusiness((current) => ({ ...current, ...updatedBusiness }));
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime business finance subscription failed: ${status}`);
        }
      });

    return () => supabase.removeChannel(channel);
  }, [business?.id]);

  // --- LÓGICA DE DATOS ---

  const loadDashboardData = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      // 1. Obtener datos del negocio
      const { data: businessData, error: bError } = await supabase
        .from('businesses')
        .select('*')
        .eq('profile_id', profile.id)
        .single();

      if (bError) throw bError;
      setBusiness(businessData);

      // 2. Carga concurrente de Billetera, Suscripción y Productos
      const [walletRes, subRes, prodRes, verificationRes, metricsRes, hoursRes] = await Promise.all([
        supabase.from('wallets').select('*').eq('business_id', businessData.id).single(),
        supabase.from('subscriptions').select('*').eq('business_id', businessData.id).maybeSingle(),
        supabase.from('products').select('*').eq('business_id', businessData.id),
        supabase.from('business_verifications')
          .select('*')
          .eq('business_id', businessData.id)
          .single(),
        supabase.rpc('business_dashboard_summary'),
        supabase.from('business_operating_hours')
          .select('day_of_week, opens_at, closes_at, is_confirmed')
          .eq('business_id', businessData.id),
      ]);

      if (walletRes.error) throw walletRes.error;
      if (prodRes.error) throw prodRes.error;
      if (verificationRes.error) throw verificationRes.error;
      if (metricsRes.error) throw metricsRes.error;
      if (hoursRes.error) throw hoursRes.error;

      setWallet({ balance: walletRes.data?.balance || 0 });
      setVerificationStatus(verificationRes.data.verification_status);
      setVerification(verificationRes.data);
      setMetrics(metricsRes.data);
      const today = new Date().toISOString().slice(0, 10);
      setSubscription({
        is_active: Boolean(
          subRes.data?.is_active
          && subRes.data.start_date <= today
          && subRes.data.end_date >= today,
        ),
      });
      setProducts(prodRes.data || []);
      if (hoursRes.data?.length) {
        const names = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        setOperatingHours(names.map((name, day_of_week) => {
          const saved = hoursRes.data.find((row) => Number(row.day_of_week) === day_of_week);
          return {
            day_of_week,
            name,
            is_open: Boolean(saved?.is_confirmed),
            opens_at: saved?.opens_at?.slice(0, 5) || '08:00',
            closes_at: saved?.closes_at?.slice(0, 5) || '21:00',
          };
        }));
      }

    } catch (error) {
      Alert.alert('Error de Carga', error.message);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    const initialLoad = setTimeout(() => { void loadDashboardData(); }, 0);
    return () => clearTimeout(initialLoad);
  }, [loadDashboardData]);

  useEffect(() => {
    if (!business?.id) return undefined;
    let active = true;
    const refreshStatus = async () => {
      try {
        const { data, error } = await supabase.rpc('get_business_operating_status', {
          p_business_id: business.id,
        });
        if (error) throw error;
        if (!active) return;
        setCurrentOperatingStatus(data);
        setOperatingStatusError('');
      } catch (error) {
        if (!active) return;
        setOperatingStatusError('No se pudo consultar el horario actual.');
        console.error('No se pudo consultar el horario operativo:', error.message);
      }
    };
    void refreshStatus();
    const timer = setInterval(() => { void refreshStatus(); }, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [business?.id]);

  const updateBusinessStatus = async (newStatus) => {
    setBusinessStatusFeedback(null);
    if (newStatus === 'activo' && verificationStatus !== 'aprobado') {
      setBusinessStatusFeedback({ type: 'error', text: 'El negocio debe ser aprobado por el equipo administrador antes de activarse.' });
      return;
    }

    setSavingBusinessStatus(true);
    try {
      const { error } = await supabase
        .from('businesses')
        .update({ status: newStatus })
        .eq('id', business.id);

      if (error) throw error;

      setBusiness({ ...business, status: newStatus });
      const statusLabel = newStatus === 'fuera_de_servicio' ? 'bloqueado' : newStatus;
      setBusinessStatusFeedback({ type: 'success', text: `Estado del local actualizado: ${statusLabel}.` });
    } catch (error) {
      setBusinessStatusFeedback({ type: 'error', text: `No se pudo cambiar el estado: ${error.message}` });
      console.error('No se pudo actualizar el estado del negocio:', error.message);
    } finally {
      setSavingBusinessStatus(false);
    }
  };

  const handleAddProduct = async () => {
    if (!newProduct.name || !newProduct.price) {
      Alert.alert('Error', 'El nombre y el precio son obligatorios');
      return;
    }

    try {
      const { error } = await supabase
        .from('products')
        .insert([
          {
            ...newProduct,
            price: parseFloat(newProduct.price),
            business_id: business.id,
          },
        ]);

      if (error) throw error;

      setModalVisible(false);
      setNewProduct({ name: '', description: '', price: '', category: '' });
      // Recargamos solo la lista de productos
      const { data } = await supabase.from('products').select('*').eq('business_id', business.id);
      setProducts(data);

      Alert.alert('Éxito', 'Producto agregado correctamente');
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const handleBusinessPayment = async (purpose) => {
    setPaymentLoading(true);
    try {
      const paymentUrl = await createBusinessPaymentLink(purpose);
      await Linking.openURL(paymentUrl);
    } catch (error) {
      Alert.alert('No se pudo iniciar el pago', error.message);
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleBusinessPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploadingBusinessPhoto(true);
      const imageUrl = await uploadBusinessPhoto({ userId: profile.id, uri: result.assets[0].uri });
      setBusiness((current) => ({ ...current, store_image_url: imageUrl }));
      setPhotoFeedback({ type: 'success', text: 'La foto del local quedó guardada.' });
    } catch (error) {
      setPhotoFeedback({ type: 'error', text: `No se pudo guardar la foto: ${error.message}` });
    } finally {
      setUploadingBusinessPhoto(false);
    }
  };

  const saveOperatingHours = async () => {
    setOperatingHoursFeedback(null);
    setSavingOperatingHours(true);
    try {
      const openDays = operatingHours.filter((row) => row.is_open);
      if (!openDays.length) {
        throw new Error('Selecciona al menos un día de atención.');
      }
      for (const row of openDays) {
        if (!isValidOperatingTime(row.opens_at) || !isValidOperatingTime(row.closes_at)) {
          throw new Error(`Horario inválido en ${row.name}. Usa el formato 24 horas HH:mm.`);
        }
        if (!isOperatingRangeValid(row.opens_at, row.closes_at)) {
          throw new Error(`En ${row.name}, la hora de cierre debe ser posterior a la apertura.`);
        }
      }
      const { error } = await supabase.rpc('save_business_operating_hours', {
        p_hours: openDays.map(({ day_of_week, opens_at, closes_at }) => ({
          day_of_week,
          opens_at,
          closes_at,
        })),
        p_timezone: 'America/Bogota',
      });
      if (error) throw error;
      setOperatingHoursFeedback({
        type: 'success',
        text: 'Horario guardado. El estado actual se calcula según la hora de Colombia; los días cerrados no recibirán pedidos.',
      });
      try {
        const { data: statusData, error: statusError } = await supabase.rpc('get_business_operating_status', {
          p_business_id: business.id,
        });
        if (statusError) throw statusError;
        setCurrentOperatingStatus(statusData);
        setOperatingStatusError('');
      } catch (statusError) {
        setOperatingStatusError('Horario guardado, pero no se pudo actualizar el estado actual.');
        console.error('El horario se guardó, pero no se pudo refrescar su estado:', statusError.message);
      }
    } catch (error) {
      setOperatingHoursFeedback({ type: 'error', text: error.message });
    } finally {
      setSavingOperatingHours(false);
    }
  };

  const updatePickupEnabled = async (enabled) => {
    setSavingPickupSettings(true);
    try {
      const { error } = await supabase.rpc('set_business_pickup_enabled', {
        p_enabled: enabled,
      });
      if (error) throw error;
      setBusiness((current) => ({ ...current, pickup_enabled: enabled }));
    } catch (error) {
      Alert.alert('No se pudo actualizar el retiro en tienda', error.message);
    } finally {
      setSavingPickupSettings(false);
    }
  };

  const saveVerificationDetails = async () => {
    setVerificationFeedback(null);
    setSavingVerification(true);
    try {
      if (!verification?.legal_name?.trim()
        || !verification?.registration_id?.trim()
        || !verification?.complaint_email?.trim()) {
        setVerificationFeedback({ type: 'error', text: 'Completa razón social, identificación y correo de contacto.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verification.complaint_email.trim())) {
        setVerificationFeedback({ type: 'error', text: 'Ingresa un correo válido para recibir quejas y solicitudes.' });
        return;
      }

      const { error } = await supabase.from('business_verifications')
        .update({
          legal_name: verification.legal_name.trim(),
          registration_id_type: verification.registration_id_type,
          registration_id: verification.registration_id.trim(),
          complaint_email: verification.complaint_email.trim().toLowerCase(),
          verification_status: 'pendiente',
          review_note: null,
          reviewed_by: null,
          reviewed_at: null,
        })
        .eq('business_id', business.id)
        .select('business_id')
        .single();
      if (error) throw error;

      if (business.status === 'fuera_de_servicio') {
        const { error: statusError } = await supabase.from('businesses')
          .update({ status: 'inactivo' })
          .eq('id', business.id)
          .select('id')
          .single();
        if (statusError) throw statusError;
        setBusiness((current) => ({ ...current, status: 'inactivo' }));
      }

      setVerificationStatus('pendiente');
      setVerification((current) => ({
        ...current,
        verification_status: 'pendiente',
        review_note: null,
        reviewed_by: null,
        reviewed_at: null,
      }));
      setVerificationFeedback({ type: 'success', text: 'Datos guardados. El equipo de IstmiYa revisará el perfil.' });
    } catch (error) {
      setVerificationFeedback({ type: 'error', text: `No se pudieron guardar los datos: ${error.message}` });
    } finally {
      setSavingVerification(false);
    }
  };

  // --- COMPONENTES DE UI ---

  const renderProductItem = ({ item }) => (
    <View style={[styles.productCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.prodName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.prodCat, { color: colors.muted }]}>{item.category}</Text>
        <Text style={[styles.prodPrice, { color: colors.primary }]}>{formatCOP(item.price, locale)}</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1A237E" />
        <Text style={styles.loadingText}>Cargando panel de negocio...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.quickLinks}>
          <Text style={[styles.quickLinkLabel, { color: colors.text }]}>Panel del negocio</Text>
          <View style={styles.sessionActions}>
            <AnimatedButton title="Configuración" variant="secondary" onPress={() => navigation.navigate('Settings')} />
            <AnimatedButton title="Cerrar sesión" variant="secondary" onPress={async () => {
              const result = await signOut();
              if (result.success) navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
              else Alert.alert('Error', result.error || 'No se pudo cerrar la sesión.');
            }} />
          </View>
        </View>
        <HelpButton navigation={navigation} context="negocio" />

        <View style={[styles.metricsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Resumen del negocio</Text>
          <View style={styles.metricsGrid}>
            <Metric label="Pedidos" value={metrics.orders} colors={colors} />
            <Metric label="Activos" value={metrics.active_orders} colors={colors} />
            <Metric label="Entregados" value={metrics.completed_orders} colors={colors} />
            <Metric label="Quejas" value={metrics.complaints} colors={colors} />
          </View>
          <Text style={[styles.metricsSales, { color: colors.primary }]}>
            Ventas entregadas: {formatCOP(metrics.sales, locale)}
          </Text>
        </View>

        <View style={[styles.verificationCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Verificación del negocio</Text>
          <Text style={[styles.verificationText, { color: colors.muted }]}>
            {verificationStatus === 'aprobado'
              ? 'Perfil aprobado. Puedes activar tu local cuando esté listo.'
              : verificationStatus === 'rechazado'
                ? 'La revisión requiere correcciones. Contacta soporte para más información.'
                : 'Pendiente de revisión. El local no puede recibir pedidos hasta ser aprobado.'}
          </Text>
          {verificationStatus !== 'aprobado' && verification && (
            <View>
              <TextInput
                style={[styles.verificationInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.input }]}
                value={verification.legal_name || ''}
                onChangeText={(value) => setVerification((current) => ({ ...current, legal_name: value }))}
                placeholder="Razón social"
                placeholderTextColor={colors.muted}
              />
              <View style={styles.identificationTypeRow}>
                {['NIT', 'CC'].map((type) => (
                  <AnimatedButton
                    key={type}
                    title={type}
                    onPress={() => setVerification((current) => ({ ...current, registration_id_type: type }))}
                    variant={verification.registration_id_type === type ? 'primary' : 'secondary'}
                    style={styles.identificationType}
                  />
                ))}
              </View>
              <TextInput
                style={[styles.verificationInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.input }]}
                value={verification.registration_id || ''}
                onChangeText={(value) => setVerification((current) => ({ ...current, registration_id: value }))}
                placeholder="Número de identificación"
                placeholderTextColor={colors.muted}
              />
              <TextInput
                style={[styles.verificationInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.input }]}
                value={verification.complaint_email || ''}
                onChangeText={(value) => setVerification((current) => ({ ...current, complaint_email: value }))}
                placeholder="Correo para quejas y solicitudes"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              {verification.review_note
                ? <Text style={[styles.verificationText, { color: colors.muted }]}>Observación: {verification.review_note}</Text>
                : null}
              <AnimatedButton
                title={savingVerification ? 'Guardando...' : 'Guardar y enviar a revisión'}
                onPress={saveVerificationDetails}
                disabled={savingVerification}
                style={styles.photoButton}
              />
              {verificationFeedback ? (
                <Text
                  accessibilityRole="alert"
                  style={[
                    styles.actionFeedback,
                    { color: verificationFeedback.type === 'success' ? colors.primary : '#B3261E' },
                  ]}
                >
                  {verificationFeedback.text}
                </Text>
              ) : null}
            </View>
          )}
          {business?.store_image_url
            ? <Image source={{ uri: business.store_image_url }} style={styles.storeImage} />
            : null}
          <AnimatedButton
            title={uploadingBusinessPhoto ? 'Cargando foto...' : 'Actualizar foto del local'}
            onPress={handleBusinessPhoto}
            variant="secondary"
            disabled={uploadingBusinessPhoto}
            style={styles.photoButton}
          />
          {photoFeedback ? (
            <Text
              accessibilityRole="alert"
              style={[
                styles.actionFeedback,
                { color: photoFeedback.type === 'success' ? colors.primary : '#B3261E' },
              ]}
            >
              {photoFeedback.text}
            </Text>
          ) : null}
        </View>

        <WalletCard
          balance={wallet.balance}
          subscriptionActive={subscription.is_active}
          loading={paymentLoading}
          onTopUp={() => handleBusinessPayment('wallet')}
          onSubscribe={() => handleBusinessPayment('subscription')}
          onTransferBalance={() => navigation.navigate('BusinessWalletTransfers')}
        />
        <BannerUploader
          businessId={business.id}
          subscriptionActive={subscription.is_active}
          onUpgrade={() => handleBusinessPayment('subscription')}
        />
        <DeliverySettingsCard
          business={business}
          onSaved={(updatedBusiness) => setBusiness((current) => ({ ...current, ...updatedBusiness }))}
        />

        <View style={styles.operatingCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Retiro en tienda</Text>
          <Text style={[styles.verificationText, { color: colors.muted }]}>
            Cuando está habilitado, los clientes pueden pagar pedidos y reclamarlos en el local con un código. No se asignará repartidor.
          </Text>
          <AnimatedButton
            title={savingPickupSettings
              ? 'Guardando...'
              : business.pickup_enabled ? 'Deshabilitar retiro en tienda' : 'Habilitar retiro en tienda'}
            onPress={() => updatePickupEnabled(!business.pickup_enabled)}
            disabled={savingPickupSettings}
            variant={business.pickup_enabled ? 'secondary' : 'primary'}
          />
        </View>

        <View style={styles.operatingCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Horario operativo</Text>
          <Text style={[styles.verificationText, { color: colors.muted }]}>
            Activa los días en que atiendes y configura sus horas. El estado abierto/cerrado actual se calcula con la hora de Colombia (America/Bogota).
          </Text>
          <Text style={[styles.operatingDay, { color: colors.text }]}>Estado actual del local</Text>
          <Text accessibilityRole="alert" style={[styles.actionFeedback, { color: currentOperatingStatus?.is_open ? colors.primary : colors.muted }]}>
            {operatingStatusError || (currentOperatingStatus
              ? formatOperatingStatus(currentOperatingStatus)
              : 'Consultando horario actual…')}
          </Text>
          {operatingHours.map((row, index) => (
            <View key={row.day_of_week} style={styles.operatingDayGroup}>
              <View style={styles.operatingDayRow}>
                <Text style={[styles.operatingDay, { color: colors.text }]}>{row.name}</Text>
                <Switch
                  accessibilityLabel={`Atiende el ${row.name}`}
                  value={row.is_open}
                  onValueChange={(is_open) => setOperatingHours((current) => current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, is_open } : item))}
                />
                <Text style={[styles.operatingDayStatus, { color: colors.muted }]}>
                  {row.is_open ? 'Atiende' : 'Cerrado'}
                </Text>
              </View>
              {row.is_open ? (
                <View style={styles.operatingTimeRow}>
                  <TextInput
                    accessibilityLabel={`Hora de apertura del ${row.name}`}
                    value={row.opens_at}
                    onChangeText={(opens_at) => setOperatingHours((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, opens_at } : item))}
                    placeholder="08:00"
                    placeholderTextColor={colors.muted}
                    style={[styles.operatingInput, { color: colors.text, borderColor: colors.border }]}
                    maxLength={5}
                  />
                  <Text style={[styles.operatingSeparator, { color: colors.muted }]}>a</Text>
                  <TextInput
                    accessibilityLabel={`Hora de cierre del ${row.name}`}
                    value={row.closes_at}
                    onChangeText={(closes_at) => setOperatingHours((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, closes_at } : item))}
                    placeholder="21:00"
                    placeholderTextColor={colors.muted}
                    style={[styles.operatingInput, { color: colors.text, borderColor: colors.border }]}
                    maxLength={5}
                  />
                </View>
              ) : null}
            </View>
          ))}
          <AnimatedButton
            title={savingOperatingHours ? 'Guardando horario...' : 'Confirmar horario operativo'}
            onPress={saveOperatingHours}
            disabled={savingOperatingHours}
            style={styles.photoButton}
          />
          {operatingHoursFeedback ? (
            <Text
              accessibilityRole="alert"
              style={[
                styles.actionFeedback,
                { color: operatingHoursFeedback.type === 'success' ? colors.primary : '#B3261E' },
              ]}
            >
              {operatingHoursFeedback.text}
            </Text>
          ) : null}
        </View>

        {/* ESTADO OPERACIONAL */}
        <View style={styles.statusContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Estado del Local</Text>
          <View style={styles.statusRow}>
            {['activo', 'inactivo', 'fuera_de_servicio'].map((s) => (
              <AnimatedButton
                key={s}
                title={s === 'fuera_de_servicio' ? 'Bloqueado' : s.charAt(0).toUpperCase() + s.slice(1)}
                onPress={() => updateBusinessStatus(s)}
                disabled={savingBusinessStatus || (s === 'activo' && verificationStatus !== 'aprobado')}
                variant={business.status === s ? 'primary' : 'secondary'}
                style={styles.statusAction}
                buttonStyle={styles.statusBtn}
                textStyle={styles.statusBtnText}
              />
            ))}
          </View>
          {businessStatusFeedback ? (
            <Text
              accessibilityRole="alert"
              style={[styles.actionFeedback, { color: businessStatusFeedback.type === 'success' ? colors.primary : '#B3261E' }]}
            >
              {businessStatusFeedback.text}
            </Text>
          ) : null}
        </View>

        {/* GESTIÓN DE PRODUCTOS */}
        <View style={styles.productsSection}>
          <View style={styles.productsHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Mis Productos</Text>
            <AnimatedButton
              title="+ Agregar"
              onPress={() => setModalVisible(true)}
              style={styles.addAction}
              buttonStyle={styles.addBtn}
            />
          </View>

          <FlatList
            data={products}
            renderItem={renderProductItem}
            keyExtractor={(item) => item.id}
            scrollEnabled={false} // El ScrollView padre maneja el scroll
            ListEmptyComponent={<Text style={styles.emptyText}>No tienes productos registrados.</Text>}
          />
        </View>
      </ScrollView>

      {/* MODAL AGREGAR PRODUCTO */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Nuevo Producto</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Nombre del producto"
              value={newProduct.name}
              onChangeText={(t) => setNewProduct({...newProduct, name: t})}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Descripción"
              value={newProduct.description}
              onChangeText={(t) => setNewProduct({...newProduct, description: t})}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Precio (Ej: 15000)"
              keyboardType="numeric"
              value={newProduct.price}
              onChangeText={(t) => setNewProduct({...newProduct, price: t})}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Categoría (Ej: Comida Rápida)"
              value={newProduct.category}
              onChangeText={(t) => setNewProduct({...newProduct, category: t})}
            />

            <View style={styles.modalButtons}>
              <AnimatedButton
                title="Cancelar"
                onPress={() => setModalVisible(false)}
                variant="secondary"
                style={styles.modalAction}
                buttonStyle={[styles.btnModal, styles.btnCancel]}
                textStyle={styles.btnCancelText}
              />
              <AnimatedButton
                title="Guardar"
                onPress={handleAddProduct}
                style={styles.modalAction}
                buttonStyle={[styles.btnModal, styles.btnSave]}
                textStyle={styles.btnSaveText}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  quickLinks: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sessionActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickLinkLabel: { fontSize: 20, fontWeight: '700' },
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  scrollContent: { padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F7FA' },
  loadingText: { marginTop: 10, color: '#1A237E', fontSize: 16 },

  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A237E', marginBottom: 15 },
  verificationCard: { padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 20 },
  metricsCard: { padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 20 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  metric: { width: '48%', borderRadius: 10, padding: 12, marginBottom: 8 },
  metricValue: { fontSize: 22, fontWeight: '800' },
  metricLabel: { fontSize: 12, marginTop: 2 },
  metricsSales: { fontSize: 16, fontWeight: '700', marginTop: 10 },
  verificationText: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  storeImage: { width: '100%', height: 170, borderRadius: 12, marginBottom: 10 },
  photoButton: { alignSelf: 'stretch' },
  actionFeedback: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 10 },
  verificationInput: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  identificationTypeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  identificationType: { flex: 1, alignSelf: 'stretch' },

  operatingCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 20,
  },
  operatingDayGroup: { marginBottom: 8 },
  operatingDayRow: { flexDirection: 'row', alignItems: 'center' },
  operatingDay: { flex: 1, fontSize: 13, fontWeight: '700' },
  operatingDayStatus: { width: 62, fontSize: 12, textAlign: 'right' },
  operatingTimeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  operatingInput: {
    width: 72,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: 'center',
  },
  operatingSeparator: { marginHorizontal: 8, fontSize: 13 },

  // Status Section
  statusContainer: { marginBottom: 25 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statusAction: { flex: 1, alignSelf: 'stretch', marginHorizontal: 3 },
  statusBtn: { width: '100%', paddingHorizontal: 5, borderRadius: 10 },
  statusBtnText: { fontSize: 11 },

  // Products Section
  productsSection: { marginTop: 10 },
  productsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  addAction: { alignSelf: 'auto' },
  addBtn: { padding: 10, borderRadius: 8 },
  productCard: {
    padding: 15, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: '#E0E0E0', elevation: 1
  },
  prodName: { fontSize: 16, fontWeight: 'bold' },
  prodCat: { fontSize: 12, marginVertical: 2 },
  prodPrice: { fontSize: 15, fontWeight: 'bold' },
  emptyText: { textAlign: 'center', color: '#757575', marginTop: 20 },

  // Modal Styles
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: 20
  },
  modalContent: {
    backgroundColor: '#fff', width: '100%', borderRadius: 20,
    padding: 25, elevation: 10
  },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#1A237E', marginBottom: 20, textAlign: 'center' },
  modalInput: {
    backgroundColor: '#F5F7FA', padding: 15, borderRadius: 12,
    marginBottom: 15, borderWidth: 1, borderColor: '#E0E0E0'
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  modalAction: { flex: 1, alignSelf: 'stretch', marginHorizontal: 5 },
  btnModal: { width: '100%', padding: 15, borderRadius: 12 },
  btnCancel: { backgroundColor: '#E0E0E0' },
  btnCancelText: { color: '#333', fontWeight: 'bold' },
  btnSave: { backgroundColor: '#1A237E' },
  btnSaveText: { color: '#fff', fontWeight: 'bold' },


});



export default BusinessHomeScreen;
