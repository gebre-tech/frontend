import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import tw from 'twrnc';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import { API_URL } from '../utils/constants';

const Groups = () => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const navigation = useNavigation();

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroups(response.data || []);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, []);

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
      setGroups(response.data || []);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [fetchGroups]);

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

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-md border border-gray-100`}
      onPress={() => navigation.navigate('GroupChatScreen', { groupId: item.id, groupName: item.name })}
    >
      <View style={tw`w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center mr-3`}>
        <Text style={tw`text-white text-lg font-bold`}>{item.name[0]}</Text>
      </View>
      <View style={tw`flex-1`}>
        <Text style={tw`text-lg font-semibold text-gray-800`}>{item.name}</Text>
        <Text style={tw`text-sm text-gray-500`}>Admin: {item.admin.first_name}</Text>
      </View>
      <TouchableOpacity onPress={() => navigation.navigate('GroupInfo', { groupId: item.id })}>
        <Ionicons name="information-circle-outline" size={24} color="#007AFF" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      {/* Gradient Header */}
      <LinearGradient
        colors={['#4A00E0', '#8E2DE2']}
        style={tw`p-4 pt-10 flex-row items-center justify-between shadow-md`}
      >
        <Text style={tw`text-2xl font-bold text-white`}>Groups</Text>
        <TouchableOpacity
          style={tw`p-2 bg-white rounded-full shadow-md`}
          onPress={() => navigation.navigate('CreateGroupScreen')}
        >
          <Ionicons name="add" size={24} color="#4A00E0" />
        </TouchableOpacity>
      </LinearGradient>

      {/* Search Bar */}
      <View style={tw`p-4`}>
        <TextInput
          style={tw`bg-white rounded-full px-4 py-3 text-gray-800 border border-gray-200 shadow-md`}
          placeholder="Search groups..."
          placeholderTextColor="#9CA3AF"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
        />
      </View>

      {/* Groups List */}
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