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
import * as FileSystem from 'expo-file-system';
import { useNavigation } from '@react-navigation/native';
import axios from 'axios';
import { AuthContext } from '../../context/AuthContext';
import { Dimensions } from 'react-native';
import debounce from 'lodash/debounce';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, API_HOST, PLACEHOLDER_IMAGE, DEFAULT_AVATAR_ICON } from '../utils/constants';

const WS_URL = `ws://${API_HOST}/ws/profile/`;
const { width } = Dimensions.get('window');

const COLORS = {
  primary: '#1e88e5', // Telegram-like blue
  secondary: '#6b7280', // Softer gray for secondary text
  background: '#ffffff', // Solid white for visibility
  cardBackground: '#f9fafb', // Light gray for cards
  white: '#ffffff',
  error: '#ef4444',
  disabled: '#d1d5db',
  border: '#e5e7eb',
  text: '#111827', // Dark text for contrast
  accent: '#f472b6',
  shadow: 'rgba(0, 0, 0, 0.05)',
  green: '#078930',
  yellow: '#FCDD09',
  red: '#DA121A',
};

const CustomAlert = ({ visible, title, message, onClose }) => {
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [fadeAnim]);

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
  const [profileImage, setProfileImage] = useState(PLACEHOLDER_IMAGE);
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
      setUsername(profileData.user.username);
      setFirstName(profileData.user.first_name || "");
      setLastName(profileData.user.last_name || "");
      setBio(profileData.bio || "");
      setLastSeen(profileData.last_seen);
      const newProfileImage = profileData.profile_picture
        ? `${profileData.profile_picture}?t=${Date.now()}`
        : PLACEHOLDER_IMAGE;
      setProfileImage(newProfileImage);
    } catch (error) {
      if (error.response?.status === 404) {
        setUsername(user?.username || "Your Name");
        setFirstName(user?.first_name || "");
        setLastName(user?.last_name || "");
        setBio("");
        setLastSeen(null);
        setProfileImage(PLACEHOLDER_IMAGE);
      } else {
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
        if (data.type === 'last_seen_update') {
          setLastSeen(data.last_seen);
        } else if (data.type === 'profile_update') {
          setUsername(data.username);
          setFirstName(data.first_name);
          setLastName(data.last_name);
          setBio(data.bio);
          const newProfileImage = data.profile_picture
            ? `${data.profile_picture}?t=${Date.now()}`
            : PLACEHOLDER_IMAGE;
          setProfileImage(newProfileImage);
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

    Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();

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
      if (!token) throw new Error('No authentication token found');

      const formData = new FormData();
      formData.append('username', username);
      formData.append('first_name', firstName);
      formData.append('last_name', lastName);
      formData.append('bio', bio || '');

      if (profileImage && !profileImage.startsWith('http')) {
        try {
          if (Platform.OS !== 'web') {
            const fileInfo = await FileSystem.getInfoAsync(profileImage);
            if (!fileInfo.exists) {
              throw new Error('Image file does not exist');
            }

            const fileName = 'profile.jpg';
            const mimeType = 'image/jpeg';

            formData.append('profile_picture', {
              uri: profileImage,
              name: fileName,
              type: mimeType,
            });
          } else {
            const response = await fetch(profileImage);
            const blob = await response.blob();
            formData.append('profile_picture', blob, 'profile.jpg');
          }
        } catch (fileError) {
          console.error('Error processing profile image:', fileError);
          throw new Error('Failed to process profile image');
        }
      }

      console.log('FormData prepared:', formData);

      const uploadResponse = await axios.post(`${API_URL}/profiles/profile/`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 10000,
      });

      const updatedProfile = uploadResponse.data;
      const newProfileImage = updatedProfile.profile_picture
        ? `${updatedProfile.profile_picture}?t=${Date.now()}`
        : PLACEHOLDER_IMAGE;
      setProfileImage(newProfileImage);
      setUsername(updatedProfile.user.username);
      setFirstName(updatedProfile.user.first_name);
      setLastName(updatedProfile.user.last_name);
      setBio(updatedProfile.bio || '');
      setLastSeen(updatedProfile.last_seen);

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
      console.error('Update profile error:', error, error.response?.data);
      setAlert({
        visible: true,
        title: "Error",
        message: `Failed to update profile: ${error.response?.data?.error || error.message}`,
      });
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
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <DrawerContentScrollView {...props} contentContainerStyle={styles.scrollContent}>
          <Animated.View style={[styles.profileSection, { opacity: fadeAnim }]}>
            {/* Profile Picture */}
            <TouchableOpacity
              onPress={() => (isEditing ? pickImage() : setIsEditing(true))}
              style={styles.avatarContainer}
              activeOpacity={0.8}
            >
              <Image
                source={{ uri: profileImage }}
                style={styles.avatar}
                resizeMode="cover"
                onError={(e) => console.error('Image load error:', e.nativeEvent.error)}
              />
              {isEditing && (
                <View style={styles.avatarEditIcon}>
                  <MaterialCommunityIcons name="camera" size={24} color={COLORS.white} />
                </View>
              )}
            </TouchableOpacity>

            {/* Profile Header */}
            <View style={styles.header}>
              <Text style={styles.name}>
                {isEditing ? 'Edit Profile' : `${firstName} ${lastName}`}
              </Text>
              {!isEditing && (
                <Text style={styles.username}>@{username}</Text>
              )}
            </View>

            {/* Edit or View Mode */}
            {isEditing ? (
              <View style={styles.editSection}>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={username}
                    onChangeText={setUsername}
                    placeholder="Username"
                    placeholderTextColor={COLORS.secondary}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First Name"
                    placeholderTextColor={COLORS.secondary}
                  />
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last Name"
                    placeholderTextColor={COLORS.secondary}
                  />
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, styles.bioInput]}
                    value={bio}
                    onChangeText={setBio}
                    placeholder="Bio"
                    placeholderTextColor={COLORS.secondary}
                    multiline
                    maxLength={200}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.saveButton, loading && styles.buttonDisabled]}
                  onPress={updateProfile}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator color={COLORS.white} />
                  ) : (
                    <Text style={styles.saveButtonText}>Save</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    setIsEditing(false);
                    debouncedFetchProfile();
                  }}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.infoSection}>
                {bio ? (
                  <View style={styles.infoItem}>
                    <MaterialCommunityIcons name="text" size={20} color={COLORS.secondary} />
                    <Text style={styles.infoText}>{bio}</Text>
                  </View>
                ) : null}
                {lastSeen && (
                  <View style={styles.infoItem}>
                    <MaterialCommunityIcons name="clock-outline" size={20} color={COLORS.secondary} />
                    <Text style={styles.infoText}>
                      Last seen: {new Date(lastSeen).toLocaleTimeString()}
                    </Text>
                  </View>
                )}
                <TouchableOpacity style={styles.editButton} onPress={() => setIsEditing(true)}>
                  <Text style={styles.editButtonText}>Edit Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.refreshButton} onPress={refreshProfile}>
                  <MaterialCommunityIcons name="refresh" size={24} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>

          {/* Navigation Items */}
          <View style={styles.navigationSection}>
            <DrawerItemList {...props} />
          </View>
        </DrawerContentScrollView>

        <CustomAlert
          visible={alert.visible}
          title={alert.title}
          message={alert.message}
          onClose={
            alert.onClose
              ? () => {
                  setAlert({ ...alert, visible: false });
                  alert.onClose();
                }
              : () => setAlert({ ...alert, visible: false })
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '500',
  },
  profileSection: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.cardBackground,
  },
  avatarEditIcon: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: 8,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.5,
  },
  username: {
    fontSize: 16,
    color: COLORS.secondary,
    marginTop: 4,
  },
  editSection: {
    marginTop: 8,
  },
  inputWrapper: {
    marginBottom: 12,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.cardBackground,
  },
  bioInput: {
    height: 100,
    textAlignVertical: 'top',
    paddingVertical: 12,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: {
    backgroundColor: COLORS.disabled,
  },
  saveButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '500',
  },
  infoSection: {
    marginTop: 8,
    position: 'relative',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  infoText: {
    fontSize: 16,
    color: COLORS.text,
    marginLeft: 12,
    flex: 1,
  },
  editButton: {
    backgroundColor: COLORS.cardBackground,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  editButtonText: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  refreshButton: {
    position: 'absolute',
    top: 0,
    right: 8,
  },
  navigationSection: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.background,
  },
  alertOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  alertContainer: {
    backgroundColor: COLORS.white,
    padding: 20,
    borderRadius: 12,
    width: '80%',
    alignItems: 'center',
  },
  alertTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  alertMessage: {
    fontSize: 16,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  alertButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  alertButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});