import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import axios from 'axios';
import { AuthContext } from '../../context/AuthContext';
import { useNavigation } from '@react-navigation/native';

const AddContacts = () => {
  const { user } = useContext(AuthContext);
  const navigation = useNavigation();
  const [friendUsername, setFriendUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAddFriend = async () => {
    if (!friendUsername.trim()) {
      Alert.alert('Error', 'Please enter a valid username');
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post(
        'http://127.0.0.1:8000/contacts/add/',
        { username: friendUsername },
        {
          headers: {
            Authorization: `Bearer ${user.token}`, // Add the token
            'Content-Type': 'application/json', // Specify the content type
          },
        }
      );
      if (response.status === 201) {
        Alert.alert('Success', 'Friend added successfully');
        setFriendUsername('');
        navigation.navigate('Contacts'); 
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || 'Could not add friend';
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Add Contact</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter Friend's Username"
        value={friendUsername}
        onChangeText={setFriendUsername}
        autoCapitalize="none"
      />
      <TouchableOpacity style={styles.button} onPress={handleAddFriend} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Add Friend</Text>}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    padding: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    marginBottom: 20,
    borderRadius: 5,
  },
  button: {
    backgroundColor: '#007bff',
    padding: 10,
    borderRadius: 5,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default AddContacts;
