import React, { useState, useEffect, useContext } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, StyleSheet, Alert } from 'react-native';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';
import { AuthContext } from '../../context/AuthContext';
import { Ionicons } from '@expo/vector-icons'; // ✅ Import Icons
import AsyncStorage from '@react-native-async-storage/async-storage'; // Ensure AsyncStorage is imported

const Contacts = () => {
  const [contacts, setContacts] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const navigation = useNavigation();
  const { user } = useContext(AuthContext);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const token = await AsyncStorage.getItem("access");
      if (!token) {
        throw new Error('No token found');
      }
      const response = await axios.get(`http://127.0.0.1:8000/contacts/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setContacts(response.data);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      Alert.alert('Error', 'Could not fetch contacts');
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const token = await AsyncStorage.getItem("access");
      if (!token) {
        throw new Error('No token found');
      }
      const response = await axios.get(`http://127.0.0.1:8000/contacts/search_users/`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { query },
      });
      setSearchResults(response.data);
    } catch (error) {
      console.error('Error searching users:', error);
      Alert.alert('Error', 'Could not search users');
    }
  };

  const handleSearchChange = (text) => {
    setSearchText(text);
    searchUsers(text);
  };

  const handleAddFriend = async (username) => {
    try {
      const token = await AsyncStorage.getItem("access");
      if (!token) {
        throw new Error('No token found');
      }
      const response = await axios.post(
        'http://127.0.0.1:8000/contacts/add/',
        { username },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (response.status === 201) {
        Alert.alert('Success', 'Friend added successfully');
        fetchContacts(); // Refresh contacts list
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || 'Could not add friend';
      Alert.alert('Error', errorMessage);
    }
  };

  const filteredContacts = contacts.filter(contact =>
    contact.friend.username.toLowerCase().includes(searchText.toLowerCase())
  );

  const renderItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.contactItem}
      onPress={() => navigation.navigate('Chat', { chatId: item.friend_id })}
    >
      <Ionicons name="person-circle-outline" size={40} color="black" />  {/* ✅ User icon */}
      <Text style={styles.contactName}>{item.friend.username}</Text>
      <Ionicons name="chatbubble-outline" size={24} color="#007bff" />  {/* ✅ Chat icon */}
    </TouchableOpacity>
  );

  const renderSearchItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.contactItem}
      onPress={() => handleAddFriend(item.username)}
    >
      <Ionicons name="person-add-outline" size={40} color="black" />  {/* ✅ Add user icon */}
      <Text style={styles.contactName}>{item.username}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search contacts..."
        value={searchText}
        onChangeText={handleSearchChange}
      />
      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" />
      ) : searchText ? (
        <FlatList
          data={searchResults}
          renderItem={renderSearchItem}
          keyExtractor={(item) => item.id.toString()}
        />
      ) : filteredContacts.length === 0 ? (
        <Text style={styles.noContactsText}>No contacts available</Text>
      ) : (
        <FlatList
          data={filteredContacts}
          renderItem={renderItem}
          keyExtractor={(item) => item.friend_id.toString()}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 10 },
  searchInput: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  contactName: {
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1, // ✅ Ensures name takes available space
    marginLeft: 10,
  },
  noContactsText: { textAlign: 'center', marginTop: 20, fontSize: 16, color: 'gray' },
});

export default Contacts;
