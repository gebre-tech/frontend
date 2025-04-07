// app/tabs/CustomDrawerContent.jsx
import React, { useEffect, useState, useContext, useCallback, useRef } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Modal, KeyboardAvoidingView, Platform, Animated
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
import debounce from 'lodash/debounce';

const API_URL = "http://127.0.0.1:8000";
const WS_URL = "ws://127.0.0.1:8000/ws/profile/";
const { width } = Dimensions.get('window');

const COLORS = {
  primary: '#1e88e5',
  secondary: '#757575',
  background: '#fafafa',
  white: '#ffffff',
  error: '#f44336',
  disabled: '#b0bec5',
  border: '#e0e0e0',
  text: '#212121',
  accent: '#ff4081',
  shadow: 'rgba(0, 0, 0, 0.2)',
};

const CustomAlert = ({ visible, title, message, onClose }) => {
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 300 : 200,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none">
      <View style={styles.alertOverlay}>
        <Animated.View style={[styles.alertContainer, { opacity: fadeAnim }]}>
          <Text style={styles.alertTitle}>{title}</Text>
          <Text style={styles.alertMessage}>{message}</Text>
          <TouchableOpacity style={styles.alertButton} onPress={onClose}>
            <Text style={styles.alertButtonText}>OK</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

export default function CustomDrawerContent(props) {
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [profileImage, setProfileImage] = useState('https://via.placeholder.com/100');
  const [lastSeen, setLastSeen] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: "", message: "" });
  const { logout, user } = useContext(AuthContext);
  const navigation = useNavigation();
  const fadeAnim = useState(new Animated.Value(0))[0];
  const wsRef = useRef(null);

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
      console.log("Raw profile data from backend:", profileData);  // Log raw response
      setUsername(profileData.user.username);
      setFirstName(profileData.user.first_name || "");
      setLastName(profileData.user.last_name || "");
      setBio(profileData.bio || "");
      setLastSeen(profileData.last_seen);
      const newProfileImage = profileData.profile_picture 
        ? `${profileData.profile_picture}?t=${Date.now()}` 
        : 'https://via.placeholder.com/100';
      setProfileImage(newProfileImage);
      console.log("Profile image set to (fetch):", newProfileImage);
    } catch (error) {
      if (error.response?.status === 404) {
        setUsername(user?.username || "Your Name");
        setFirstName(user?.first_name || "");
        setLastName(user?.last_name || "");
        setBio("");
        setLastSeen(null);
        setProfileImage('https://via.placeholder.com/100');
      } else {
        console.error("Error fetching profile:", error);
        setAlert({ visible: true, title: "Error", message: "Failed to load profile." });
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  const debouncedFetchProfile = useCallback(debounce(fetchProfile, 1000), [fetchProfile]);

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const connectWebSocket = () => {
      const ws = new WebSocket(`${WS_URL}?token=${token}`);

      ws.onopen = () => console.log('Profile WebSocket connected');
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        console.log("WebSocket message received:", data);
        if (data.type === 'last_seen_update') {
          setLastSeen(data.last_seen);
        } else if (data.type === 'profile_update') {
          setUsername(data.username);
          setFirstName(data.first_name);
          setLastName(data.last_name);
          setBio(data.bio);
          const newProfileImage = data.profile_picture 
            ? `${data.profile_picture}?t=${Date.now()}` 
            : 'https://via.placeholder.com/100';
          setProfileImage(newProfileImage);
          console.log("Profile image set to (WebSocket):", newProfileImage);
        }
      };
      ws.onerror = (e) => console.error('Profile WebSocket error:', e);
      ws.onclose = () => {
        console.log('Profile WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 2000);
      };

      wsRef.current = ws;
    };

    connectWebSocket();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const updateLastSeen = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'update_last_seen' }));
    }
  }, []);

  const debouncedUpdateLastSeen = useCallback(debounce(updateLastSeen, 5000), [updateLastSeen]);

  useEffect(() => {
    fetchProfile();
    setupWebSocket();

    const lastSeenInterval = setInterval(debouncedUpdateLastSeen, 300000);
    const fetchInterval = setInterval(debouncedFetchProfile, 300000);

    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();

    return () => {
      clearInterval(lastSeenInterval);
      clearInterval(fetchInterval);
      debouncedFetchProfile.cancel();
      debouncedUpdateLastSeen.cancel();
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchProfile, setupWebSocket, debouncedUpdateLastSeen, debouncedFetchProfile]);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setAlert({ visible: true, title: "Permission Denied", message: "We need permission to access your photos." });
        return;
      }

      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (!result.canceled) {
        const asset = result.assets[0];
        if (!['image/jpeg', 'image/png'].includes(asset.mimeType)) {
          setAlert({ visible: true, title: "Invalid Format", message: "Only JPEG and PNG images are supported." });
          return;
        }
        if (asset.fileSize > 5 * 1024 * 1024) {
          setAlert({ visible: true, title: "File Too Large", message: "Image must be under 5MB." });
          return;
        }

        const manipulatedImage = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 300, height: 300 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
        );
        setProfileImage(manipulatedImage.uri);
        console.log("Profile image set to (local pick):", manipulatedImage.uri);
      }
    } catch (error) {
      setAlert({ visible: true, title: "Error", message: "Failed to pick image." });
    }
  };

  const validateInputs = () => {
    if (!username || username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      setAlert({ visible: true, title: "Invalid Username", message: "Username must be 3+ characters (letters, numbers, underscores)." });
      return false;
    }
    if (!firstName || firstName.length < 2 || !/^[a-zA-Z]+$/.test(firstName)) {
      setAlert({ visible: true, title: "Invalid First Name", message: "First name must be 2+ letters only." });
      return false;
    }
    if (!lastName || lastName.length < 2 || !/^[a-zA-Z]+$/.test(lastName)) {
      setAlert({ visible: true, title: "Invalid Last Name", message: "Last name must be 2+ letters only." });
      return false;
    }
    return true;
  };

  const updateProfile = async () => {
    if (!validateInputs()) return;

    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const formData = new FormData();
      formData.append('username', username);
      formData.append('first_name', firstName);
      formData.append('last_name', lastName);
      formData.append('bio', bio || '');

      if (profileImage && !profileImage.startsWith('http')) {
        const response = await fetch(profileImage);
        const blob = await response.blob();
        formData.append('profile_picture', blob, 'profile.jpg');
      }

      const uploadResponse = await axios.post(`${API_URL}/profiles/profile/`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 10000,
      });

      const updatedProfile = uploadResponse.data;
      console.log("Raw updated profile data from backend:", updatedProfile);  // Log raw response
      const newProfileImage = updatedProfile.profile_picture 
        ? `${updatedProfile.profile_picture}?t=${Date.now()}` 
        : 'https://via.placeholder.com/100';
      setProfileImage(newProfileImage);
      setUsername(updatedProfile.user.username);
      setFirstName(updatedProfile.user.first_name);
      setLastName(updatedProfile.user.last_name);
      setBio(updatedProfile.bio || '');
      setLastSeen(updatedProfile.last_seen);
      console.log("Profile image set to (update):", newProfileImage);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'update_profile',
          username: updatedProfile.user.username,
          first_name: updatedProfile.user.first_name,
          last_name: updatedProfile.user.last_name,
          bio: updatedProfile.bio,
          profile_picture: updatedProfile.profile_picture,
        }));
      }

      setAlert({
        visible: true,
        title: "Success",
        message: "Profile updated successfully!",
        onClose: () => setIsEditing(false),
      });
    } catch (error) {
      console.error("Update profile error:", error);
      setAlert({ visible: true, title: "Error", message: "Failed to update profile: " + (error.response?.data?.error || error.message) });
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = () => {
    fetchProfile();
    setAlert({ visible: true, title: "Refreshed", message: "Profile data refreshed." });
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
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flexContainer}>
      <DrawerContentScrollView {...props}>
        <Animated.View style={[styles.profileContainer, { opacity: fadeAnim }]}>
          <TouchableOpacity
            onPress={() => (isEditing ? pickImage() : setIsEditing(true))}
            style={styles.imageContainer}
            activeOpacity={0.7}
          >
            <Image
              source={{ uri: profileImage }}
              style={styles.profileImage}
              resizeMode="cover"
              onError={(e) => console.error("Image load error:", e.nativeEvent.error)}
            />
            <View style={styles.editIcon}>
              <MaterialCommunityIcons name={isEditing ? "camera" : "pencil"} size={22} color={COLORS.white} />
            </View>
          </TouchableOpacity>

          <Text style={styles.profileName}>
            {isEditing ? "Edit Profile" : `${firstName} ${lastName}`}
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
                />
              </View>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="account-outline" size={20} color={COLORS.secondary} />
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First Name"
                  placeholderTextColor={COLORS.secondary}
                />
              </View>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="account-outline" size={20} color={COLORS.secondary} />
                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last Name"
                  placeholderTextColor={COLORS.secondary}
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
                />
              </View>
              <TouchableOpacity
                style={[styles.updateButton, loading && styles.buttonDisabled]}
                onPress={updateProfile}
                disabled={loading}
                activeOpacity={0.7}
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.updateButtonText}>Save Changes</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => { setIsEditing(false); debouncedFetchProfile(); }}
                disabled={loading}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.profileInfo}>
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="account" size={20} color={COLORS.secondary} />
                <Text style={styles.profileText}>@{username}</Text>
              </View>
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="text" size={20} color={COLORS.secondary} />
                <Text style={styles.profileText}>{bio || "No bio yet"}</Text>
              </View>
              {lastSeen && (
                <View style={styles.infoRow}>
                  <MaterialCommunityIcons name="clock-outline" size={20} color={COLORS.secondary} />
                  <Text style={styles.profileText}>
                    Last seen: {new Date(lastSeen).toLocaleTimeString()}
                  </Text>
                </View>
              )}
            </View>
          )}
          {!isEditing && (
            <TouchableOpacity style={styles.refreshButton} onPress={refreshProfile}>
              <MaterialCommunityIcons name="refresh" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </Animated.View>
        <DrawerItemList {...props} />
      </DrawerContentScrollView>
      <CustomAlert
        visible={alert.visible}
        title={alert.title}
        message={alert.message}
        onClose={alert.onClose 
          ? () => { setAlert({ ...alert, visible: false }); alert.onClose(); } 
          : () => setAlert({ ...alert, visible: false })}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flexContainer: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  loadingText: { marginTop: 12, color: COLORS.secondary, fontSize: 16, fontWeight: '500' },
  profileContainer: { 
    padding: 20, 
    paddingTop: 40, 
    alignItems: 'center', 
    backgroundColor: COLORS.white, 
    borderBottomWidth: 1, 
    borderBottomColor: COLORS.border, 
    position: 'relative',
  },
  imageContainer: { position: 'relative', marginBottom: 20 },
  profileImage: { 
    width: 110, 
    height: 110, 
    borderRadius: 55, 
    borderWidth: 3, 
    borderColor: COLORS.primary, 
    backgroundColor: COLORS.background,
  },
  editIcon: { 
    position: 'absolute', 
    bottom: 0, 
    right: 0, 
    backgroundColor: COLORS.primary, 
    borderRadius: 15, 
    padding: 8,
  },
  profileName: { 
    fontSize: 26, 
    fontWeight: '700', 
    color: COLORS.text, 
    marginBottom: 15, 
    letterSpacing: 0.5,
  },
  profileInfo: { width: '100%', paddingHorizontal: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 10, paddingVertical: 5 },
  profileText: { fontSize: 16, color: COLORS.text, marginLeft: 12, flex: 1, lineHeight: 22 },
  inputContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    width: '100%', 
    marginVertical: 12, 
    paddingHorizontal: 10 
  },
  input: { 
    flex: 1, 
    height: 50, 
    borderColor: COLORS.primary, 
    borderWidth: 1.5, 
    borderRadius: 12, 
    paddingHorizontal: 15, 
    backgroundColor: COLORS.white, 
    fontSize: 16, 
    color: COLORS.text, 
    marginLeft: 10,
  },
  bioInput: { 
    height: 120, 
    textAlignVertical: 'top', 
    paddingTop: 10 
  },
  updateButton: { 
    marginTop: 20, 
    backgroundColor: COLORS.primary, 
    paddingVertical: 14, 
    borderRadius: 12, 
    width: '100%', 
    alignItems: 'center',
  },
  buttonDisabled: { 
    backgroundColor: COLORS.disabled,
  },
  updateButtonText: { 
    color: COLORS.white, 
    fontWeight: '600', 
    fontSize: 16, 
    letterSpacing: 0.5 
  },
  cancelButton: { 
    marginTop: 10, 
    paddingVertical: 12, 
    width: '100%', 
    alignItems: 'center', 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: COLORS.border 
  },
  cancelButtonText: { 
    color: COLORS.secondary, 
    fontSize: 16, 
    fontWeight: '500' 
  },
  refreshButton: { 
    position: 'absolute', 
    top: 20, 
    right: 20 
  },
  alertOverlay: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: 'rgba(0,0,0,0.6)' 
  },
  alertContainer: { 
    backgroundColor: COLORS.white, 
    padding: 25, 
    borderRadius: 15, 
    width: '85%', 
    alignItems: 'center',
  },
  alertTitle: { 
    fontSize: 22, 
    fontWeight: '700', 
    color: COLORS.text, 
    marginBottom: 10 
  },
  alertMessage: { 
    fontSize: 16, 
    color: COLORS.secondary, 
    textAlign: 'center', 
    marginBottom: 20 
  },
  alertButton: { 
    backgroundColor: COLORS.primary, 
    paddingVertical: 10, 
    paddingHorizontal: 25, 
    borderRadius: 10 
  },
  alertButtonText: { 
    color: COLORS.white, 
    fontSize: 16, 
    fontWeight: '600' 
  },
});