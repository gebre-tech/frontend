import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
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

const FileSystem = Platform.OS !== 'web' ? require('expo-file-system') : null;

const GroupInfo = () => {
  const { groupId } = useRoute().params;
  const navigation = useNavigation();
  const { user } = useContext(AuthContext);
  const [group, setGroup] = useState(null);
  const [memberProfiles, setMemberProfiles] = useState({});
  const [groupDetails, setGroupDetails] = useState(null);
  const [isModalVisible, setModalVisible] = useState(false);
  const [isAddMembersModalVisible, setAddMembersModalVisible] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactProfiles, setContactProfiles] = useState({});
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

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

  const fetchContacts = useCallback(async () => {
    try {
      setLoadingContacts(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/contacts/list_with_profiles/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contactsData = response.data || [];
      const filteredContacts = contactsData.filter(
        (contact) => !group.members.some((member) => member.id === contact.friend_id)
      );
      setContacts(filteredContacts);

      const profiles = {};
      for (const contact of filteredContacts) {
        try {
          const profileResponse = await axios.get(
            `${API_URL}/profiles/friend/${contact.friend.user.username}/`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const profileData = profileResponse.data;
          const now = new Date();
          const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
          profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
          profiles[contact.friend_id] = profileData;
        } catch (error) {
          console.error(`Failed to fetch profile for ${contact.friend.user.username}:`, error);
          profiles[contact.friend_id] = null;
        }
      }
      setContactProfiles(profiles);
    } catch (error) {
      handleError(error);
    } finally {
      setLoadingContacts(false);
    }
  }, [group]);

  const toggleMember = (memberId) => {
    setSelectedMembers((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const addMembersToGroup = async () => {
    if (selectedMembers.length === 0) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Select at least one member to add',
        position: 'bottom',
      });
      return;
    }

    const isAdmin = group?.admins.some(admin => admin.id === user?.id);
    if (!isAdmin) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only admins can add members.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      for (const userId of selectedMembers) {
        await axios.post(
          `${API_URL}/groups/add_member/${groupId}/${userId}/`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Members added successfully',
        position: 'bottom',
      });

      setSelectedMembers([]);
      setAddMembersModalVisible(false);
      fetchGroup();
    } catch (error) {
      handleError(error);
    }
  };

  const removeMember = async (userId) => {
    const isAdmin = group?.admins.some(admin => admin.id === user?.id);
    if (!isAdmin) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only admins can remove members.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/remove_member/${groupId}/${userId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
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

  const assignAdmin = async (userId) => {
    const isOwner = group?.creator.id === user?.id;
    if (!isOwner) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only the group owner can assign admin rights.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/assign_admin/${groupId}/${userId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Admin rights assigned successfully',
        position: 'bottom',
      });
      fetchGroup();
    } catch (error) {
      handleError(error);
    }
  };

  const revokeAdmin = async (userId) => {
    const isOwner = group?.creator.id === user?.id;
    if (!isOwner) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only the group owner can revoke admin rights.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/revoke_admin/${groupId}/${userId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Admin rights revoked successfully',
        position: 'bottom',
      });
      fetchGroup();
    } catch (error) {
      handleError(error);
    }
  };

  const leaveGroup = async () => {
    const isOwner = group?.creator.id === user?.id;
    if (isOwner) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'The group owner cannot leave the group.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/leave/${groupId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'You have left the group.',
        position: 'bottom',
      });
      navigation.goBack(); // Navigate back to the previous screen (e.g., group list)
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
        if (file) updateProfilePicture(file);
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

      if (!result.canceled) updateProfilePicture(result.assets[0].uri);
    }
  };

  const updateProfilePicture = async (fileOrUri) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const formData = new FormData();

      if (Platform.OS === 'web') {
        formData.append('profile_picture', fileOrUri, 'group_profile.jpg');
      } else {
        const fileInfo = await FileSystem.getInfoAsync(fileOrUri);
        if (!fileInfo.exists) throw new Error('Image file does not exist');

        const newUri = `${FileSystem.cacheDirectory}group_profile.jpg`;
        await FileSystem.copyAsync({ from: fileOrUri, to: newUri });

        formData.append('profile_picture', {
          uri: newUri,
          name: 'group_profile.jpg',
          type: 'image/jpeg',
        });
      }

      const response = await axios.post(
        `${API_URL}/groups/update_profile_picture/${groupId}/`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } }
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
    const isAdmin = group?.admins.some(admin => admin.id === user?.id);
    const isOwner = group?.creator.id === user?.id;
    const isMemberAdmin = group?.admins.some(admin => admin.id === item.id);
    const isMemberOwner = group?.creator.id === item.id;
    const isCurrentUser = item.id === user?.id;

    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-3 border-b border-gray-200 bg-white rounded-lg mx-2 my-1 shadow-sm`}
        onPress={() => {
          if (item.username) navigation.navigate('FriendProfile', { username: item.username });
          else
            Toast.show({
              type: 'error',
              text1: 'Error',
              text2: 'User profile unavailable',
              position: 'bottom',
            });
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
          {isMemberOwner ? (
            <Text style={tw`text-sm text-blue-500`}>Owner</Text>
          ) : isMemberAdmin ? (
            <Text style={tw`text-sm text-blue-500`}>Admin</Text>
          ) : null}
          {profile && (
            <Text style={tw`text-sm text-gray-500`}>
              {profile.is_online
                ? 'Online'
                : `Last seen: ${profile.last_seen ? new Date(profile.last_seen).toLocaleString() : 'Unknown'}`}
            </Text>
          )}
        </View>
        {isAdmin && !isMemberOwner && (
          <View style={tw`flex-row`}>
            {isOwner && !isMemberAdmin ? (
              <TouchableOpacity onPress={() => assignAdmin(item.id)} style={tw`p-2`}>
                <Ionicons name="shield" size={20} color="green" />
              </TouchableOpacity>
            ) : isOwner && isMemberAdmin ? (
              <TouchableOpacity onPress={() => revokeAdmin(item.id)} style={tw`p-2`}>
                <Ionicons name="shield-outline" size={20} color="orange" />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => removeMember(item.id)} style={tw`p-2`}>
              <Ionicons name="person-remove" size={20} color="red" />
            </TouchableOpacity>
          </View>
        )}
        {isCurrentUser && !isOwner && (
          <TouchableOpacity onPress={leaveGroup} style={tw`p-2`}>
            <Ionicons name="exit" size={20} color="gray" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderContact = ({ item }) => {
    const profile = contactProfiles[item.friend_id];
    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-sm border-b border-gray-100`}
        onPress={() => {
          if (item.friend.user.username) navigation.navigate('FriendProfile', { username: item.friend.user.username });
          else
            Toast.show({
              type: 'error',
              text1: 'Error',
              text2: 'User profile unavailable',
              position: 'bottom',
            });
        }}
      >
        <Image
          source={{
            uri: profile?.profile_picture || `https://ui-avatars.com/api/?name=${item.friend.user.first_name || item.friend.user.username}&background=random`,
          }}
          style={tw`w-12 h-12 rounded-full mr-3`}
          onError={() => console.log(`Failed to load profile picture for ${item.friend.user.username}`)}
        />
        <View style={tw`flex-1`}>
          <Text style={tw`text-lg font-semibold text-gray-800`}>
            {item.friend.user.first_name || item.friend.user.username}
          </Text>
          {profile && (
            <Text style={tw`text-sm text-gray-500`}>
              {profile.is_online ? 'Online' : `Last seen: ${profile.last_seen ? new Date(profile.last_seen).toLocaleString() : 'Unknown'}`}
            </Text>
          )}
        </View>
        <Ionicons
          name={selectedMembers.includes(item.friend_id) ? 'checkbox' : 'square-outline'}
          size={24}
          color={selectedMembers.includes(item.friend_id) ? '#007AFF' : '#9CA3AF'}
          onPress={() => toggleMember(item.friend_id)}
        />
      </TouchableOpacity>
    );
  };

  if (!group) {
    return <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />;
  }

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <LinearGradient colors={['#4A00E0', '#8E2DE2']} style={tw`p-4 pt-10 flex-row items-center justify-between shadow-md`}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <View style={tw`flex-row items-center flex-1`}>
          <TouchableOpacity
            onPress={group.admins.some(admin => admin.id === user?.id) ? pickImage : undefined}
            disabled={!group.admins.some(admin => admin.id === user?.id)}
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
            {group.admins.some(admin => admin.id === user?.id) && (
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

      <Modal isVisible={isModalVisible} onBackdropPress={() => setModalVisible(false)}>
        <View style={tw`bg-white p-5 rounded-lg`}>
          <Text style={tw`text-xl font-bold mb-3 text-gray-900`}>Group Details</Text>
          {groupDetails && (
            <View>
              <Text style={tw`text-base text-gray-800 mb-2`}>Name: {groupDetails.name}</Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>
                Created At: {new Date(groupDetails.created_at).toLocaleString()}
              </Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>Total Members: {groupDetails.total_members}</Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>Total Messages: {groupDetails.total_messages}</Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>Owner:</Text>
              <View style={tw`flex-row items-center mb-2`}>
                <Image
                  source={{
                    uri: groupDetails.creator.profile_picture
                      ? `${API_URL}${groupDetails.creator.profile_picture}`
                      : `https://ui-avatars.com/api/?name=${groupDetails.creator.first_name || groupDetails.creator.username}&background=random`,
                  }}
                  style={tw`w-10 h-10 rounded-full mr-3`}
                  onError={() => console.log('Failed to load creator profile picture')}
                />
                <View>
                  <Text style={tw`text-base text-gray-800`}>
                    {groupDetails.creator.first_name} (@{groupDetails.creator.username})
                  </Text>
                  <Text style={tw`text-sm text-gray-500`}>
                    {memberProfiles[groupDetails.creator.id]?.is_online ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>
              <Text style={tw`text-base text-gray-800 mb-2`}>Admins:</Text>
              {groupDetails.admins.map(admin => (
                <View key={admin.id} style={tw`flex-row items-center mb-2 ml-2`}>
                  <Image
                    source={{
                      uri: admin.profile_picture
                        ? `${API_URL}${admin.profile_picture}`
                        : `https://ui-avatars.com/api/?name=${admin.first_name || admin.username}&background=random`,
                    }}
                    style={tw`w-8 h-8 rounded-full mr-2`}
                    onError={() => console.log('Failed to load admin profile picture')}
                  />
                  <Text style={tw`text-base text-gray-800`}>
                    {admin.first_name} (@{admin.username})
                    {admin.id === groupDetails.creator.id ? ' (Owner)' : ''}
                  </Text>
                </View>
              ))}
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
          <TouchableOpacity onPress={() => setModalVisible(false)} style={tw`mt-5 p-2 bg-blue-500 rounded-lg`}>
            <Text style={tw`text-white text-center font-semibold`}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        isVisible={isAddMembersModalVisible}
        onBackdropPress={() => {
          setAddMembersModalVisible(false);
          setSelectedMembers([]);
        }}
      >
        <View style={tw`bg-white p-5 rounded-lg max-h-3/4`}>
          <Text style={tw`text-xl font-bold mb-3 text-gray-900`}>Add New Members</Text>
          {loadingContacts ? (
            <ActivityIndicator size="large" color="#007AFF" style={tw`my-4`} />
          ) : (
            <FlatList
              data={contacts}
              renderItem={renderContact}
              keyExtractor={(item) => item.friend_id.toString()}
              ListEmptyComponent={<Text style={tw`text-center mt-5 text-gray-500`}>No contacts available to add</Text>}
              contentContainerStyle={tw`pb-4`}
            />
          )}
          <TouchableOpacity
            onPress={addMembersToGroup}
            style={tw`mt-5 p-2 bg-blue-500 rounded-lg`}
            disabled={loadingContacts || selectedMembers.length === 0}
          >
            <Text style={tw`text-white text-center font-semibold`}>Add Members</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setAddMembersModalVisible(false);
              setSelectedMembers([]);
            }}
            style={tw`mt-2 p-2 bg-gray-300 rounded-lg`}
          >
            <Text style={tw`text-gray-800 text-center font-semibold`}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <View style={tw`p-4 bg-white shadow-md rounded-b-2xl`}>
        <Text style={tw`text-lg font-semibold text-gray-800`}>Owner: {group.creator.first_name}</Text>
      </View>

      {group?.admins.some(admin => admin.id === user?.id) && (
        <View style={tw`p-4`}>
          <TouchableOpacity
            style={tw`bg-blue-500 rounded-full px-4 py-3 shadow-sm flex-row items-center justify-center`}
            onPress={() => {
              fetchContacts();
              setAddMembersModalVisible(true);
            }}
          >
            <Ionicons name="person-add" size={20} color="white" style={tw`mr-2`} />
            <Text style={tw`text-white font-semibold`}>+ Add New Members</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={group.members}
        renderItem={renderMember}
        keyExtractor={(item) => item.id.toString()}
        ListEmptyComponent={<Text style={tw`text-center mt-5 text-gray-500`}>No members</Text>}
        contentContainerStyle={tw`pb-4`}
      />
    </View>
  );
};

export default GroupInfo;