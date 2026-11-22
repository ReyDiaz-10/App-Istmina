import { AppText as Text } from './src/components/AppText.js';
// app/App.js
import React, { useEffect, useRef } from 'react';
import './src/services/liveKitSetup';
import * as SplashScreen from 'expo-splash-screen';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import LoginScreen from './src/screens/auth/LoginScreen';
import RegisterScreen from './src/screens/auth/RegisterScreen';
import ClientHomeScreen from './src/screens/client/ClientHomeScreen';
import StoreDetailScreen from './src/screens/client/StoreDetailScreen';
import CartScreen from './src/screens/client/CartScreen';
import ClientOrdersScreen from './src/screens/client/ClientOrdersScreen';
import ClientOrderFeedbackScreen from './src/screens/client/ClientOrderFeedbackScreen';
import OrderChatScreen from './src/screens/client/OrderChatScreen';
import OrderCallScreen from './src/screens/calls/OrderCallScreen';
import BusinessTabs from './src/navigation/BusinessTabs';
import DriverHomeScreen from './src/screens/driver/DriverHomeScreen';
import DriverOrderClosureFeedbackScreen from './src/screens/driver/DriverOrderClosureFeedbackScreen';
import DriverFeedbackScreen from './src/screens/driver/DriverFeedbackScreen';
import DriverProfileScreen from './src/screens/driver/DriverProfileScreen';
import AdminDashboardScreen from './src/screens/admin/AdminDashboardScreen';
import AdminFinanceScreen from './src/screens/admin/AdminFinanceScreen';
import AdminActivityScreen from './src/screens/admin/AdminActivityScreen';
import AdminChatAuditScreen from './src/screens/admin/AdminChatAuditScreen';
import AdminUsersScreen from './src/screens/admin/AdminUsersScreen';
import AdminUserDetailsScreen from './src/screens/admin/AdminUserDetailsScreen';
import AdminControlReportsScreen from './src/screens/admin/AdminControlReportsScreen';
import SupportTickets from './src/screens/client/SupportTickets';
import AboutScreen from './src/screens/client/AboutScreen';
import PrivacyScreen from './src/screens/client/PrivacyScreen';
import AppSettingsScreen from './src/screens/client/AppSettingsScreen';
import ClientProfileScreen from './src/screens/client/ClientProfileScreen';
import BusinessWalletTransfersScreen from './src/screens/business/BusinessWalletTransfersScreen';
import NotificationRuntime from './src/components/NotificationRuntime';

import { useAuthStore } from './src/store/authStore';
import { supabase, supabaseConfigError } from './src/api/supabaseClient';
import { usePreferencesStore } from './src/store/preferencesStore';
import { useAppTheme } from './src/hooks/useAppTheme';
import { applyAppearancePreference } from './src/utils/appearance';

const Stack = createStackNavigator();

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync().catch((error) => {
    console.warn('No se pudo mantener visible la pantalla de inicio:', error?.message);
  });
}

const getInitialRoute = (user, profile) => {
  if (!user) return 'ClientHome';

  switch (profile?.role) {
    case 'negocio':
      return 'BusinessHome';
    case 'repartidor':
      return 'DriverHome';
    case 'admin':
      return 'AdminDashboard';
    default:
      return 'ClientHome';
  }
};

export default function App() {
  const { user, fetchProfile } = useAuthStore();
  const appearance = usePreferencesStore((state) => state.appearance);
  const { mode, colors } = useAppTheme();
  const [initializing, setInitializing] = React.useState(true);
  const navigationRef = useRef(null);

  useEffect(() => {
    applyAppearancePreference(appearance === 'system' ? 'system' : mode);
  }, [appearance, mode]);

  useEffect(() => {
    if (Platform.OS === 'web' || (initializing && supabase && !supabaseConfigError)) return;
    SplashScreen.hideAsync().catch((error) => {
      console.warn('No se pudo ocultar la pantalla de inicio:', error?.message);
    });
  }, [initializing]);

  useEffect(() => {
    if (!supabase) return undefined;

    let isActive = true;
    const checkSession = async () => {
      try {
        await usePreferencesStore.getState().hydrate();
        const savedAppearance = usePreferencesStore.getState().appearance;
        applyAppearancePreference(savedAppearance);
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const session = data?.session;
        if (session?.user) {
          useAuthStore.setState({ user: session.user });
          await fetchProfile(session.user.id);
        }
      } catch (error) {
        console.warn('No se pudo restaurar la sesión al iniciar; se continuará sin sesión.', error);
        useAuthStore.setState({ user: null, profile: null });
      } finally {
        if (isActive) setInitializing(false);
      }
    };

    void checkSession();
    return () => {
      isActive = false;
    };
  }, [fetchProfile]);

  if (!supabase || supabaseConfigError) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
          <Text style={[styles.errorTitle, { color: colors.text }]}>No se pudo iniciar IstmiYa</Text>
          <Text style={[styles.errorMessage, { color: colors.text }]}>
            {supabaseConfigError?.message || 'La conexión con Supabase no está disponible.'}
          </Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (initializing) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
          <Image
            source={require('./assets/images/istmiya-local-market-hero.jpg')}
            accessibilityLabel="IstmiYa conecta el mercado local de Istmina"
            accessible
            resizeMode="contain"
            style={styles.startupImage}
          />
          <ActivityIndicator size="large" color={colors.primary} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.appSafeArea} edges={['top', 'right', 'left']}>
        <NavigationContainer ref={navigationRef} theme={{ ...(mode === 'dark' ? DarkTheme : DefaultTheme), colors: { ...(mode === 'dark' ? DarkTheme.colors : DefaultTheme.colors), primary: colors.primary, background: colors.background, card: colors.surface, text: colors.text, border: colors.border } }}>
        <NotificationRuntime navigationRef={navigationRef} />
        <Stack.Navigator 
          initialRouteName={getInitialRoute(user, useAuthStore.getState().profile)}
          screenOptions={{ 
            headerShown: false,
            cardStyle: { flex: 1, minHeight: 0 },
          }}
        >
          <Stack.Screen name="ClientHome" component={ClientHomeScreen} />
          <Stack.Screen name="StoreDetail" component={StoreDetailScreen} />
          <Stack.Screen name="Cart" component={CartScreen} />
          <Stack.Screen name="ClientOrders" component={ClientOrdersScreen} />
          <Stack.Screen name="ClientOrderFeedback" component={ClientOrderFeedbackScreen} />
          <Stack.Screen name="OrderChat" component={OrderChatScreen} />
          <Stack.Screen name="OrderCall" component={OrderCallScreen} />
          <Stack.Screen name="BusinessHome" component={BusinessTabs} />
          <Stack.Screen name="BusinessWalletTransfers" component={BusinessWalletTransfersScreen} />
          <Stack.Screen name="DriverHome" component={DriverHomeScreen} />
          <Stack.Screen name="DriverOrderClosureFeedback" component={DriverOrderClosureFeedbackScreen} />
          <Stack.Screen name="DriverFeedback" component={DriverFeedbackScreen} />
          <Stack.Screen name="DriverProfile" component={DriverProfileScreen} />
          <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
          <Stack.Screen name="AdminFinance" component={AdminFinanceScreen} />
          <Stack.Screen name="AdminActivity" component={AdminActivityScreen} />
          <Stack.Screen name="AdminChatAudit" component={AdminChatAuditScreen} />
          <Stack.Screen name="AdminUsers" component={AdminUsersScreen} />
          <Stack.Screen name="AdminUserDetails" component={AdminUserDetailsScreen} />
          <Stack.Screen name="AdminControlReports" component={AdminControlReportsScreen} />
          <Stack.Screen name="Notifications" component={NotificationCenterScreen} />
          <Stack.Screen name="Support" component={SupportTickets} />
          <Stack.Screen name="About" component={AboutScreen} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} />
          <Stack.Screen name="Settings" component={AppSettingsScreen} />
          <Stack.Screen name="Profile" component={ClientProfileScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function NotificationCenterScreen({ navigation }) {
  const role = useAuthStore((state) => state.profile?.role);
  const [rows, setRows] = React.useState([]); const [error, setError] = React.useState(''); const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => { setLoading(true); try { const { data, error: queryError } = await supabase.from('user_notifications').select('id,event_key,title,body,order_id,created_at,read_at').order('created_at', { ascending: false }).limit(100); if (queryError) throw queryError; setRows(data || []); setError(''); } catch (e) { setError(e.message || 'No se pudieron cargar las notificaciones.'); } finally { setLoading(false); } }, []);
  useEffect(() => { let active = true; Promise.resolve().then(() => { if (active) void load(); }); const channel = supabase.channel('notification-center').on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications' }, () => void load()).subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setError(`Conexión de notificaciones fallida: ${status}`); }); return () => { active = false; void supabase.removeChannel(channel); }; }, [load]);
  const markRead = async (id) => { const { error: updateError } = await supabase.rpc('mark_notification_read', { p_id: id }); if (updateError) setError(updateError.message); else setRows((old) => old.map((row) => row.id === id ? { ...row, read_at: new Date().toISOString() } : row)); };
  return <SafeAreaView style={{ flex: 1, padding: 16 }}><Text style={{ fontSize: 22, fontWeight: '800' }}>Notificaciones</Text>{loading ? <ActivityIndicator /> : error ? <Text accessibilityRole="alert">{error}</Text> : <ScrollView>{rows.map((row) => <Pressable key={row.id} onPress={async () => { await markRead(row.id); if (!row.order_id) return; if (role === 'negocio') navigation.navigate('BusinessHome', { screen: 'Orders' }); else if (role === 'repartidor') navigation.navigate('DriverHome'); else navigation.navigate('ClientOrders', { orderId: row.order_id }); }} style={{ padding: 12, borderBottomWidth: 1, borderColor: '#ddd', backgroundColor: row.read_at ? 'transparent' : '#F1F4FF' }}><Text style={{ fontWeight: '700' }}>{row.title}</Text><Text>{row.body}</Text><Text style={{ color: '#666', fontSize: 12 }}>{new Date(row.created_at).toLocaleString()}</Text></Pressable>)}</ScrollView>}</SafeAreaView>;
}



const styles = StyleSheet.create({
  appSafeArea: { flex: 1 },
  startupImage: { width: '100%', maxWidth: 420, height: 300, marginBottom: 16 },
  center: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#F5F7FA' 
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
