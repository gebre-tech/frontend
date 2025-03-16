// src/navigation/CustomDrawerContent.jsx
import React, { useEffect, useState, useContext, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import { DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation } from '@react-navigation/native';
import axios from 'axios';
import { AuthContext } from '../../context/AuthContext';
import { Dimensions } from 'react-native';

const API_URL = "http://127.0.0.1:8000";
const WS_URL = "ws://127.0.0.1:8000/ws/profile/";
const { width } = Dimensions.get('window');

const COLORS = {
  primary: '#1a73e8',
  secondary: '#666',
  background: '#f5f6fa',
  white: '#ffffff',
  error: '#ff4444',
  disabled: '#99ccff',
  border: '#ddd',
  text: '#333',
};

export default function CustomDrawerContent(props) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [profileImage, setProfileImage] = useState(null);
  const [lastSeen, setLastSeen] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ws, setWs] = useState(null);
  const { logout, user } = useContext(AuthContext);
  const navigation = useNavigation();

  // Fetch profile data
  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const response = await axios.get(`${API_URL}/profiles/profile/`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      
      const profileData = response.data;
      setUsername(profileData.user.username);
      setEmail(profileData.user.email);
      setBio(profileData.bio || "");
      setLastSeen(profileData.last_seen);
      setProfileImage(profileData.profile_picture 
        ? `${API_URL}${profileData.profile_picture}?t=${Date.now()}`
        : 'https://via.placeholder.com/90');
    } catch (error) {
      if (error.response?.status === 404) {
        setUsername(user?.username || "Your Name");
        setEmail(user?.email || "yourname@example.com");
        setBio("");
        setLastSeen(null);
        setProfileImage('https://via.placeholder.com/90');
      } else {
        console.error("Error fetching profile:", error);
        setError("Failed to load profile. Please check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Setup WebSocket connection using native WebSocket
  const setupWebSocket = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;

      const websocket = new WebSocket(`${WS_URL}?token=${token}`);
      
      websocket.onopen = () => {
        console.log('WebSocket connected');
      };

      websocket.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'last_seen_update') {
          setLastSeen(data.last_seen);
        }
      };

      websocket.onerror = (e) => {
        console.error('WebSocket error:', e);
      };

      websocket.onclose = () => {
        console.log('WebSocket disconnected');
      };

      setWs(websocket);
      return () => websocket.close();
    } catch (error) {
      console.error('WebSocket setup error:', error);
    }
  }, []);

  // Update last seen periodically
  const updateLastSeen = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.post(
        `${API_URL}/profiles/last_seen/`,
        { last_seen: new Date().toISOString() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error('Error updating last seen:', error);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    setupWebSocket();
    
    // Update last seen every 5 minutes
    const lastSeenInterval = setInterval(updateLastSeen, 300000);
    const fetchInterval = setInterval(fetchProfile, 300000);

    return () => {
      clearInterval(lastSeenInterval);
      clearInterval(fetchInterval);
      if (ws) ws.close();
    };
  }, [fetchProfile, setupWebSocket, updateLastSeen]);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          "Permission Required",
          "We need permission to access your photos",
          [{ text: "OK" }]
        );
        return;
      }

      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (!result.canceled) {
        const manipulatedImage = await ImageManipulator.manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 300, height: 300 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
        );
        setProfileImage(manipulatedImage.uri);
      }
    } catch (error) {
      Alert.alert("Error", "Failed to pick image. Please try again.");
    }
  };

  const updateProfile = async () => {
    if (!username.trim()) {
      setError("Username is required");
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setError('');
    setLoading(true);

    try {
      const token = await AsyncStorage.getItem('token');
      const formData = new FormData();
      formData.append('bio', bio || '');

      if (profileImage && !profileImage.startsWith('http')) {
        formData.append('profile_picture', {
          uri: profileImage,
          type: 'image/jpeg',
          name: 'profile.jpg',
        });
      }

      const response = await axios.post(
        `${API_URL}/profiles/profile/`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
          timeout: 10000,
        }
      );

      Alert.alert(
        "Success",
        "Profile updated successfully",
        [{ text: "OK", onPress: () => setIsEditing(false) }]
      );
      fetchProfile();
    } catch (error) {
      console.error("Update profile error:", error);
      const message = error.response?.data?.error || "Failed to update profile.";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !username) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.flexContainer}
    >
      <DrawerContentScrollView {...props}>
        <View style={styles.profileContainer}>
          <TouchableOpacity 
            onPress={() => {
              if (isEditing) pickImage();
              else {
                setIsEditing(true);
                fetchProfile();
              }
            }}
            style={styles.imageContainer}
            activeOpacity={0.8}
          >
            <Image 
              source={{ uri: profileImage }} 
              style={styles.profileImage}
              resizeMode="cover"
            />
            {!isEditing && (
              <View style={styles.editOverlay}>
                <MaterialCommunityIcons name="pencil" size={20} color={COLORS.white} />
              </View>
            )}
          </TouchableOpacity>
          
          <Text style={styles.profileName}>
            {isEditing ? "Edit Profile" : username}
          </Text>

          {isEditing ? (
            <>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="account" size={20} color={COLORS.secondary} />
                <TextInput 
                  style={styles.input}
                  value={username}
                  onChangeText={setUsername}
                  placeholder="Username"
                  placeholderTextColor={COLORS.secondary}
                  accessibilityLabel="Username Input"
                />
              </View>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="email" size={20} color={COLORS.secondary} />
                <TextInput 
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor={COLORS.secondary}
                  keyboardType="email-address"
                  editable={false}
                  accessibilityLabel="Email Input"
                />
              </View>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="text" size={20} color={COLORS.secondary} />
                <TextInput
                  style={[styles.input, styles.bioInput]}
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Tell us about yourself"
                  placeholderTextColor={COLORS.secondary}
                  multiline
                  maxLength={200}
                  accessibilityLabel="Bio Input"
                />
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <TouchableOpacity 
                style={[styles.updateButton, loading && styles.buttonDisabled]}
                onPress={updateProfile}
                disabled={loading}
                activeOpacity={0.8}
                accessibilityLabel="Save Changes Button"
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <View style={styles.buttonContent}>
                    <MaterialCommunityIcons name="content-save" size={20} color={COLORS.white} />
                    <Text style={styles.updateButtonText}>Save Changes</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={() => {
                  setIsEditing(false);
                  fetchProfile();
                }}
                disabled={loading}
                activeOpacity={0.8}
                accessibilityLabel="Cancel Button"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.profileInfo}>
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="email" size={20} color={COLORS.secondary} />
                <Text style={styles.profileText}>{email}</Text>
              </View>
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="text" size={20} color={COLORS.secondary} />
                <Text style={styles.profileText}>{bio || "No bio yet"}</Text>
              </View>
              {lastSeen && (
                <View style={styles.infoRow}>
                  <MaterialCommunityIcons name="clock" size={20} color={COLORS.secondary} />
                  <Text style={styles.profileText}>
                    Last seen: {new Date(lastSeen).toLocaleString()}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
        <DrawerItemList {...props} />
      </DrawerContentScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flexContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.secondary,
    fontSize: width < 400 ? 14 : 16,
    fontWeight: '500',
  },
  profileContainer: {
    padding: 20,
    paddingTop: 40,
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  imageContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  profileImage: {
    width: width < 400 ? 80 : 90,
    height: width < 400 ? 80 : 90,
    borderRadius: width < 400 ? 40 : 45,
    borderWidth: 3,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
  },
  editOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 6,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  profileName: {
    fontSize: width < 400 ? 20 : 22,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  profileInfo: {
    width: '100%',
    paddingHorizontal: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    paddingVertical: 4,
  },
  profileText: {
    fontSize: width < 400 ? 14 : 16,
    color: COLORS.text,
    marginLeft: 12,
    flex: 1,
    lineHeight: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 12,
    paddingHorizontal: 10,
  },
  input: {
    flex: 1,
    height: 48,
    borderColor: COLORS.primary,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: COLORS.white,
    fontSize: width < 400 ? 14 : 16,
    color: COLORS.text,
    marginLeft: 10,
    elevation: 1,
  },
  bioInput: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  updateButton: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  buttonDisabled: {
    backgroundColor: COLORS.disabled,
    elevation: 0,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateButtonText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: width < 400 ? 14 : 16,
    marginLeft: 8,
    letterSpacing: 0.5,
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelButtonText: {
    color: COLORS.secondary,
    fontSize: width < 400 ? 14 : 16,
    fontWeight: '500',
  },
  errorText: {
    color: COLORS.error,
    fontSize: width < 400 ? 12 : 14,
    marginTop: 8,
    textAlign: 'center',
    width: '100%',
    fontWeight: '500',
  },
});