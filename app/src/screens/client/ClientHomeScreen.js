// app/src/screens/client/ClientHomeScreen.js
import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, View, Text, FlatList, TextInput, 
  TouchableOpacity, ActivityIndicator, Image, ScrollView 
} from 'react-native';
import { supabase } from '../../api/supabaseClient';

const CATEGORIES = ['🍔 Comida', '🛒 Super', '💊 Farmacia', '🛠️ Servicios', '🍰 Postres'];

const ClientHomeScreen = ({ navigation }) => {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('Todos');

  useEffect(() => {
    fetchBusinesses();
  }, []);

  const fetchBusinesses = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('status', 'activo'); // Solo negocios activos

      if (error) throw error;
      setBusinesses(data);
    } catch (error) {
      console.error('Error cargando negocios:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const renderBusinessCard = ({ item }) => (
    <TouchableOpacity 
      style={styles.card} 
      onPress={() => navigation.navigate('StoreDetail', { businessId: item.id, storeName: item.store_name })}
    >
      <View style={styles.cardImagePlaceholder} />
      <View style={styles.cardContent}>
        <Text style={styles.storeName}>{item.store_name}</Text>
        <Text style={styles.storeInfo}>⏱️ {item.prep_time_t} min • {item.address}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Barra de búsqueda */}
      <View style={styles.searchContainer}>
        <TextInput 
          style={styles.searchInput} 
          placeholder="Busca tu producto o negocio favorito..." 
        />
      </View>

      {/* Categorías */}
      <View style={{ height: 60 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryList}>
          <TouchableOpacity 
            style={[styles.categoryItem, category === 'Todos' && styles.categoryActive]} 
            onPress={() => setCategory('Todos')}
          >
            <Text style={[styles.categoryText, category === 'Todos' && styles.categoryTextActive]}>Todos</Text>
          </TouchableOpacity>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity 
              key={cat} 
              style={[styles.categoryItem, category === cat && styles.categoryActive]} 
              onPress={() => setCategory(cat)}
            >
              <Text style={[styles.categoryText, category === cat && styles.categoryTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Lista de Negocios */}
      {loading ? (
        <ActivityIndicator size="large" color="#1A237E" style={{ marginTop: 50 }} />
      ) : (
        <FlatList 
          data={businesses} 
          keyExtractor={(item) => item.id} 
          renderItem={renderBusinessCard} 
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>No hay negocios activos en este momento.</Text>}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  searchContainer: { padding: 20, paddingTop: 10 },
  searchInput: { 
    backgroundColor: '#fff', 
    padding: 15, 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: '#E0E0E0',
    fontSize: 16 
  },
  categoryList: { paddingHorizontal: 20, alignItems: 'center' },
  categoryItem: { 
    paddingHorizontal: 20, 
    paddingVertical: 10, 
    borderRadius: 20, 
    backgroundColor: '#fff', 
    marginRight: 10, 
    borderWidth: 1, 
    borderColor: '#E0E0E0',
    height: 40
  },
  categoryActive: { backgroundColor: '#1A237E', borderColor: '#1A237E' },
  categoryText: { color: '#757575', fontWeight: '600' },
  categoryTextActive: { color: '#fff' },
  listContent: { padding: 20 },
  card: { 
    backgroundColor: '#fff', 
    borderRadius: 15, 
    marginBottom: 20, 
    overflow: 'hidden', 
    elevation: 3, 
    shadowColor: '#000', 
    shadowOpacity: 0.1, 
    shadowRadius: 5, 
    shadowOffset: { width: 0, height: 2 } 
  },
  cardImagePlaceholder: { height: 120, backgroundColor: '#C5CAE9' },
  cardContent: { padding: 15 },
  storeName: { fontSize: 18, fontWeight: 'bold', color: '#1A237E' },
  storeInfo: { fontSize: 14, color: '#757575', marginTop: 5 },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#757575', fontSize: 16 }
});

export default ClientHomeScreen;
