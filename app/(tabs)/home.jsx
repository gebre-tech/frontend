import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Dimensions, Text, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import CustomDrawerContent from './CustomDrawerContent';
import TopTabs from './TopTabs';
import AddContacts from './AddContacts';
import CreateGroupScreen from './CreateGroupScreen';
import LogoutScreen from '../(auth)/logout';

const Drawer = createDrawerNavigator();
const { width, height } = Dimensions.get('window');

export default function Home() {
  const headerHeight = height < 600 ? 80 : 100;

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
        headerStyle: {
          elevation: 6,
          shadowOpacity: 0.2,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 8,
          borderBottomLeftRadius: 30,
          borderBottomRightRadius: 30,
          height: headerHeight,
        },
        headerBackground: () => (
          <LinearGradient
            colors={['#007bff', '#6f42c1',]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerBackground}
          />
        ),
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontSize: 22,
          fontWeight: '700',
          letterSpacing: 0.5,
        },
        headerTitleAlign: 'center',
        headerLeftContainerStyle: {
          paddingLeft: 16,
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
          title: 'Home',
        }}
      />
      <Drawer.Screen
        name="AddContacts"
        component={AddContacts}
        options={{
          drawerIcon: ({ color }) => (
            <MaterialCommunityIcons name="account-plus" size={24} color={color} />
          ),
          title: 'Add Contacts',
        }}
      />
      <Drawer.Screen
        name="CreateNewGroup"
        component={CreateGroupScreen}
        options={{
          drawerIcon: ({ color }) => (
            <MaterialCommunityIcons name="account-group" size={24} color={color} />
          ),
          title: 'Create New Group',
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
          title: 'Logout',
        }}
      />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  headerBackground: {
    flex: 1,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.1)', // Subtle glassmorphism effect
  },
});