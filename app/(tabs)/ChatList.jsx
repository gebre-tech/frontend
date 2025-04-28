import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Image,
  Animated,
  Pressable,
} from 'react-native';
import axios from 'axios';
import { AuthContext } from '../../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import tw from 'twrnc';
import { useWebSocket } from '../hooks/useWebSocket';
import useMessageStore from '../store/messageStore';
import { API_URL, PLACEHOLDER_IMAGE } from '../utils/constants';
import Swipeable from 'react-native-gesture-handler/Swipeable';

const INITIAL_CHAT_LIMIT = 5;

const ChatList = () => {
  const { user } = useContext(AuthContext);
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();
  const [highlightedChatIds, setHighlightedChatIds] = useState(new Set());
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const messageStore = useMessageStore();

  const {
    onlineUsers,
    newMessageNotifications,
    clearNotifications,
    subscribeToEvent,
    isConnected,
    retryConnection,
    sendTypingStatus,
  } = useWebSocket({ userId: user?.id, isGlobal: true });

  const generateChatId = useCallback((senderId, receiverId) => {
    if (!senderId || !receiverId) {
      console.warn('Invalid senderId or receiverId:', { senderId, receiverId });
      return null;
    }
    return `chat_${Math.min(senderId, receiverId)}_${Math.max(senderId, receiverId)}`;
  }, []);

  const fetchChats = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No token found');

      const cachedChats = await AsyncStorage.getItem('cached-chats');
      if (cachedChats) {
        setChats(JSON.parse(cachedChats).slice(0, INITIAL_CHAT_LIMIT));
      }

      const response = await axios.get(`${API_URL}/chat/rooms/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const enhancedChats = await Promise.all(
        (response.data || []).map(async (chat) => {
          const updatedMembers = await Promise.all(
            (chat.members || []).map(async (member) => {
              if (!member?.profile_picture) {
                try {
                  const profileResponse = await axios.get(
                    `${API_URL}/profiles/friend/${member.username}/`,
                    { headers: { Authorization: `Bearer ${token}` } }
                  );
                  return { ...member, profile_picture: profileResponse.data.profile_picture };
                } catch (error) {
                  console.error(`Error fetching profile for ${member.username}:`, error);
                  return { ...member, profile_picture: PLACEHOLDER_IMAGE };
                }
              }
              return member;
            })
          );

          const chatId = chat.is_group
            ? chat.id
            : generateChatId(user.id, chat.members?.find((m) => m.id !== user.id)?.id);

          if (!chatId) {
            console.warn('Skipping chat with invalid chatId:', chat);
            return null;
          }

          const chatMessages = messageStore.messages[chatId] || {};
          const messages = Object.values(chatMessages);
          if (messages.length > 0) {
            return {
              ...chat,
              chatId,
              members: updatedMembers,
              last_message: messages[messages.length - 1],
              unread_count: messages.filter(
                (m) => m.status !== 'seen' && m.sender !== user.id
              ).length,
              delivered_count: messages.filter((m) => m.status === 'delivered').length,
            };
          }
          return { ...chat, chatId, members: updatedMembers };
        })
      );

      const validChats = enhancedChats.filter((chat) => chat !== null);
      const sortedChats = validChats.sort(
        (a, b) =>
          new Date(b.last_message?.timestamp || b.created_at) -
          new Date(a.last_message?.timestamp || a.created_at)
      );

      setChats(sortedChats.slice(0, INITIAL_CHAT_LIMIT));
      await AsyncStorage.setItem('cached-chats', JSON.stringify(sortedChats));
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    } catch (error) {
      console.error('Fetch chats error:', error);
      Alert.alert('Error', error.message || 'Failed to fetch chats');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fadeAnim, user?.id, messageStore.messages, generateChatId]);

  useEffect(() => {
    if (user) {
      fetchChats();
    }
  }, [user, fetchChats]);

  useEffect(() => {
    const handleNewMessage = (data) => {
      const { chatId, message } = data;
      if (!chatId) {
        console.warn('Received message with invalid chatId:', data);
        return;
      }

      messageStore.addMessage(chatId, {
        ...message,
        status: message.sender === user.id ? 'sent' : 'delivered',
      });

      setChats((prev) => {
        let updatedChats = prev.filter((chat) => chat.chatId !== chatId);
        const existingChat = prev.find((chat) => chat.chatId === chatId);
        const friend = message.chat?.members?.find((m) => m.id !== user.id);
        const newChat = {
          id: chatId,
          chatId,
          members: message.chat?.members || [],
          last_message: message,
          unread_count: message.sender !== user.id ? (existingChat?.unread_count || 0) + 1 : 0,
          delivered_count: message.delivered_to?.length > 0 ? 1 : 0,
          is_group: message.chat?.is_group || false,
          created_at: new Date().toISOString(),
        };
        updatedChats = [newChat, ...updatedChats]
          .sort(
            (a, b) =>
              new Date(b.last_message?.timestamp || b.created_at) -
              new Date(a.last_message?.timestamp || a.created_at)
          )
          .slice(0, INITIAL_CHAT_LIMIT);

        AsyncStorage.setItem('cached-chats', JSON.stringify(updatedChats));
        return updatedChats;
      });

      setHighlightedChatIds((prev) => new Set(prev).add(chatId));
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0.7, duration: 200, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    };

    const handleMessageDelivered = ({ chatId, messageId }) => {
      if (!chatId) return;
      messageStore.updateMessage(chatId, messageId, { status: 'delivered' });

      setChats((prev) => {
        let updatedChats = prev.filter((chat) => chat.chatId !== chatId);
        const chatToUpdate = prev.find((chat) => chat.chatId === chatId) || {
          chatId,
          members: [],
          is_group: false,
          created_at: new Date().toISOString(),
        };
        const chatMessages = messageStore.messages[chatId] || {};
        const messages = Object.values(chatMessages);
        const updatedChat = {
          ...chatToUpdate,
          last_message: messages[messages.length - 1],
          delivered_count: messages.filter((m) => m.status === 'delivered').length,
          unread_count: messages.filter((m) => m.status !== 'seen' && m.sender !== user.id).length,
        };
        updatedChats = [updatedChat, ...updatedChats]
          .sort(
            (a, b) =>
              new Date(b.last_message?.timestamp || b.created_at) -
              new Date(a.last_message?.timestamp || a.created_at)
          )
          .slice(0, INITIAL_CHAT_LIMIT);

        AsyncStorage.setItem('cached-chats', JSON.stringify(updatedChats));
        return updatedChats;
      });

      setHighlightedChatIds((prev) => new Set(prev).add(chatId));
    };

    const handleMessageSeen = ({ chatId, messageId }) => {
      if (!chatId) return;
      messageStore.updateMessage(chatId, messageId, { status: 'seen' });

      setChats((prev) => {
        let updatedChats = prev.filter((chat) => chat.chatId !== chatId);
        const chatToUpdate = prev.find((chat) => chat.chatId === chatId);
        if (!chatToUpdate) return prev;
        const chatMessages = messageStore.messages[chatId] || {};
        const messages = Object.values(chatMessages);
        const updatedChat = {
          ...chatToUpdate,
          last_message: messages[messages.length - 1],
          delivered_count: messages.filter((m) => m.status === 'delivered').length,
          unread_count: messages.filter((m) => m.status !== 'seen' && m.sender !== user.id).length,
        };
        updatedChats = [updatedChat, ...updatedChats]
          .sort(
            (a, b) =>
              new Date(b.last_message?.timestamp || b.created_at) -
              new Date(a.last_message?.timestamp || a.created_at)
          )
          .slice(0, INITIAL_CHAT_LIMIT);

        AsyncStorage.setItem('cached-chats', JSON.stringify(updatedChats));
        return updatedChats;
      });
    };

    const handleTyping = ({ chatId, username, isTyping }) => {
      if (isTyping) {
        messageStore.addTypingUser(chatId, username);
      } else {
        messageStore.removeTypingUser(chatId, username);
      }
    };

    const unsubscribers = [
      subscribeToEvent('message', handleNewMessage),
      subscribeToEvent('message_delivered', handleMessageDelivered),
      subscribeToEvent('message_seen', handleMessageSeen),
      subscribeToEvent('typing', handleTyping),
    ];

    return () => unsubscribers.forEach((unsub) => unsub());
  }, [
    subscribeToEvent,
    user?.id,
    fadeAnim,
    messageStore,
    clearNotifications,
    generateChatId,
  ]);

  const onRefresh = () => {
    setRefreshing(true);
    setHighlightedChatIds(new Set());
    fetchChats();
  };

  const truncateMessage = (message) => {
    if (!message) return '';
    const lines = message.split('\n');
    return lines.slice(0, 2).join('\n');
  };

  const deleteChat = async (chatId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.delete(`${API_URL}/chat/rooms/${chatId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setChats((prev) => prev.filter((chat) => chat.chatId !== chatId));
      messageStore.clearMessages(chatId);
      await AsyncStorage.setItem(
        'cached-chats',
        JSON.stringify(chats.filter((chat) => chat.chatId !== chatId))
      );
      Alert.alert('Success', 'Chat deleted successfully');
    } catch (error) {
      console.error('Error deleting chat:', error);
      Alert.alert('Error', 'Failed to delete chat');
    }
  };

  const renderRightActions = (chatId) => (
    <Pressable
      style={tw`bg-red-500 justify-center items-center w-20 rounded-r-lg`}
      onPress={() => {
        Alert.alert('Delete Chat', 'Are you sure you want to delete this chat?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => deleteChat(chatId) },
        ]);
      }}
    >
      <Ionicons name="trash" size={24} color="white" />
    </Pressable>
  );

  const renderItem = ({ item }) => {
    const friend = item.members.find((m) => m.id !== user.id);
    const isOnline = onlineUsers.has(friend?.id);
    const isHighlighted = highlightedChatIds.has(item.chatId);
    const isSentMessage = item.last_message && item.last_message.sender === user.id;
    const typingUsers = messageStore.typingUsers[item.chatId] || [];

    let lastMessageText = '';
    if (typingUsers.length > 0) {
      lastMessageText = `${typingUsers.join(', ')} ${typingUsers.length > 1 ? 'are' : 'is'} typing...`;
    } else if (item.last_message) {
      if (item.last_message.type === 'text') {
        if (isSentMessage) {
          lastMessageText = `You: ${truncateMessage(item.last_message.message)}`;
        } else if (item.is_group) {
          lastMessageText = `${
            item.last_message.sender?.first_name || item.last_message.sender?.username
          }: ${truncateMessage(item.last_message.message)}`;
        } else {
          lastMessageText = truncateMessage(item.last_message.message);
        }
      } else if (item.last_message.type === 'photo') {
        lastMessageText = isSentMessage ? 'You sent a photo' : `${friend?.first_name || friend?.username} sent a photo`;
      } else if (item.last_message.type === 'video') {
        lastMessageText = isSentMessage ? 'You sent a video' : `${friend?.first_name || friend?.username} sent a video`;
      } else if (item.last_message.type === 'file') {
        lastMessageText = isSentMessage ? 'You sent a file' : `${friend?.first_name || friend?.username} sent a file`;
      }
    } else {
      lastMessageText = 'No messages yet';
    }

    return (
      <Swipeable renderRightActions={() => renderRightActions(item.chatId)}>
        <Animated.View style={{ opacity: fadeAnim }}>
          <View
            style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-sm border-b border-gray-100 ${
              isHighlighted ? 'bg-blue-50' : ''
            }`}
          >
            <TouchableOpacity
              onPress={() => {
                if (!item.is_group) {
                  navigation.navigate('FriendProfile', { username: friend?.username });
                }
              }}
            >
              <View style={tw`relative`}>
                <Image
                  source={{
                    uri: friend?.profile_picture || PLACEHOLDER_IMAGE,
                  }}
                  style={tw`w-12 h-12 rounded-full mr-3`}
                  resizeMode="cover"
                  onError={(e) =>
                    console.log(`Failed to load image for ${friend?.username}:`, e.nativeEvent.error)
                  }
                />
                {isOnline && !item.is_group && (
                  <View
                    style={tw`absolute bottom-0 right-2 w-5 h-5 bg-green-500 rounded-full border-2 border-white`}
                  />
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={tw`flex-1 flex-row justify-between items-center`}
              onPress={async () => {
                if (item.unread_count > 0) {
                  try {
                    const token = await AsyncStorage.getItem('token');
                    await axios.post(
                      `${API_URL}/chat/mark-as-read/${item.id}/`,
                      {},
                      { headers: { Authorization: `Bearer ${token}` } }
                    );
                    const chatMessages = messageStore.messages[item.chatId] || {};
                    Object.keys(chatMessages).forEach((messageId) => {
                      if (chatMessages[messageId].status !== 'seen') {
                        messageStore.updateMessage(item.chatId, messageId, { status: 'seen' });
                      }
                    });
                    setChats((prev) =>
                      prev.map((chat) =>
                        chat.chatId === item.chatId ? { ...chat, unread_count: 0 } : chat
                      )
                    );
                    setHighlightedChatIds((prev) => {
                      const newSet = new Set(prev);
                      newSet.delete(item.chatId);
                      return newSet;
                    });
                    clearNotifications(item.chatId);
                  } catch (error) {
                    console.error('Error marking as read:', error);
                  }
                }

                navigation.navigate('ChatScreen', {
                  senderId: user.id,
                  contactId: friend?.id,
                  contactUsername: friend?.username,
                });
              }}
              onLongPress={() => {
                Alert.alert('Chat Options', '', [
                  { text: 'Delete Chat', style: 'destructive', onPress: () => deleteChat(item.chatId) },
                  { text: 'Cancel', style: 'cancel' },
                ]);
              }}
            >
              <View style={tw`flex-1`}>
                <View style={tw`flex-row justify-between`}>
                  <Text style={tw`text-lg font-semibold text-gray-800`}>
                    {item.is_group
                      ? item.name || `Group ${item.id}`
                      : item.name || friend?.first_name || 'Unknown'}
                  </Text>
                  <Text style={tw`text-xs text-gray-500`}>
                    {item.last_message
                      ? new Date(item.last_message.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </Text>
                </View>
                <Text
                  style={tw`${
                    isSentMessage ? 'text-blue-600' : 'text-gray-600'
                  } text-sm mt-1 ${item.unread_count > 0 ? 'font-medium' : ''}`}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {lastMessageText}
                </Text>
                {!item.is_group && (
                  <Text
                    style={tw`text-xs mt-1 ${isOnline ? 'text-green-500' : 'text-gray-500'}`}
                  >
                    {isOnline ? 'Online' : 'Offline'}
                  </Text>
                )}
                {isSentMessage && item.last_message && (
                  <Text style={tw`text-xs text-gray-500 mt-1`}>
                    {item.last_message.status === 'seen'
                      ? '✓✓ Seen'
                      : item.last_message.status === 'delivered'
                      ? '✓✓ Delivered'
                      : '✓ Sent'}
                  </Text>
                )}
              </View>
              {(item.unread_count > 0 || item.delivered_count > 0) && (
                <View style={tw`flex-row items-center`}>
                  {item.delivered_count > 0 && (
                    <Text style={tw`text-xs text-gray-500 mr-2`}>✓</Text>
                  )}
                  {item.unread_count > 0 && (
                    <View style={tw`bg-blue-500 rounded-full px-2 py-1`}>
                      <Text style={tw`text-white text-xs font-bold`}>{item.unread_count}</Text>
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Swipeable>
    );
  };

  if (loading) {
    return (
      <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />
    );
  }

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <FlatList
        data={chats}
        renderItem={renderItem}
        keyExtractor={(chat, index) => chat.chatId?.toString() ?? `fallback-${index}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={tw`text-center mt-5 text-gray-500`}>No chats available</Text>
        }
      />
      <TouchableOpacity
        style={tw`absolute bottom-6 right-6 bg-blue-500 rounded-full w-16 h-16 justify-center items-center shadow-lg`}
        onPress={() => navigation.navigate('Contacts')}
      >
        <Ionicons name="chatbubble-ellipses" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

export default ChatList;