import React from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import tw from 'twrnc';
import { API_URL } from '../utils/constants';
import { Feather } from '@expo/vector-icons';

const GroupInfo = () => {
  const { chatId } = useRoute().params;
  const queryClient = useQueryClient();

  const { data: group } = useQuery({
    queryKey: ['group', chatId],
    queryFn: async () => {
      const token = await AsyncStorage.getItem('token');
      return axios.get(`${API_URL}/chat/rooms/${chatId}/`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.data);
    },
  });

  const manageMember = useMutation({
    mutationFn: async ({ action, memberId }) => {
      const token = await AsyncStorage.getItem('token');
      return axios.post(
        `${API_URL}/chat/manage-group-member/${chatId}/`,
        { action, member_id: memberId },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
    },
    onSuccess: () => queryClient.invalidateQueries(['group', chatId]),
  });

  const renderMember = ({ item }) => (
    <View style={tw`flex-row justify-between items-center p-3 border-b border-gray-200`}>
      <Text style={tw`text-lg text-gray-800`}>{item.username}</Text>
      {group?.admins?.some((a) => a.id === item.id) && <Text style={tw`text-sm text-blue-500`}>Admin</Text>}
      <TouchableOpacity onPress={() => manageMember.mutate({ action: 'remove', memberId: item.id })} style={tw`p-2`}>
        <Feather name="user-x" size={20} color="red" />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={tw`flex-1 bg-white`}>
      <Text style={tw`text-2xl font-bold p-4`}>{group?.name}</Text>
      <FlatList data={group?.members} renderItem={renderMember} keyExtractor={(item) => item.id.toString()} />
      <TouchableOpacity onPress={() => manageMember.mutate({ action: 'add', memberId: /* prompt user */ 1 })} style={tw`p-4 bg-blue-500 m-4 rounded-lg`}>
        <Text style={tw`text-white text-center`}>Add Member</Text>
      </TouchableOpacity>
    </View>
  );
};

export default GroupInfo;