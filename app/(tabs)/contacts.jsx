import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, StyleSheet, Alert, Image } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { AuthContext } from '../../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import debounce from 'lodash.debounce';

const API_URL = "http://127.0.0.1:8000"; // Replace with your device's IP if testing on emulator

const Contacts = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const navigation = useNavigation();
  const { user } = useContext(AuthContext);
  const [ws, setWs] = useState(null);

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error("No authentication token found");
      const response = await axios.get(`${API_URL}/contacts/list_with_profiles/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setContacts(response.data || []);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchContacts = useCallback(
    debounce(async (query) => {
      if (!query) return fetchContacts();
      try {
        setLoading(true);
        const token = await AsyncStorage.getItem('token');
        if (!token) throw new Error("No authentication token found");
        const response = await axios.get(`${API_URL}/contacts/search/`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { query },
        });
        setContacts(response.data.results || response.data || []);
      } catch (error) {
        handleError(error);
      } finally {
        setLoading(false);
      }
    }, 300),
    [fetchContacts]
  );

  const startChat = async (friendId, friendUsername) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error("No authentication token found");

      const response = await axios.post(
        `${API_URL}/chat/send-message/`,
        {
          receiver_id: friendId,
          content: '', // Empty initial message to establish chat
          message_type: 'text',
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );

      console.log("Send message response:", JSON.stringify(response.data)); // Debug full response
      const chatId = response.data.chat?.id || response.data.id; // Flexible extraction
      if (!chatId) throw new Error("Chat ID not found in response");
      
      console.log(`Started chat with ${friendUsername}, chatId: ${chatId}`);
      navigation.navigate('ChatScreen', { chatId, friendUsername, isGroup: false });
    } catch (error) {
      console.error("Start chat error:", error);
      Alert.alert('Error', error.response?.data?.error || error.message || 'Failed to start chat');
    }
  };

  const removeFriend = async (friendId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error("No authentication token found");
      await axios.delete(`${API_URL}/contacts/remove/${friendId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setContacts((prev) => prev.filter((contact) => contact.friend_id !== friendId));
      Alert.alert('Success', 'Friend removed successfully');
    } catch (error) {
      if (error.response?.status === 404) {
        setContacts((prev) => prev.filter((contact) => contact.friend_id !== friendId));
        Alert.alert('Info', 'Friend was already removed');
      } else {
        handleError(error);
      }
    }
  };

  const handleError = (error) => {
    console.error("Error:", error);
    if (error.response?.status === 401) {
      Alert.alert('Error', 'Session expired. Please log in again.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } else {
      Alert.alert('Error', error.response?.data?.error || error.message || 'An error occurred');
    }
  };

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const wsInstance = new WebSocket(`ws://127.0.0.1:8000/ws/contacts/?token=${token}`);
    wsInstance.onopen = () => console.log('Contacts WebSocket connected');
    wsInstance.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log("Contacts WebSocket message:", data);
        if (data.type === 'friend_removed') {
          setContacts((prev) => prev.filter((contact) => contact.friend_id !== data.friend_id));
          Alert.alert('Notification', `${data.friend_first_name} removed you as a friend`);
        } else if (data.type === 'friend_request_accepted') {
          setContacts((prev) => [...prev, data.contact]);
          Alert.alert('Notification', `${data.contact.friend.user.username} accepted your friend request`);
        }
      } catch (error) {
        console.error("WebSocket message parsing error:", error);
      }
    };
    wsInstance.onerror = (error) => {
      console.error("WebSocket error:", error);
      setTimeout(setupWebSocket, 2000);
    };
    wsInstance.onclose = () => console.log('Contacts WebSocket closed');
    setWs(wsInstance);

    return () => {
      if (wsInstance) wsInstance.close();
    };
  }, []);

  useEffect(() => {
    if (user) {
      fetchContacts();
      setupWebSocket();
    }
    return () => {
      if (ws) {
        ws.close();
        console.log("Contacts WebSocket cleanup");
      }
    };
  }, [user, fetchContacts, setupWebSocket]);

  useFocusEffect(
    useCallback(() => {
      const currentRoute = navigation.getState()?.routes.find(r => r.name === 'Contacts');
      if (currentRoute?.params?.refresh) {
        fetchContacts();
        navigation.setParams({ refresh: false });
      }
    }, [fetchContacts, navigation])
  );

  useEffect(() => {
    searchContacts(searchText);
  }, [searchText, searchContacts]);

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => startChat(item.friend_id, item.friend.user.username)}
    >
      <Image
        source={{ uri: item.friend.profile_picture || 'https://via.placeholder.com/40' }}
        style={styles.profileImage}
      />
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{item.friend.user.first_name || item.friend.user.username}</Text>
        <Text style={styles.contactStatus}>
          {item.is_online
            ? 'Online'
            : `Last seen: ${item.friend.last_seen ? new Date(item.friend.last_seen).toLocaleString() : 'Unknown'}`}
        </Text>
      </View>
      <TouchableOpacity onPress={() => removeFriend(item.friend_id)}>
        <Ionicons name="trash-outline" size={24} color="#007AFF" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search contacts..."
        value={searchText}
        onChangeText={setSearchText}
        autoCapitalize="none"
      />
      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loaderContainer} />
      ) : (
        <FlatList
          data={contacts}
          renderItem={renderItem}
          keyExtractor={(item) => item.friend_id.toString()}
          ListEmptyComponent={<Text style={styles.noContactsText}>{searchText ? 'No contacts found' : 'No contacts available'}</Text>}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  searchInput: { padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fff', fontSize: 16, marginBottom: 20 },
  contactItem: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#fff', borderRadius: 8, marginBottom: 10, elevation: 2 },
  profileImage: { width: 40, height: 40, borderRadius: 20 },
  contactInfo: { flex: 1, marginLeft: 15 },
  contactName: { fontSize: 16, fontWeight: '600', color: '#333' },
  contactStatus: { fontSize: 12, color: '#666', marginTop: 2 },
  noContactsText: { fontSize: 16, color: '#666', textAlign: 'center', marginTop: 20 },
  loaderContainer: { flex: 1, justifyContent: 'center' },
  listContainer: { flexGrow: 1 },
});

export default Contacts;