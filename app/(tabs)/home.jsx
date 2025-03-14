import React, { useEffect, useState } from 'react';
import { 
  View, Text, Image, StyleSheet, TouchableOpacity, TextInput, 
  ActivityIndicator, Alert 
} from 'react-native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation } from '@react-navigation/native';

import CreateGroupScreen from "../(tabs)/CreateGroupScreen";
import AddContacts from "../(tabs)/AddContacts";
import ChatList from '../(tabs)/chat';
import ChatScreen from '../(tabs)/chatScreen';
import Contacts from '../(tabs)/contacts';
import Groups from '../(tabs)/groups';
import LogoutScreen from '../(auth)/logout';

const Drawer = createDrawerNavigator();
const Tab = createMaterialTopTabNavigator();
const Stack = createStackNavigator();

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
        tabBarLabelStyle: { fontSize: 14 },
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
  const navigation = useNavigation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileImage, setProfileImage] = useState('https://via.placeholder.com/90');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadUserData = async () => {
      try {
        const storedName = await AsyncStorage.getItem('name');
        const storedEmail = await AsyncStorage.getItem('email');
        const storedImage = await AsyncStorage.getItem('profileImage');

        setName(storedName || "Your Name");
        setEmail(storedEmail || "yourname@example.com");
        setProfileImage(storedImage || 'https://via.placeholder.com/90');
      } catch (error) {
        console.error("Error loading user data:", error);
      }
    };
    loadUserData();
  }, []);

  const pickImage = async () => {
    try {
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
          { compress: 1, format: ImageManipulator.SaveFormat.PNG }
        );
        setProfileImage(manipulatedImage.uri);
      }
    } catch (error) {
      Alert.alert("Error", "Failed to pick image.");
    }
  };

  const updateProfile = async () => {
    if (!name.trim() || !email.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setError('');
    setLoading(true);

    try {
      await AsyncStorage.setItem('name', name);
      await AsyncStorage.setItem('email', email);
      await AsyncStorage.setItem('profileImage', profileImage);
      Alert.alert("Profile Updated", `Name: ${name}\nEmail: ${email}`);
      setIsEditing(false);
    } catch (error) {
      Alert.alert("Update Failed", "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      "Logout",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Logout",
          onPress: async () => {
            try {
              await AsyncStorage.clear();
              navigation.reset({ index: 0, routes: [{ name: "LogoutScreen" }] });
            } catch (error) {
              Alert.alert("Logout Failed", "Something went wrong.");
            }
          },
        },
      ]
    );
  };

  return (
    <DrawerContentScrollView {...props}>
      <View style={styles.profileContainer}>
        <TouchableOpacity onPress={pickImage}>
          <Image source={{ uri: profileImage }} style={styles.profileImage} />
        </TouchableOpacity>
        <Text style={styles.profileName}>{isEditing ? "Editing Profile" : "View Profile"}</Text>

        {isEditing ? (
          <>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Enter your name" />
            <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Enter your email" keyboardType="email-address" />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity style={styles.updateButton} onPress={updateProfile} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.updateButtonText}>Save Changes</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.profileInfo}>
            <Text style={styles.profileText}>Name: {name}</Text>
            <Text style={styles.profileText}>Email: {email}</Text>
            <TouchableOpacity style={styles.editButton} onPress={() => setIsEditing(true)}>
              <Text style={styles.editButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <DrawerItemList {...props} />

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <MaterialCommunityIcons name="logout" size={24} color="red" />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </DrawerContentScrollView>
  );
}

export default function Home() {
  return (
    <Drawer.Navigator drawerContent={props => <CustomDrawerContent {...props} />}>
      <Drawer.Screen name="Home" component={TopTabs} />
      <Drawer.Screen name="Add Contacts" component={AddContacts} />
      <Drawer.Screen name="Create New Group" component={CreateGroupScreen} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  profileContainer: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  profileImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: '#1a73e8',
  },
  profileName: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  profileInfo: {
    alignItems: 'center',
    marginTop: 10,
  },
  profileText: {
    fontSize: 16,
    color: '#555',
    marginVertical: 2,
  },
  input: {
    width: '100%',
    height: 45,
    borderColor: '#1a73e8',
    borderWidth: 1.5,
    borderRadius: 10,
    marginTop: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f9f9f9',
    fontSize: 16,
    color: '#333',
  },
  editButton: {
    marginTop: 10,
    backgroundColor: '#FFA500',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  editButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 16,
  },
  updateButton: {
    marginTop: 15,
    backgroundColor: '#1a73e8',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 10,
    shadowColor: '#1a73e8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  updateButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 16,
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
    justifyContent: 'center',
  },
  logoutText: {
    marginLeft: 10,
    fontSize: 16,
    color: 'red',
    fontWeight: 'bold',
  },
  errorText: {
    color: 'red',
    fontSize: 14,
    marginTop: 5,
  },
});
