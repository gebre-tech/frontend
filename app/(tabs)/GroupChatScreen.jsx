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
import { useRoute, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import tw from 'twrnc';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import { API_URL } from '../utils/constants';
import { AuthContext } from '../../context/AuthContext';

const GroupChatScreen = () => {
  const { groupId, groupName } = useRoute().params;
  const { user } = useContext(AuthContext);
  const navigation = useNavigation();
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [readMessages, setReadMessages] = useState(new Set());
  const ws = useRef(null);
  const flatListRef = useRef(null);
  const [typingUser, setTypingUser] = useState(null); // Track typing user's name
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const userRef = useRef(user);
  const markMessageAsReadRef = useRef(null);

  const fetchMessages = async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await fetch(`${API_URL}/group/messages/${groupId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setMessages(data || []);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  const connectWebSocket = async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;
    ws.current = new WebSocket(`ws://${API_URL.replace('http://', '')}/ws/group/${groupId}/?token=${token}`);
    ws.current.onopen = () => console.log('Group WebSocket connected');
    ws.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'group_message') {
          setMessages((prev) => {
            const messageIndex = prev.findIndex((msg) => msg.id === data.message.id);
            if (messageIndex !== -1) {
              const updatedMessages = [...prev];
              updatedMessages[messageIndex] = data.message;
              return updatedMessages;
            } else {
              const newMessages = [...prev, data.message];
              flatListRef.current?.scrollToEnd({ animated: true });
              Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
              }).start();
              return newMessages;
            }
          });
        } else if (data.type === 'typing') {
          if (data.user_id !== user?.id) { // Don't show typing indicator for the current user
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
    ws.current.onclose = () => console.log('Group WebSocket closed');
  };

  const sendMessage = async () => {
    if (message.trim() === '') return;
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'group_message', message }));
      setMessage('');
    } else {
      handleError(new Error('WebSocket not connected'));
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
      await fetch(`${API_URL}/group/message/send/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });
      fetchMessages();
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
      ws.current.send(JSON.stringify({ type: 'typing' }));
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

  useEffect(() => {
    if (user) {
      fetchMessages();
      connectWebSocket();
    }
    return () => {
      if (ws.current) {
        ws.current.close();
        console.log('Group WebSocket cleanup');
      }
    };
  }, [user, groupId]);

  const renderMessage = ({ item }) => {
    const isCurrentUser = item.sender.id === user.id;
    const reactions = item.reactions || {};
    const readBy = item.read_by || [];

    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <Pressable
          style={tw`flex-row items-end mb-2 ${isCurrentUser ? 'self-end flex-row-reverse' : 'self-start'}`}
          onLongPress={() => {
            addReaction(item.id, '❤️');
          }}
        >
          <View style={tw`relative`}>
            <Image
              source={{ uri: `https://ui-avatars.com/api/?name=${item.sender.first_name}&background=random` }}
              style={tw`w-10 h-10 rounded-full ${isCurrentUser ? 'ml-2' : 'mr-2'}`}
            />
            <View
              style={tw`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white bg-green-500 ${isCurrentUser ? 'right-2' : 'right-0'}`}
            />
          </View>

          <View
            style={tw`relative max-w-3/4 p-3 rounded-2xl shadow-sm ${
              isCurrentUser ? 'bg-blue-500 rounded-br-none' : 'bg-gray-200 rounded-bl-none'
            }`}
          >
            {!isCurrentUser && (
              <Text style={tw`text-sm font-semibold text-gray-800`}>
                {item.sender.first_name}
              </Text>
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
                {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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