import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import debounce from 'lodash.debounce';

const AddContacts = () => {
  const navigation = useNavigation();
  const [friendUsername, setFriendUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isFocused, setIsFocused] = useState(false);
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

        const response = await axios.get('http://127.0.0.1:8000/contacts/search/users/', {
          headers: { Authorization: `Bearer ${token}` },
          params: { query },
        });
        console.log('Suggestions response:', response.data);
        setSuggestions(response.data.results || response.data);
      } catch (err) {
        console.error('Fetch suggestions error:', err.message, err.response);
        setError(err.response?.status === 401 ? 'Session expired. Please log in again.' : 'Failed to load suggestions');
        if (err.response?.status === 401) navigation.navigate('Login');
      }
    }, 300),
    [navigation]
  );

  const handleAddFriend = async (username = friendUsername) => {
    console.log('Attempting to add friend:', username);
    setLoading(true);
    setStatus('');
    setError('');
    setSuggestions([]);
    try {
      const token = await AsyncStorage.getItem('token');
      console.log('Token:', token);
      if (!token) {
        throw new Error('No authentication token found. Please log in again.');
      }
  
      console.log('Sending POST request to /contacts/add/ with:', { username });
      const response = await axios.post(
        'http://127.0.0.1:8000/contacts/add/',
        { username },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
  
      console.log('Add friend response:', response.status, response.data);
  
      if (response.status === 201) {
        const friendData = response.data.friend || { username };
        setStatus(`Successfully added ${friendData.username} as a friend!`);
        console.log('Navigating to Contacts with refresh');
        resetForm();
        navigation.navigate('Contacts', { refresh: true });
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error) {
      console.error('Add friend error:', error.message, error.response?.data, error.code);
      const errorMessage =
        error.response?.status === 500
          ? `Server error: ${error.response.data.error || 'Unknown issue'}`
          : error.code === 'ECONNREFUSED'
          ? 'Cannot connect to the server. Please ensure it’s running.'
          : error.response?.status === 401
          ? 'Session expired. Please log in again.'
          : error.response?.status === 404
          ? `User "${username}" not found.`
          : error.response?.status === 400
          ? error.response.data.error || 'Could not add friend.'
          : error.message || 'Failed to add friend.';
      setError(errorMessage);
      Alert.alert('Error', errorMessage, [{ text: 'OK' }]);
      if (error.response?.status === 401) navigation.navigate('Login');
    } finally {
      setLoading(false);
    }
  };
  
  const addFriendAndNavigate = (username = friendUsername) => {
    console.log('Adding friend and navigating for:', username);
    if (!username.trim() || error) {
      setError(error || 'Please enter a valid username');
      Alert.alert('Error', error || 'Please enter a valid username');
      return;
    }
    handleAddFriend(username); // Directly call handleAddFriend
  };

  const handleSuggestionSelect = (username) => {
    console.log('Suggestion selected:', username);
    setFriendUsername(username);
    setSuggestions([]);
    inputRef.current?.blur();
    addFriendAndNavigate(username); // Auto-add and navigate
  };

  const renderSuggestion = (item) => (
    <TouchableOpacity
      style={styles.suggestionItem}
      onPress={() => handleSuggestionSelect(item.username)}
    >
      <Ionicons name="person-outline" size={20} color="#666" />
      <Text style={styles.suggestionText}>{item.username}</Text>
    </TouchableOpacity>
  );

  useEffect(() => {
    inputRef.current?.focus();
    AsyncStorage.getItem('token').then((token) => console.log('Initial token:', token));
  }, []);

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
          {suggestions.length > 0 && !error ? (
            <View style={styles.suggestionsContainer}>
              {suggestions.slice(0, 5).map((item, index) => (
                <View key={item.id || index}>{renderSuggestion(item)}</View>
              ))}
            </View>
          ) : null}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {status ? <Text style={styles.statusText}>{status}</Text> : null}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={() => navigation.goBack()}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, loading || error ? styles.buttonDisabled : styles.addButton]}
            onPress={() => addFriendAndNavigate()}
            disabled={loading || !!error}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.buttonText}>Add Friend</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 24,
    textAlign: 'center',
  },
  inputWrapper: {
    width: '100%',
    position: 'relative',
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fafafa',
    fontSize: 16,
  },
  inputFocused: {
    borderColor: '#007bff',
  },
  inputError: {
    borderColor: '#ff4d4d',
  },
  errorText: {
    color: '#ff4d4d',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  statusText: {
    color: '#28a745',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  suggestionsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginTop: 4,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    maxHeight: 200,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  suggestionText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 10,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  cancelButton: {
    backgroundColor: '#6c757d',
  },
  addButton: {
    backgroundColor: '#007bff',
  },
  buttonDisabled: {
    backgroundColor: '#99ccff',
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default AddContacts;