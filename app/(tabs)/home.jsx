import React, { useEffect, useState, useContext, useCallback } from 'react';
import { 
  View, Text, Image, StyleSheet, TouchableOpacity, TextInput, 
  ActivityIndicator, Alert, Dimensions, KeyboardAvoidingView, Platform 
} from 'react-native';
import { AuthContext } from '../../context/AuthContext';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation } from '@react-navigation/native';
import axios from 'axios';

import CreateGroupScreen from "../(tabs)/CreateGroupScreen";
import AddContacts from "../(tabs)/AddContacts";
import ChatList from '../(tabs)/chat';
import ChatScreen from '../(tabs)/chatScreen';
import Contacts from '../(tabs)/contacts';
import Groups from '../(tabs)/groups';
import LogoutScreen from '../(auth)/logout';

const API_URL = "http://127.0.0.1:8000";
const Drawer = createDrawerNavigator();
const Tab = createMaterialTopTabNavigator();
const Stack = createStackNavigator();
const { width } = Dimensions.get('window');

// Chat Stack Navigator
const ChatStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="ChatList" component={ChatList} options={{ headerShown: false }} />
    <Stack.Screen name="ChatScreen" component={ChatScreen} options={{ title: 'Chat' }} />
  </Stack.Navigator>
);

// Top Tabs Navigator
function TopTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#ffffff',
        tabBarInactiveTintColor: '#b0bec5',
        tabBarStyle: { backgroundColor: '#1a73e8' },
        tabBarLabelStyle: { fontSize: width < 400 ? 12 : 14 },
        tabBarIndicatorStyle: { backgroundColor: '#ffffff' },
      }}
    >
      <Tab.Screen name="Contacts" component={Contacts} />
      <Tab.Screen name="Chat" component={ChatStack} />
      <Tab.Screen name="Group" component={Groups} />
    </Tab.Navigator>
  );
}

// Custom Drawer Content
function CustomDrawerContent(props) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [profileImage, setProfileImage] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { logout, user } = useContext(AuthContext);
  const navigation = useNavigation();

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const response = await axios.get(`${API_URL}/profile/`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      
      const profileData = response.data;
      setUsername(profileData.user.username);
      setEmail(profileData.user.email);
      setBio(profileData.bio || "");
      setProfileImage(profileData.profile_picture 
        ? `${API_URL}${profileData.profile_picture}?t=${Date.now()}`
        : 'https://via.placeholder.com/90');
    } catch (error) {
      if (error.response?.status === 404) {
        setUsername(user?.username || "Your Name");
        setEmail(user?.email || "yourname@example.com");
        setBio("");
        setProfileImage('https://via.placeholder.com/90');
      } else {
        console.error("Error fetching profile:", error);
        setError("Failed to load profile. Please check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();
    const interval = setInterval(fetchProfile, 300000);
    return () => clearInterval(interval);
  }, [fetchProfile]);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          "Permission Required",
          "We need permission to access your photos to update your profile picture",
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

      await axios.post(`${API_URL}/profile/`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 10000,
      });

      Alert.alert(
        "Success",
        "Profile updated successfully",
        [{ text: "OK", onPress: () => setIsEditing(false) }]
      );
      fetchProfile();
    } catch (error) {
      console.error("Update profile error:", error);
      const message = error.response?.data?.detail || "Failed to update profile. Please try again.";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  };


  if (loading && !username) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1a73e8" />
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
              if (isEditing) {
                pickImage();
              } else {
                setIsEditing(true);
                fetchProfile();
              }
            }}
            style={styles.imageContainer}
          >
            <Image 
              source={{ uri: profileImage }} 
              style={styles.profileImage}
              resizeMode="cover"
            />
            {!isEditing && (
              <View style={styles.editOverlay}>
                <MaterialCommunityIcons name="pencil" size={24} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
          
          <Text style={styles.profileName}>
            {isEditing ? "Edit Profile" : username}
          </Text>

          {isEditing ? (
            <>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="account" size={20} color="#666" />
                <TextInput 
                  style={styles.input} 
                  value={username} 
                  onChangeText={setUsername} 
                  placeholder="Username"
                  accessibilityLabel="Username Input"
                />
              </View>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="email" size={20} color="#666" />
                <TextInput 
                  style={styles.input} 
                  value={email} 
                  onChangeText={setEmail} 
                  placeholder="Email"
                  keyboardType="email-address"
                  editable={false}
                  accessibilityLabel="Email Input"
                />
              </View>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="text" size={20} color="#666" />
                <TextInput
                  style={[styles.input, styles.bioInput]}
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Tell us about yourself"
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
                accessibilityLabel="Save Changes Button"
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <View style={styles.buttonContent}>
                    <MaterialCommunityIcons name="content-save" size={20} color="#fff" />
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
                accessibilityLabel="Cancel Button"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.profileInfo}>
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="email" size={20} color="#555" />
                <Text style={styles.profileText}>{email}</Text>
              </View>
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="text" size={20} color="#555" />
                <Text style={styles.profileText}>{bio || "No bio yet"}</Text>
              </View>
            </View>
          )}
        </View>

        <DrawerItemList {...props} />
      </DrawerContentScrollView>
    </KeyboardAvoidingView>
  );
}

export default function Home() {
  return (
    <Drawer.Navigator 
      drawerContent={props => <CustomDrawerContent {...props} />}
      screenOptions={{
        drawerStyle: {
          width: width * 0.75,
        },
        drawerActiveTintColor: '#1a73e8',
        drawerInactiveTintColor: '#666',
        drawerLabelStyle: {
          fontSize: width < 400 ? 14 : 16,
          fontWeight: '500',
        },
      }}
    >
      <Drawer.Screen 
        name="Home" 
        component={TopTabs} 
        options={{
          drawerIcon: ({ color }) => (
            <MaterialCommunityIcons name="home" size={24} color={color} />
          ),
        }}
      />
      <Drawer.Screen 
        name="Add Contacts" 
        component={AddContacts} 
        options={{
          drawerIcon: ({ color }) => (
            <MaterialCommunityIcons name="account-plus" size={24} color={color} />
          ),
        }}
      />
      <Drawer.Screen 
        name="Create New Group" 
        component={CreateGroupScreen} 
        options={{
          drawerIcon: ({ color }) => (
            <MaterialCommunityIcons name="account-group" size={24} color={color} />
          ),
        }}
      />
      <Drawer.Screen 
        name="Logout" 
        component={LogoutScreen} 
        options={{
          drawerIcon: ({ color }) => (
            <MaterialCommunityIcons name="logout" size={24} color="red" />
          ),
          drawerLabel: ({ color }) => (
            <Text style={{ color: 'red', fontSize: width < 400 ? 14 : 16, fontWeight: '500' }}>
              Logout
            </Text>
          ),
        }}
      />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  flexContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
    fontSize: 16,
  },
  profileContainer: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  imageContainer: {
    position: 'relative',
  },
  profileImage: {
    width: width < 400 ? 80 : 90,
    height: width < 400 ? 80 : 90,
    borderRadius: width < 400 ? 40 : 45,
    borderWidth: 2,
    borderColor: '#1a73e8',
  },
  editOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 6,
  },
  profileName: {
    marginTop: 12,
    fontSize: width < 400 ? 18 : 20,
    fontWeight: 'bold',
    color: '#333',
  },
  profileInfo: {
    alignItems: 'flex-start',
    marginTop: 15,
    width: '100%',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
    width: '100%',
  },
  profileText: {
    fontSize: width < 400 ? 14 : 16,
    color: '#555',
    marginLeft: 10,
    flex: 1,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 12,
  },
  input: {
    flex: 1,
    height: 45,
    borderColor: '#1a73e8',
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f9f9f9',
    fontSize: width < 400 ? 14 : 16,
    color: '#333',
    marginLeft: 10,
  },
  bioInput: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  updateButton: {
    marginTop: 20,
    backgroundColor: '#1a73e8',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#99ccff',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  updateButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: width < 400 ? 14 : 16,
    marginLeft: 8,
  },
  cancelButton: {
    marginTop: 10,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: width < 400 ? 14 : 16,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    marginTop: 20,
    backgroundColor: '#ffe6e6',
    borderRadius: 10,
    marginHorizontal: 10,
  },
  logoutText: {
    marginLeft: 10,
    fontSize: width < 400 ? 14 : 16,
    color: 'red',
    fontWeight: 'bold',
  },
  errorText: {
    color: 'red',
    fontSize: width < 400 ? 12 : 14,
    marginTop: 8,
    textAlign: 'center',
    width: '100%',
  },
});