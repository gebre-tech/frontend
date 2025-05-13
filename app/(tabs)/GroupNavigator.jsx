import { createStackNavigator } from '@react-navigation/stack';
import Groups from './groups';
import CreateGroupScreen from './CreateGroupScreen';
import GroupChatScreen from './GroupChatScreen';
import GroupInfo from './GroupInfo';
import React from 'react';
import FriendProfile from './FriendProfile';

const Stack = createStackNavigator();

const GroupsNavigator = () => {
  return (
    <Stack.Navigator
      initialRouteName="Groups"
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="Groups" component={Groups} />
      <Stack.Screen name="CreateGroup" component={CreateGroupScreen} />
      <Stack.Screen name="GroupChatScreen" component={GroupChatScreen} />
      <Stack.Screen name="GroupInfo" component={GroupInfo} />
      <Stack.Screen name="FriendProfile" component={FriendProfile} />
    </Stack.Navigator>
  );
};

export default GroupsNavigator;