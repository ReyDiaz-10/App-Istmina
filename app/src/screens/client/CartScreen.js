// app/src/screens/client/CartScreen.js
import React, { useState } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { supabase } from '../../api/supabaseClient';

const PAYMENT_METHODS = ['Nequi', 'Daviplata', 'QR', 'Efectivo'];

const CartScreen = () => {
  const { items, getTotal, clearCart, updateQuantity, removeItem } = useCartStore();
  const { user } = useAuthStore();
  const [paymentMethod, setPaymentMethod] = useState('Nequi');
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    if (items.length === 0) return;
    setLoading(true);

    try {
      // 1. Crear la orden en la tabla 'orders'
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert([
          {
            client_id: user.id,
            business_id: items[0].businessId, // Asumimos un solo negocio por pedido
            total_amount: getTotal(),
            payment_method: paymentMethod.toLowerCase(),
            status: 'pendiente',
          },
        ])
        .select()
        .single();

      if (orderError) throw orderError;

      // 2. Insertar los productos en 'order_items'
      const orderItems = items.map(item => ({
        order_id: order.id,
        product_id: item.id,
        quantity: item.quantity,
        unit_price: item.price,
      }));

      const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
      if (itemsError) throw itemsError;

      Alert.alert('¡Pedido Enviado!', 'El negocio recibirá tu pedido y confirmará el pago.');
      clearCart();
      // Aquí navegaríamos a una pantalla de "Mis Pedidos"
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mi Carrito</Text>
      
      <FlatList 
        data={items} 
        keyExtractor={(item) => item.id} 
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>${item.price}</Text>
            </View>
            <View style={styles.quantityControls}>
              <TouchableOpacity onPress={() => updateQuantity(item.id, -1)} style={styles.qtyBtn}>
                <Text style={styles.qtyText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.qtyNumber}>{item.quantity}</Text>
              <TouchableOpacity onPress={() => updateQuantity(item.id, 1)} style={styles.qtyBtn}>
                <Text style={styles.qtyText}>+</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.removeBtn}>
                <Text style={styles.removeText}>🗑️</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Tu carrito está vacío</Text>}
      />

      <View style={styles.footer}>
        <Text style={styles.totalLabel}>Total: <Text style={styles.totalAmount}>${getTotal()}</Text></Text>
        
        <Text style={styles.paymentLabel}>Método de Pago:</Text>
        <View style={styles.paymentGrid}>
          {PAYMENT_METHODS.map(method => (
            <TouchableOpacity 
              key={method} 
              style={[styles.paymentBtn, paymentMethod === method && styles.paymentBtnActive]} 
              onPress={() => setPaymentMethod(method)}
            >
              <Text style={[styles.paymentBtnText, paymentMethod === method && styles.paymentBtnTextActive]}>{method}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity 
          style={[styles.checkoutBtn, loading && styles.btnDisabled]} 
          onPress={handleCheckout} 
          disabled={loading || items.length === 0}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.checkoutText}>Confirmar Pedido</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1A237E', marginBottom: 20, marginTop: 10 },
  itemCard: { 
    backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10, 
    flexDirection: 'row', alignItems: 'center', elevation: 2 
  },
  itemName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  itemPrice: { fontSize: 14, color: '#2E7D32', fontWeight: '600' },
  quantityControls: { flexDirection: 'row', alignItems: 'center' },
  qtyBtn: { backgroundColor: '#E0E0E0', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  qtyText: { fontSize: 18, fontWeight: 'bold' },
  qtyNumber: { marginHorizontal: 10, fontSize: 16, fontWeight: 'bold' },
  removeBtn: { marginLeft: 15 },
  removeText: { fontSize: 18 },
  footer: { backgroundColor: '#fff', padding: 20, borderRadius: 20, elevation: 5, marginTop: 20 },
  totalLabel: { fontSize: 20, fontWeight: 'bold', textAlign: 'right', marginBottom: 15 },
  totalAmount: { color: '#2E7D32' },
  paymentLabel: { fontSize: 16, fontWeight: 'bold', color: '#555', marginBottom: 10 },
  paymentGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 20 },
  paymentBtn: { 
    backgroundColor: '#F5F7FA', padding: 10, borderRadius: 8, 
    borderWidth: 1, borderColor: '#E0E0E0', width: '48%', marginBottom: 10, alignItems: 'center' 
  },
  paymentBtnActive: { backgroundColor: '#1A237E', borderColor: '#1A237E' },
  paymentBtnText: { color: '#757575', fontSize: 13, fontWeight: '600' },
  paymentBtnTextActive: { color: '#fff' },
  checkoutBtn: { backgroundColor: '#1A237E', padding: 18, borderRadius: 12, alignItems: 'center' },
  btnDisabled: { backgroundColor: '#9FA8DA' },
  checkoutText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#757575' },
});

export default CartScreen;
