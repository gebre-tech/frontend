// src/navigation/ChatStack.js
import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import ChatList from './chat';
import ChatScreen from './chatScreen';
import FriendProfile from './FriendProfile';
const Stack = createStackNavigator();



export default function ChatStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ChatList" component={ChatList} options={{ headerShown: false }} />
      <Stack.Screen name="ChatScreen" component={ChatScreen} options={{ title: 'Chat' }} />
      <Stack.Screen name="FriendProfile" component={FriendProfile} options={{ title: 'Friend Profile' }} />
    </Stack.Navigator>
  );
}