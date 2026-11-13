import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../api/supabaseClient';
import { useAuthStore } from '../store/authStore';
import {
  endOrderCall,
  expireOrderCall,
  respondToOrderCall,
  startOrderCall,
} from '../services/liveKitCalls';
import AnimatedButton from './AnimatedButton';
import { useRoleTheme } from '../hooks/useRoleTheme';

export default function OrderChat({ orderId, navigation }) {
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const theme = useRoleTheme();
  const [messages, setMessages] = useState([]);
  const [activeCall, setActiveCall] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [requiresPhoneConsent, setRequiresPhoneConsent] = useState(false);
  const [phoneConsent, setPhoneConsent] = useState(false);
  const routedCallId = useRef(null);
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

  const openAcceptedCall = useCallback((call) => {
    setActiveCall(call);
    if (call.status === 'accepted' && routedCallId.current !== call.id) {
      routedCallId.current = call.id;
      navigation.navigate('OrderCall', { callId: call.id, orderId });
    } else if (['declined', 'ended', 'missed'].includes(call.status)) {
      setActiveCall(null);
      if (routedCallId.current === call.id) routedCallId.current = null;
      if (call.status === 'declined' && call.caller_id === senderId) {
        Alert.alert('Llamada no aceptada', 'La otra persona rechazó la llamada.');
      }
      if (call.status === 'missed' && call.caller_id === senderId) {
        Alert.alert('Llamada sin respuesta', 'La llamada expiró antes de ser contestada.');
      }
    }
  }, [navigation, orderId, senderId]);

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

    supabase.from('order_calls')
      .select('*')
      .eq('order_id', orderId)
      .in('status', ['ringing', 'accepted'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('Error cargando la llamada del pedido:', error.message);
        } else if (active && data) {
          openAcceptedCall(data);
        }
      });

    const callChannel = supabase
      .channel(`order-calls:${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_calls', filter: `order_id=eq.${orderId}` },
        ({ new: call }) => openAcceptedCall(call),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime call subscription failed: ${status}`);
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
      supabase.removeChannel(callChannel);
    };
  }, [loadMessages, openAcceptedCall, orderId]);

  useEffect(() => {
    if (activeCall?.status !== 'ringing') return undefined;
    const remaining = Math.max(0, new Date(activeCall.expires_at).getTime() - Date.now());
    const timeout = setTimeout(async () => {
      try {
        await expireOrderCall(activeCall.id);
      } catch (error) {
        Alert.alert('No se pudo actualizar la llamada', error.message);
      }
    }, remaining);
    return () => clearTimeout(timeout);
  }, [activeCall]);

  const sendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || !senderId || sending) return;

    setSending(true);
    try {
      const { error } = await supabase.rpc('send_order_chat_message', {
        p_order_id: orderId,
        p_message: trimmed,
        p_phone_consent: phoneConsent,
      });
      if (error) throw error;
      setMessage('');
      setRequiresPhoneConsent(false);
      setPhoneConsent(false);
    } catch (error) {
      if (error.message?.includes('PHONE_CONSENT_REQUIRED')) {
        setRequiresPhoneConsent(true);
        setPhoneConsent(false);
      } else {
        Alert.alert('No se pudo enviar el mensaje', error.message);
      }
    } finally {
      setSending(false);
    }
  };

  const handleStartCall = async () => {
    if (!senderId || startingCall) return;
    setStartingCall(true);
    try {
      const callId = await startOrderCall(orderId);
      const { data: call, error } = await supabase
        .from('order_calls')
        .select('*')
        .eq('id', callId)
        .single();
      if (error) throw error;
      setActiveCall(call);
    } catch (error) {
      Alert.alert('No se pudo iniciar la llamada', error.message);
    } finally {
      setStartingCall(false);
    }
  };

  const handleCallResponse = async (accept) => {
    if (!activeCall) return;
    try {
      await respondToOrderCall(activeCall.id, accept);
      if (accept) {
        openAcceptedCall({ ...activeCall, status: 'accepted' });
      } else {
        setActiveCall(null);
      }
    } catch (error) {
      Alert.alert('No se pudo responder la llamada', error.message);
    }
  };

  const handleCancelCall = async () => {
    if (!activeCall) return;
    try {
      await endOrderCall(activeCall.id);
      setActiveCall(null);
    } catch (error) {
      Alert.alert('No se pudo cancelar la llamada', error.message);
    }
  };

  const openPhoneLink = async (phone) => {
    try {
      await Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
    } catch (error) {
      Alert.alert('No se pudo abrir el teléfono', error.message);
    }
  };

  const renderMessage = ({ item }) => {
    const ownMessage = item.sender_id === senderId;
    const messageParts = item.phone_consent
      ? item.message.split(/(\+?\d[\d\s()./-]{6,}\d)/g)
      : [item.message];
    return (
      <View style={[styles.bubble, ownMessage ? styles.ownBubble : styles.otherBubble]}>
        <Text style={[styles.messageText, ownMessage && styles.ownMessageText]}>
          {messageParts.map((part, index) => /^\+?\d[\d\s()./-]{6,}\d$/.test(part)
            ? (
              <Text
                key={`${item.id}-phone-${index}`}
                style={[styles.phoneLink, ownMessage && styles.ownPhoneLink]}
                onPress={() => openPhoneLink(part)}
                accessibilityRole="link"
              >
                {part}
              </Text>
            )
            : <Text key={`${item.id}-text-${index}`}>{part}</Text>)}
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
      <View style={styles.callActions}>
        {!activeCall ? (
          <AnimatedButton
            title={startingCall ? 'Llamando...' : 'Llamar por Internet'}
            onPress={handleStartCall}
            disabled={startingCall || !senderId}
            style={styles.callButton}
          />
        ) : activeCall.status === 'ringing' && activeCall.callee_id === senderId ? (
          <>
            <Text style={styles.callNotice}>Llamada de voz entrante</Text>
            <View style={styles.callActionRow}>
              <AnimatedButton title="Rechazar" onPress={() => handleCallResponse(false)} variant="secondary" />
              <AnimatedButton title="Responder" onPress={() => handleCallResponse(true)} style={styles.callButton} />
            </View>
          </>
        ) : activeCall.status === 'ringing' ? (
          <View style={styles.callActionRow}>
            <Text style={styles.callNotice}>Llamando al otro participante...</Text>
            <AnimatedButton title="Cancelar" onPress={handleCancelCall} variant="secondary" />
          </View>
        ) : null}
      </View>
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
      {requiresPhoneConsent && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: phoneConsent }}
          onPress={() => setPhoneConsent((current) => !current)}
          style={styles.consent}
        >
          <Text style={[styles.consentCheck, phoneConsent && styles.consentCheckActive]}>
            {phoneConsent ? '✓' : ''}
          </Text>
          <Text style={styles.consentText}>
            Confirmo que quiero compartir mi número telefónico en este mensaje.
          </Text>
        </Pressable>
      )}
      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={(value) => {
            setMessage(value);
            setPhoneConsent(false);
            setRequiresPhoneConsent(false);
          }}
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
          disabled={sending || !message.trim() || (requiresPhoneConsent && !phoneConsent)}
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
  phoneLink: { color: '#1565C0', textDecorationLine: 'underline' },
  ownPhoneLink: { color: '#B3E5FC' },
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
  callActions: { paddingHorizontal: 12, paddingTop: 10 },
  callButton: { alignSelf: 'stretch' },
  callNotice: { color: '#334155', fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  callActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  consent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    padding: 12,
    marginHorizontal: 12,
    borderRadius: 10,
  },
  consentCheck: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: '#8A5A00',
    borderRadius: 5,
    marginRight: 10,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: '#FFFFFF',
  },
  consentCheckActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  consentText: { flex: 1, color: '#5D4700', fontSize: 13, lineHeight: 18 },
});
