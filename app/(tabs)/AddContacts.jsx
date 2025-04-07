//app/tabs/AddContacts.jsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, FlatList } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import debounce from 'lodash.debounce';

const API_URL = "http://127.0.0.1:8000";

const AddContacts = () => {
  const navigation = useNavigation();
  const [friendUsername, setFriendUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isFocused, setIsFocused] = useState(false);
  const [ws, setWs] = useState(null);
  const inputRef = useRef(null);

  const resetForm = useCallback(() => {
    setFriendUsername('');
    setError('');
    setStatus('');
    setSuggestions([]);
    inputRef.current?.blur();
  }, []);

  const validateInput = (text) => {
    setFriendUsername(text);
    setStatus('');
    if (!text.trim()) {
      setError('Username cannot be empty');
      setSuggestions([]);
    } else if (text.length < 3) {
      setError('Username must be at least 3 characters');
      setSuggestions([]);
    } else {
      setError('');
      fetchSuggestions(text);
    }
  };

  const fetchSuggestions = useCallback(
    debounce(async (query) => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) {
          setError('Please log in again');
          navigation.navigate('Login');
          return;
        }
        const response = await axios.get(`${API_URL}/contacts/search/users/`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { query },
        });
        console.log('Suggestions response:', response.data.results); // Debug
        setSuggestions(response.data.results || []);
      } catch (err) {
        setError(err.response?.status === 401 ? 'Session expired. Please log in again.' : 'Failed to load suggestions');
        if (err.response?.status === 401) navigation.navigate('Login');
      }
    }, 300),
    [navigation]
  );

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) {
      console.error('No token found for WebSocket');
      return;
    }

    const websocket = new WebSocket(`ws://127.0.0.1:8000/ws/contacts/?token=${token}`);

    websocket.onopen = () => console.log('WebSocket connected for AddContacts');
    websocket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'friend_request_sent') {
        setStatus(`Friend request sent to ${data.request.receiver.first_name}!`);
        Alert.alert('Success', `Friend request sent to ${data.request.receiver.first_name}!`, [
          { text: 'OK', onPress: () => navigation.navigate('Contacts') },
        ]);
        resetForm();
      } else if (data.type === 'friend_request_accepted') {
        Alert.alert('Notification', `${data.friend_first_name} accepted your friend request!`);
        navigation.navigate('Contacts', { refresh: true });
      } else if (data.type === 'friend_request_rejected') {
        Alert.alert('Notification', `${data.rejected_by} rejected your friend request.`);
      } else if (data.type === 'friend_request_received') {
        Alert.alert('New Friend Request', `From ${data.request.sender.first_name}`);
      }
    };
    websocket.onerror = (e) => console.error('WebSocket error:', e);
    websocket.onclose = () => console.log('WebSocket disconnected');

    setWs(websocket);
    return () => websocket.close();
  }, [navigation, resetForm]);

  const handleSendFriendRequest = async (username = friendUsername) => {
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        throw new Error('No token found');
      }
      await axios.post(
        `${API_URL}/contacts/request/`,
        { username },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      if (ws) {
        ws.send(JSON.stringify({ type: 'friend_request', username }));
      }
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to send friend request';
      setError(message);
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setupWebSocket();
    inputRef.current?.focus();
  }, [setupWebSocket]);

  const renderSuggestion = ({ item }) => (
    <TouchableOpacity
      style={styles.suggestionItem}
      onPress={() => {
        setFriendUsername(item.username);
        setSuggestions([]);
        handleSendFriendRequest(item.username);
      }}
    >
      <Ionicons name="person-outline" size={20} color="#666" />
      <Text style={styles.suggestionText}>{item.first_name || item.username}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.outerContainer}>
      <View style={styles.container}>
        <Text style={styles.title}>Add a New Contact</Text>
        <View style={styles.inputWrapper}>
          <View style={styles.inputContainer}>
            <Ionicons name="person-add-outline" size={24} color="#666" style={styles.inputIcon} />
            <TextInput
              ref={inputRef}
              style={[styles.input, error ? styles.inputError : isFocused ? styles.inputFocused : null]}
              placeholder="Enter Friend's Username"
              value={friendUsername}
              onChangeText={validateInput}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              editable={!loading}
            />
          </View>
          {suggestions.length > 0 && !error && (
            <View style={styles.suggestionsContainer}>
              {console.log('Rendering suggestions:', suggestions)} {/* Debug */}
              <FlatList
                data={suggestions.slice(0, 5)}
                renderItem={renderSuggestion}
                keyExtractor={(item) => (item.id ? item.id.toString() : item.username)} // Fallback to username if id is missing
              />
            </View>
          )}
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
        {status && <Text style={styles.statusText}>{status}</Text>}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={() => navigation.goBack()}
            disabled={loading}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, loading || error ? styles.buttonDisabled : styles.addButton]}
            onPress={() => handleSendFriendRequest()}
            disabled={loading || !!error}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.buttonText}>Send Request</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#f5f5f5', justifyContent: 'center', alignItems: 'center', padding: 20 },
  container: { width: '100%', maxWidth: 400, backgroundColor: '#fff', borderRadius: 12, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5 },
  title: { fontSize: 24, fontWeight: '700', color: '#333', marginBottom: 24, textAlign: 'center' },
  inputWrapper: { width: '100%', position: 'relative', marginBottom: 16 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fafafa', fontSize: 16 },
  inputFocused: { borderColor: '#007bff' },
  inputError: { borderColor: '#ff4d4d' },
  errorText: { color: '#ff4d4d', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  statusText: { color: '#28a745', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  suggestionsContainer: { position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#ddd', marginTop: 4, zIndex: 1000, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, maxHeight: 200 },
  suggestionItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  suggestionText: { fontSize: 16, color: '#333', marginLeft: 10 },
  buttonContainer: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 20 },
  button: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 6 },
  cancelButton: { backgroundColor: '#6c757d' },
  addButton: { backgroundColor: '#007bff' },
  buttonDisabled: { backgroundColor: '#99ccff', opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

export default AddContacts;