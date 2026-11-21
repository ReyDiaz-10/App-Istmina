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
import { useAuthStore } from '../../store/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import AnimatedButton from '../../components/AnimatedButton';

const COMMENT_CATEGORIES = [
  { key: 'elogio', label: 'Enviar un elogio' },
  { key: 'sugerencia', label: 'Enviar una sugerencia' },
  { key: 'queja', label: 'Enviar una queja' },
];

const DRIVER_RESPONSES = {
  thanks_for_praise: '¡Gracias por tus palabras!',
  glad_to_help: 'Me alegra haberte ayudado.',
  appreciate_kindness: 'Agradezco mucho tu amabilidad.',
  thanks_will_improve: 'Gracias, trabajaré para mejorar.',
  will_review: 'Voy a tener en cuenta tu sugerencia.',
  appreciate_feedback: 'Aprecio que me lo compartas.',
};

const ClientOrderFeedbackScreen = ({ route, navigation }) => {
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const userId = profile?.id || user?.id;
  const orderId = route?.params?.orderId;
  const { colors } = useAppTheme();
  const [order, setOrder] = useState(null);
  const [driverName, setDriverName] = useState('');
  const [feedbackByCategory, setFeedbackByCategory] = useState({});
  const [blockState, setBlockState] = useState({
    blocked_by_me: false,
    blocked_by_other: false,
    pair_blocked: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rating, setRating] = useState(0);
  const [commentCategory, setCommentCategory] = useState('elogio');
  const [message, setMessage] = useState('');
  const [savingCategory, setSavingCategory] = useState(null);
  const [savingBlock, setSavingBlock] = useState(false);

  const loadOrderFeedback = useCallback(async () => {
    if (!userId || !orderId) {
      setLoadError('No se pudo identificar el pedido o la cuenta.');
      setLoading(false);
      return;
    }

    try {
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('id, order_number, status, client_id, driver_id, drivers(profile_id, plate_number)')
        .eq('id', orderId)
        .eq('client_id', userId)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!orderData) throw new Error('No tienes acceso a este pedido.');
      setOrder(orderData);

      const assignedDriverProfileId = orderData.drivers?.profile_id;
      if (assignedDriverProfileId) {
        const { data: driverProfile, error: driverError } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', assignedDriverProfileId)
          .maybeSingle();
        if (driverError) throw driverError;
        setDriverName(driverProfile?.full_name || 'tu repartidor');

        const { data: currentBlockState, error: blockError } = await supabase.rpc(
          'get_order_participant_block_state',
          { p_order_id: orderId },
        );
        if (blockError) throw blockError;
        setBlockState(currentBlockState || {
          blocked_by_me: false,
          blocked_by_other: false,
          pair_blocked: false,
        });
      } else {
        setDriverName('');
        setBlockState({
          blocked_by_me: false,
          blocked_by_other: false,
          pair_blocked: false,
        });
      }

      const { data: feedback, error: feedbackError } = await supabase
        .from('delivery_order_feedback')
        .select('category, rating, message, driver_response_code, created_at')
        .eq('order_id', orderId)
        .eq('author_id', userId);
      if (feedbackError) throw feedbackError;
      setFeedbackByCategory(Object.fromEntries(
        (feedback || []).map((item) => [item.category, item]),
      ));
      setLoadError('');
    } catch (error) {
      setLoadError(error.message || 'No se pudo cargar la información del pedido.');
    } finally {
      setLoading(false);
    }
  }, [orderId, userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadOrderFeedback();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadOrderFeedback]);

  const submitFeedback = async (category) => {
    if (category === 'calificacion' && (rating < 1 || rating > 5)) {
      Alert.alert('Selecciona una calificación', 'Elige entre una y cinco estrellas.');
      return;
    }
    if (category !== 'calificacion' && message.trim().length < 5) {
      Alert.alert('Mensaje muy corto', 'Escribe al menos cinco caracteres.');
      return;
    }

    setSavingCategory(category);
    try {
      const { data, error } = await supabase.rpc('submit_order_feedback', {
        p_order_id: order.id,
        p_category: category,
        p_rating: category === 'calificacion' ? rating : null,
        p_message: category === 'calificacion' ? null : message.trim(),
      });
      if (error) throw error;

      if (data?.created) {
        setMessage('');
        Alert.alert('Gracias', 'Tu comentario quedó asociado a este pedido.');
      } else {
        Alert.alert('Ya enviado', 'Solo se acepta una respuesta de este tipo por pedido.');
      }
      await loadOrderFeedback();
    } catch (error) {
      Alert.alert('No se pudo enviar', error.message);
    } finally {
      setSavingCategory(null);
    }
  };

  const toggleDriverBlock = async () => {
    setSavingBlock(true);
    try {
      const { data, error } = await supabase.rpc('set_order_participant_block', {
        p_order_id: order.id,
        p_blocked: !blockState.blocked_by_me,
      });
      if (error) throw error;
      setBlockState(data || blockState);
    } catch (error) {
      Alert.alert('No se pudo actualizar el bloqueo', error.message);
    } finally {
      setSavingBlock(false);
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
        <Text style={[styles.title, { color: colors.text }]}>No se pudo abrir la reseña</Text>
        <Text style={[styles.body, { color: colors.muted }]}>{loadError || 'Pedido no disponible.'}</Text>
        <AnimatedButton title="Volver" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const orderLabel = order.order_number || order.id.slice(0, 8);
  const canReview = order.status === 'entregado' && Boolean(order.driver_id);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text style={[styles.title, { color: colors.text }]}>Tu entrega #{orderLabel}</Text>
        <Text style={[styles.body, { color: colors.muted }]}>
          {canReview
            ? `Cuéntanos cómo te fue con ${driverName}. Tus comentarios no abren un chat.`
            : 'La valoración estará disponible cuando la entrega se cierre correctamente.'}
        </Text>

        {canReview ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Califica al repartidor</Text>
            {feedbackByCategory.calificacion ? (
              <Text style={[styles.savedText, { color: colors.muted }]}>
                Ya calificaste esta entrega con {feedbackByCategory.calificacion.rating} de 5 estrellas.
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

            <Text style={[styles.sectionTitle, { color: colors.text }]}>Enviar un comentario sobre este pedido</Text>
            <View style={styles.categoryRow}>
              {COMMENT_CATEGORIES.map((category) => (
                <TouchableOpacity
                  key={category.key}
                  accessibilityRole="button"
                  onPress={() => setCommentCategory(category.key)}
                  style={[
                    styles.categoryButton,
                    { borderColor: commentCategory === category.key ? colors.primary : colors.border },
                  ]}
                >
                  <Text style={[styles.categoryText, { color: colors.text }]}>{category.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {feedbackByCategory[commentCategory] ? (
              <View style={[styles.savedCard, { borderColor: colors.border }]}>
                <Text style={[styles.savedText, { color: colors.muted }]}>
                  Ya enviaste este {commentCategory} para el pedido #{orderLabel}.
                </Text>
                <Text style={[styles.body, { color: colors.text }]}>
                  {feedbackByCategory[commentCategory].message}
                </Text>
                {feedbackByCategory[commentCategory].driver_response_code ? (
                  <Text style={[styles.savedText, { color: colors.muted }]}>
                    Respuesta del repartidor: {DRIVER_RESPONSES[feedbackByCategory[commentCategory].driver_response_code]}
                  </Text>
                ) : null}
              </View>
            ) : (
              <>
                <TextInput
                  accessibilityLabel="Comentario sobre el pedido"
                  value={message}
                  onChangeText={(value) => setMessage(value.slice(0, 2000))}
                  placeholder="Escribe tu comentario (5 a 2000 caracteres)"
                  maxLength={2000}
                  multiline
                  style={[
                    styles.messageInput,
                    { color: colors.text, backgroundColor: colors.input, borderColor: colors.border },
                  ]}
                />
                <AnimatedButton
                  title={savingCategory === commentCategory ? 'Enviando...' : `Enviar ${commentCategory}`}
                  onPress={() => submitFeedback(commentCategory)}
                  disabled={savingCategory !== null}
                />
              </>
            )}

            <Text style={[styles.sectionTitle, { color: colors.text }]}>Bloqueo de interacción</Text>
            <Text style={[styles.body, { color: colors.muted }]}>
              Bloquear al repartidor evita futuras asignaciones y desactiva la interacción directa.
            </Text>
            {blockState.blocked_by_other ? (
              <Text style={[styles.savedText, { color: colors.muted }]}>
                El repartidor también bloqueó la interacción directa contigo.
              </Text>
            ) : null}
            <AnimatedButton
              title={savingBlock ? 'Actualizando...' : blockState.blocked_by_me ? 'Desbloquear repartidor' : 'Bloquear repartidor'}
              onPress={toggleDriverBlock}
              disabled={savingBlock}
              variant="secondary"
            />
          </>
        ) : null}
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
  categoryRow: { gap: 8, marginBottom: 12 },
  categoryButton: { borderWidth: 1, borderRadius: 10, padding: 11 },
  categoryText: { fontSize: 14, fontWeight: '600' },
  messageInput: { minHeight: 110, borderWidth: 1, borderRadius: 10, padding: 12, textAlignVertical: 'top', marginBottom: 12 },
  savedCard: { borderWidth: 1, borderRadius: 10, padding: 12 },
  savedText: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
});

export default ClientOrderFeedbackScreen;
