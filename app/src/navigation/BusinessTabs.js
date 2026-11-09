// app/src/navigation/BusinessTabs.js
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import BusinessHomeScreen from '../screens/business/BusinessHomeScreen';
import BusinessOrdersScreen from '../screens/business/BusinessOrdersScreen';
import BusinessCatalogScreen from '../screens/business/BusinessCatalogScreen';

const Tab = createBottomTabNavigator();

export default function BusinessTabs() {
  return (
    <Tab.Navigator 
      screenOptions={{ 
        headerShown: false,
        tabBarStyle: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E0E0E0' },
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
    </Tab.Navigator>
  );
}
