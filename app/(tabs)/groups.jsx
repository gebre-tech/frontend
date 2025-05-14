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

  const processGroupProfilePicture = (profilePicture) => {
    if (!profilePicture) return null;
    // Ensure absolute URL
    return profilePicture.startsWith('http') ? profilePicture : `${API_URL}${profilePicture}`;
  };

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const groupData = (response.data || []).map(group => ({
        ...group,
        profile_picture: processGroupProfilePicture(group.profile_picture),
      }));
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
      const groupData = (response.data || []).map(group => ({
        ...group,
        profile_picture: processGroupProfilePicture(group.profile_picture),
      }));
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
          const groupId = message.group_id || message.group?.id;
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
          const groupId = message.group_id || message.group?.id;
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
        } else if (data.type === 'group_deleted') {
          setGroups((prev) => prev.filter((group) => group.id !== parseInt(data.group_id)));
          setLastMessages((prev) => {
            const newMessages = { ...prev };
            delete newMessages[data.group_id];
            return newMessages;
          });
          setUnreadCounts((prev) => {
            const newCounts = { ...prev };
            delete newCounts[data.group_id];
            return newCounts;
          });
          Toast.show({
            type: 'info',
            text1: 'Group Deleted',
            text2: data.message,
            position: 'bottom',
          });
          navigation.navigate('Groups');
        } else if (data.type === 'ownership_transferred') {
          setGroups((prev) =>
            prev.map((group) =>
              group.id === parseInt(data.group_id)
                ? { ...group, creator: data.new_owner, admins: data.group_data.admins }
                : group
            )
          );
          Toast.show({
            type: 'info',
            text1: 'Ownership Transferred',
            text2: data.message,
            position: 'bottom',
          });
        }
      } catch (error) {
        console.error('WebSocket message parsing error:', error);
      }
    };
    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setTimeout(connectWebSocket, 2000);
    };
    ws.current.onclose = () => {
      console.log('Groups WebSocket closed');
    };
  };

  const handleError = (error) => {
    console.error('Error:', error);
    Toast.show({
      type: 'error',
      text1: 'Error',
      text2: error.response?.data?.error || error.message || 'An error occurred',
      position: 'bottom',
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
          console.log('Groups WebSocket disconnected');
        }
      };
    }, [fetchGroups, user])
  );

  const renderGroup = ({ item }) => {
    const lastMessage = lastMessages[item.id];
    const unreadCount = unreadCounts[item.id] || 0;

    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-3 bg-white border-b border-gray-200 rounded-lg mx-2 my-1 shadow-sm`}
        onPress={() => navigation.navigate('GroupChatScreen', { groupId: item.id, groupName: item.name })}
      >
        {item.profile_picture ? (
          <Image
            source={{ uri: item.profile_picture }}
            style={tw`w-12 h-12 rounded-full mr-3`}
            onError={() => console.log(`Failed to load profile picture for group ${item.name}`)}
          />
        ) : (
          <View style={tw`w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center mr-3`}>
            <Text style={tw`text-lg font-bold text-white`}>{item.name[0]}</Text>
          </View>
        )}
        <View style={tw`flex-1`}>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-lg font-semibold text-gray-800`}>{item.name}</Text>
            {lastMessage?.timestamp && (
              <Text style={tw`text-xs text-gray-500`}>
                {new Date(lastMessage.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </View>
          {lastMessage ? (
            <View style={tw`flex-row items-center`}>
              <Text
                style={tw`text-sm text-gray-500 flex-1`}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {lastMessage.sender?.first_name || lastMessage.sender?.username || 'Unknown'}: {lastMessage.message || (lastMessage.file_name ? 'Sent a file' : 'No message')}
              </Text>
              {unreadCount > 0 && (
                <View style={tw`bg-blue-500 rounded-full px-2 py-1 ml-2`}>
                  <Text style={tw`text-xs text-white font-semibold`}>{unreadCount}</Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={tw`text-sm text-gray-500`}>No messages yet</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <View style={tw`bg-[#1a73e8] p-4 pt-10 flex-row items-center justify-between`}>
        <Text style={tw`text-2xl font-bold text-white`}>Groups</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('CreateGroup')}
          style={tw`p-2`}
        >
          <Ionicons name="add-circle" size={28} color="white" />
        </TouchableOpacity>
      </View>

      <View style={tw`p-4 bg-white shadow-md rounded-b-2xl`}>
        <View style={tw`flex-row items-center bg-gray-100 rounded-full px-3 py-2`}>
          <Ionicons name="search" size={20} color="#9CA3AF" />
          <TextInput
            style={tw`flex-1 ml-2 text-base text-gray-800`}
            placeholder="Search groups..."
            value={searchText}
            onChangeText={setSearchText}
          />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />
      ) : (
        <FlatList
          data={groups}
          renderItem={renderGroup}
          keyExtractor={(item) => item.id.toString()}
          ListEmptyComponent={
            <Text style={tw`text-center mt-5 text-gray-500`}>No groups found</Text>
          }
          contentContainerStyle={tw`pb-4`}
        />
      )}
    </View>
  );
};

export default Groups;