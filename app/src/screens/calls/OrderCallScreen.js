import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { AudioSession, LiveKitRoom, useConnectionState, useParticipants } from '@livekit/react-native';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { createOrderCallToken, endOrderCall } from '../../services/liveKitCalls';
import { supabase } from '../../api/supabaseClient';

const CallStatus = () => {
  const connectionState = useConnectionState();
  const participants = useParticipants();
  return (
    <Text style={styles.status}>
      {connectionState === 'connected'
        ? `Conectado · ${Math.max(0, participants.length - 1)} participante(s)`
        : 'Conectando la llamada...'}
    </Text>
  );
};

export default function OrderCallScreen({ route, navigation }) {
  const { callId, orderId } = route.params || {};
  const { colors } = useAppTheme();
  const endingRef = useRef(false);
  const [credentials, setCredentials] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let active = true;
    AudioSession.startAudioSession()
      .then(() => createOrderCallToken(callId))
      .then((result) => {
        if (active) setCredentials(result);
      })
      .catch((error) => {
        if (active) {
          Alert.alert('No se pudo iniciar la llamada', error.message);
          navigation.goBack();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      AudioSession.stopAudioSession().catch((error) => {
        console.error('No se pudo cerrar el audio de LiveKit:', error.message);
      });
    };
  }, [callId, navigation]);

  useEffect(() => {
    if (!callId || !orderId) return undefined;
    const channel = supabase
      .channel(`order-call:${callId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_calls', filter: `order_id=eq.${orderId}` },
        ({ new: call }) => {
          if (call.id === callId && ['ended', 'declined', 'missed'].includes(call.status) && !endingRef.current) {
            navigation.goBack();
          }
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime call subscription failed: ${status}`);
        }
      });
    return () => supabase.removeChannel(channel);
  }, [callId, navigation, orderId]);

  const hangUp = async () => {
    endingRef.current = true;
    setEnding(true);
    try {
      await endOrderCall(callId);
      navigation.goBack();
    } catch (error) {
      endingRef.current = false;
      setEnding(false);
      Alert.alert('No se pudo finalizar la llamada', error.message);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Llamada de IstmiYa</Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        Llamada de voz cifrada en tránsito para coordinar este pedido.
      </Text>
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : credentials ? (
        <LiveKitRoom
          serverUrl={credentials.serverUrl}
          token={credentials.token}
          connect
          audio
          video={false}
          options={{ adaptiveStream: true, dynacast: true }}
          onError={(error) => Alert.alert('Error de llamada', error.message)}
        >
          <CallStatus />
        </LiveKitRoom>
      ) : (
        <Text style={[styles.status, { color: colors.muted }]}>No fue posible obtener acceso a la llamada.</Text>
      )}
      <AnimatedButton
        title={ending ? 'Finalizando...' : 'Colgar'}
        onPress={hangUp}
        disabled={loading || ending || !callId}
        style={styles.endButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center' },
  description: { textAlign: 'center', lineHeight: 21, marginVertical: 16 },
  status: { color: '#334155', textAlign: 'center', marginVertical: 24, fontSize: 16 },
  endButton: { alignSelf: 'stretch', marginTop: 16 },
});
