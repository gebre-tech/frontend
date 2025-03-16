// src/screens/Contacts.jsx
import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, StyleSheet, Alert } from 'react-native';
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

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${API_URL}/contacts/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setContacts(response.data.results || response.data);
    } catch (error) {
      if (error.response?.status === 401) {
        Alert.alert('Error', 'Session expired. Please log in again.', [
          { text: 'OK', onPress: () => navigation.navigate('Login') },
        ]);
      } else {
        Alert.alert('Error', error.message || 'Could not fetch contacts');
      }
    } finally {
      setLoading(false);
    }
  }, [navigation]);

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
        if (error.response?.status === 401) {
          Alert.alert('Error', 'Session expired. Please log in again.', [
            { text: 'OK', onPress: () => navigation.navigate('Login') },
          ]);
        } else {
          Alert.alert('Error', 'Failed to search contacts');
        }
      } finally {
        setLoading(false);
      }
    }, 300),
    [fetchContacts, navigation]
  );

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const websocket = new WebSocket(`ws://127.0.0.1:8000/ws/contacts/?token=${token}`);

    websocket.onopen = () => console.log('WebSocket connected for Contacts');
    websocket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'friend_request_accepted') {
        fetchContacts();
        Alert.alert('Notification', 'A friend request was accepted!');
      }
    };
    websocket.onerror = (e) => console.error('WebSocket error:', e);
    websocket.onclose = () => console.log('WebSocket disconnected');

    setWs(websocket);
    return () => websocket.close();
  }, [fetchContacts]);

  useEffect(() => {
    fetchContacts();
    setupWebSocket();
  }, [fetchContacts, setupWebSocket]);

  useFocusEffect(
    useCallback(() => {
      if (route.params?.refresh) {
        fetchContacts();
        navigation.setParams({ refresh: false });
      }
    }, [route.params?.refresh, fetchContacts, navigation])
  );

  useEffect(() => {
    searchContacts(searchText);
  }, [searchText, searchContacts]);

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => navigation.navigate('ChatScreen', { chatId: item.friend_id, friendUsername: item.friend.username })}
    >
      <Ionicons name="person-circle-outline" size={40} color="#333" />
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{item.friend.username}</Text>
        <Text style={styles.contactStatus}>
          Last seen: {item.friend.last_seen ? new Date(item.friend.last_seen).toLocaleString() : 'Unknown'}
        </Text>
      </View>
      <TouchableOpacity onPress={() => navigation.navigate('FriendProfile', { username: item.friend.username })}>
        <Ionicons name="information-circle-outline" size={24} color="#007bff" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  searchInput: { padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fff', fontSize: 16, marginBottom: 20 },
  contactItem: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#fff', borderRadius: 8, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  contactInfo: { flex: 1, marginLeft: 15 },
  contactName: { fontSize: 16, fontWeight: '600', color: '#333' },
  contactStatus: { fontSize: 12, color: '#666', marginTop: 2 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  noContactsText: { fontSize: 16, color: '#666', textAlign: 'center' },
  loaderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContainer: { flexGrow: 1 },
});

export default Contacts;