import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { supabase } from '../api/supabaseClient';

export const SOUND_BY_EVENT = {
  business_new_order: 'order-new.wav', order_available: 'order-available.wav',
  profile_review_pending: 'review-pending.wav', customer_registered: 'customer-registered.wav',
  money_received: 'money-received.wav', feedback_elogio: 'feedback.wav', feedback_sugerencia: 'feedback.wav',
  order_preparing: 'default', order_ready: 'default', order_picked_up: 'default', order_on_the_way: 'default',
  driver_assigned: 'default', order_arrival_soon: 'default', financial_exception: 'review-pending.wav', inappropriate_language: 'review-pending.wav',
};

export function configureNotificationPresentation() {
  Notifications.setNotificationHandler({ handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }) });
}

export async function registerNotificationDevice(userId) {
  if (!userId || Platform.OS === 'web' || !Constants.isDevice) return;
  const permission = await Notifications.getPermissionsAsync();
  const result = permission.granted ? permission : await Notifications.requestPermissionsAsync();
  if (!result.granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Falta extra.eas.projectId para registrar push.');
  const { data, error } = await Notifications.getExpoPushTokenAsync({ projectId });
  if (error) throw error;
  const { error: saveError } = await supabase.from('notification_devices').upsert({
    user_id: userId, expo_push_token: data, platform: Platform.OS, updated_at: new Date().toISOString(), disabled_at: null,
  }, { onConflict: 'expo_push_token' });
  if (saveError) throw saveError;
  if (Platform.OS === 'android') {
    for (const [id, name, sound] of [
      ['default', 'General', 'default'], ['orders', 'Pedidos', 'order-new'], ['available', 'Pedidos disponibles', 'order-available'],
      ['admin', 'Revisión administrativa', 'review-pending'], ['money', 'Ingresos', 'money-received'],
    ]) await Notifications.setNotificationChannelAsync(id, { name, importance: AndroidImportance.HIGH, sound });
  }
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

export async function getEmailPreferences(userId) {
  const { data, error } = await supabase.from('notification_preferences').select('email_profile_pending,email_inappropriate_language,email_financial_exception,admin_alert_email').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return { profilePending: data?.email_profile_pending ?? true, inappropriateLanguage: data?.email_inappropriate_language ?? true, financialException: data?.email_financial_exception ?? true, email: data?.admin_alert_email || '' };
}

export async function setEmailPreferences(userId, value) {
  const { error } = await supabase.rpc('notify_email_preferences', { p_user: userId, p_profile_pending: value.profilePending, p_inappropriate_language: value.inappropriateLanguage, p_financial_exception: value.financialException, p_email: value.email || null });
  if (error) throw error;
}
