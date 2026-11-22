import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
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
  image_url: null,
  image_uri: null,
};

const EMPTY_OPTION = {
  option_group: 'Opciones',
  name: '',
  option_type: 'variant',
  price_delta: '0',
  is_available: true,
  is_required: false,
};

const todayInBogota = () => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).reduce((values, part) => ({ ...values, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const getPromotion = (product) => Array.isArray(product?.product_promotions)
  ? product.product_promotions[0] || null
  : product?.product_promotions || null;

const formatPromotionRange = (promotion) => {
  if (!promotion) return '';
  const dates = promotion.start_date === promotion.end_date
    ? promotion.start_date
    : `${promotion.start_date} al ${promotion.end_date}`;
  return promotion.all_day
    ? `${dates} · todo el día`
    : `${dates} · ${String(promotion.start_time).slice(0, 5)}–${String(promotion.end_time).slice(0, 5)}`;
};

export default function BusinessCatalogScreen() {
  const { colors } = useAppTheme();
  const profile = useAuthStore((state) => state.profile);
  const [businessId, setBusinessId] = useState(null);
  const [products, setProducts] = useState([]);
  const [productMetrics, setProductMetrics] = useState({});
  const [availabilityRequests, setAvailabilityRequests] = useState([]);
  const [loading, setLoading] = useState(Boolean(profile?.id));
  const [saving, setSaving] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [optionModal, setOptionModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingOption, setEditingOption] = useState(null);
  const [optionProduct, setOptionProduct] = useState(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT);
  const [optionForm, setOptionForm] = useState(EMPTY_OPTION);
  const [promotionModal, setPromotionModal] = useState(false);
  const [promotionProduct, setPromotionProduct] = useState(null);
  const [promotionForm, setPromotionForm] = useState(null);

  const loadProducts = useCallback(async (id) => {
    if (!id) return;
    const [productsResult, metricsResult, requestsResult] = await Promise.all([
      supabase
        .from('products')
        .select('*, product_options(*), product_promotions(*)')
        .eq('business_id', id)
        .order('name'),
      supabase.rpc('business_product_order_metrics', { p_business_id: id }),
      supabase
        .from('product_availability_requests')
        .select('id, product_id, requester_id, created_at, products(name)')
        .eq('business_id', id)
        .eq('status', 'open')
        .order('created_at', { ascending: false }),
    ]);
    if (productsResult.error) throw productsResult.error;
    if (metricsResult.error) throw metricsResult.error;
    if (requestsResult.error) throw requestsResult.error;
    setProducts(productsResult.data || []);
    setProductMetrics(Object.fromEntries((metricsResult.data || []).map((metric) => [
      metric.product_id,
      { orderCount: Number(metric.order_count || 0), requestedUnits: Number(metric.requested_units || 0) },
    ])));
    setAvailabilityRequests(requestsResult.data || []);
  }, []);

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
    return () => { active = false; };
  }, [profile?.id, loadProducts]);

  useEffect(() => {
    if (!businessId) return undefined;
    const channel = supabase
      .channel(`business-catalog:${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_availability_requests', filter: `business_id=eq.${businessId}` },
        () => loadProducts(businessId),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products', filter: `business_id=eq.${businessId}` },
        () => loadProducts(businessId),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_promotions', filter: `business_id=eq.${businessId}` },
        () => loadProducts(businessId),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime business catalog subscription failed: ${status}`);
        }
      });
    return () => supabase.removeChannel(channel);
  }, [businessId, loadProducts]);

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
      image_url: product.image_url || null,
      image_uri: null,
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
        is_available: editingProduct ? editingProduct.is_available : productForm.is_available,
        image_url: productForm.image_url || null,
      };
      if (productForm.image_uri) {
        if (!profile?.id) throw new Error('No se encontró la sesión del negocio para subir la foto.');
        const response = await fetch(productForm.image_uri);
        if (!response.ok) throw new Error('No se pudo leer la foto seleccionada.');
        const blob = await response.blob();
        const contentType = blob.type || 'image/jpeg';
        const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
        const imagePath = `${profile.id}/product-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('business-images')
          .upload(imagePath, blob, { contentType, upsert: false });
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage
          .from('business-images')
          .getPublicUrl(imagePath);
        values.image_url = publicUrl;
      }
      const query = editingProduct
        ? supabase.from('products').update(values).eq('id', editingProduct.id).eq('business_id', businessId)
        : supabase.from('products').insert({ ...values, business_id: businessId });
      const { error } = await query;
      if (error) throw error;
      const availableStock = Number(productForm.stock_quantity || 0)
        - Number(editingProduct?.reserved_quantity || 0);
      if (editingProduct && (
        productForm.is_available !== editingProduct.is_available
        || !productForm.is_available
        || !editingProduct.inventory_enabled
        || availableStock > 0
      )) {
        const { error: availabilityError } = await supabase.rpc('set_product_availability', {
          p_product_id: editingProduct.id,
          p_is_available: productForm.is_available,
        });
        if (availabilityError) throw availabilityError;
      }
      await loadProducts(businessId);
      setProductModal(false);
    } catch (error) {
      Alert.alert('No se pudo guardar el producto', error.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleProductAvailability = async (product, isAvailable) => {
    try {
      const { error } = await supabase.rpc('set_product_availability', {
        p_product_id: product.id,
        p_is_available: isAvailable,
      });
      if (error) throw error;
      await loadProducts(businessId);
    } catch (error) {
      Alert.alert('No se pudo actualizar la disponibilidad', error.message);
    }
  };

  const editRequestedProduct = (productId) => {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      Alert.alert('Producto no disponible', 'Recarga el catálogo para encontrar el producto solicitado.');
      return;
    }
    openEditProduct(product);
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

  const openPromotionEditor = (product) => {
    const current = getPromotion(product);
    setPromotionProduct(product);
    setPromotionForm({
      discountPercent: String(current?.discount_percent ?? ''),
      startDate: current?.start_date || todayInBogota(),
      endDate: current?.end_date || todayInBogota(),
      allDay: current?.all_day !== false,
      startTime: String(current?.start_time || '08:00').slice(0, 5),
      endTime: String(current?.end_time || '21:00').slice(0, 5),
      isActive: current?.is_active !== false,
    });
    setPromotionModal(true);
  };

  const savePromotion = async () => {
    const percent = Number(promotionForm?.discountPercent);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
      Alert.alert('Descuento inválido', 'Ingresa un porcentaje mayor que 0 y menor que 100.');
      return;
    }
    if (!datePattern.test(promotionForm.startDate) || !datePattern.test(promotionForm.endDate)
      || promotionForm.endDate < promotionForm.startDate) {
      Alert.alert('Fechas inválidas', 'Usa el formato AAAA-MM-DD y verifica que la fecha final no sea anterior.');
      return;
    }
    if (!promotionForm.allDay && (!timePattern.test(promotionForm.startTime)
      || !timePattern.test(promotionForm.endTime) || promotionForm.endTime <= promotionForm.startTime)) {
      Alert.alert('Horario inválido', 'Usa horas HH:MM y define una hora final posterior a la inicial.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('business_set_product_promotion', {
        p_product_id: promotionProduct.id,
        p_discount_percent: percent,
        p_start_date: promotionForm.startDate,
        p_end_date: promotionForm.endDate,
        p_all_day: promotionForm.allDay,
        p_start_time: promotionForm.allDay ? null : promotionForm.startTime,
        p_end_time: promotionForm.allDay ? null : promotionForm.endTime,
        p_is_active: promotionForm.isActive,
      });
      if (error) throw error;
      await loadProducts(businessId);
      setPromotionModal(false);
    } catch (error) {
      Alert.alert('No se pudo guardar la promoción', error.message);
    } finally {
      setSaving(false);
    }
  };

  const pickProductImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.75,
      });
      if (result.canceled) return;
      setProductForm((current) => ({
        ...current,
        image_uri: result.assets?.[0]?.uri || null,
      }));
    } catch (error) {
      Alert.alert('No se pudo seleccionar la foto', error.message);
    }
  };

  const styles = createStyles();
  const groupedAvailabilityRequests = availabilityRequests.reduce((groups, request) => {
    const current = groups[request.product_id] || {
      productId: request.product_id,
      productName: request.products?.name || 'Producto',
      count: 0,
      createdAt: request.created_at,
    };
    current.count += 1;
    groups[request.product_id] = current;
    return groups;
  }, {});

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
      {Object.keys(groupedAvailabilityRequests).length > 0 ? (
        <View style={[styles.requestsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.optionsTitle, { color: colors.text }]}>
            Solicitudes de actualización ({availabilityRequests.length})
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Los clientes solicitaron revisar estos productos. No se crea ningún chat.
          </Text>
          {Object.values(groupedAvailabilityRequests).map((request) => (
            <View key={request.productId} style={[styles.requestRow, { borderColor: colors.border }]}>
              <Text style={[styles.meta, { color: colors.text, flex: 1 }]}>
                {request.productName} · {request.count} {request.count === 1 ? 'solicitud' : 'solicitudes'}
              </Text>
              <Pressable onPress={() => editRequestedProduct(request.productId)}>
                <Text style={styles.link}>Actualizar</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const options = item.product_options || [];
          const promotion = getPromotion(item);
          const previewPrice = promotion
            ? Math.round(Number(item.price) * (100 - Number(promotion.discount_percent)) / 100)
            : null;
          const metrics = productMetrics[item.id] || { orderCount: 0, requestedUnits: 0 };
          const effectivelyAvailable = item.is_available
            && (!item.inventory_enabled
              || Number(item.stock_quantity || 0) - Number(item.reserved_quantity || 0) > 0);
          return (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.productHeader}>
                <View style={styles.productCopy}>
                  <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
                  {item.category ? <Text style={[styles.meta, { color: colors.muted }]}>{item.category}</Text> : null}
                  {promotion ? (
                    <View style={styles.promotionPriceRow}>
                      <Text style={[styles.oldPrice, { color: colors.muted }]}>{formatCOP(item.price)}</Text>
                      <Text style={styles.promotionPrice}>{formatCOP(previewPrice)}</Text>
                      <Text style={styles.discountBadge}>-{Number(promotion.discount_percent)}%</Text>
                    </View>
                  ) : <Text style={[styles.price, { color: colors.primary }]}>{formatCOP(item.price)}</Text>}
                  {promotion ? (
                    <Text style={[styles.meta, { color: promotion.is_active ? '#14804A' : colors.muted }]}>
                      {promotion.is_active ? 'Promoción configurada' : 'Promoción pausada'} · {formatPromotionRange(promotion)}
                    </Text>
                  ) : null}
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {effectivelyAvailable
                      ? item.inventory_enabled
                        ? `Disponible · Existencias: ${Math.max(0, Number(item.stock_quantity || 0) - Number(item.reserved_quantity || 0))}`
                        : 'Disponible · Sin control de existencias'
                      : 'Agotado'}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    Historial: {metrics.orderCount} pedidos · {metrics.requestedUnits} unidades solicitadas
                  </Text>
                </View>
                <View style={styles.actions}>
                  <Pressable onPress={() => openEditProduct(item)}><Text style={styles.link}>Editar</Text></Pressable>
                  <Pressable onPress={() => openPromotionEditor(item)}><Text style={styles.link}>{promotion ? 'Promoción' : 'Promocionar'}</Text></Pressable>
                  <Pressable onPress={() => deleteProduct(item)}><Text style={[styles.link, styles.delete]}>Eliminar</Text></Pressable>
                </View>
                <View style={styles.availabilityRow}>
                  <Text style={[styles.meta, { color: colors.text }]}>
                    Disponibilidad rápida: {effectivelyAvailable ? 'Disponible' : 'Agotado'}
                  </Text>
                  <Switch
                    accessibilityLabel={`Marcar ${item.name} como ${effectivelyAvailable ? 'agotado' : 'disponible'}`}
                    value={Boolean(effectivelyAvailable)}
                    onValueChange={(value) => toggleProductAvailability(item, value)}
                  />
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
              <Pressable accessibilityRole="button" onPress={pickProductImage} style={[styles.imagePicker, { borderColor: colors.border }]}>
                {(productForm.image_uri || productForm.image_url) ? (
                  <Image source={{ uri: productForm.image_uri || productForm.image_url }} style={styles.productImagePreview} resizeMode="cover" />
                ) : null}
                <Text style={{ color: colors.primary, fontWeight: '700' }}>
                  {productForm.image_uri || productForm.image_url ? 'Cambiar foto del producto' : 'Agregar foto del producto'}
                </Text>
              </Pressable>
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

      <Modal visible={promotionModal} transparent animationType="slide" onRequestClose={() => setPromotionModal(false)}>
        <View style={styles.backdrop}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalScroll}>
            <View style={[styles.modal, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Promoción · {promotionProduct?.name}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>Precio normal: {formatCOP(promotionProduct?.price || 0)}</Text>
              <TextInput
                value={promotionForm?.discountPercent || ''}
                onChangeText={(discountPercent) => setPromotionForm((current) => ({ ...current, discountPercent }))}
                placeholder="Descuento en porcentaje (p. ej. 20)"
                keyboardType="decimal-pad" placeholderTextColor={colors.muted} style={styles.input}
              />
              {promotionProduct && Number(promotionForm?.discountPercent) > 0
                && Number(promotionForm?.discountPercent) < 100 ? (
                <View style={styles.promotionPreview}>
                  <Text style={styles.previewEyebrow}>Así lo verá el cliente</Text>
                  <Text style={styles.previewOldPrice}>{formatCOP(promotionProduct.price)}</Text>
                  <Text style={styles.previewNewPrice}>{formatCOP(Math.round(
                    Number(promotionProduct.price) * (100 - Number(promotionForm.discountPercent)) / 100,
                  ))}</Text>
                  <Text style={styles.previewDiscount}>-{promotionForm.discountPercent}% de descuento</Text>
                </View>
              ) : null}
              <View style={styles.promotionQuickActions}>
                <Text style={[styles.meta, { color: colors.text }]}>Vigencia</Text>
                <Pressable onPress={() => setPromotionForm((current) => ({
                  ...current, startDate: todayInBogota(), endDate: todayInBogota(),
                }))} style={styles.quickButton}><Text style={styles.quickButtonText}>Solo hoy</Text></Pressable>
              </View>
              <TextInput
                value={promotionForm?.startDate || ''}
                onChangeText={(startDate) => setPromotionForm((current) => ({ ...current, startDate }))}
                placeholder="Desde · AAAA-MM-DD" placeholderTextColor={colors.muted} style={styles.input}
              />
              <TextInput
                value={promotionForm?.endDate || ''}
                onChangeText={(endDate) => setPromotionForm((current) => ({ ...current, endDate }))}
                placeholder="Hasta · AAAA-MM-DD" placeholderTextColor={colors.muted} style={styles.input}
              />
              <View style={styles.switchRow}>
                <Text style={[styles.meta, { color: colors.text }]}>Todo el día</Text>
                <Switch value={promotionForm?.allDay ?? true} onValueChange={(allDay) => setPromotionForm((current) => ({ ...current, allDay }))} />
              </View>
              {!promotionForm?.allDay ? (
                <View style={styles.timeRow}>
                  <TextInput
                    value={promotionForm?.startTime || ''}
                    onChangeText={(startTime) => setPromotionForm((current) => ({ ...current, startTime }))}
                    placeholder="Desde HH:MM" keyboardType="numbers-and-punctuation" placeholderTextColor={colors.muted} style={[styles.input, styles.timeInput]}
                  />
                  <TextInput
                    value={promotionForm?.endTime || ''}
                    onChangeText={(endTime) => setPromotionForm((current) => ({ ...current, endTime }))}
                    placeholder="Hasta HH:MM" keyboardType="numbers-and-punctuation" placeholderTextColor={colors.muted} style={[styles.input, styles.timeInput]}
                  />
                </View>
              ) : null}
              <View style={styles.switchRow}>
                <Text style={[styles.meta, { color: colors.text }]}>Promoción activa</Text>
                <Switch value={promotionForm?.isActive ?? true} onValueChange={(isActive) => setPromotionForm((current) => ({ ...current, isActive }))} />
              </View>
              <View style={styles.modalActions}>
                <AnimatedButton title="Cancelar" variant="secondary" onPress={() => setPromotionModal(false)} />
                <AnimatedButton title={saving ? 'Guardando...' : 'Guardar promoción'} disabled={saving} onPress={savePromotion} />
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
  requestsCard: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 14 },
  requestRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, marginTop: 8, paddingTop: 8 },
  list: { paddingBottom: 24, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  productHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  availabilityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  productCopy: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700' },
  price: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  promotionPriceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  oldPrice: { fontSize: 13, textDecorationLine: 'line-through' },
  promotionPrice: { color: '#D84315', fontSize: 18, fontWeight: '900' },
  discountBadge: { backgroundColor: '#D84315', color: '#FFFFFF', borderRadius: 8, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontWeight: '800', fontSize: 11 },
  meta: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4 },
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
  imagePicker: { minHeight: 88, borderWidth: 1, borderRadius: 9, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  productImagePreview: { width: 68, height: 68, borderRadius: 8, backgroundColor: '#E7EAF2' },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeChoice: { flex: 1, alignItems: 'center', padding: 10, borderWidth: 1, borderColor: '#D5D7DD', borderRadius: 8 },
  typeChoiceActive: { backgroundColor: '#3949AB', borderColor: '#3949AB' },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 6 },
  promotionPreview: { backgroundColor: '#FFF2E8', borderColor: '#FF8A3D', borderWidth: 1, borderRadius: 12, alignItems: 'center', padding: 14, gap: 3 },
  previewEyebrow: { color: '#713711', fontSize: 12, fontWeight: '700' },
  previewOldPrice: { color: '#6B7280', fontSize: 14, textDecorationLine: 'line-through' },
  previewNewPrice: { color: '#D84315', fontSize: 26, fontWeight: '900' },
  previewDiscount: { color: '#B93812', fontSize: 13, fontWeight: '800' },
  promotionQuickActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quickButton: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#3949AB' },
  quickButtonText: { color: '#FFFFFF', fontWeight: '700' },
  timeRow: { flexDirection: 'row', gap: 8 },
  timeInput: { flex: 1 },
});
