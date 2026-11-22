import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '../store/authStore';
import { registerNotificationDevice, configureNotificationPresentation } from '../services/notifications';

export default function NotificationRuntime({ navigationRef }) {
  const userId = useAuthStore((s) => s.user?.id);
  const role = useAuthStore((s) => s.profile?.role);
  useEffect(() => {
    configureNotificationPresentation();
    if (!userId || Platform.OS === 'web') return undefined;
    let mounted = true;
    registerNotificationDevice(userId).catch((e) => console.warn('No se pudo registrar push:', e?.message));
    const receive = Notifications.addNotificationReceivedListener(() => {});
    const handledResponses = new Set();
    const openNotification = (response) => {
      const notificationId = response?.notification?.request?.identifier;
      if (!mounted || !notificationId || handledResponses.has(notificationId)) return;
      handledResponses.add(notificationId);
      const data = response.notification.request.content.data || {};
      if (!navigationRef.current?.isReady()) return;
      if (data.order_id && role === 'negocio') navigationRef.current.navigate('BusinessHome', { screen: 'Orders' });
      else if (data.order_id && role === 'repartidor') navigationRef.current.navigate('DriverHome');
      else if (data.order_id && role !== 'admin') navigationRef.current.navigate('ClientOrders', { orderId: data.order_id });
      else navigationRef.current.navigate('Notifications');
    };
    const response = Notifications.addNotificationResponseReceivedListener((response) => {
      openNotification(response);
    });
    Notifications.getLastNotificationResponseAsync().then(openNotification).catch((e) => console.warn('No se pudo procesar el push inicial:', e?.message));
    const state = AppState.addEventListener('change', (status) => { if (status === 'active') registerNotificationDevice(userId).catch((e) => console.warn('No se pudo actualizar token push:', e?.message)); });
    return () => { mounted = false; receive.remove(); response.remove(); state.remove(); };
  }, [userId, role, navigationRef]);
  return null;
}
