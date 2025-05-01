import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import tw from 'twrnc';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import { API_URL, PLACEHOLDER_IMAGE } from '../utils/constants';
import * as ImagePicker from 'expo-image-picker';
import { AuthContext } from '../../context/AuthContext';
import { useContext } from 'react';
import Modal from 'react-native-modal';

// Only import expo-file-system if not on web
const FileSystem = Platform.OS !== 'web' ? require('expo-file-system') : null;

const GroupInfo = () => {
  const { groupId } = useRoute().params;
  const navigation = useNavigation();
  const { user } = useContext(AuthContext);
  const [group, setGroup] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [users, setUsers] = useState([]);
  const [memberProfiles, setMemberProfiles] = useState({});
  const [groupDetails, setGroupDetails] = useState(null);
  const [isModalVisible, setModalVisible] = useState(false);

  const fetchGroup = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const groupData = response.data.find((g) => g.id === parseInt(groupId));
      setGroup(groupData);
      if (groupData) {
        fetchMemberProfiles(groupData.members);
      }
    } catch (error) {
      handleError(error);
    }
  };

  const fetchMemberProfiles = async (members) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const profiles = {};
      for (const member of members) {
        try {
          const response = await axios.get(`${API_URL}/profiles/friend/${member.username}/`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const profileData = response.data;
          const now = new Date();
          const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
          profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
          profiles[member.id] = profileData;
        } catch (error) {
          console.error(`Failed to fetch profile for ${member.username}:`, error);
          profiles[member.id] = null;
        }
      }
      setMemberProfiles(profiles);
    } catch (error) {
      handleError(error);
    }
  };

  const fetchGroupDetails = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/details/${groupId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroupDetails(response.data);
      setModalVisible(true);
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

  const pickImage = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (event) => {
        const file = event.target.files[0];
        if (file) {
          updateProfilePicture(file);
        }
      };
      input.click();
    } else {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Toast.show({
          type: 'error',
          text1: 'Permission Denied',
          text2: 'Please grant permission to access the media library.',
          position: 'bottom',
        });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (!result.canceled) {
        updateProfilePicture(result.assets[0].uri);
      }
    }
  };

  const updateProfilePicture = async (fileOrUri) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const formData = new FormData();

      if (Platform.OS === 'web') {
        formData.append('profile_picture', fileOrUri, 'group_profile.jpg');
        console.log('Uploading profile picture (web):', fileOrUri.name);
      } else {
        const fileInfo = await FileSystem.getInfoAsync(fileOrUri);
        if (!fileInfo.exists) {
          throw new Error('Image file does not exist');
        }

        const newUri = `${FileSystem.cacheDirectory}group_profile.jpg`;
        await FileSystem.copyAsync({
          from: fileOrUri,
          to: newUri,
        });

        formData.append('profile_picture', {
          uri: newUri,
          name: 'group_profile.jpg',
          type: 'image/jpeg',
        });

        console.log('Uploading profile picture (mobile) with URI:', newUri);
      }

      const response = await axios.post(
        `${API_URL}/groups/update_profile_picture/${groupId}/`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      setGroup(response.data);
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Group profile picture updated',
        position: 'bottom',
      });
    } catch (error) {
      console.error('Error uploading profile picture:', error.response?.data || error.message);
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

  const renderMember = ({ item }) => {
    const profile = memberProfiles[item.id];

    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-3 border-b border-gray-200 bg-white rounded-lg mx-2 my-1 shadow-sm`}
        onPress={() => {
          if (item.username) {
            navigation.navigate('FriendProfile', { username: item.username });
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
        <Image
          source={{
            uri: profile?.profile_picture || `https://ui-avatars.com/api/?name=${item.first_name || item.username}&background=random`,
          }}
          style={tw`w-10 h-10 rounded-full mr-3`}
          onError={() => console.log(`Failed to load profile picture for ${item.username}`)}
        />
        <View style={tw`flex-1`}>
          <Text style={tw`text-lg font-semibold text-gray-800`}>{item.first_name || item.username}</Text>
          {group?.admin.id === item.id && (
            <Text style={tw`text-sm text-blue-500`}>Admin</Text>
          )}
          {profile && (
            <Text style={tw`text-sm text-gray-500`}>
              {profile.is_online
                ? 'Online'
                : `Last seen: ${profile.last_seen ? new Date(profile.last_seen).toLocaleString() : 'Unknown'}`}
            </Text>
          )}
        </View>
        {group?.admin.id !== item.id && (
          <TouchableOpacity onPress={() => removeMember(item.id)} style={tw`p-2`}>
            <Ionicons name="person-remove" size={20} color="red" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderUser = ({ item }) => (
    <TouchableOpacity
      style={tw`flex-row items-center p-3 border-b border-gray-200 bg-white rounded-lg mx-2 my-1 shadow-sm`}
      onPress={() => addMember(item.id)}
    >
      <Image
        source={{ uri: `https://ui-avatars.com/api/?name=${item.first_name || item.username}&background=random` }}
        style={tw`w-10 h-10 rounded-full mr-3`}
      />
      <Text style={tw`text-lg font-semibold text-gray-800`}>{item.first_name || item.username}</Text>
    </TouchableOpacity>
  );

  if (!group) {
    return <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />;
  }

  const isAdmin = group.admin.id === user?.id;

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
        <View style={tw`flex-row items-center flex-1`}>
          <TouchableOpacity
            onPress={isAdmin ? pickImage : undefined}
            disabled={!isAdmin}
            style={tw`relative w-12 h-12 rounded-full flex items-center justify-center mr-4`}
          >
            {group.profile_picture ? (
              <Image
                source={{ uri: `${API_URL}${group.profile_picture}` }}
                style={tw`w-12 h-12 rounded-full`}
                onError={() => console.log('Failed to load group profile picture')}
              />
            ) : (
              <View style={tw`w-12 h-12 rounded-full bg-white flex items-center justify-center`}>
                <Text style={tw`text-lg font-bold text-purple-600`}>{group.name[0]}</Text>
              </View>
            )}
            {isAdmin && (
              <View style={tw`absolute bottom-0 right-0 bg-white rounded-full p-1 border border-gray-200`}>
                <Ionicons name="camera" size={16} color="#4A00E0" />
              </View>
            )}
          </TouchableOpacity>
          <View style={tw`flex-1 ml-2`}>
            <Text style={tw`text-xl font-bold text-white`}>{group.name}</Text>
            <Text style={tw`text-sm text-white opacity-70`}>{group.members.length} members</Text>
          </View>
        </View>
        <TouchableOpacity onPress={fetchGroupDetails} style={tw`p-2`}>
          <Ionicons name="information-circle" size={24} color="white" />
        </TouchableOpacity>
      </LinearGradient>

      {/* Modal for Group Details */}
      <Modal isVisible={isModalVisible} onBackdropPress={() => setModalVisible(false)}>
        <View style={tw`bg-white p-5 rounded-lg`}>
          <Text style={tw`text-xl font-bold mb-3 text-gray-900`}>Group Details</Text>
          {groupDetails && (
            <View>
              <Text style={tw`text-base text-gray-800 mb-2`}>Name: {groupDetails.name}</Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>
                Created At: {new Date(groupDetails.created_at).toLocaleString()}
              </Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>
                Total Members: {groupDetails.total_members}
              </Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>
                Total Messages: {groupDetails.total_messages}
              </Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>Admin:</Text>
              <View style={tw`flex-row items-center mb-2`}>
                <Image
                  source={{
                    uri: groupDetails.admin.profile_picture
                      ? `${API_URL}${groupDetails.admin.profile_picture}`
                      : `https://ui-avatars.com/api/?name=${groupDetails.admin.first_name || groupDetails.admin.username}&background=random`,
                  }}
                  style={tw`w-10 h-10 rounded-full mr-3`}
                  onError={() => console.log('Failed to load admin profile picture')}
                />
                <View>
                  <Text style={tw`text-base text-gray-800`}>
                    {groupDetails.admin.first_name} (@{groupDetails.admin.username})
                  </Text>
                  <Text style={tw`text-sm text-gray-500`}>
                    {memberProfiles[groupDetails.admin.id]?.is_online ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>
              {groupDetails.profile_picture && (
                <View style={tw`mt-2`}>
                  <Text style={tw`text-base text-gray-800 mb-1`}>Profile Picture:</Text>
                  <Image
                    source={{ uri: `${API_URL}${groupDetails.profile_picture}` }}
                    style={tw`w-20 h-20 rounded-lg`}
                    onError={() => console.log('Failed to load group profile picture')}
                  />
                </View>
              )}
            </View>
          )}
          <TouchableOpacity
            onPress={() => setModalVisible(false)}
            style={tw`mt-5 p-2 bg-blue-500 rounded-lg`}
          >
            <Text style={tw`text-white text-center font-semibold`}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

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