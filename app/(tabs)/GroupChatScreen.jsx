import React, { useState, useEffect, useRef, useContext, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Animated,
  Pressable,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import tw from 'twrnc';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import { API_HOST, API_URL, PLACEHOLDER_IMAGE } from '../utils/constants';
import { AuthContext } from '../../context/AuthContext';
import debounce from 'lodash.debounce';
import axios from 'axios';

const GroupChatScreen = () => {
  const { groupId, groupName } = useRoute().params;
  const { user } = useContext(AuthContext);
  const navigation = useNavigation();
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [readMessages, setReadMessages] = useState(new Set());
  const ws = useRef(null);
  const flatListRef = useRef(null);
  const [typingUser, setTypingUser] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [senderProfiles, setSenderProfiles] = useState({});
  const pageSize = 20;

  const userRef = useRef(user);
  const markMessageAsReadRef = useRef(null);

  const storageKey = `group_messages_${groupId}`;
  const queueKey = `queued_messages_${groupId}`;

  // Load messages from AsyncStorage
  const loadCachedMessages = async () => {
    try {
      const cachedMessages = await AsyncStorage.getItem(storageKey);
      if (cachedMessages) {
        const parsedMessages = JSON.parse(cachedMessages);
        setMessages(parsedMessages);
        fetchSenderProfiles(parsedMessages);
        return parsedMessages.length > 0;
      }
      return false;
    } catch (error) {
      console.error('Error loading cached messages:', error);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Save messages to AsyncStorage with cache management
  const saveMessagesToStorage = async (msgs) => {
    try {
      const limitedMessages = msgs.slice(-100);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const filteredMessages = limitedMessages.filter(
        (msg) => new Date(msg.timestamp) >= thirtyDaysAgo
      );
      await AsyncStorage.setItem(storageKey, JSON.stringify(filteredMessages));
    } catch (error) {
      console.error('Error saving messages to storage:', error);
    }
  };

  // Load queued messages from AsyncStorage
  const loadQueuedMessages = async () => {
    try {
      const queued = await AsyncStorage.getItem(queueKey);
      return queued ? JSON.parse(queued) : [];
    } catch (error) {
      console.error('Error loading queued messages:', error);
      return [];
    }
  };

  // Save queued messages to AsyncStorage
  const saveQueuedMessages = async (queued) => {
    try {
      await AsyncStorage.setItem(queueKey, JSON.stringify(queued));
    } catch (error) {
      console.error('Error saving queued messages:', error);
    }
  };

  // Fetch sender profiles
  const fetchSenderProfiles = async (messages) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found for fetching profiles');
        throw new Error('No authentication token found');
      }

      const uniqueSenders = [...new Set(messages.map((msg) => msg.sender?.id))].filter(Boolean);
      const profiles = { ...senderProfiles };

      for (const senderId of uniqueSenders) {
        if (profiles[senderId]) continue;

        const sender = messages.find((msg) => msg.sender?.id === senderId)?.sender;
        if (!sender?.username) {
          console.warn(`Sender with ID ${senderId} has no username, skipping profile fetch`);
          profiles[senderId] = null;
          continue;
        }

        try {
          console.log(`Fetching profile for username: ${sender.username}`);
          const response = await axios.get(`${API_URL}/profiles/friend/${sender.username}/`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const profileData = response.data;
          console.log(`Profile data for ${sender.username}:`, profileData);

          const now = new Date();
          const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
          profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
          profiles[senderId] = profileData;
        } catch (error) {
          console.error(`Failed to fetch profile for ${sender.username}:`, error.response?.data || error.message);
          profiles[senderId] = null;
        }
      }
      setSenderProfiles(profiles);
    } catch (error) {
      handleError(error);
    }
  };

  // Fetch messages with pagination
  const fetchMessages = async (pageNum = 1, reset = false) => {
    try {
      if (pageNum !== 1) setLoadingMore(true);
      else setLoading(true);

      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const response = await fetch(
        `${API_URL}/groups/messages/${groupId}/?page=${pageNum}&page_size=${pageSize}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      const newMessages = data.results || [];
      const hasNext = data.next;

      setMessages((prev) => {
        const existingIds = new Set(prev.map((msg) => msg.id));
        const filteredMessages = newMessages.filter((msg) => !existingIds.has(msg.id));
        const updatedMessages = reset
          ? filteredMessages
          : [...filteredMessages, ...prev].sort(
              (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
            );
        saveMessagesToStorage(updatedMessages);
        fetchSenderProfiles(updatedMessages);
        return updatedMessages;
      });

      setHasMore(hasNext);
      if (hasNext) setPage(pageNum + 1);
      else setPage(1);
      return true;
    } catch (error) {
      handleError(error);
      return false;
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Debounced fetchMessages
  const debouncedFetchMessages = useCallback(
    debounce((pageNum, reset) => fetchMessages(pageNum, reset), 500),
    []
  );

  const connectWebSocket = async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    ws.current = new WebSocket(`ws://${API_HOST}/ws/groups/${groupId}/?token=${token}`);
    ws.current.onopen = async () => {
      console.log('Groups WebSocket connected');
      await syncQueuedMessages();
    };
    ws.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'group_message') {
          setMessages((prev) => {
            const messageIndex = prev.findIndex((msg) => msg.id === data.message.id);
            let updatedMessages;
            if (messageIndex !== -1) {
              updatedMessages = [...prev];
              updatedMessages[messageIndex] = data.message;
            } else {
              updatedMessages = [...prev, data.message].sort(
                (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
              );
              flatListRef.current?.scrollToEnd({ animated: true });
              Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
              }).start();
            }
            saveMessagesToStorage(updatedMessages);
            fetchSenderProfiles(updatedMessages);
            return updatedMessages;
          });
        } else if (data.type === 'typing') {
          if (data.user_id !== user?.id) {
            setTypingUser(data.first_name);
            setTimeout(() => setTypingUser(null), 2000);
          }
        } else if (data.type === 'error') {
          handleError(new Error(data.message));
        }
      } catch (error) {
        console.error('WebSocket message parsing error:', error);
      }
    };
    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setTimeout(connectWebSocket, 2000);
    };
    ws.current.onclose = () => console.log('Groups WebSocket closed');
  };

  // Sync queued messages when online
  const syncQueuedMessages = async () => {
    if (ws.current?.readyState !== WebSocket.OPEN) return;

    const queuedMessages = await loadQueuedMessages();
    if (queuedMessages.length === 0) return;

    for (const msg of queuedMessages) {
      ws.current.send(JSON.stringify({
        type: 'group_message',
        message: msg.message,
        group_id: groupId
      }));
    }

    await saveQueuedMessages([]);
  };

  const sendMessage = async () => {
    if (message.trim() === '') return;

    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'group_message',
        message,
        group_id: groupId
      }));
      setMessage('');
    } else {
      const queuedMessages = await loadQueuedMessages();
      queuedMessages.push({ message, timestamp: new Date().toISOString() });
      await saveQueuedMessages(queuedMessages);
      Toast.show({
        type: 'info',
        text1: 'Offline',
        text2: 'Message queued and will be sent when online',
        position: 'bottom',
      });
      setMessage('');
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled) {
      sendAttachment(result.assets[0].uri);
    }
  };

  const sendAttachment = async (uri) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const formData = new FormData();
      formData.append('group_id', groupId);
      formData.append('message', '');
      formData.append('attachment', {
        uri,
        name: 'attachment.jpg',
        type: 'image/jpeg',
      });
      const response = await fetch(`${API_URL}/groups/message/send/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      debouncedFetchMessages(1, true);
    } catch (error) {
      handleError(error);
    }
  };

  const handleError = (error) => {
    console.error('Error:', error);
    Toast.show({
      type: 'error',
      text1: 'Error',
      text2: error.message || 'An error occurred',
      position: 'bottom',
    });
  };

  const addReaction = (messageId, reaction) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'reaction', message_id: messageId, reaction }));
    }
  };

  const markMessageAsRead = (messageId) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'read_receipt', message_id: messageId }));
    }
  };

  const sendTyping = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'typing', group_id: groupId }));
    }
  };

  useEffect(() => {
    userRef.current = user;
    markMessageAsReadRef.current = markMessageAsRead;
  }, [user, markMessageAsRead]);

  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    viewableItems.forEach(({ item }) => {
      const currentUser = userRef.current;
      const markAsRead = markMessageAsReadRef.current;
      if (!currentUser || !markAsRead) return;

      const isCurrentUser = item.sender.id === currentUser.id;
      const readBy = item.read_by || [];
      if (
        !isCurrentUser &&
        !readBy.some((u) => u.id === currentUser.id) &&
        !readMessages.has(item.id)
      ) {
        markAsRead(item.id);
        setReadMessages((prev) => new Set(prev).add(item.id));
      }
    });
  }, []);

  const viewabilityConfig = {
    itemVisiblePercentThreshold: 50,
  };

  const loadMoreMessages = useCallback(() => {
    if (!loadingMore && hasMore) {
      debouncedFetchMessages(page);
    }
  }, [loadingMore, hasMore, page]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;

      loadCachedMessages();
      debouncedFetchMessages(1, true);
      connectWebSocket();

      return () => {
        if (ws.current) {
          ws.current.close();
          console.log('Groups WebSocket cleanup');
        }
      };
    }, [user, groupId])
  );

  const renderMessage = ({ item }) => {
    const isCurrentUser = item.sender?.id === user?.id;
    const reactions = item.reactions || {};
    const readBy = item.read_by || [];
    const senderProfile = senderProfiles[item.sender?.id];

    const senderName = senderProfile?.user?.first_name || item.sender?.first_name || 'Unknown';
    const senderUsername = item.sender?.username;

    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <Pressable
          style={tw`flex-row items-end mb-2 ${isCurrentUser ? 'self-end flex-row-reverse' : 'self-start'}`}
          onLongPress={() => addReaction(item.id, '❤️')}
        >
          <TouchableOpacity
            onPress={() => {
              if (senderUsername) {
                navigation.navigate('FriendProfile', { username: senderUsername });
              } else {
                Toast.show({
                  type: 'error',
                  text1: 'Error',
                  text2: 'User profile unavailable',
                  position: 'bottom',
                });
              }
            }}
          >
            <View style={tw`relative`}>
              <Image
                source={{
                  uri: senderProfile?.profile_picture || PLACEHOLDER_IMAGE || `https://ui-avatars.com/api/?name=${senderName}&background=random`,
                }}
                style={tw`w-10 h-10 rounded-full ${isCurrentUser ? 'ml-2' : 'mr-2'}`}
                onError={() => console.log(`Failed to load profile picture for ${senderName}`)}
              />
              <View
                style={tw`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white ${
                  senderProfile?.is_online ? 'bg-green-500' : 'bg-gray-500'
                } ${isCurrentUser ? 'right-2' : 'right-0'}`}
              />
            </View>
          </TouchableOpacity>

          <View
            style={tw`relative max-w-3/4 p-3 rounded-2xl shadow-sm ${
              isCurrentUser ? 'bg-blue-500 rounded-br-none' : 'bg-gray-200 rounded-bl-none'
            }`}
          >
            {!isCurrentUser && (
              <Text style={tw`text-sm font-semibold text-gray-800`}>{senderName}</Text>
            )}
            {item.message && (
              <Text style={tw`${isCurrentUser ? 'text-white' : 'text-gray-800'}`}>
                {item.message}
              </Text>
            )}
            {item.attachment && (
              <Image
                source={{ uri: `${API_URL}${item.attachment}` }}
                style={tw`w-40 h-40 rounded-lg mt-2`}
              />
            )}
            <View style={tw`flex-row items-center justify-end mt-1`}>
              <Text style={tw`text-xs ${isCurrentUser ? 'text-white' : 'text-gray-500'} mr-1`}>
                {new Date(item.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              {isCurrentUser && (
                <Ionicons
                  name={readBy.length > 0 ? 'checkmark-done' : 'checkmark'}
                  size={14}
                  color={readBy.length > 0 ? '#34B7F1' : 'gray'}
                />
              )}
            </View>
            {Object.keys(reactions).length > 0 && (
              <View style={tw`flex-row mt-1`}>
                {Object.values(reactions).map((reaction, idx) => (
                  <Text key={idx} style={tw`text-sm mr-1`}>{reaction}</Text>
                ))}
              </View>
            )}
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <LinearGradient
        colors={['#4A00E0', '#8E2DE2']}
        style={tw`p-4 pt-10 flex-row items-center justify-between shadow-md`}
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <TouchableOpacity
          style={tw`flex-row items-center`}
          onPress={() => navigation.navigate('GroupInfo', { groupId })}
        >
          <View style={tw`w-10 h-10 rounded-full bg-white flex items-center justify-center mr-3`}>
            <Text style={tw`text-lg font-bold text-purple-600`}>{groupName[0]}</Text>
          </View>
          <View>
            <Text style={tw`text-xl font-bold text-white`}>{groupName}</Text>
            <Text style={tw`text-sm text-white opacity-70`}>Tap for group info</Text>
          </View>
        </TouchableOpacity>
        <View style={tw`w-10`} />
      </LinearGradient>

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />
      ) : messages.length === 0 ? (
        <View style={tw`flex-1 justify-center items-center`}>
          <Text style={tw`text-gray-500 text-lg`}>No messages yet</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={tw`p-4 pb-20`}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReached={loadMoreMessages}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color="#007AFF" style={tw`my-4`} />
            ) : null
          }
        />
      )}

      {typingUser && (
        <View style={tw`flex-row items-center px-4 mb-2`}>
          <Text style={tw`text-gray-500 text-sm`}>{typingUser} is typing...</Text>
        </View>
      )}

      <View style={tw`flex-row items-center p-3 bg-white border-t border-gray-200 shadow-md`}>
        <TouchableOpacity onPress={pickImage} style={tw`mr-2`}>
          <Ionicons name="image" size={24} color="#007AFF" />
        </TouchableOpacity>
        <TouchableOpacity style={tw`mr-2`}>
          <Ionicons name="mic" size={24} color="#007AFF" />
        </TouchableOpacity>
        <TextInput
          style={tw`flex-1 bg-gray-100 rounded-full px-4 py-2 text-gray-800 border border-gray-200 shadow-sm`}
          placeholder="Type a message..."
          placeholderTextColor="#9CA3AF"
          value={message}
          onChangeText={(text) => {
            setMessage(text);
            sendTyping();
          }}
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity onPress={sendMessage} style={tw`ml-2`}>
          <Ionicons name="send" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>

      <Toast />
    </View>
  );
};

export default GroupChatScreen;