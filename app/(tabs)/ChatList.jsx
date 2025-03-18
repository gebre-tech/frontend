import React, { useState, useEffect, useContext, useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Alert, Image } from "react-native";
import axios from "axios";
import { AuthContext } from "../../context/AuthContext";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const API_URL = "http://127.0.0.1:8000"; // Replace with your device's IP if needed

const ChatList = () => {
  const { user } = useContext(AuthContext);
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();
  const wsRef = useState(null);

  const fetchChats = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error("No token found");
      const response = await axios.get(`${API_URL}/chat/rooms/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const sortedChats = (response.data || []).sort((a, b) =>
        new Date(b.last_message?.timestamp || b.created_at) - new Date(a.last_message?.timestamp || a.created_at)
      );
      setChats(sortedChats);
    } catch (error) {
      console.error("Fetch chats error:", error);
      Alert.alert("Error", error.message || "Failed to fetch chats");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const ws = new WebSocket(`ws://127.0.0.1:8000/ws/contacts/?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => console.log('ChatList WebSocket connected');
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log("ChatList WebSocket message:", data);
        if (data.type === 'chat_message') {
          setChats((prev) => {
            const updated = prev.map(chat =>
              chat.id === data.message.chat.id
                ? { ...chat, last_message: data.message, unread_count: (chat.unread_count || 0) + (data.message.sender.id !== user.id ? 1 : 0) }
                : chat
            );
            if (!updated.some(chat => chat.id === data.message.chat.id)) {
              updated.push({
                id: data.message.chat.id,
                members: data.message.chat.members,
                last_message: data.message,
                unread_count: data.message.sender.id !== user.id ? 1 : 0,
                is_group: data.message.chat.is_group || false,
              });
            }
            return updated.sort((a, b) =>
              new Date(b.last_message?.timestamp || b.created_at) - new Date(a.last_message?.timestamp || a.created_at)
            );
          });
        }
      } catch (error) {
        console.error("WebSocket message parsing error:", error);
      }
    };
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      ws.close();
    };
    ws.onclose = () => {
      console.log('ChatList WebSocket closed');
      if (user) setTimeout(setupWebSocket, 2000);
    };
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchChats();
      setupWebSocket();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        console.log("ChatList WebSocket cleanup");
      }
    };
  }, [user, fetchChats, setupWebSocket]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchChats();
  };

  const getChatSections = () => {
    const recentReceived = chats.filter(chat => chat.last_message && chat.last_message.sender.id !== user.id).slice(0, 5);
    const recentSent = chats.filter(chat => chat.last_message && chat.last_message.sender.id === user.id).slice(0, 5);
    const history = chats.filter(chat => !recentReceived.includes(chat) && !recentSent.includes(chat));
    return [
      { title: 'Recent Received', data: recentReceived },
      { title: 'Recent Sent', data: recentSent },
      { title: 'Chat History', data: history },
    ].filter(section => section.data.length > 0);
  };

  const renderItem = ({ item }) => {
    const friend = item.members.find(m => m.id !== user.id);
    const lastSeen = friend?.last_seen ? new Date(friend.last_seen) : null;
    const isOnline = lastSeen && (new Date() - lastSeen) < 5 * 60 * 1000;

    return (
      <TouchableOpacity
        style={styles.chatItem}
        onPress={() => navigation.navigate("ChatScreen", {
          chatId: item.id,
          friendUsername: item.is_group ? null : (item.name || friend?.username),
          isGroup: item.is_group || false,
        })}
      >
        <Image
          source={{ uri: friend?.profile_picture || 'https://via.placeholder.com/40' }}
          style={styles.avatar}
        />
        <View style={styles.chatInfo}>
          <Text style={styles.username}>{item.is_group ? `Group ${item.id}` : (item.name || friend?.username || "Unknown")}</Text>
          <Text style={styles.lastMessage} numberOfLines={1}>
            {item.last_message
              ? `${item.last_message.sender.username}: ${item.last_message.content || item.last_message.message_type}`
              : "No messages yet"}
          </Text>
          <Text style={styles.status}>
            {item.is_group ? "" : (isOnline ? 'Online' : lastSeen ? `Last seen: ${lastSeen.toLocaleTimeString()}` : 'Offline')}
          </Text>
        </View>
        {item.unread_count > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{item.unread_count}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderSectionHeader = ({ section: { title } }) => (
    <Text style={styles.sectionHeader}>{title}</Text>
  );

  if (loading) return <ActivityIndicator size="large" color="#007AFF" style={styles.loadingContainer} />;

  return (
    <View style={styles.container}>
      <FlatList
        data={getChatSections()}
        renderItem={({ item }) => (
          <FlatList
            data={item.data}
            renderItem={renderItem}
            keyExtractor={(chat) => chat.id.toString()}
          />
        )}
        keyExtractor={(section) => section.title}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={true}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.emptyText}>No chats available</Text>}
      />
      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('Contacts')}>
        <Ionicons name="chatbubble-ellipses" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  chatItem: { 
    flexDirection: 'row', 
    padding: 15, 
    backgroundColor: '#fff', 
    borderBottomWidth: 1, 
    borderBottomColor: '#eee', 
    alignItems: 'center' 
  },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  chatInfo: { flex: 1 },
  username: { fontSize: 16, fontWeight: "600" },
  lastMessage: { color: "#666", fontSize: 14, marginTop: 2 },
  status: { color: "#999", fontSize: 12, marginTop: 2 },
  unreadBadge: { 
    backgroundColor: '#007AFF', 
    borderRadius: 12, 
    padding: 5, 
    minWidth: 24, 
    alignItems: 'center' 
  },
  unreadText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  sectionHeader: { 
    fontSize: 18, 
    fontWeight: '700', 
    padding: 10, 
    backgroundColor: '#f0f0f0', 
    color: '#333' 
  },
  emptyText: { textAlign: "center", marginTop: 20, fontSize: 16, color: "#666" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  fab: { 
    position: 'absolute', 
    bottom: 20, 
    right: 20, 
    backgroundColor: '#007AFF', 
    borderRadius: 30, 
    width: 60, 
    height: 60, 
    justifyContent: 'center', 
    alignItems: 'center', 
    elevation: 5 
  },
});

export default ChatList;