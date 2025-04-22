// app/(tabs)/Home.js
import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Dimensions, Text } from 'react-native';
import CustomDrawerContent from './CustomDrawerContent';
import TopTabs from './TopTabs';
import AddContacts from './AddContacts'; // Update path if needed
import CreateGroupScreen from './CreateGroupScreen';
import LogoutScreen from '../(auth)/logout';

const Drawer = createDrawerNavigator();
const { width } = Dimensions.get('window');

export default function Home() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        drawerStyle: { width: width * 0.75 },
        drawerActiveTintColor: '#1a73e8',
        drawerInactiveTintColor: '#666',
        drawerLabelStyle: {
          fontSize: width < 400 ? 14 : 16,
          fontWeight: '500',
        },
      }}
    >
      <Drawer.Screen
        name="HomeScreen"
        component={TopTabs}
        options={{
          drawerIcon: ({ color }) => (
            <MaterialCommunityIcons name="home" size={24} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="AddContacts"
        component={AddContacts}
        options={{
          drawerIcon: ({ color }) => (
            <MaterialCommunityIcons name="account-plus" size={24} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="CreateNewGroup"
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