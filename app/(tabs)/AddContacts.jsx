// app/tabs/AddContacts.jsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  Animated,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import debounce from 'lodash.debounce';
import { API_URL, API_HOST, PLACEHOLDER_IMAGE } from '../utils/constants';
import FriendProfile from './FriendProfile';

// Create a Stack Navigator
const Stack = createNativeStackNavigator();

// The AddContacts screen component (renamed to AddContactsScreen)
const AddContactsScreen = () => {
  const navigation = useNavigation();
  const [friendUsername, setFriendUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isFocused, setIsFocused] = useState(false);
  const [ws, setWs] = useState(null);
  const [pendingRequests, setPendingRequests] = useState(new Set());
  const [notification, setNotification] = useState(null);
  const inputRef = useRef(null);
  const inputAnim = useRef(new Animated.Value(0)).current;
  const notificationAnim = useRef(new Animated.Value(0)).current;

  const resetForm = useCallback(() => {
    setFriendUsername('');
    setError('');
    setStatus('');
    setSuggestions([]);
    inputRef.current?.blur();
    inputRef.current?.focus();
  }, []);

  const validateInput = (text) => {
    setFriendUsername(text);
    setStatus('');
    if (!text.trim()) {
      setError('Name or username cannot be empty');
      setSuggestions([]);
    } else if (text.length < 3) {
      setError('Input must be at least 3 characters');
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

        // Step 1: Fetch the initial list of users
        const usersResponse = await axios.get(`${API_URL}/contacts/search/users/`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { query },
        });

        const users = usersResponse.data.results || [];
        if (users.length === 0) {
          setSuggestions([]);
          return;
        }

        // Step 2: Fetch profile pictures for each user using the FriendProfileView endpoint
        const profilePromises = users.map(async (user) => {
          try {
            const profileResponse = await axios.get(`${API_URL}/profiles/friend/${user.username}/`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            return {
              ...user,
              profile_picture: profileResponse.data.profile_picture || null, // Only store the profile_picture
            };
          } catch (err) {
            console.error(`Failed to fetch profile for ${user.username}:`, err);
            return {
              ...user,
              profile_picture: null, // Fallback to null if the profile fetch fails
            };
          }
        });

        const updatedSuggestions = await Promise.all(profilePromises);
        setSuggestions(updatedSuggestions);
      } catch (err) {
        setError(
          err.response?.status === 401
            ? 'Session expired. Please log in again.'
            : 'Failed to load suggestions'
        );
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

    const websocket = new WebSocket(`ws://${API_HOST}/ws/contacts/?token=${token}`);

    websocket.onopen = () => console.log('WebSocket connected for AddContacts');
    websocket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'friend_request_sent') {
        setNotification(`Friend request sent to ${data.request.receiver.username}`);
        setPendingRequests((prev) => {
          const updated = new Set(prev);
          updated.delete(data.request.receiver.username);
          return updated;
        });
        resetForm();

        Animated.timing(notificationAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();

        setTimeout(() => {
          Animated.timing(notificationAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => setNotification(null));
        }, 3000);
      } else if (data.type === 'friend_request_accepted') {
        setNotification(`${data.friend_first_name} accepted your friend request!`);
        Animated.timing(notificationAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
        setTimeout(() => {
          Animated.timing(notificationAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => setNotification(null));
        }, 3000);
        navigation.navigate('Contacts', { refresh: true });
      } else if (data.type === 'friend_request_rejected') {
        setPendingRequests((prev) => {
          const updated = new Set(prev);
          updated.delete(data.rejected_by);
          return updated;
        });
        setNotification(
          `${data.rejected_by} rejected your friend request. You can now send a new request if you'd like.`
        );
        Animated.timing(notificationAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
        setTimeout(() => {
          Animated.timing(notificationAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => setNotification(null));
        }, 3000);
      } else if (data.type === 'friend_request_received') {
        setNotification(`New Friend Request from ${data.request.sender.first_name}`);
        Animated.timing(notificationAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
        setTimeout(() => {
          Animated.timing(notificationAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => setNotification(null));
        }, 3000);
      } else if (data.type === 'error') {
        setPendingRequests((prev) => {
          const updated = new Set(prev);
          updated.delete(friendUsername);
          return updated;
        });
        setError(data.message);
        setNotification(data.message);
        Animated.timing(notificationAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
        setTimeout(() => {
          Animated.timing(notificationAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => setNotification(null));
        }, 3000);
      }
    };
    websocket.onerror = (e) => console.error('WebSocket error:', e);
    websocket.onclose = () => console.log('WebSocket disconnected');

    setWs(websocket);
    return () => websocket.close();
  }, [navigation, resetForm, friendUsername, notificationAnim]);

  const handleSendFriendRequest = async (username = friendUsername) => {
    if (pendingRequests.has(username)) {
      setError(`A friend request to ${username} is already pending.`);
      return;
    }

    setLoading(true);
    setError('');
    setStatus('');
    setPendingRequests((prev) => new Set(prev).add(username));

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
      setPendingRequests((prev) => {
        const updated = new Set(prev);
        updated.delete(username);
        return updated;
      });
      const message = error.response?.data?.error || 'Failed to send friend request';
      setError(message);
      setNotification(message);
      Animated.timing(notificationAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
      setTimeout(() => {
        Animated.timing(notificationAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setNotification(null));
      }, 3000);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setupWebSocket();
    inputRef.current?.focus();

    Animated.timing(inputAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [setupWebSocket, inputAnim]);

  const renderSuggestion = ({ item }) => {
    const isOnline = item.last_seen && new Date() - new Date(item.last_seen) < 5 * 60 * 1000;
    const sendIconAnim = new Animated.Value(1);

    const handleSendPressIn = () => {
      Animated.spring(sendIconAnim, {
        toValue: 0.9,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();
    };

    const handleSendPressOut = () => {
      Animated.spring(sendIconAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();
    };

    const handleViewProfile = () => {
      navigation.navigate('FriendProfile', { username: item.username });
    };

    return (
      <View style={styles.suggestionItem}>
        <TouchableOpacity style={styles.suggestionContent} onPress={handleViewProfile}>
          <View style={styles.avatarContainer}>
            <Image
              source={{ uri: item.profile_picture || PLACEHOLDER_IMAGE }}
              style={styles.suggestionAvatar}
              resizeMode="cover"
              onError={(e) => console.log(`Failed to load profile picture for ${item.username}:`, e.nativeEvent.error)}
            />
            {isOnline && <View style={styles.onlineIndicator} />}
          </View>
          <View style={styles.suggestionTextContainer}>
            <Text style={styles.suggestionName}>
              {item.first_name} {item.last_name || ''}
            </Text>
            <Text style={styles.suggestionUsername}>@{item.username}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleSendFriendRequest(item.username)}
          onPressIn={handleSendPressIn}
          onPressOut={handleSendPressOut}
          style={styles.sendIconContainer}
          disabled={loading || pendingRequests.has(item.username)}
        >
          <Animated.View style={{ transform: [{ scale: sendIconAnim }] }}>
            <Ionicons
              name="person-add-outline"
              size={24}
              color={loading || pendingRequests.has(item.username) ? '#ccc' : '#007bff'}
            />
          </Animated.View>
        </TouchableOpacity>
      </View>
    );
  };

  const inputTranslateY = inputAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [50, 0],
  });

  const inputOpacity = inputAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const notificationOpacity = notificationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const notificationTranslateY = notificationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
  });

  const clearNotification = () => {
    Animated.timing(notificationAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setNotification(null));
  };

  return (
    <View style={styles.outerContainer}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color="#007bff" />
        </TouchableOpacity>

        {notification && (
          <Animated.View
            style={[
              styles.notificationContainer,
              {
                opacity: notificationOpacity,
                transform: [{ translateY: notificationTranslateY }],
              },
            ]}
          >
            <Text style={styles.notificationText}>{notification}</Text>
            <TouchableOpacity onPress={clearNotification}>
              <Text style={styles.clearNotificationText}>CLEAR NOTIFICATIONS</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        <Animated.View
          style={[
            styles.inputWrapper,
            { transform: [{ translateY: inputTranslateY }], opacity: inputOpacity },
          ]}
        >
          <View style={styles.inputContainer}>
            <Ionicons name="search-outline" size={24} color="#888" style={styles.inputIcon} />
            <TextInput
              ref={inputRef}
              style={[styles.input, error ? styles.inputError : isFocused ? styles.inputFocused : null]}
              placeholder="Search by username, first name, or full name..."
              placeholderTextColor="#aaa"
              value={friendUsername}
              onChangeText={validateInput}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={50}
              editable={!loading}
            />
            {friendUsername.length > 0 && (
              <TouchableOpacity onPress={() => setFriendUsername('')} style={styles.clearIcon}>
                <Ionicons name="close-circle" size={20} color="#888" />
              </TouchableOpacity>
            )}
          </View>
          {suggestions.length > 0 && !error && (
            <View style={styles.suggestionsContainer}>
              <FlatList
                data={suggestions.slice(0, 5)}
                renderItem={renderSuggestion}
                keyExtractor={(item) => (item.id ? item.id.toString() : item.username)}
              />
            </View>
          )}
        </Animated.View>
        {error && !notification && <Text style={styles.errorText}>{error}</Text>}
        {status && !notification && <Text style={styles.statusText}>{status}</Text>}
      </View>
    </View>
  );
};

// The Navigator component that includes AddContactsScreen and FriendProfile
const AddContactsNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="AddContactsScreen" component={AddContactsScreen} />
      <Stack.Screen name="FriendProfile" component={FriendProfile} />
    </Stack.Navigator>
  );
};

// Export the navigator as the default export
export default AddContactsNavigator;

// Styles remain the same
const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#f5f6fa',
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'flex-start',
  },
  backButton: {
    position: 'absolute',
    top: 24,
    left: 24,
    zIndex: 1000,
  },
  notificationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginTop: 70,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  notificationText: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  clearNotificationText: {
    fontSize: 14,
    color: '#007bff',
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  inputWrapper: {
    width: '100%',
    position: 'relative',
    marginBottom: 20,
    marginTop: 60,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 4,
  },
  inputIcon: {
    marginLeft: 16,
    marginRight: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 40,
    fontSize: 16,
    color: '#333',
    borderRadius: 15,
  },
  inputFocused: {
    borderColor: '#007bff',
    shadowColor: '#007bff',
    shadowOpacity: 0.3,
  },
  inputError: {
    borderColor: '#ff4d4d',
    shadowColor: '#ff4d4d',
    shadowOpacity: 0.3,
  },
  clearIcon: {
    position: 'absolute',
    right: 16,
  },
  errorText: {
    color: '#ff4d4d',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
    fontWeight: '500',
  },
  statusText: {
    color: '#28a745',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
    fontWeight: '500',
  },
  suggestionsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    marginTop: 10,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
    maxHeight: 260,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 4,
    marginHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  suggestionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
  },
  suggestionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e5e5e5',
    borderWidth: 2,
    borderColor: '#007AFF', // Match the border color from FriendProfile
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    backgroundColor: '#28a745',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  suggestionTextContainer: {
    flex: 1,
  },
  suggestionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  suggestionUsername: {
    fontSize: 14,
    color: '#777',
    marginTop: 2,
  },
  sendIconContainer: {
    padding: 8,
  },
});