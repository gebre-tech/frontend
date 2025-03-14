import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

const AddContacts = () => {
  const navigation = useNavigation();
  const [friendUsername, setFriendUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(''); // For success/error status display

  const resetForm = () => {
    setFriendUsername('');
    setError('');
    setStatus('');
  };

  const validateInput = (text) => {
    setFriendUsername(text);
    setStatus('');
    if (!text.trim()) {
      setError('Username cannot be empty');
    } else if (text.length < 3) {
      setError('Username must be at least 3 characters');
    } else {
      setError('');
    }
  };

  const confirmAddFriend = () => {
    if (!friendUsername.trim() || error) {
      Alert.alert('Error', error || 'Please enter a valid username');
      return;
    }

    Alert.alert(
      'Confirm',
      `Are you sure you want to add ${friendUsername} as a friend?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes', onPress: handleAddFriend },
      ]
    );
  };

  const handleAddFriend = async () => {
    setLoading(true);
    setStatus('');
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found. Please log in again.');
      }

      console.log('Sending request with:', { username: friendUsername, token });
      const response = await axios.post(
        'http://127.0.0.1:8000/contacts/add/',
        { username: friendUsername },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status === 201) {
        const friendData = response.data.friend; // Extract friend details from response
        setStatus(`Successfully added ${friendData.username} as a friend!`);
        Alert.alert(
          'Success',
          `${friendData.username} has been added to your contacts!`,
          [
            {
              text: 'OK',
              onPress: () => {
                resetForm();
                navigation.navigate('Contacts');
              },
            },
            {
              text: 'Add Another',
              onPress: resetForm,
              style: 'cancel',
            },
          ]
        );
      }
    } catch (error) {
      console.log('Error response:', error.response?.data);
      const errorData = error.response?.data;
      let errorMessage = 'Could not add friend. Please try again.';
      let alertButtons = [{ text: 'OK' }];

      if (error.response) {
        switch (error.response.status) {
          case 400:
            if (errorData?.error === 'Username is required') {
              errorMessage = 'Please provide a username.';
            } else if (errorData?.error === 'You cannot add yourself as a friend') {
              errorMessage = 'You cannot add yourself as a contact.';
            } else if (errorData?.error === 'Already friends') {
              errorMessage = `${friendUsername} is already in your contacts.`;
              alertButtons.push({
                text: 'View Contacts',
                onPress: () => navigation.navigate('Contacts'),
              });
            }
            break;
          case 404:
            errorMessage = `User "${friendUsername}" was not found.`;
            break;
          case 401:
            errorMessage = 'Session expired. Please log in again.';
            alertButtons.push({
              text: 'Log In',
              onPress: () => navigation.navigate('Login'),
            });
            break;
          default:
            errorMessage = errorData?.error || errorMessage;
        }
      } else {
        errorMessage = error.message; // Network or client-side error
      }

      setStatus('');
      Alert.alert('Error', errorMessage, alertButtons);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={styles.outerContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={80}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Add a New Contact</Text>

        <View style={styles.inputContainer}>
          <Ionicons name="person-add-outline" size={24} color="#666" style={styles.inputIcon} />
          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            placeholder="Enter Friend's Username"
            value={friendUsername}
            onChangeText={validateInput}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            editable={!loading}
          />
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {status ? <Text style={styles.statusText}>{status}</Text> : null}

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={handleCancel}
            disabled={loading}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, loading || error ? styles.buttonDisabled : null]}
            onPress={confirmAddFriend}
            disabled={loading || !!error}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Add Friend</Text>
            )}
          </TouchableOpacity>
        </View>

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#007bff" />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 30,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    backgroundColor: '#fff',
    fontSize: 16,
  },
  inputError: {
    borderColor: '#ff4d4d',
  },
  errorText: {
    color: '#ff4d4d',
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  statusText: {
    color: '#28a745',
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  button: {
    flex: 1,
    backgroundColor: '#007bff',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  cancelButton: {
    backgroundColor: '#ccc',
  },
  buttonDisabled: {
    backgroundColor: '#99ccff',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AddContacts;