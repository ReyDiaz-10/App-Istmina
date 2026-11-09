// app/src/components/EmptyState.js
import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

const EmptyState = ({ title, message, icon }) => (
  <View style={styles.container}>
    <Text style={styles.icon}>{icon}</Text>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.message}>{message}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, marginTop: 100 },
  icon: { fontSize: 60, marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1A237E', textAlign: 'center' },
  message: { fontSize: 16, color: '#757575', textAlign: 'center', marginTop: 10 },
});

export default EmptyState;
