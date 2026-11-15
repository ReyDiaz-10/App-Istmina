import { AppText as Text } from '../components/AppText.js';
// app/src/navigation/BusinessTabs.js
import React from 'react';

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import BusinessHomeScreen from '../screens/business/BusinessHomeScreen';
import BusinessOrdersScreen from '../screens/business/BusinessOrdersScreen';
import BusinessCatalogScreen from '../screens/business/BusinessCatalogScreen';
import BusinessSettlementsScreen from '../screens/business/BusinessSettlementsScreen';
import { usePreferencesStore } from '../store/preferencesStore';

const Tab = createBottomTabNavigator();

export default function BusinessTabs() {
  const fontScale = usePreferencesStore((state) => state.fontScale);

  return (
    <Tab.Navigator 
      screenOptions={{ 
        headerShown: false,
        tabBarStyle: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E0E0E0' },
        tabBarLabelStyle: { fontSize: 12 * (fontScale || 1) },
        tabBarActiveTintColor: '#1A237E',
        tabBarInactiveTintColor: '#757575',
      }}
    >
      <Tab.Screen 
        name="Dashboard" 
        component={BusinessHomeScreen} 
        options={{ tabBarLabel: 'Inicio', tabBarIcon: ({color}) => <Text style={{color}}>🏠</Text> }} 
      />
      <Tab.Screen 
        name="Orders" 
        component={BusinessOrdersScreen} 
        options={{ tabBarLabel: 'Pedidos', tabBarIcon: ({color}) => <Text style={{color}}>📦</Text> }} 
      />
      <Tab.Screen 
        name="Catalog" 
        component={BusinessCatalogScreen} 
        options={{ tabBarLabel: 'Productos', tabBarIcon: ({color}) => <Text style={{color}}>🍔</Text> }} 
      />
      <Tab.Screen
        name="Settlements"
        component={BusinessSettlementsScreen}
        options={{ tabBarLabel: 'Liquidaciones', tabBarIcon: ({color}) => <Text style={{color}}>🏦</Text> }}
      />
    </Tab.Navigator>
  );
}
