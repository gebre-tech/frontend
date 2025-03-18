import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import ChatList from './ChatList';
import ChatScreen from './ChatScreen';
import FriendProfile from './FriendProfile';
import Contacts from './Contacts';

const Stack = createStackNavigator();

export default function ChatStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#333',
      }}
    >
      <Stack.Screen name="ChatList" component={ChatList} options={{ headerShown: false }} />
      <Stack.Screen name="ChatScreen" component={ChatScreen} options={({ route }) => ({ title: route.params.friendUsername })} />
      <Stack.Screen name="Contacts" component={Contacts} options={{ title: 'Contacts' }} />
      <Stack.Screen name="FriendProfile" component={FriendProfile} options={{ title: 'Friend Profile' }} />
    </Stack.Navigator>
  );
}