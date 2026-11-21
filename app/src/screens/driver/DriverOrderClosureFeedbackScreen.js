import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import HelpButton from '../../components/HelpButton';
import { useAuthStore } from '../../store/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';

const DriverOrderClosureFeedbackScreen = ({ route, navigation }) => {
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const userId = profile?.id || user?.id;
  const orderId = route?.params?.orderId;
  const { colors } = useAppTheme();
  const [order, setOrder] = useState(null);
  const [clientName, setClientName] = useState('el cliente');
  const [feedbackByCategory, setFeedbackByCategory] = useState({});
  const [rating, setRating] = useState(0);
  const [complaint, setComplaint] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingCategory, setSavingCategory] = useState(null);

  const loadOrder = useCallback(async () => {
    if (!userId || !orderId) {
      setLoadError('No se pudo identificar el pedido o la cuenta del repartidor.');
      setLoading(false);
      return;
    }

    try {
      const { data: driver, error: driverError } = await supabase
        .from('drivers')
        .select('id')
        .eq('profile_id', userId)
        .maybeSingle();
      if (driverError) throw driverError;
      if (!driver) throw new Error('No se encontró el perfil de repartidor.');

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('id, order_number, status, client_id, driver_id')
        .eq('id', orderId)
        .eq('driver_id', driver.id)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!orderData || orderData.status !== 'entregado') {
        throw new Error('La valoración solo está disponible para un pedido entregado por ti.');
      }
      setOrder(orderData);

      const { data: customer, error: customerError } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', orderData.client_id)
        .maybeSingle();
      if (customerError) throw customerError;
      setClientName(customer?.full_name || 'el cliente');

      const { data: feedback, error: feedbackError } = await supabase
        .from('delivery_order_feedback')
        .select('category, rating, message')
        .eq('order_id', orderId)
        .eq('author_id', userId);
      if (feedbackError) throw feedbackError;
      setFeedbackByCategory(Object.fromEntries(
        (feedback || []).map((item) => [item.category, item]),
      ));
      setLoadError('');
    } catch (error) {
      setLoadError(error.message || 'No se pudo cargar el pedido.');
    } finally {
      setLoading(false);
    }
  }, [orderId, userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadOrder();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadOrder]);

  const submitFeedback = async (category) => {
    if (category === 'calificacion' && (rating < 1 || rating > 5)) {
      Alert.alert('Selecciona una calificación', 'Elige entre una y cinco estrellas.');
      return;
    }
    if (category === 'queja' && complaint.trim().length < 5) {
      Alert.alert('Motivo muy corto', 'Describe la situación con al menos cinco caracteres.');
      return;
    }

    setSavingCategory(category);
    try {
      const { data, error } = await supabase.rpc('submit_order_feedback', {
        p_order_id: order.id,
        p_category: category,
        p_rating: category === 'calificacion' ? rating : null,
        p_message: category === 'queja' ? complaint.trim() : null,
      });
      if (error) throw error;

      if (data?.created) {
        if (category === 'queja') setComplaint('');
        Alert.alert('Gracias', 'Tu respuesta quedó asociada a este pedido.');
      } else {
        Alert.alert('Ya enviado', 'Solo se acepta una respuesta de este tipo por pedido.');
      }
      await loadOrder();
    } catch (error) {
      Alert.alert('No se pudo enviar', error.message);
    } finally {
      setSavingCategory(null);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loadError || !order) {
    return (
      <View style={[styles.center, styles.padded, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>No se pudo abrir el cierre</Text>
        <Text style={[styles.body, { color: colors.muted }]}>{loadError || 'Pedido no disponible.'}</Text>
        <AnimatedButton title="Volver al panel" onPress={() => navigation.navigate('DriverHome')} />
        <HelpButton navigation={navigation} context="repartidor" orderId={orderId} />
      </View>
    );
  }

  const orderLabel = order.order_number || order.id.slice(0, 8);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Pedido #{orderLabel} entregado</Text>
        <Text style={[styles.body, { color: colors.muted }]}>
          Puedes calificar a {clientName} o registrar una queja únicamente sobre esta entrega.
          Para reportar otro pedido, utiliza Soporte.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Calificar al cliente</Text>
        {feedbackByCategory.calificacion ? (
          <Text style={[styles.savedText, { color: colors.muted }]}>
            Ya calificaste este pedido con {feedbackByCategory.calificacion.rating} de 5 estrellas.
          </Text>
        ) : (
          <>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((value) => (
                <TouchableOpacity
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} estrellas`}
                  onPress={() => setRating(value)}
                  style={styles.starButton}
                >
                  <Text style={[styles.star, { color: value <= rating ? '#F4B400' : colors.border }]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <AnimatedButton
              title={savingCategory === 'calificacion' ? 'Enviando...' : 'Enviar calificación'}
              onPress={() => submitFeedback('calificacion')}
              disabled={savingCategory !== null}
            />
          </>
        )}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Registrar una queja del pedido</Text>
        {feedbackByCategory.queja ? (
          <Text style={[styles.savedText, { color: colors.muted }]}>
            Ya registraste una queja para este pedido. El cliente no puede verla.
          </Text>
        ) : (
          <>
            <TextInput
              accessibilityLabel="Motivo de queja sobre este pedido"
              value={complaint}
              onChangeText={(value) => setComplaint(value.slice(0, 2000))}
              placeholder="Describe brevemente el motivo (5 a 2000 caracteres)"
              maxLength={2000}
              multiline
              style={[
                styles.messageInput,
                { color: colors.text, backgroundColor: colors.input, borderColor: colors.border },
              ]}
            />
            <AnimatedButton
              title={savingCategory === 'queja' ? 'Enviando...' : 'Enviar queja sobre este pedido'}
              onPress={() => submitFeedback('queja')}
              disabled={savingCategory !== null}
              variant="secondary"
            />
          </>
        )}

        <View style={styles.actions}>
          <AnimatedButton
            title="Ver elogios y sugerencias"
            onPress={() => navigation.navigate('DriverFeedback')}
            variant="secondary"
          />
          <AnimatedButton
            title="Volver al panel"
            onPress={() => navigation.navigate('DriverHome')}
          />
        </View>
        <HelpButton navigation={navigation} context="repartidor" orderId={order.id} />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 36 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  padded: { padding: 24 },
  card: { borderWidth: 1, borderRadius: 16, padding: 18 },
  title: { fontSize: 21, fontWeight: '700', marginVertical: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 24, marginBottom: 10 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  ratingRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 14 },
  starButton: { paddingHorizontal: 6, paddingVertical: 2 },
  star: { fontSize: 36 },
  messageInput: { minHeight: 110, borderWidth: 1, borderRadius: 10, padding: 12, textAlignVertical: 'top', marginBottom: 12 },
  savedText: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  actions: { gap: 10, marginTop: 20, marginBottom: 12 },
});

export default DriverOrderClosureFeedbackScreen;
