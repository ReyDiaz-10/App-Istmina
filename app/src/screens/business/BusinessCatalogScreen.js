// app/src/screens/business/BusinessCatalogScreen.js
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';

const BusinessCatalogScreen = () => {
  const { profile } = useAuthStore();
  const [products, setProducts] = useState([]);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    const { data } = await supabase.from('products').select('*').eq('business_id', (await getBusinessId()).id);
    setProducts(data || []);
  };

  const getBusinessId = async () => {
    const { data } = await supabase.from('businesses').select('*').eq('profile_id', profile.id).single();
    return data;
  };

  const deleteProduct = async (id) => {
    Alert.alert('Eliminar', '¿Estás seguro de eliminar este producto?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        await supabase.from('products').delete().eq('id', id);
        fetchProducts();
      }}
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList 
        data={products}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.price}>${item.price}</Text>
            </View>
            <TouchableOpacity onPress={() => deleteProduct(item.id)} style={styles.delBtn}>
              <Text style={styles.delText}>🗑️</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 12, flexDirection: 'row', marginBottom: 10, alignItems: 'center', elevation: 1 },
  name: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  price: { fontSize: 14, color: '#2E7D32', fontWeight: 'bold' },
  delBtn: { padding: 10 },
  delText: { fontSize: 18 }
});

export default BusinessCatalogScreen;
