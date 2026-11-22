import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { supabase } from '../api/supabaseClient';

let registeredPushToken = null;

export const SOUND_BY_EVENT = {
  business_new_order: 'order_new.wav', order_available: 'order_available.wav',
  profile_review_pending: 'review_pending.wav', customer_registered: 'customer_registered.wav',
  money_received: 'money_received.wav', feedback_elogio: 'feedback.wav', feedback_sugerencia: 'feedback.wav',
  order_preparing: 'order_new.wav', order_ready: 'order_new.wav', order_picked_up: 'order_new.wav', order_on_the_way: 'order_new.wav',
  driver_assigned: 'order_new.wav', order_arrival_soon: 'order_new.wav', order_delayed: 'review_pending.wav',
  financial_exception: 'review_pending.wav', inappropriate_language: 'review_pending.wav',
};

export const CHANNEL_BY_EVENT = {
  business_new_order: 'orders_v2', order_available: 'available_v2',
  profile_review_pending: 'admin_review_v2', financial_exception: 'admin_review_v2', inappropriate_language: 'admin_review_v2',
  customer_registered: 'admin_info_v2', money_received: 'money_v2',
  feedback_elogio: 'feedback_v2', feedback_sugerencia: 'feedback_v2',
  order_preparing: 'order_updates_v2', order_ready: 'order_updates_v2', order_picked_up: 'order_updates_v2',
  order_on_the_way: 'order_updates_v2', driver_assigned: 'order_updates_v2', order_arrival_soon: 'order_updates_v2',
  order_delayed: 'operations_v2',
};

export function configureNotificationPresentation() {
  Notifications.setNotificationHandler({ handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }) });
}

export async function registerNotificationDevice(userId) {
  if (!userId || Platform.OS === 'web' || !Constants.isDevice) return;
  if (Platform.OS === 'android') {
    const channels = [
      ['default', 'General', 'default'], ['orders_v2', 'Pedidos nuevos para negocio', SOUND_BY_EVENT.business_new_order],
      ['available_v2', 'Pedidos disponibles para repartidor', SOUND_BY_EVENT.order_available],
      ['admin_review_v2', 'Revisión administrativa pendiente', SOUND_BY_EVENT.profile_review_pending],
      ['admin_info_v2', 'Avisos informativos de administración', SOUND_BY_EVENT.customer_registered],
      ['money_v2', 'Ingresos y pagos recibidos', SOUND_BY_EVENT.money_received],
      ['feedback_v2', 'Elogios y sugerencias', SOUND_BY_EVENT.feedback_elogio],
      ['order_updates_v2', 'Actualizaciones de pedidos', SOUND_BY_EVENT.order_ready],
      ['operations_v2', 'Alertas de operación', SOUND_BY_EVENT.order_delayed],
    ];
    for (const [id, name, sound] of channels) {
      try { await Notifications.setNotificationChannelAsync(id, { name, importance: AndroidImportance.HIGH, sound }); }
      catch (error) { console.warn(`No se pudo configurar el canal de notificación ${id}:`, error?.message); }
    }
  }
  const permission = await Notifications.getPermissionsAsync();
  const result = permission.granted ? permission : await Notifications.requestPermissionsAsync();
  if (!result.granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Falta extra.eas.projectId para registrar push.');
  const { data, error } = await Notifications.getExpoPushTokenAsync({ projectId });
  if (error) throw error;
  const { error: saveError } = await supabase.rpc('register_notification_device', {
    p_token: data, p_platform: Platform.OS,
  });
  if (saveError) throw saveError;
  registeredPushToken = data;
}

export async function unregisterNotificationDevice() {
  if (!registeredPushToken) return;
  const { error } = await supabase.rpc('unregister_notification_device', { p_token: registeredPushToken });
  if (error) throw error;
  registeredPushToken = null;
}

export async function listNotifications(limit = 50) {
  const { data, error } = await supabase.from('user_notifications').select('id,event_key,title,body,order_id,created_at,read_at').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(id) {
  const { error } = await supabase.rpc('mark_notification_read', { p_id: id });
  if (error) throw error;
}

export async function getUnreadNotificationCount() {
  const { data, error } = await supabase.rpc('notification_unread_count');
  if (error) throw error;
  return Number(data || 0);
}

export async function getEmailPreferences(userId) {
  const { data, error } = await supabase.from('notification_preferences').select('email_profile_pending,email_inappropriate_language,email_financial_exception,admin_alert_email').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return { profilePending: data?.email_profile_pending ?? true, inappropriateLanguage: data?.email_inappropriate_language ?? true, financialException: data?.email_financial_exception ?? true, email: data?.admin_alert_email || '' };
}

export async function setEmailPreferences(userId, value) {
  const { error } = await supabase.rpc('notify_email_preferences', { p_user: userId, p_profile_pending: value.profilePending, p_inappropriate_language: value.inappropriateLanguage, p_financial_exception: value.financialException, p_email: value.email || null });
  if (error) throw error;
}
