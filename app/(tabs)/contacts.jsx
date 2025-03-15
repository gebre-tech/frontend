import React, { useState, useEffect, useContext, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AuthContext } from '../../context/AuthContext'
import { Ionicons } from '@expo/vector-icons';
import debounce from 'lodash.debounce';
import PropTypes from 'prop-types';

const Contacts = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useContext(AuthContext);

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        Alert.alert('Error', 'Please log in again', [
          { text: 'OK', onPress: () => navigation.navigate('Login') },
        ]);
        return;
      }

      const response = await axios.get('http://127.0.0.1:8000/contacts/list/', {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log('Fetch contacts response:', response.data);
      setContacts(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching contacts:', error.message, error.response);
      if (error.response?.status === 401) {
        Alert.alert('Error', 'Session expired. Please log in again.', [
          { text: 'OK', onPress: () => navigation.navigate('Login') },
        ]);
      } else {
        Alert.alert('Error', error.message || 'Could not fetch contacts');
      }
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  const searchContacts = useCallback(
    debounce(async (query) => {
      if (!query) {
        fetchContacts();
        return;
      }
      try {
        setLoading(true);
        const token = await AsyncStorage.getItem('token');
        if (!token) {
          Alert.alert('Error', 'Please log in again', [
            { text: 'OK', onPress: () => navigation.navigate('Login') },
          ]);
          return;
        }

        const response = await axios.get('http://127.0.0.1:8000/contacts/search/', {
          headers: { Authorization: `Bearer ${token}` },
          params: { query },
        });
        console.log('Search contacts response:', response.data);
        setContacts(response.data.results || response.data);
      } catch (error) {
        console.error('Error searching contacts:', error.message, error.response);
        if (error.response?.status === 401) {
          Alert.alert('Error', 'Session expired. Please log in again.', [
            { text: 'OK', onPress: () => navigation.navigate('Login') },
          ]);
        } else {
          Alert.alert('Error', 'Failed to search contacts');
        }
      } finally {
        setLoading(false);
      }
    }, 300),
    [fetchContacts, navigation]
  );

  useEffect(() => {
    console.log('Initial fetch or route params:', route.params);
    fetchContacts();
  }, [fetchContacts]);

  // Enhanced refresh handling
  useEffect(() => {
    if (route.params?.refresh) {
      console.log('Refreshing contacts due to route params:', route.params);
      fetchContacts();
      // Reset refresh param to avoid infinite loop
      navigation.setParams({ refresh: false });
    }
  }, [route.params?.refresh, fetchContacts, navigation]);

  useEffect(() => {
    searchContacts(searchText);
  }, [searchText, searchContacts]);

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() =>
        navigation.navigate('Chat', {
          chatId: item.friend_id,
          friendUsername: item.friend.username,
        })
      }
    >
      <Ionicons name="person-circle-outline" size={40} color="#333" />
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{item.friend.username}</Text>
        <Text style={styles.contactStatus}>Online</Text>
      </View>
      <Ionicons name="chatbubble-outline" size={24} color="#007bff" />
    </TouchableOpacity>
  );

  const ListEmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.noContactsText}>
        {searchText ? 'No contacts found' : 'No contacts available'}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: "gray",
          borderRadius: 5,
          paddingHorizontal: 8,
          paddingVertical: 4,
        }}
      >
        <Ionicons name="search" size={24} color="gray" />
        <TextInput
          style={{
            flex: 1,
            marginLeft: 8,
            fontSize: 16,
          }}
          placeholder="Search contacts..."
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
        />
      </View>

      {loading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#007bff" />
        </View>
      ) : (
        <FlatList
          data={contacts}
          renderItem={renderItem}
          keyExtractor={(item) => item.friend_id.toString()}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
};

Contacts.propTypes = {
  navigation: PropTypes.object,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  addButton: {
    backgroundColor: '#007bff',
    padding: 8,
    borderRadius: 8,
  },
  searchInput: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    fontSize: 16,
    marginBottom: 20,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  contactInfo: {
    flex: 1,
    marginLeft: 15,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  contactStatus: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noContactsText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    flexGrow: 1,
  },
});

export default Contacts;