// src/screens/FriendProfile.jsx
import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';

const API_URL = "http://127.0.0.1:8000";

const FriendProfile = () => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation();
  const route = useRoute();
  const { username } = route.params;

  const fetchFriendProfile = async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${API_URL}/profiles/friend/${username}/`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      setProfile(response.data);
    } catch (error) {
      if (error.response?.status === 401) {
        Alert.alert('Error', 'Session expired. Please log in again.', [
          { text: 'OK', onPress: () => navigation.navigate('Login') },
        ]);
      } else {
        Alert.alert('Error', error.response?.data?.error || 'Failed to load profile');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFriendProfile();
  }, [username]);

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#007bff" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Profile not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Image
        source={{ uri: profile.profile_picture || 'https://via.placeholder.com/150' }}
        style={styles.profileImage}
        resizeMode="cover"
      />
      <Text style={styles.name}>{`${profile.user.first_name} ${profile.user.last_name}`}</Text>
      <Text style={styles.username}>@{profile.user.username}</Text>
      <Text style={styles.bio}>{profile.bio || 'No bio available'}</Text>
      {profile.last_seen && (
        <Text style={styles.lastSeen}>
          Last seen: {new Date(profile.last_seen).toLocaleString()}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', padding: 20, backgroundColor: '#f5f5f5' },
  loaderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileImage: { width: 150, height: 150, borderRadius: 75, marginBottom: 20, borderWidth: 2, borderColor: '#007bff' },
  name: { fontSize: 24, fontWeight: '700', color: '#333', marginBottom: 10 },
  username: { fontSize: 18, color: '#666', marginBottom: 10 },
  bio: { fontSize: 16, color: '#333', textAlign: 'center', marginBottom: 10 },
  lastSeen: { fontSize: 14, color: '#666' },
  errorText: { fontSize: 16, color: '#666', textAlign: 'center' },
});

export default FriendProfile;