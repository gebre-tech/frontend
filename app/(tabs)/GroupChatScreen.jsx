//app/(tabs)/GroupChatScreen.jsx
import React, { useState, useEffect, useRef, useContext } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import tw from 'twrnc';
import { API_URL } from '../utils/constants';
import AuthContext from '../../context/AuthContext';

const GroupChatScreen = () => {
  const { groupId, groupName } = useRoute().params;
  const { user } = useContext(AuthContext);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const ws = useRef(null);
  const flatListRef = useRef(null);

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
          setMessages((prev) => [...prev, data.message]);
          flatListRef.current?.scrollToEnd({ animated: true });
        } else if (data.type === 'error') {
          Alert.alert('Error', data.message);
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
      Alert.alert('Error', 'WebSocket not connected');
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
    Alert.alert('Error', error.response?.data?.error || error.message || 'An error occurred');
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

  const renderMessage = ({ item }) => (
    <View
      style={tw`flex-row items-end mb-2 ${
        item.sender.id === user.id ? 'self-end flex-row-reverse' : 'self-start'
      }`}
    >
      <Image
        source={{ uri: `https://ui-avatars.com/api/?name=${item.sender.first_name}&background=random` }}
        style={tw`w-10 h-10 rounded-full ${item.sender.id === user.id ? 'ml-2' : 'mr-2'}`}
      />
      <View
        style={tw`max-w-3/4 p-3 rounded-lg ${
          item.sender.id === user.id ? 'bg-blue-500' : 'bg-gray-200'
        }`}
      >
        <Text style={tw`text-sm font-semibold ${item.sender.id === user.id ? 'text-white' : 'text-gray-800'}`}>
          {item.sender.first_name}
        </Text>
        {item.message && (
          <Text style={tw`${item.sender.id === user.id ? 'text-white' : 'text-gray-800'}`}>
            {item.message}
          </Text>
        )}
        {item.attachment && (
          <Image
            source={{ uri: `${API_URL}${item.attachment}` }}
            style={tw`w-40 h-40 rounded-lg mt-2`}
          />
        )}
        <Text style={tw`text-xs ${item.sender.id === user.id ? 'text-white' : 'text-gray-500'} mt-1`}>
          {new Date(item.timestamp).toLocaleTimeString()}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <View style={tw`bg-white p-4 border-b border-gray-200 flex-row items-center justify-between`}>
        <Text style={tw`text-xl font-bold`}>{groupName}</Text>
        <TouchableOpacity onPress={() => navigation.navigate('GroupInfo', { groupId })}>
          <Ionicons name="information-circle-outline" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>
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
        />
      )}
      <View style={tw`flex-row items-center p-4 bg-white border-t border-gray-200`}>
        <TouchableOpacity onPress={pickImage} style={tw`mr-2`}>
          <Ionicons name="image" size={24} color="#007AFF" />
        </TouchableOpacity>
        <TextInput
          style={tw`flex-1 bg-gray-100 rounded-full px-4 py-2`}
          placeholder="Type a message..."
          value={message}
          onChangeText={setMessage}
        />
        <TouchableOpacity onPress={sendMessage} style={tw`ml-2`}>
          <Ionicons name="send" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default GroupChatScreen;