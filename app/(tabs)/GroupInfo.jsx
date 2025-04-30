import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import tw from 'twrnc';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import { API_URL } from '../utils/constants';

const GroupInfo = () => {
  const { groupId } = useRoute().params;
  const navigation = useNavigation();
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
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Member added successfully',
        position: 'bottom',
      });
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
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Member removed successfully',
        position: 'bottom',
      });
      fetchGroup();
    } catch (error) {
      handleError(error);
    }
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
    fetchGroup();
  }, [groupId]);

  const renderMember = ({ item }) => (
    <View style={tw`flex-row items-center p-3 border-b border-gray-200 bg-white rounded-lg mx-2 my-1 shadow-sm`}>
      <Image
        source={{ uri: `https://ui-avatars.com/api/?name=${item.first_name}&background=random` }}
        style={tw`w-10 h-10 rounded-full mr-3`}
      />
      <View style={tw`flex-1`}>
        <Text style={tw`text-lg font-semibold text-gray-800`}>{item.first_name || item.username}</Text>
        {group?.admin.id === item.id && (
          <Text style={tw`text-sm text-blue-500`}>Admin</Text>
        )}
      </View>
      {group?.admin.id !== item.id && (
        <TouchableOpacity onPress={() => removeMember(item.id)} style={tw`p-2`}>
          <Ionicons name="person-remove" size={20} color="red" />
        </TouchableOpacity>
      )}
    </View>
  );

  const renderUser = ({ item }) => (
    <TouchableOpacity
      style={tw`flex-row items-center p-3 border-b border-gray-200 bg-white rounded-lg mx-2 my-1 shadow-sm`}
      onPress={() => addMember(item.id)}
    >
      <Image
        source={{ uri: `https://ui-avatars.com/api/?name=${item.first_name}&background=random` }}
        style={tw`w-10 h-10 rounded-full mr-3`}
      />
      <Text style={tw`text-lg font-semibold text-gray-800`}>{item.first_name || item.username}</Text>
    </TouchableOpacity>
  );

  if (!group) {
    return <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />;
  }

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      {/* Gradient Header */}
      <LinearGradient
        colors={['#4A00E0', '#8E2DE2']}
        style={tw`p-4 pt-10 flex-row items-center justify-between shadow-md`}
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <View style={tw`flex-row items-center`}>
          <View style={tw`w-12 h-12 rounded-full bg-white flex items-center justify-center mr-3`}>
            <Text style={tw`text-lg font-bold text-purple-600`}>{group.name[0]}</Text>
          </View>
          <View>
            <Text style={tw`text-xl font-bold text-white`}>{group.name}</Text>
            <Text style={tw`text-sm text-white opacity-70`}>{group.members.length} members</Text>
          </View>
        </View>
        <View style={tw`w-10`} /> {/* Spacer */}
      </LinearGradient>

      {/* Group Info */}
      <View style={tw`p-4 bg-white shadow-md rounded-b-2xl`}>
        <Text style={tw`text-lg font-semibold text-gray-800`}>Admin: {group.admin.first_name}</Text>
      </View>

      {/* Search Users */}
      <View style={tw`p-4`}>
        <TextInput
          style={tw`bg-white rounded-full px-4 py-3 text-gray-800 border border-gray-200 shadow-sm`}
          placeholder="Search users to add..."
          placeholderTextColor="#9CA3AF"
          value={searchText}
          onChangeText={(text) => {
            setSearchText(text);
            searchUsers(text);
          }}
        />
      </View>

      {/* Members or Search Results */}
      {searchText ? (
        <FlatList
          data={users.filter((u) => !group.members.some((m) => m.id === u.id))}
          renderItem={renderUser}
          keyExtractor={(item) => item.id.toString()}
          ListEmptyComponent={
            <Text style={tw`text-center mt-5 text-gray-500`}>No users found</Text>
          }
          contentContainerStyle={tw`pb-4`}
        />
      ) : (
        <FlatList
          data={group.members}
          renderItem={renderMember}
          keyExtractor={(item) => item.id.toString()}
          ListEmptyComponent={
            <Text style={tw`text-center mt-5 text-gray-500`}>No members</Text>
          }
          contentContainerStyle={tw`pb-4`}
        />
      )}
    </View>
  );
};

export default GroupInfo;