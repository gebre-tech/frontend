// src/screens/FriendProfile.jsx
import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute } from '@react-navigation/native';

const API_URL = "http://127.0.0.1:8000";

const FriendProfile = () => {
  const route = useRoute();
  const { username } = route.params;
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        const response = await axios.get(`${API_URL}/profiles/friend/${username}/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setProfile(response.data);
      } catch (error) {
        console.error('Error fetching friend profile:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [username]);

  if (loading) {
    return <ActivityIndicator size="large" color="#007bff" />;
  }

  return (
    <View style={styles.container}>
      <Image
        source={{ uri: profile?.profile_picture || 'https://via.placeholder.com/150' }}
        style={styles.profileImage}
      />
      <Text style={styles.username}>{profile?.user.username}</Text>
      <Text style={styles.email}>{profile?.user.email}</Text>
      <Text style={styles.bio}>{profile?.bio || 'No bio available'}</Text>
      <Text style={styles.lastSeen}>
        Last seen: {profile?.last_seen ? new Date(profile.last_seen).toLocaleString() : 'Unknown'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  profileImage: {
    width: 150,
    height: 150,
    borderRadius: 75,
    marginBottom: 20,
  },
  username: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  email: {
    fontSize: 16,
    color: '#666',
    marginTop: 5,
  },
  bio: {
    fontSize: 14,
    color: '#333',
    marginTop: 10,
    textAlign: 'center',
  },
  lastSeen: {
    fontSize: 12,
    color: '#666',
    marginTop: 10,
  },
});

export default FriendProfile;