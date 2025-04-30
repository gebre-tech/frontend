//app/(tabs)/CreateGroupScreen.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import tw from 'twrnc';
import { API_URL } from '../utils/constants';

const CreateGroupScreen = ({ navigation }) => {
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/contacts/list_with_profiles/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setContacts(response.data || []);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleMember = (memberId) => {
    setSelectedMembers((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      Alert.alert('Error', 'Group name is required');
      return;
    }
    if (selectedMembers.length === 0) {
      Alert.alert('Error', 'Select at least one member');
      return;
    }
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.post(
        `${API_URL}/groups/create/`,
        {
          name: groupName,
          members: selectedMembers,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      Alert.alert('Success', 'Group created successfully');
      navigation.goBack();
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleError = (error) => {
    console.error('Error:', error);
    Alert.alert('Error', error.response?.data?.error || error.message || 'An error occurred');
  };

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-sm border-b border-gray-100`}
      onPress={() => toggleMember(item.friend_id)}
    >
      <View style={tw`w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center mr-3`}>
        <Text style={tw`text-white text-lg font-bold`}>{item.friend.user.first_name[0]}</Text>
      </View>
      <View style={tw`flex-1`}>
        <Text style={tw`text-lg font-semibold text-gray-800`}>
          {item.friend.user.first_name || item.friend.user.username}
        </Text>
      </View>
      <Ionicons
        name={selectedMembers.includes(item.friend_id) ? 'checkbox' : 'square-outline'}
        size={24}
        color={selectedMembers.includes(item.friend_id) ? '#007AFF' : '#9CA3AF'}
      />
    </TouchableOpacity>
  );

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <View style={tw`p-4`}>
        <TextInput
          style={tw`bg-white rounded-full px-4 py-2 text-gray-800 border border-gray-200 shadow-sm`}
          placeholder="Group name..."
          placeholderTextColor="#9CA3AF"
          value={groupName}
          onChangeText={setGroupName}
        />
      </View>
      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />
      ) : (
        <FlatList
          data={contacts}
          renderItem={renderItem}
          keyExtractor={(item) => item.friend_id.toString()}
          ListEmptyComponent={
            <Text style={tw`text-center mt-5 text-gray-500`}>No contacts available</Text>
          }
          contentContainerStyle={tw`pb-4`}
        />
      )}
      <TouchableOpacity
        style={tw`bg-blue-500 m-4 p-4 rounded-lg`}
        onPress={createGroup}
        disabled={loading}
      >
        <Text style={tw`text-white text-center font-semibold`}>Create Group</Text>
      </TouchableOpacity>
    </View>
  );
};

export default CreateGroupScreen;