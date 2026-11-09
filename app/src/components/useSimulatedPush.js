// app/src/hooks/useSimulatedPush.js
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../api/supabaseClient';
import { useAuthStore } from '../store/authStore';

export const useSimulatedPush = () => {
  const { profile } = useAuthStore();

  useEffect(() => {
    if (!profile) return;

    const channel = supabase
      .channel('push-sim')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        const { old: oldData, new: newData } = payload;
        if (newData.client_id === profile.id && oldData.status !== newData.status) {
          Alert.alert('🔔 Actualización de IstmiYa', `Tu pedido ha cambiado a: ${newData.status}`);
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [profile]);
};
