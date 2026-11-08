// app/App.js
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';


export default function App() {
  return (
    <NavigationContainer>
      <AppNavigator />
    </NavigationContainer>
  );
}

// Importamos las pantallas de Auth
import LoginScreen from './src/screens/auth/LoginScreen';
import RegisterScreen from './src/screens/auth/RegisterScreen';

// Importamos el store de autenticación
import { useAuthStore } from './src/store/authStore';
import { supabase } from './src/api/supabaseClient';

const Stack = createStackNavigator();

// Pantalla provisional para el Home (Aquí es donde llegarán los usuarios logueados)
const HomeScreen = () => (
  <View style={styles.center}>
    <Text style={styles.text}>🚀 ¡Bienvenido a IstmiYa!</Text>
    <Text>Aquí empezaremos a construir el Marketplace</Text>
  </View>
);

export default function App() {
  const { user, profile, loading, fetchProfile } = useAuthStore();
  const [initializing, setInitializing] = React.useState(true);

  // Efecto para verificar la sesión al abrir la app
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          // Si hay sesión, cargamos el perfil (rol, nombre, etc.)
          await fetchProfile(session.user.id);
        }
      } catch (error) {
        console.error('Error verificando sesión:', error);
      } finally {
        setInitializing(false);
      }
    };

    checkSession();
  }, []);

  // Mientras la app verifica si hay sesión, mostramos un cargador
  if (initializing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1A237E" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator 
        screenOptions={{ 
          headerShown: false, // Ocultamos el header para un diseño más limpio y moderno
        }}
      >
        {user ? (
          // --- FLUJO AUTENTICADO ---
          // Si hay usuario, solo puede acceder a las pantallas principales
          <Stack.Screen name="Home" component={HomeScreen} />
        ) : (
          // --- FLUJO NO AUTENTICADO ---
          // Si no hay usuario, solo puede acceder a Login y Registro
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
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
    backgroundColor: '#F5F7FA' 
  },
  text: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: '#1A237E', 
    marginBottom: 10 
  },
});
