import { AppText as Text } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  View,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import EmptyState from '../../components/EmptyState';
import { useAuthStore } from '../../store/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';

const PREDEFINED_RESPONSES = {
  elogio: [
    { code: 'thanks_for_praise', label: '¡Gracias por tus palabras!' },
    { code: 'glad_to_help', label: 'Me alegra haberte ayudado.' },
    { code: 'appreciate_kindness', label: 'Agradezco mucho tu amabilidad.' },
  ],
  sugerencia: [
    { code: 'thanks_will_improve', label: 'Gracias, trabajaré para mejorar.' },
    { code: 'will_review', label: 'Voy a tener en cuenta tu sugerencia.' },
    { code: 'appreciate_feedback', label: 'Aprecio que me lo compartas.' },
  ],
};

const DriverFeedbackScreen = ({ navigation }) => {
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const userId = profile?.id || user?.id;
  const { colors } = useAppTheme();
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState(null);

  const loadFeedback = useCallback(async () => {
    if (!userId) {
      setFeedback([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('delivery_order_feedback')
        .select('id, order_id, author_display_name, category, message, driver_response_code, created_at, orders(order_number)')
        .eq('recipient_id', userId)
        .eq('author_role', 'cliente')
        .in('category', ['elogio', 'sugerencia'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      setFeedback(data || []);
    } catch (error) {
      console.error('No se pudieron cargar los elogios y sugerencias:', error.message);
      Alert.alert('No se pudieron cargar los comentarios', error.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadFeedback();
    }, 0);
    if (!userId) return () => clearTimeout(timer);

    const channel = supabase
      .channel(`driver-feedback:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'delivery_order_feedback',
        filter: `recipient_id=eq.${userId}`,
      }, () => loadFeedback())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Driver feedback subscription failed: ${status}`);
        }
      });

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [loadFeedback, userId]);

  const sendResponse = async (item, responseCode) => {
    setRespondingId(item.id);
    try {
      const { data, error } = await supabase.rpc('respond_to_delivery_feedback', {
        p_feedback_id: item.id,
        p_response_code: responseCode,
      });
      if (error) throw error;
      if (!data) throw new Error('No se pudo guardar la respuesta predefinida.');
      await loadFeedback();
    } catch (error) {
      Alert.alert('No se pudo responder', error.message);
    } finally {
      setRespondingId(null);
    }
  };

  const renderFeedback = ({ item }) => {
    const orderNumber = item.orders?.order_number || item.order_id.slice(0, 8);
    const isPraise = item.category === 'elogio';
    const savedResponse = PREDEFINED_RESPONSES[item.category]
      ?.find((option) => option.code === item.driver_response_code);

    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.greeting, { color: colors.text }]}>
          {isPraise
            ? `Hola, te felicitaron: ${item.author_display_name} te envió un elogio.`
            : `Hola, tienes una sugerencia de ${item.author_display_name}.`}
        </Text>
        <Text style={[styles.order, { color: colors.muted }]}>Pedido #{orderNumber}</Text>
        <Text style={[styles.message, { color: colors.text }]}>{item.message}</Text>

        {savedResponse ? (
          <Text style={[styles.responded, { color: colors.muted }]}>
            Tu respuesta: {savedResponse.label}
          </Text>
        ) : (
          <View style={styles.responseList}>
            <Text style={[styles.responseHeading, { color: colors.muted }]}>
              Responder con una opción:
            </Text>
            {PREDEFINED_RESPONSES[item.category].map((option) => (
              <AnimatedButton
                key={option.code}
                title={respondingId === item.id ? 'Enviando...' : option.label}
                onPress={() => sendResponse(item, option.code)}
                disabled={respondingId !== null}
                variant="secondary"
                style={styles.responseButton}
              />
            ))}
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text style={[styles.title, { color: colors.text }]}>Elogios y sugerencias</Text>
      </View>
      <FlatList
        data={feedback}
        keyExtractor={(item) => item.id}
        renderItem={renderFeedback}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="Aún no tienes comentarios"
            message="Aquí verás elogios y sugerencias asociados a tus entregas. Las quejas no se muestran en este panel."
            icon="💬"
          />
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  list: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 14 },
  greeting: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  order: { fontSize: 12, marginTop: 6 },
  message: { fontSize: 15, lineHeight: 21, marginTop: 12 },
  responseList: { marginTop: 18, gap: 9 },
  responseHeading: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  responseButton: { alignSelf: 'stretch' },
  responded: { fontSize: 13, fontWeight: '600', marginTop: 16 },
});

export default DriverFeedbackScreen;
