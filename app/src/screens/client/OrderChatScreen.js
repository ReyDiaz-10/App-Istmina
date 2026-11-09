// app/src/screens/client/OrderChatScreen.js
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';

const OrderChatScreen = ({ route }) => {
  const { orderId } = route.params;
  const { profile } = useAuthStore();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    fetchMessages();
    // Canal de Realtime para el chat
    const channel = supabase
      .channel(`chat:${orderId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chats', filter: `order_id=eq.${orderId}` }, 
      (payload) => {
        setMessages(prev => [...prev, payload.new]);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const fetchMessages = async () => {
    const { data } = await supabase.from('chats').select('*').eq('order_id', orderId).order('created_at', { ascending: true });
    setMessages(data || []);
  };

  const sendMessage = async () => {
    if (!text.trim()) return;
    const { error } = await supabase.from('chats').insert([{ order_id: orderId, sender_id: profile.id, message: text }]);
    if (error) console.error(error);
    setText('');
  };

  const renderMessage = ({ item }) => {
    const isMe = item.sender_id === profile.id;
    return (
      <View style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}>
        <Text style={[styles.msgText, isMe ? styles.myText : styles.theirText]}>{item.message}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <FlatList 
        data={messages} 
        renderItem={renderMessage} 
        keyExtractor={(item) => item.id} 
        contentContainerStyle={styles.list} 
      />
      <View style={styles.inputArea}>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Escribe un mensaje..." />
        <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
          <Text style={styles.sendText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  list: { padding: 15 },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 15, marginBottom: 10 },
  myBubble: { alignSelf: 'flex-end', backgroundColor: '#1A237E', borderBottomRightRadius: 2 },
  theirBubble: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 2, borderWidth: 1, borderColor: '#E0E0E0' },
  msgText: { fontSize: 15 },
  myText: { color: '#fff' },
  theirText: { color: '#333' },
  inputArea: { flexDirection: 'row', padding: 15, backgroundColor: '#fff', alignItems: 'center', borderTopWidth: 1, borderColor: '#E0E0E0' },
  input: { flex: 1, backgroundColor: '#F5F7FA', padding: 12, borderRadius: 20, marginRight: 10 },
  sendBtn: { backgroundColor: '#1A237E', width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center' },
  sendText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
});

export default OrderChatScreen;
