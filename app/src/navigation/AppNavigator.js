// app/src/navigation/AppNavigator.js
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import CartScreen from '../screens/client/CartScreen';

// Pantallas de Auth
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';

// Pantallas de Cliente (Nuevas)
import ClientHomeScreen from '../screens/client/ClientHomeScreen';
import StoreDetailScreen from '../screens/client/StoreDetailScreen';

const Stack = createNativeStackNavigator();

// --- PLACEHOLDERS TEMPORALES PARA NEGOCIO Y REPARTIDOR ---
const PlaceholderScreen = ({ role }) => {
  const { signOut } = useAuthStore();
  
  return (
    <View style={styles.center}>
      <Text style={styles.welcome}>¡Bienvenido!</Text>
      <Text style={styles.roleText}>Estás en el panel de: <Text style={styles.bold}>{role.toUpperCase()}</Text></Text>
      <TouchableOpacity style={styles.logoutButton} onPress={() => signOut()}>
        <Text style={styles.logoutText}>Cerrar Sesión</Text>
      </TouchableOpacity>
    </View>
  );
};

const BusinessScreen = () => <PlaceholderScreen role="negocio" />;
const DriverScreen = () => <PlaceholderScreen role="repartidor" />;

// --- NAVEGADOR PRINCIPAL ---
export default function AppNavigator() {
  const { user, profile, loading } = useAuthStore();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1A237E" />
      </View>
    );
  }

  return (
    <NavigationContainer independent={true}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          // Flujo de Autenticación
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        ) : (
          // Flujo basado en Roles
          <>
            {/* FLUJO CLIENTE: Ahora con navegación múltiple */}
            {profile?.role === 'cliente' && (
              <>
                <Stack.Screen name="ClientHome" component={ClientHomeScreen} options={{ title: 'IstmiYa - Explorar' }} />
                <Stack.Screen name="StoreDetail" component={StoreDetailScreen} options={({ route }) => ({ title: route.params?.storeName })} />
                <Stack.Screen name="Cart" component={CartScreen} options={{ title: 'Mi Carrito' }} />
                
                <Stack.Screen 
                  name="ClientHome" 
                  component={ClientHomeScreen} 
                  options={{ headerShown: true, title: 'IstmiYa - Explorar' }} 
                />
                <Stack.Screen 
                  name="StoreDetail" 
                  component={StoreDetailScreen} 
                  options={({ route }) => ({ 
                    headerShown: true, 
                    title: route.params?.storeName || 'Detalle de Tienda' 
                  })} 
                />
              </>
            )}

            {/* FLUJO NEGOCIO (Placeholder) */}
            {profile?.role === 'negocio' && (
              <Stack.Screen name="BusinessHome" component={BusinessScreen} />
            )}

            {/* FLUJO REPARTIDOR (Placeholder) */}
            {profile?.role === 'repartidor' && (
              <Stack.Screen name="DriverHome" component={DriverScreen} />
            )}

            {/* Error de Rol */}
            {!profile?.role && (
              <Stack.Screen name="ErrorRole" component={() => (
                <View style={styles.center}><Text>Error: Rol no asignado</Text></View>
              )} />
            )}
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F7FA',
    padding: 20,
  },
  welcome: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1A237E',
    marginBottom: 10,
  },
  roleText: {
    fontSize: 18,
    color: '#5C6BC0',
    marginBottom: 30,
    textAlign: 'center',
  },
  bold: {
    fontWeight: 'bold',
    color: '#1A237E',
  },
  logoutButton: {
    backgroundColor: '#D32F2F',
    padding: 15,
    borderRadius: 12,
    width: '80%',
    alignItems: 'center',
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
