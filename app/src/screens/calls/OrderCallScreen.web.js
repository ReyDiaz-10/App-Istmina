import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Room, RoomEvent, ConnectionState } from 'livekit-client';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { createOrderCallToken, endOrderCall } from '../../services/liveKitCalls';
import { supabase } from '../../api/supabaseClient';

export default function OrderCallScreen({ route, navigation }) {
  const { callId, orderId } = route.params || {};
  const { colors } = useAppTheme();
  const roomRef = useRef(null);
  const endingRef = useRef(false);
  const [status, setStatus] = useState('Conectando la llamada...');
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let active = true;
    let audioElements = [];
    const room = new Room();
    roomRef.current = room;

    const attachAudioTrack = (track) => {
      if (track.kind !== 'audio') return;
      const element = track.attach();
      element.autoplay = true;
      element.setAttribute('playsinline', 'true');
      document.body.appendChild(element);
      audioElements.push(element);
      element.play().catch((error) => {
        console.warn('El navegador requiere una interacción para reproducir el audio:', error.message);
      });
    };

    const detachAudioTrack = (track) => {
      track.detach().forEach((element) => {
        element.remove();
        audioElements = audioElements.filter((current) => current !== element);
      });
    };

    room.on(RoomEvent.TrackSubscribed, attachAudioTrack);
    room.on(RoomEvent.TrackUnsubscribed, detachAudioTrack);
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (!active) return;
      setStatus(state === ConnectionState.Connected ? 'Conectado · llamada de voz activa' : `Estado: ${state}`);
    });

    const connect = async () => {
      try {
        const credentials = await createOrderCallToken(callId);
        await room.connect(credentials.serverUrl, credentials.token);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (active) setStatus('Conectado · llamada de voz activa');
      } catch (error) {
        if (active) {
          Alert.alert('No se pudo iniciar la llamada', error.message);
          navigation.goBack();
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    connect();

    return () => {
      active = false;
      room.removeAllListeners();
      room.disconnect();
      audioElements.forEach((element) => element.remove());
      audioElements = [];
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
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
          console.error(`Realtime call subscription failed: ${subscriptionStatus}`);
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
      <Text style={[styles.status, { color: colors.muted }]}>
        {loading ? 'Conectando...' : status}
      </Text>
      <Text style={[styles.hint, { color: colors.muted }]}>
        Permite el acceso al micrófono cuando el navegador lo solicite.
      </Text>
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
  status: { textAlign: 'center', marginVertical: 16, fontSize: 16 },
  hint: { textAlign: 'center', lineHeight: 20 },
  endButton: { alignSelf: 'stretch', marginTop: 16 },
});
