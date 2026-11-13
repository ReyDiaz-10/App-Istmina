// app/App.js
import React, { useEffect } from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from './src/screens/auth/LoginScreen';
import RegisterScreen from './src/screens/auth/RegisterScreen';
import ClientHomeScreen from './src/screens/client/ClientHomeScreen';
import StoreDetailScreen from './src/screens/client/StoreDetailScreen';
import CartScreen from './src/screens/client/CartScreen';
import ClientOrdersScreen from './src/screens/client/ClientOrdersScreen';
import OrderChatScreen from './src/screens/client/OrderChatScreen';
import BusinessTabs from './src/navigation/BusinessTabs';
import DriverHomeScreen from './src/screens/driver/DriverHomeScreen';
import AdminDashboardScreen from './src/screens/admin/AdminDashboardScreen';
import SupportTickets from './src/screens/client/SupportTickets';
import AboutScreen from './src/screens/client/AboutScreen';
import PrivacyScreen from './src/screens/client/PrivacyScreen';
import AppSettingsScreen from './src/screens/client/AppSettingsScreen';

import { useAuthStore } from './src/store/authStore';
import { supabase } from './src/api/supabaseClient';
import { usePreferencesStore } from './src/store/preferencesStore';
import { useAppTheme } from './src/hooks/useAppTheme';
import { applyAppearancePreference } from './src/utils/appearance';

const Stack = createStackNavigator();

const getInitialRoute = (user, profile) => {
  if (!user) return 'ClientHome';

  switch (profile?.role) {
    case 'negocio':
      return 'BusinessHome';
    case 'repartidor':
      return 'DriverHome';
    case 'superadmin':
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

  useEffect(() => {
    applyAppearancePreference(appearance);
  }, [appearance]);

  useEffect(() => {
    const checkSession = async () => {
      try {
        await usePreferencesStore.getState().hydrate();
        const savedAppearance = usePreferencesStore.getState().appearance;
        applyAppearancePreference(savedAppearance);
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          useAuthStore.setState({ user: session.user });
          await fetchProfile(session.user.id);
        }
      } catch (error) {
        console.error('Error verificando sesión:', error);
      } finally {
        setInitializing(false);
      }
    };

    checkSession();
  }, [fetchProfile]);

  if (initializing) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={{ ...(mode === 'dark' ? DarkTheme : DefaultTheme), colors: { ...(mode === 'dark' ? DarkTheme.colors : DefaultTheme.colors), primary: colors.primary, background: colors.background, card: colors.surface, text: colors.text, border: colors.border } }}>
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
          <Stack.Screen name="OrderChat" component={OrderChatScreen} />
          <Stack.Screen name="BusinessHome" component={BusinessTabs} />
          <Stack.Screen name="DriverHome" component={DriverHomeScreen} />
          <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
          <Stack.Screen name="Support" component={SupportTickets} />
          <Stack.Screen name="About" component={AboutScreen} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} />
          <Stack.Screen name="Settings" component={AppSettingsScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}



const styles = StyleSheet.create({
  center: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#F5F7FA' 
  },
});
