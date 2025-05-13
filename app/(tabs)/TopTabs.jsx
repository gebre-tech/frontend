// app/(tabs)/TopTabs.js
import React, { useState, useEffect, useCallback } from 'react';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Dimensions, View, Text, StyleSheet } from 'react-native';
import ChatStack from './ChatStack';
import Contacts from './Contacts'; // Ensure correct path and casing
import GroupsNavigator from './GroupNavigator'; // Ensure correct path and casing
import FriendRequests from './FriendRequests'; // Ensure correct path and casing
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { API_URL, API_HOST,PLACEHOLDER_IMAGE } from '../utils/constants';

const Tab = createMaterialTopTabNavigator();
const { width } = Dimensions.get('window');


export default function TopTabs() {
  const [friendRequests, setFriendRequests] = useState([]);
  const [ws, setWs] = useState(null);

  // Fetch pending friend requests
  const fetchFriendRequests = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;

      const response = await axios.get(`${API_URL}/contacts/requests/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFriendRequests(response.data);
    } catch (err) {
      console.error('Error fetching friend requests:', err);
    }
  }, []);

  // Setup WebSocket for real-time friend request updates
  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const websocket = new WebSocket(`ws://${API_HOST}/ws/contacts/?token=${token}`);

    websocket.onopen = () => console.log('WebSocket connected for TopTabs');
    websocket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'friend_request') {
        setFriendRequests((prev) => [...prev, data.request]);
      } else if (data.type === 'friend_request_accepted') {
        fetchFriendRequests(); // Refresh when a request is accepted
      }
    };
    websocket.onerror = (e) => console.error('WebSocket error:', e);
    websocket.onclose = () => console.log('WebSocket disconnected');

    setWs(websocket);
    return () => websocket.close();
  }, [fetchFriendRequests]);

  useEffect(() => {
    fetchFriendRequests();
    setupWebSocket();
  }, [fetchFriendRequests, setupWebSocket]);

  // Custom tab bar label with notification badge
  const renderTabBarLabel = (focused, label, hasNotifications = false) => (
    <View style={styles.tabLabelContainer}>
      <Text style={[styles.tabLabel, { color: focused ? '#ffffff' : '#b0bec5' }]}>
        {label}
      </Text>
      {hasNotifications && friendRequests.length > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{friendRequests.length}</Text>
        </View>
      )}
    </View>
  );

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
      <Tab.Screen
        name="Contacts"
        component={Contacts}
        options={{
          tabBarIcon: ({ focused }) => (
            <Ionicons name="people" size={24} color={focused ? '#ffffff' : '#b0bec5'} />
          ),
          tabBarLabel: ({ focused }) => renderTabBarLabel(focused, 'Contacts'),
        }}
      />
      <Tab.Screen
        name="Friend Requests"
        component={FriendRequests}
        options={{
          tabBarIcon: ({ focused }) => (
            <Ionicons name="person-add" size={24} color={focused ? '#ffffff' : '#b0bec5'} />
          ),
          tabBarLabel: ({ focused }) => renderTabBarLabel(focused, 'Requests', true),
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatStack}
        options={{
          tabBarIcon: ({ focused }) => (
            <Ionicons name="chatbubbles" size={24} color={focused ? '#ffffff' : '#b0bec5'} />
          ),
          tabBarLabel: ({ focused }) => renderTabBarLabel(focused, 'Chat'),
        }}
      />
      <Tab.Screen
        name="Group"
        component={GroupsNavigator}
        options={{
          tabBarIcon: ({ focused }) => (
            <Ionicons name="chatbox-ellipses" size={24} color={focused ? '#ffffff' : '#b0bec5'} />
          ),
          tabBarLabel: ({ focused }) => renderTabBarLabel(focused, 'Group'),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: width < 400 ? 12 : 14,
  },
  badge: {
    backgroundColor: '#ff4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 5,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
});