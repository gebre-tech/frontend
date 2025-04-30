// app/(tabs)/GroupsNavigator.js
import { createStackNavigator } from '@react-navigation/stack';
import Groups from './groups';
import CreateGroupScreen from './CreateGroupScreen';
import GroupChatScreen from './GroupChatScreen';
import GroupInfo from './GroupInfo';
import React from 'react';


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
      <Stack.Screen name="CreateGroupScreen" component={CreateGroupScreen} />
      <Stack.Screen name="GroupChatScreen" component={GroupChatScreen} />
      <Stack.Screen name="GroupInfo" component={GroupInfo} />
    </Stack.Navigator>
  );
};

export default GroupsNavigator;