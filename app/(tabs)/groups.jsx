import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import tw from 'twrnc';
import Toast from 'react-native-toast-message';
import { API_HOST, API_URL } from '../utils/constants';
import { AuthContext } from '../../context/AuthContext';

const Groups = () => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [lastMessages, setLastMessages] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({});
  const navigation = useNavigation();
  const { user } = React.useContext(AuthContext);
  const ws = useRef(null);

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const groupData = response.data || [];
      setGroups(groupData);

      const lastMessagesData = {};
      const unreadCountsData = {};
      for (const group of groupData) {
        const lastMessage = await fetchLastMessage(group.id, token);
        lastMessagesData[group.id] = lastMessage;
        unreadCountsData[group.id] = await fetchUnreadCount(group.id, token);
      }
      setLastMessages(lastMessagesData);
      setUnreadCounts(unreadCountsData);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchLastMessage = async (groupId, token) => {
    try {
      const response = await axios.get(`${API_URL}/groups/messages/${groupId}/`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { page: 1, page_size: 1 },
      });
      const messages = response.data.results || [];
      return messages.length > 0 ? messages[0] : null;
    } catch (error) {
      console.error(`Error fetching last message for group ${groupId}:`, error);
      return null;
    }
  };

  const fetchUnreadCount = async (groupId, token) => {
    try {
      const response = await axios.get(`${API_URL}/groups/messages/${groupId}/`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { page_size: 100 },
      });
      const messages = response.data.results || [];
      return messages.filter((msg) => !(msg.read_by || []).some((u) => u.id === user?.id)).length;
    } catch (error) {
      console.error(`Failed to fetch unread count for group ${groupId}:`, error);
      return 0;
    }
  };

  const searchGroups = useCallback(async (query) => {
    if (!query) return fetchGroups();
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { query },
      });
      const groupData = response.data || [];
      setGroups(groupData);

      const lastMessagesData = {};
      const unreadCountsData = {};
      for (const group of groupData) {
        const lastMessage = await fetchLastMessage(group.id, token);
        lastMessagesData[group.id] = lastMessage;
        unreadCountsData[group.id] = await fetchUnreadCount(group.id, token);
      }
      setLastMessages(lastMessagesData);
      setUnreadCounts(unreadCountsData);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [fetchGroups, user]);

  const connectWebSocket = async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    ws.current = new WebSocket(`ws://${API_HOST}/ws/groups/?token=${token}`);
    ws.current.onopen = () => {
      console.log('Groups WebSocket connected');
    };
    ws.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'group_message') {
          const message = data.message;
          const groupId = message.group_id;
          setLastMessages((prev) => ({
            ...prev,
            [groupId]: message,
          }));
          if (user) {
            const readByUsers = message.read_by || [];
            const isUnread = !readByUsers.some((u) => u.id === user.id);
            setUnreadCounts((prev) => ({
              ...prev,
              [groupId]: isUnread ? (prev[groupId] || 0) + 1 : prev[groupId],
            }));
          }
        } else if (data.type === 'read_receipt') {
          const message = data.message;
          const groupId = message.group_id;
          setLastMessages((prev) => ({
            ...prev,
            [groupId]: prev[groupId]?.id === message.id ? message : prev[groupId],
          }));
          if (user) {
            const readByUsers = message.read_by || [];
            const isUnread = !readByUsers.some((u) => u.id === user.id);
            setUnreadCounts((prev) => ({
              ...prev,
              [groupId]: isUnread ? prev[groupId] : Math.max((prev[groupId] || 1) - 1, 0),
            }));
          }
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

  const handleError = (error) => {
    console.error('Error:', error);
    Toast.show({
      type: 'error',
      text1: 'Error',
      text2: error.response?.data?.error || error.message || 'An error occurred',
      position: 'bottom',
    });
  };

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    searchGroups(searchText);
  }, [searchText, searchGroups]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;

      fetchGroups();
      connectWebSocket();

      return () => {
        if (ws.current) {
          ws.current.close();
          console.log('Groups WebSocket cleanup');
        }
      };
    }, [user, fetchGroups])
  );

  const renderItem = ({ item }) => {
    const lastMessage = lastMessages[item.id];
    const unreadCount = unreadCounts[item.id] || 0;

    let senderName = 'Unknown';
    if (lastMessage) {
      senderName = lastMessage.sender?.id === user?.id ? 'You' : lastMessage.sender?.first_name || 'Unknown';
    }

    let messagePreview = 'No messages yet';
    if (lastMessage) {
      if (lastMessage.message) {
        messagePreview = lastMessage.message;
      } else if (lastMessage.attachment) {
        const attachmentUrl = lastMessage.attachment.toLowerCase();
        if (attachmentUrl.endsWith('.jpg') || attachmentUrl.endsWith('.png') || attachmentUrl.endsWith('.jpeg')) {
          messagePreview = 'Sent a photo';
        } else if (attachmentUrl.endsWith('.mp4') || attachmentUrl.endsWith('.mov')) {
          messagePreview = 'Sent a video';
        } else {
          messagePreview = 'Sent an attachment';
        }
      }
    }

    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-md border border-gray-100`}
        onPress={() => navigation.navigate('GroupChatScreen', { groupId: item.id, groupName: item.name })}
      >
        {item.profile_picture ? (
          <Image
            source={{ uri: `${API_URL}${item.profile_picture}` }}
            style={tw`w-12 h-12 rounded-full mr-3`}
            onError={() => console.log(`Failed to load profile picture for group ${item.name}`)}
          />
        ) : (
          <View style={tw`w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center mr-3`}>
            <Text style={tw`text-white text-lg font-bold`}>{item.name[0]}</Text>
          </View>
        )}
        <View style={tw`flex-1 flex-row items-center justify-between`}>
          <View style={tw`flex-1`}>
            <Text style={tw`text-lg font-semibold text-gray-800`}>{item.name}</Text>
            {lastMessage ? (
              <Text style={tw`text-sm text-gray-500`} numberOfLines={1}>
                {senderName}: {messagePreview}
              </Text>
            ) : (
              <Text style={tw`text-sm text-gray-500`}>No messages yet</Text>
            )}
          </View>
          <View style={tw`items-end`}>
            {lastMessage && (
              <Text style={tw`text-xs text-gray-500 mb-1`}>
                {new Date(lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
            {unreadCount > 0 && (
              <View style={tw`bg-blue-500 rounded-full px-2 py-1`}>
                <Text style={tw`text-xs text-white font-semibold`}>{unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <View style={tw`p-4 flex-row items-center bg-white shadow-sm`}>
        <View style={tw`flex-1 flex-row items-center bg-white rounded-xl px-6 py-3 border border-gray-200 shadow-sm`}>
          <Ionicons name="search" size={20} color="#9CA3AF" style={tw`mr-2`} />
          <TextInput
            style={tw`flex-1 text-gray-800 text-lg`}
            placeholder="Search groups..."
            placeholderTextColor="#9CA3AF"
            value={searchText}
            onChangeText={setSearchText}
            autoCapitalize="none"
          />
        </View>
        <TouchableOpacity
          style={tw`ml-3 p-2 bg-blue-500 rounded-full`}
          onPress={() => navigation.navigate('CreateGroupScreen')}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />
      ) : (
        <FlatList
          data={groups}
          renderItem={renderItem}
          keyExtractor={(item) => item.id.toString()}
          ListEmptyComponent={
            <Text style={tw`text-center mt-5 text-gray-500`}>
              {searchText ? 'No groups found' : 'No groups available'}
            </Text>
          }
          contentContainerStyle={tw`pb-4`}
        />
      )}
    </View>
  );
};

export default Groups;