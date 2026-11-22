import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '../store/authStore';
import { registerNotificationDevice, configureNotificationPresentation } from '../services/notifications';

export default function NotificationRuntime({ navigationRef }) {
  const userId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    configureNotificationPresentation();
    if (!userId || Platform.OS === 'web') return undefined;
    let mounted = true;
    registerNotificationDevice(userId).catch((e) => console.warn('No se pudo registrar push:', e?.message));
    const receive = Notifications.addNotificationReceivedListener(() => {});
    const response = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data || {};
      const target = data.order_id ? 'ClientOrders' : 'Notifications';
      if (mounted && navigationRef.current?.isReady()) navigationRef.current.navigate(target, data.order_id ? { orderId: data.order_id } : undefined);
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!mounted || !response) return;
      const data = response.notification.request.content.data || {};
      if (navigationRef.current?.isReady()) navigationRef.current.navigate(data.order_id ? 'ClientOrders' : 'Notifications', data.order_id ? { orderId: data.order_id } : undefined);
    }).catch((e) => console.warn('No se pudo procesar el push inicial:', e?.message));
    const state = AppState.addEventListener('change', (status) => { if (status === 'active') registerNotificationDevice(userId).catch((e) => console.warn('No se pudo actualizar token push:', e?.message)); });
    return () => { mounted = false; receive.remove(); response.remove(); state.remove(); };
  }, [userId, navigationRef]);
  return null;
}
