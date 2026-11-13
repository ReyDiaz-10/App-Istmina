import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../api/supabaseClient';
import { useAuthStore } from '../store/authStore';
import AnimatedButton from './AnimatedButton';
import { useRoleTheme } from '../hooks/useRoleTheme';

export default function OrderChat({ orderId }) {
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const theme = useRoleTheme();
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const senderId = profile?.id || user?.id;

  const loadMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    setMessages(data || []);
  }, [orderId]);

  useEffect(() => {
    let active = true;
    loadMessages()
      .catch((error) => console.error('Error cargando chat:', error.message))
      .finally(() => {
        if (active) setLoading(false);
      });

    const channel = supabase
      .channel(`order-chat:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chats', filter: `order_id=eq.${orderId}` },
        ({ new: incoming }) => {
          setMessages((current) => (
            current.some((item) => item.id === incoming.id)
              ? current
              : [...current, incoming].sort(
                (left, right) => new Date(left.created_at) - new Date(right.created_at),
              )
          ));
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime chat subscription failed: ${status}`);
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [loadMessages, orderId]);

  const sendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || !senderId || sending) return;

    setSending(true);
    try {
      const { error } = await supabase.from('chats').insert({
        order_id: orderId,
        sender_id: senderId,
        message: trimmed,
      });
      if (error) throw error;
      setMessage('');
    } catch (error) {
      console.error('Error enviando mensaje:', error.message);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }) => {
    const ownMessage = item.sender_id === senderId;
    return (
      <View style={[styles.bubble, ownMessage ? styles.ownBubble : styles.otherBubble]}>
        <Text style={[styles.messageText, ownMessage && styles.ownMessageText]}>
          {item.message}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <Text style={styles.caption}>
        Coordina la entrega y confirma cualquier detalle del pago con el negocio.
      </Text>
      {loading ? (
        <ActivityIndicator style={styles.loader} color={theme.primary} />
      ) : (
        <FlatList
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
        />
      )}
      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Escribe un mensaje..."
          accessibilityLabel="Mensaje para el negocio"
          maxLength={1000}
          editable={!sending}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <AnimatedButton
          title={sending ? '...' : 'Enviar'}
          onPress={sendMessage}
          disabled={sending || !message.trim()}
          buttonStyle={[styles.sendButton, { backgroundColor: theme.primary }]}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  caption: { color: '#555555', fontSize: 13, paddingHorizontal: 16, paddingTop: 12 },
  loader: { marginTop: 24 },
  list: { flexGrow: 1, padding: 15, justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', padding: 12, borderRadius: 15, marginBottom: 10 },
  ownBubble: { alignSelf: 'flex-end', backgroundColor: '#1A237E', borderBottomRightRadius: 2 },
  otherBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  messageText: { color: '#333333', fontSize: 15 },
  ownMessageText: { color: '#FFFFFF' },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderColor: '#E0E0E0',
  },
  input: {
    flex: 1,
    backgroundColor: '#F5F7FA',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 20,
    marginRight: 8,
  },
  sendButton: { minHeight: 42, paddingHorizontal: 12 },
});
