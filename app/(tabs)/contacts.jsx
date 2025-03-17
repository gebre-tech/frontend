import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, StyleSheet, Alert, Image } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { AuthContext } from '../../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import debounce from 'lodash.debounce';

const API_URL = "http://127.0.0.1:8000";

const Contacts = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useContext(AuthContext);
  const [ws, setWs] = useState(null);

  // Fetch contacts from the backend
  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
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

  // Search contacts based on query
  const searchContacts = useCallback(
    debounce(async (query) => {
      if (!query) {
        fetchContacts();
        return;
      }
      try {
        setLoading(true);
        const token = await AsyncStorage.getItem('token');
        const response = await axios.get(`${API_URL}/contacts/search/`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { query },
        });
        setContacts(response.data.results || response.data);
      } catch (error) {
        handleError(error);
      } finally {
        setLoading(false);
      }
    }, 300),
    [fetchContacts]
  );

  // Remove a friend
  const removeFriend = async (friendId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await axios.delete(`${API_URL}/contacts/remove/${friendId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 200) {
        // Remove the friend from the local state
        setContacts((prevContacts) =>
          prevContacts.filter((contact) => contact.friend_id !== friendId)
        );
        Alert.alert('Success', 'Friend removed successfully');
      }
    } catch (error) {
      if (error.response?.status === 404) {
        // Handle 404 Not Found
        Alert.alert('Error', 'Friend not found in your contacts');
        // Optionally, remove the friend from the local state
        setContacts((prevContacts) =>
          prevContacts.filter((contact) => contact.friend_id !== friendId)
        );
      } else {
        // Handle other errors
        Alert.alert('Error', error.response?.data?.error || 'Failed to remove friend');
      }
    }
  };

  // Handle errors
  const handleError = (error) => {
    if (error.response?.status === 401) {
      Alert.alert('Error', 'Session expired. Please log in again.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } else {
      Alert.alert('Error', error.response?.data?.error || error.message || 'An error occurred');
    }
  };

  // Setup WebSocket connection
  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) {
      console.error('No token found for WebSocket');
      return;
    }

    const connectWebSocket = () => {
      const contactWs = new WebSocket(`ws://127.0.0.1:8000/ws/contacts/?token=${token}`);

      contactWs.onopen = () => console.log('Contact WebSocket connected');
      contactWs.onmessage = (e) => {
        const data = JSON.parse(e.data);
        console.log('WebSocket message:', data);

        if (data.type === 'friend_removed') {
          // Update the local state to remove the friend
          setContacts((prevContacts) =>
            prevContacts.filter((contact) => contact.friend_id !== data.friend_id)
          );
          Alert.alert('Friend Removed', data.message);
        } else if (data.type === 'friend_request_received') {
          Alert.alert('New Friend Request', `From ${data.request.sender.first_name}`);
        } else if (data.type === 'friend_request_accepted') {
          setContacts((prev) => {
            if (!prev.some((c) => c.friend_id === data.contact.friend_id)) {
              return [...prev, data.contact];
            }
            return prev;
          });
          Alert.alert('Notification', `${data.friend_first_name} is now your friend!`);
        } else if (data.type === 'friend_added') {
          setContacts((prev) => {
            if (!prev.some((c) => c.friend_id === data.contact.friend_id)) {
              return [...prev, data.contact];
            }
            return prev;
          });
          Alert.alert('Notification', `${data.contact.friend.user.first_name} added you as a friend!`);
        }
      };

      contactWs.onerror = (e) => {
        console.error('Contact WebSocket error:', e);
      };

      contactWs.onclose = (e) => {
        console.log('Contact WebSocket disconnected, reconnecting in 2s...', e.code, e.reason);
        setTimeout(connectWebSocket, 2000); // Reconnect after 2 seconds
      };

      setWs(contactWs);
      return contactWs;
    };

    const wsInstance = connectWebSocket();
    return () => wsInstance.close();
  }, []);

  // Fetch contacts and setup WebSocket on component mount
  useEffect(() => {
    fetchContacts();
    setupWebSocket();
  }, [fetchContacts, setupWebSocket]);

  // Refresh contacts when the screen is focused
  useFocusEffect(
    useCallback(() => {
      if (route.params?.refresh) {
        fetchContacts();
        navigation.setParams({ refresh: false });
      }
    }, [route.params?.refresh, fetchContacts, navigation])
  );

  // Search contacts when searchText changes
  useEffect(() => {
    searchContacts(searchText);
  }, [searchText, searchContacts]);

  // Render each contact item
  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => navigation.navigate('ChatScreen', { chatId: item.friend_id, friendUsername: item.friend.user.username })}
    >
      <TouchableOpacity
        onPress={() => navigation.navigate('FriendProfile', { username: item.friend.user.username })}
      >
        <Image
          source={{ uri: item.friend.profile_picture || 'https://via.placeholder.com/40' }}
          style={styles.profileImage}
          resizeMode="cover"
        />
      </TouchableOpacity>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{item.friend.user.first_name || item.friend.user.username}</Text>
        <Text style={styles.contactStatus}>
          {item.is_online ? 'Online' : `Last seen: ${item.friend.last_seen ? new Date(item.friend.last_seen).toLocaleString() : 'Unknown'}`}
        </Text>
      </View>
      <TouchableOpacity onPress={() => removeFriend(item.friend_id)}>
        <Ionicons name="trash-outline" size={24} color="#ff4444" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // Render empty state
  const ListEmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.noContactsText}>{searchText ? 'No contacts found' : 'No contacts available'}</Text>
    </View>
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
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#007bff" />
        </View>
      ) : (
        <FlatList
          data={contacts}
          renderItem={renderItem}
          keyExtractor={(item) => item.friend_id.toString()}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
};

// Styles
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  searchInput: { padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fff', fontSize: 16, marginBottom: 20 },
  contactItem: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#fff', borderRadius: 8, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  profileImage: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ddd' },
  contactInfo: { flex: 1, marginLeft: 15 },
  contactName: { fontSize: 16, fontWeight: '600', color: '#333' },
  contactStatus: { fontSize: 12, color: '#666', marginTop: 2 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  noContactsText: { fontSize: 16, color: '#666', textAlign: 'center' },
  loaderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContainer: { flexGrow: 1 },
});

export default Contacts;