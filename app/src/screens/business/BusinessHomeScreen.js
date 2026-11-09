// app/src/screens/business/BusinessHomeScreen.js
import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TouchableOpacity, FlatList, 
  TextInput, Modal, ActivityIndicator, Alert, ScrollView, SafeAreaView 
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';

const BusinessHomeScreen = () => {
  // Estados de Datos
  const { profile } = useAuthStore();
  const [business, setBusiness] = useState(null);
  const [products, setProducts] = useState([]);
  const [wallet, setWallet] = useState({ balance: 0 });
  const [subscription, setSubscription] = useState({ is_active: false });
  const [loading, setLoading] = useState(true);

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
      setSubscription({ is_active: subRes.data?.is_active || false });
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

  // --- COMPONENTES DE UI ---

  const renderProductItem = ({ item }) => (
    <View style={styles.productCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.prodName}>{item.name}</Text>
        <Text style={styles.prodCat}>{item.category}</Text>
        <Text style={styles.prodPrice}>${item.price}</Text>
      </View>
      <TouchableOpacity style={styles.editBtn}>
        <Text style={styles.editBtnText}>✏️</Text>
      </TouchableOpacity>
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

const handlePaySubscription = async () => {
  try {
    // Llamamos a la Edge Function de Supabase que crea el link de Wompi
    const { data, error } = await supabase.functions.invoke('create-wompi-payment', {
      body: { businessId: business.id, amount: 30000 }
    });

    if (error) throw error;
 import('react-native').then(({ Linking }) => {
      Linking.openURL(data.payment_url);
    });

  } catch (error) {
    Alert.alert('Error', 'No se pudo generar el link de pago');
  }
};

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* SECCIÓN FINANCIERA */}
        <View style={styles.financeCard}>
                  <TouchableOpacity
                      style={styles.paySubBtn}
                      onPress={() => handlePaySubscription()}
                  >
                      <Text style={styles.paySubText}>Pagar Suscripción (30.000 COP)</Text>
                  </TouchableOpacity>
          <Text style={styles.sectionTitle}>Mi Billetera</Text>
          <Text style={styles.balanceText}>${wallet.balance.toFixed(2)}</Text>
          <View style={styles.subBadge}>
            <Text style={styles.subText}>
              Suscripción: {subscription.is_active ? '✅ Activa' : '❌ Inactiva'}
            </Text>
          </View>
        </View>

        {/* ESTADO OPERACIONAL */}
        <View style={styles.statusContainer}>
          <Text style={styles.sectionTitle}>Estado del Local</Text>
          <View style={styles.statusRow}>
            {['activo', 'inactivo', 'fuera_de_servicio'].map((s) => (
              <TouchableOpacity 
                key={s} 
                style={[styles.statusBtn, business.status === s && styles.statusBtnActive]} 
                onPress={() => updateBusinessStatus(s)}
              >
                <Text style={[styles.statusBtnText, business.status === s && styles.statusBtnTextActive]}>
                  {s === 'fuera_de_servicio' ? 'Bloqueado' : s.charAt(0).toUpperCase() + s.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* GESTIÓN DE PRODUCTOS */}
        <View style={styles.productsSection}>
          <View style={styles.productsHeader}>
            <Text style={styles.sectionTitle}>Mis Productos</Text>
            <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
              <Text style={styles.addBtnText}>+ Agregar</Text>
            </TouchableOpacity>
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
              <TouchableOpacity 
                style={[styles.btnModal, styles.btnCancel]} 
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.btnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.btnModal, styles.btnSave]} 
                onPress={handleAddProduct}
              >
                <Text style={styles.btnSaveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  scrollContent: { padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F7FA' },
  loadingText: { marginTop: 10, color: '#1A237E', fontSize: 16 },
  
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A237E', marginBottom: 15 },
  
  // Finance Card
  financeCard: { 
    backgroundColor: '#1A237E', 
    padding: 25, 
    borderRadius: 20, 
    alignItems: 'center', 
    marginBottom: 25,
    elevation: 5,
  },
  balanceText: { fontSize: 36, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  subBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 20 },
  subText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Status Section
  statusContainer: { marginBottom: 25 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statusBtn: { 
    flex: 1, padding: 12, marginHorizontal: 5, 
    borderRadius: 10, backgroundColor: '#fff', 
    borderWidth: 1, borderColor: '#1A237E', alignItems: 'center' 
  },
  statusBtnActive: { backgroundColor: '#1A237E' },
  statusBtnText: { color: '#1A237E', fontWeight: '600', fontSize: 12 },
  statusBtnTextActive: { color: '#fff' },

  // Products Section
  productsSection: { marginTop: 10 },
  productsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  addBtn: { backgroundColor: '#1A237E', padding: 10, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: 'bold' },
  productCard: { 
    backgroundColor: '#fff', padding: 15, borderRadius: 12, 
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: '#E0E0E0', elevation: 1 
  },
  prodName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  prodCat: { fontSize: 12, color: '#757575', marginVertical: 2 },
  prodPrice: { fontSize: 15, fontWeight: 'bold', color: '#2E7D32' },
  editBtn: { backgroundColor: '#F5F7FA', padding: 8, borderRadius: 8 },
  editBtnText: { fontSize: 16 },
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
  btnModal: { flex: 1, padding: 15, borderRadius: 12, alignItems: 'center', marginHorizontal: 5 },
  btnCancel: { backgroundColor: '#E0E0E0' },
  btnCancelText: { color: '#333', fontWeight: 'bold' },
  btnSave: { backgroundColor: '#1A237E' },
  btnSaveText: { color: '#fff', fontWeight: 'bold' },


  paySubBtn: { 
  backgroundColor: '#fff', 
  padding: 12, 
  borderRadius: 10, 
  marginTop: 15, 
  width: '100%', 
  alignItems: 'center' 
},
paySubText: { color: '#1A237E', fontWeight: 'bold', fontSize: 14 },
});



export default BusinessHomeScreen;
