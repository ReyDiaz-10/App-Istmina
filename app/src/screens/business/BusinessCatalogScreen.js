import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAuthStore } from '../../store/authStore';
import AnimatedButton from '../../components/AnimatedButton';
import { formatCOP } from '../../utils/formatters';

const EMPTY_PRODUCT = {
  name: '',
  description: '',
  category: '',
  price: '',
  inventory_enabled: false,
  stock_quantity: '',
  is_available: true,
};

const EMPTY_OPTION = {
  option_group: 'Opciones',
  name: '',
  option_type: 'variant',
  price_delta: '0',
  is_available: true,
  is_required: false,
};

export default function BusinessCatalogScreen() {
  const { colors } = useAppTheme();
  const profile = useAuthStore((state) => state.profile);
  const [businessId, setBusinessId] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [optionModal, setOptionModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingOption, setEditingOption] = useState(null);
  const [optionProduct, setOptionProduct] = useState(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT);
  const [optionForm, setOptionForm] = useState(EMPTY_OPTION);

  const loadProducts = useCallback(async (id) => {
    if (!id) return;
    const { data, error } = await supabase
      .from('products')
      .select('*, product_options(*)')
      .eq('business_id', id)
      .order('name');
    if (error) throw error;
    setProducts(data || []);
  }, [businessId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('id')
          .eq('profile_id', profile?.id)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('No se encontró el negocio asociado a esta cuenta.');
        if (!active) return;
        setBusinessId(data.id);
        await loadProducts(data.id);
      } catch (error) {
        Alert.alert('No se pudo cargar el catálogo', error.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    if (profile?.id) load();
    else setLoading(false);
    return () => { active = false; };
  }, [profile?.id, loadProducts]);

  const openNewProduct = () => {
    setEditingProduct(null);
    setProductForm(EMPTY_PRODUCT);
    setProductModal(true);
  };

  const openEditProduct = (product) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name || '',
      description: product.description || '',
      category: product.category || '',
      price: String(product.price ?? ''),
      inventory_enabled: Boolean(product.inventory_enabled),
      stock_quantity: product.stock_quantity == null ? '' : String(product.stock_quantity),
      is_available: product.is_available !== false,
    });
    setProductModal(true);
  };

  const saveProduct = async () => {
    const price = Number(productForm.price);
    const stock = Number(productForm.stock_quantity);
    if (!productForm.name.trim() || !Number.isFinite(price) || price <= 0) {
      Alert.alert('Datos incompletos', 'Escribe el nombre del producto y un precio mayor que cero.');
      return;
    }
    if (productForm.inventory_enabled && (!Number.isInteger(stock) || stock < 0)) {
      Alert.alert('Inventario inválido', 'El inventario debe ser un número entero igual o mayor que cero.');
      return;
    }
    setSaving(true);
    try {
      const values = {
        name: productForm.name.trim(),
        description: productForm.description.trim() || null,
        category: productForm.category.trim() || null,
        price,
        inventory_enabled: productForm.inventory_enabled,
        stock_quantity: productForm.inventory_enabled ? stock : null,
        is_available: productForm.is_available,
      };
      const query = editingProduct
        ? supabase.from('products').update(values).eq('id', editingProduct.id).eq('business_id', businessId)
        : supabase.from('products').insert({ ...values, business_id: businessId });
      const { error } = await query;
      if (error) throw error;
      await loadProducts(businessId);
      setProductModal(false);
    } catch (error) {
      Alert.alert('No se pudo guardar el producto', error.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = (product) => {
    Alert.alert('Eliminar producto', `¿Deseas eliminar "${product.name}" del catálogo?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('products')
              .delete().eq('id', product.id).eq('business_id', businessId);
            if (error) throw error;
            await loadProducts(businessId);
          } catch (error) {
            Alert.alert('No se pudo eliminar el producto', error.message);
          }
        },
      },
    ]);
  };

  const openOptionEditor = (product, option = null) => {
    setOptionProduct(product);
    setEditingOption(option);
    setOptionForm(option ? {
      option_group: option.option_group,
      name: option.name,
      option_type: option.option_type,
      price_delta: String(option.price_delta ?? 0),
      is_available: option.is_available,
      is_required: option.is_required,
    } : EMPTY_OPTION);
    setOptionModal(true);
  };

  const saveOption = async () => {
    const priceDelta = Number(optionForm.price_delta);
    if (!optionForm.name.trim() || !optionForm.option_group.trim()
      || !Number.isFinite(priceDelta) || priceDelta < 0) {
      Alert.alert('Datos incompletos', 'Escribe el grupo, nombre y un precio adicional válido.');
      return;
    }
    setSaving(true);
    try {
      const values = {
        option_group: optionForm.option_group.trim(),
        name: optionForm.name.trim(),
        option_type: optionForm.option_type,
        price_delta: priceDelta,
        is_available: optionForm.is_available,
        is_required: optionForm.is_required,
      };
      const query = editingOption
        ? supabase.from('product_options').update(values).eq('id', editingOption.id).eq('business_id', businessId)
        : supabase.from('product_options').insert({
          ...values,
          product_id: optionProduct.id,
          business_id: businessId,
        });
      const { error } = await query;
      if (error) throw error;
      await loadProducts(businessId);
      setOptionModal(false);
    } catch (error) {
      Alert.alert('No se pudo guardar la opción', error.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteOption = (option) => {
    Alert.alert('Eliminar opción', `¿Deseas eliminar "${option.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('product_options')
              .delete().eq('id', option.id).eq('business_id', businessId);
            if (error) throw error;
            await loadProducts(businessId);
          } catch (error) {
            Alert.alert('No se pudo eliminar la opción', error.message);
          }
        },
      },
    ]);
  };

  const styles = createStyles();

  if (loading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Catálogo de productos</Text>
        <AnimatedButton title="Agregar" onPress={openNewProduct} />
      </View>
      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const options = item.product_options || [];
          return (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.productHeader}>
                <View style={styles.productCopy}>
                  <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
                  {item.category ? <Text style={[styles.meta, { color: colors.muted }]}>{item.category}</Text> : null}
                  <Text style={[styles.price, { color: colors.primary }]}>{formatCOP(item.price)}</Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {item.is_available
                      ? item.inventory_enabled ? `Disponible · Existencias: ${item.stock_quantity}` : 'Disponible · Sin control de existencias'
                      : 'No disponible'}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <Pressable onPress={() => openEditProduct(item)}><Text style={styles.link}>Editar</Text></Pressable>
                  <Pressable onPress={() => deleteProduct(item)}><Text style={[styles.link, styles.delete]}>Eliminar</Text></Pressable>
                </View>
              </View>
              <View style={styles.optionsHeader}>
                <Text style={[styles.optionsTitle, { color: colors.text }]}>Variantes y extras ({options.length})</Text>
                <Pressable onPress={() => openOptionEditor(item)}><Text style={styles.link}>Agregar opción</Text></Pressable>
              </View>
              {options.map((option) => (
                <View key={option.id} style={styles.optionRow}>
                  <Text style={[styles.meta, { color: colors.muted, flex: 1 }]}>
                    {option.option_group}: {option.name} · {option.option_type === 'variant' ? 'Variante' : 'Extra'}
                    {Number(option.price_delta) ? ` · +${formatCOP(option.price_delta)}` : ''}
                    {!option.is_available ? ' · Oculta' : ''}
                    {option.is_required ? ' · Obligatoria' : ''}
                  </Text>
                  <Pressable onPress={() => openOptionEditor(item, option)}><Text style={styles.link}>Editar</Text></Pressable>
                  <Pressable onPress={() => deleteOption(option)}><Text style={[styles.link, styles.delete]}>×</Text></Pressable>
                </View>
              ))}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={[styles.empty, { color: colors.muted }]}>Aún no tienes productos. Agrega el primero para publicarlo en tu tienda.</Text>}
      />

      <Modal visible={productModal} transparent animationType="slide" onRequestClose={() => setProductModal(false)}>
        <View style={styles.backdrop}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalScroll}>
            <View style={[styles.modal, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{editingProduct ? 'Editar producto' : 'Nuevo producto'}</Text>
              <TextInput value={productForm.name} onChangeText={(name) => setProductForm((current) => ({ ...current, name }))} placeholder="Nombre" placeholderTextColor={colors.muted} style={styles.input} maxLength={120} />
              <TextInput value={productForm.description} onChangeText={(description) => setProductForm((current) => ({ ...current, description }))} placeholder="Descripción" placeholderTextColor={colors.muted} style={[styles.input, styles.multiline]} multiline maxLength={500} />
              <TextInput value={productForm.category} onChangeText={(category) => setProductForm((current) => ({ ...current, category }))} placeholder="Categoría (p. ej. Comida, Postres)" placeholderTextColor={colors.muted} style={styles.input} maxLength={60} />
              <TextInput value={productForm.price} onChangeText={(price) => setProductForm((current) => ({ ...current, price }))} placeholder="Precio en COP" keyboardType="decimal-pad" placeholderTextColor={colors.muted} style={styles.input} />
              <View style={styles.switchRow}><Text style={[styles.meta, { color: colors.text }]}>Disponible en la tienda</Text><Switch value={productForm.is_available} onValueChange={(is_available) => setProductForm((current) => ({ ...current, is_available }))} /></View>
              <View style={styles.switchRow}><Text style={[styles.meta, { color: colors.text }]}>Controlar existencias</Text><Switch value={productForm.inventory_enabled} onValueChange={(inventory_enabled) => setProductForm((current) => ({ ...current, inventory_enabled }))} /></View>
              {productForm.inventory_enabled ? (
                <TextInput value={productForm.stock_quantity} onChangeText={(stock_quantity) => setProductForm((current) => ({ ...current, stock_quantity }))} placeholder="Unidades disponibles" keyboardType="number-pad" placeholderTextColor={colors.muted} style={styles.input} />
              ) : null}
              <View style={styles.modalActions}>
                <AnimatedButton title="Cancelar" variant="secondary" onPress={() => setProductModal(false)} />
                <AnimatedButton title={saving ? 'Guardando...' : 'Guardar'} disabled={saving} onPress={saveProduct} />
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={optionModal} transparent animationType="slide" onRequestClose={() => setOptionModal(false)}>
        <View style={styles.backdrop}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalScroll}>
            <View style={[styles.modal, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{editingOption ? 'Editar opción' : 'Nueva variante o extra'}</Text>
              <TextInput value={optionForm.option_group} onChangeText={(option_group) => setOptionForm((current) => ({ ...current, option_group }))} placeholder="Grupo (p. ej. Tamaño)" placeholderTextColor={colors.muted} style={styles.input} maxLength={60} />
              <TextInput value={optionForm.name} onChangeText={(name) => setOptionForm((current) => ({ ...current, name }))} placeholder="Nombre de la opción" placeholderTextColor={colors.muted} style={styles.input} maxLength={100} />
              <View style={styles.typeRow}>
                {['variant', 'extra'].map((type) => (
                  <Pressable key={type} onPress={() => setOptionForm((current) => ({ ...current, option_type: type }))} style={[styles.typeChoice, optionForm.option_type === type && styles.typeChoiceActive]}>
                    <Text style={{ color: optionForm.option_type === type ? '#FFFFFF' : colors.text }}>{type === 'variant' ? 'Variante' : 'Extra'}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput value={optionForm.price_delta} onChangeText={(price_delta) => setOptionForm((current) => ({ ...current, price_delta }))} placeholder="Precio adicional en COP" keyboardType="decimal-pad" placeholderTextColor={colors.muted} style={styles.input} />
              <View style={styles.switchRow}><Text style={[styles.meta, { color: colors.text }]}>Disponible</Text><Switch value={optionForm.is_available} onValueChange={(is_available) => setOptionForm((current) => ({ ...current, is_available }))} /></View>
              <View style={styles.switchRow}><Text style={[styles.meta, { color: colors.text }]}>Selección obligatoria</Text><Switch value={optionForm.is_required} onValueChange={(is_required) => setOptionForm((current) => ({ ...current, is_required }))} /></View>
              <View style={styles.modalActions}>
                <AnimatedButton title="Cancelar" variant="secondary" onPress={() => setOptionModal(false)} />
                <AnimatedButton title={saving ? 'Guardando...' : 'Guardar'} disabled={saving} onPress={saveOption} />
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  container: { flex: 1, padding: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 21, fontWeight: '800', flex: 1 },
  list: { paddingBottom: 24, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  productHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  productCopy: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700' },
  price: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  link: { color: '#3949AB', fontSize: 13, fontWeight: '700', padding: 4 },
  delete: { color: '#B3261E' },
  optionsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  optionsTitle: { fontSize: 13, fontWeight: '700' },
  optionRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D5D7DD', marginTop: 4, paddingTop: 4 },
  empty: { textAlign: 'center', marginTop: 40, lineHeight: 20 },
  backdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalScroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  modal: { borderRadius: 16, padding: 18, gap: 10 },
  modalTitle: { fontSize: 19, fontWeight: '800', marginBottom: 2 },
  input: { borderWidth: 1, borderColor: '#D5D7DD', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#222222' },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeChoice: { flex: 1, alignItems: 'center', padding: 10, borderWidth: 1, borderColor: '#D5D7DD', borderRadius: 8 },
  typeChoiceActive: { backgroundColor: '#3949AB', borderColor: '#3949AB' },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 6 },
});
