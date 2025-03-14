import React, { useState, useEffect, useContext } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, StyleSheet, Alert } from 'react-native';
import axios from 'axios';
import AsyncStorage from "@react-native-async-storage/async-storage"; // ✅ Import AsyncStorage
import { useNavigation } from '@react-navigation/native';
import { AuthContext } from '../../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

const Contacts = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const navigation = useNavigation();
  const { user } = useContext(AuthContext);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const token = await AsyncStorage.getItem("token"); // ✅ Fetch token from AsyncStorage
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await axios.get(`http://127.0.0.1:8000/contacts/list/`, {
        headers: { Authorization: `Token ${token}` }, // Use fetched token
      });
      setContacts(response.data);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      Alert.alert('Error', error.message || 'Could not fetch contacts');
    } finally {
      setLoading(false);
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
      <Ionicons name="person-circle-outline" size={40} color="black" />
      <Text style={styles.contactName}>{item.friend.username}</Text>
      <Ionicons name="chatbubble-outline" size={24} color="#007bff" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search contacts..."
        value={searchText}
        onChangeText={setSearchText}
      />
      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" />
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
    flex: 1,
    marginLeft: 10,
  },
  noContactsText: { textAlign: 'center', marginTop: 20, fontSize: 16, color: 'gray' },
});

export default Contacts;