// app/src/screens/business/BusinessHomeScreen.js
import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import AnimatedButton from '../../components/AnimatedButton';
import WalletCard from '../../components/WalletCard';
import { createBusinessPaymentLink } from '../../services/orders';
import HelpButton from '../../components/HelpButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCOP } from '../../utils/formatters';

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
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Estados de Interfaz (UI)
  const [modalVisible, setModalVisible] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    price: '',
    category: '',
  });

  useEffect(() => {
    loadDashboardData();
  }, []);

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
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime business finance subscription failed: ${status}`);
        }
      });

    return () => supabase.removeChannel(channel);
  }, [business?.id]);

  // --- LÓGICA DE DATOS ---

  const loadDashboardData = async () => {
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
      const [walletRes, subRes, prodRes] = await Promise.all([
        supabase.from('wallets').select('*').eq('business_id', businessData.id).single(),
        supabase.from('subscriptions').select('*').eq('business_id', businessData.id).maybeSingle(),
        supabase.from('products').select('*').eq('business_id', businessData.id)
      ]);

      if (walletRes.error) throw walletRes.error;
      if (prodRes.error) throw prodRes.error;

      setWallet({ balance: walletRes.data?.balance || 0 });
      const today = new Date().toISOString().slice(0, 10);
      setSubscription({
        is_active: Boolean(
          subRes.data?.is_active
          && subRes.data.start_date <= today
          && subRes.data.end_date >= today,
        ),
      });
      setProducts(prodRes.data || []);

    } catch (error) {
      Alert.alert('Error de Carga', error.message);
    } finally {
      setLoading(false);
    }
  };

  const updateBusinessStatus = async (newStatus) => {
    try {
      const { error } = await supabase
        .from('businesses')
        .update({ status: newStatus })
        .eq('id', business.id);

      if (error) throw error;

      setBusiness({ ...business, status: newStatus });
      Alert.alert('Actualizado', `El negocio ahora está ${newStatus}`);
    } catch (error) {
      Alert.alert('Error', error.message);
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
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

        <WalletCard
          balance={wallet.balance}
          subscriptionActive={subscription.is_active}
          loading={paymentLoading}
          onTopUp={() => handleBusinessPayment('wallet')}
          onSubscribe={() => handleBusinessPayment('subscription')}
        />

        {/* ESTADO OPERACIONAL */}
        <View style={styles.statusContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Estado del Local</Text>
          <View style={styles.statusRow}>
            {['activo', 'inactivo', 'fuera_de_servicio'].map((s) => (
              <AnimatedButton
                key={s}
                title={s === 'fuera_de_servicio' ? 'Bloqueado' : s.charAt(0).toUpperCase() + s.slice(1)}
                onPress={() => updateBusinessStatus(s)}
                variant={business.status === s ? 'primary' : 'secondary'}
                style={styles.statusAction}
                buttonStyle={styles.statusBtn}
                textStyle={styles.statusBtnText}
              />
            ))}
          </View>
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
