// app/src/screens/client/StoreDetailScreen.js
import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, View, Text, FlatList, ActivityIndicator, 
  TouchableOpacity, Image 
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useCartStore } from '../../store/cartStore'; // Importamos el store del carrito

const StoreDetailScreen = ({ route, navigation }) => { // Añadimos navigation a los props
  const { businessId } = route.params;
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Extraemos la función addItem del store
  const { addItem } = useCartStore();

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', businessId);

      if (error) throw error;
      setProducts(data);
    } catch (error) {
      console.error('Error cargando productos:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const renderProduct = ({ item }) => (
    <View style={styles.productCard}>
      <View style={styles.productInfo}>
        <Text style={styles.productName}>{item.name}</Text>
        <Text style={styles.productDesc}>{item.description}</Text>
        <Text style={styles.productPrice}>${item.price}</Text>
      </View>
      <TouchableOpacity 
        style={styles.addButton} 
        onPress={() => {
          // Agregamos el producto al carrito. 
          // Pasamos el item completo que ya incluye el business_id
          addItem({
            id: item.id,
            name: item.name,
            price: item.price,
            businessId: item.business_id
          });
        }}
      >
        <Text style={styles.addButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color="#1A237E" style={{ marginTop: 50 }} />
      ) : (
        <>
          <FlatList 
            data={products} 
            keyExtractor={(item) => item.id} 
            renderItem={renderProduct} 
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={styles.emptyText}>Este negocio aún no tiene productos disponibles.</Text>}
          />
          
          {/* BOTÓN FLOTANTE PARA IR AL CARRITO */}
          <TouchableOpacity 
            style={styles.cartFloatingButton} 
            onPress={() => navigation.navigate('Cart')}
          >
            <Text style={styles.cartFloatingText}>Ver Carrito 🛒</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  listContent: { padding: 20, paddingBottom: 100 }, // Añadimos padding inferior para que el botón no tape el último producto
  productCard: { 
    backgroundColor: '#fff', 
    borderRadius: 12, 
    padding: 15, 
    marginBottom: 15, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    borderWidth: 1, 
    borderColor: '#E0E0E0',
    elevation: 2,
  },
  productInfo: { flex: 1, marginRight: 10 },
  productName: { fontSize: 16, fontWeight: 'bold', color: '#1A237E' },
  productDesc: { fontSize: 14, color: '#757575', marginVertical: 4 },
  productPrice: { fontSize: 16, fontWeight: 'bold', color: '#2E7D32' },
  addButton: { 
    backgroundColor: '#1A237E', 
    width: 35, 
    height: 35, 
    borderRadius: 17.5, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#757575', fontSize: 16 },
  
  // ESTILOS DEL BOTÓN FLOTANTE
  cartFloatingButton: { 
    position: 'absolute', 
    bottom: 30, 
    right: 20, 
    left: 20, // Lo expandí un poco para que sea más fácil de tocar
    backgroundColor: '#1A237E', 
    padding: 18, 
    borderRadius: 30, 
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  cartFloatingText: { 
    color: '#fff', 
    fontWeight: 'bold', 
    fontSize: 18 
  },
});

export default StoreDetailScreen;
