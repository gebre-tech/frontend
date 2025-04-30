//app/(tabs)/GroupInfo.jsx
import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import tw from 'twrnc';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '../utils/constants';

const GroupInfo = () => {
  const { groupId } = useRoute().params;
  const [group, setGroup] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [users, setUsers] = useState([]);

  const fetchGroup = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const groupData = response.data.find((g) => g.id === parseInt(groupId));
      setGroup(groupData);
    } catch (error) {
      handleError(error);
    }
  };

  const searchUsers = async (query) => {
    if (!query) return setUsers([]);
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/contacts/search/users/`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { query },
      });
      setUsers(response.data.results || response.data || []);
    } catch (error) {
      handleError(error);
    }
  };

  const addMember = async (userId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/add_member/${groupId}/${userId}/`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      Alert.alert('Success', 'Member added successfully');
      fetchGroup();
    } catch (error) {
      handleError(error);
    }
  };

  const removeMember = async (userId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/remove_member/${groupId}/${userId}/`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      Alert.alert('Success', 'Member removed successfully');
      fetchGroup();
    } catch (error) {
      handleError(error);
    }
  };

  const handleError = (error) => {
    console.error('Error:', error);
    Alert.alert('Error', error.response?.data?.error || error.message || 'An error occurred');
  };

  React.useEffect(() => {
    fetchGroup();
  }, [groupId]);

  const renderMember = ({ item }) => (
    <View style={tw`flex-row justify-between items-center p-3 border-b border-gray-200`}>
      <Text style={tw`text-lg text-gray-800`}>{item.first_name || item.username}</Text>
      {group?.admin.id === item.id ? (
        <Text style={tw`text-sm text-blue-500`}>Admin</Text>
      ) : (
        <TouchableOpacity onPress={() => removeMember(item.id)} style={tw`p-2`}>
          <Ionicons name="person-remove" size={20} color="red" />
        </TouchableOpacity>
      )}
    </View>
  );

  const renderUser = ({ item }) => (
    <TouchableOpacity
      style={tw`flex-row items-center p-3 border-b border-gray-200`}
      onPress={() => addMember(item.id)}
    >
      <Text style={tw`text-lg text-gray-800`}>{item.first_name || item.username}</Text>
    </TouchableOpacity>
  );

  if (!group) {
    return <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />;
  }

  return (
    <View style={tw`flex-1 bg-white`}>
      <Text style={tw`text-2xl font-bold p-4`}>{group.name}</Text>
      <Text style={tw`text-lg p-4 text-gray-600`}>Admin: {group.admin.first_name}</Text>
      <View style={tw`p-4`}>
        <TextInput
          style={tw`bg-gray-100 rounded-full px-4 py-2 text-gray-800 border border-gray-200 shadow-sm`}
          placeholder="Search users to add..."
          placeholderTextColor="#9CA3AF"
          value={searchText}
          onChangeText={(text) => {
            setSearchText(text);
            searchUsers(text);
          }}
        />
      </View>
      {searchText ? (
        <FlatList
          data={users.filter((u) => !group.members.some((m) => m.id === u.id))}
          renderItem={renderUser}
          keyExtractor={(item) => item.id.toString()}
          ListEmptyComponent={
            <Text style={tw`text-center mt-5 text-gray-500`}>No users found</Text>
          }
        />
      ) : (
        <FlatList
          data={group.members}
          renderItem={renderMember}
          keyExtractor={(item) => item.id.toString()}
          ListEmptyComponent={
            <Text style={tw`text-center mt-5 text-gray-500`}>No members</Text>
          }
        />
      )}
    </View>
  );
};

export default GroupInfo;