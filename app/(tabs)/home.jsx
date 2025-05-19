import { StatusBar } from 'react-native';
import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { Dimensions, Text, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import CustomDrawerContent from './CustomDrawerContent';

import AddContacts from './AddContacts';
import CreateGroupScreen from './CreateGroupScreen';
import LogoutScreen from '../(auth)/logout';
import BottomTabs from './BottomTabs';

const Drawer = createDrawerNavigator();
const { width, height } = Dimensions.get('window');

export default function Home() {
  const headerHeight = height < 600 ? 80 : 100;

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#008000" />
      <Drawer.Navigator
        drawerContent={(props) => <CustomDrawerContent {...props} />}
        screenOptions={{
          drawerStyle: {
            width: width * 0.75,
            backgroundColor: '#ffffff', // Solid white to prevent transparency
            shadowColor: 'rgba(0, 0, 0, 0.1)',
            shadowOffset: { width: 2, height: 0 },
            shadowOpacity: 0.2,
            shadowRadius: 4,
            elevation: 3,
          },
          drawerActiveTintColor: '#1e88e5', // Matches CustomDrawerContent primary color
          drawerInactiveTintColor: '#111827',
          drawerActiveBackgroundColor: 'rgba(30, 136, 229, 0.1)',
          drawerItemStyle: {
            borderRadius: 8,
            marginVertical: 4,
            paddingHorizontal: 8,
            backgroundColor: '#f9fafb', // Matches cardBackground
          },
          drawerLabelStyle: {
            fontSize: width < 400 ? 15 : 16,
            fontWeight: '600',
            marginLeft: -10,
            fontFamily: 'Roboto', // Ensure font is loaded
          },
          headerStyle: {
            elevation: 8,
            shadowOpacity: 0.3,
            shadowOffset: { width: 0, height: 4 },
            shadowRadius: 10,
            borderBottomLeftRadius: 20,
            borderBottomRightRadius: 20,
            height: headerHeight,
            backgroundColor: '#ffffff',
          },
          headerBackground: () => (
            <LinearGradient
              colors={['#078930', '#FCDD09', '#DA121A']} // Ethiopian flag colors (unchanged)
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerBackground}
            />
          ),
          headerTintColor: '#ffffff',
          headerTitleStyle: {
            fontSize: 24,
            fontWeight: '700',
            letterSpacing: 1,
            fontFamily: 'Roboto',
          },
          headerTitleAlign: 'center',
          headerLeftContainerStyle: {
            paddingLeft: 16,
          },
          headerRight: () => (
            <View style={styles.headerRight}>
              <FontAwesome5 name="lock" size={18} color="#ffffff" />
              <Text style={styles.headerRightText}>Secure</Text>
            </View>
          ),
        }}
      >

        <Drawer.Screen
          name="AddContacts"
          component={AddContacts}
          options={{
            drawerIcon: ({ color }) => (
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons name="account-plus" size={24} color={color} />
              </View>
            ),
            title: 'Add Contacts',
          }}
        />
        <Drawer.Screen
          name="CreateNewGroup"
          component={CreateGroupScreen}
          options={{
            drawerIcon: ({ color }) => (
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons name="account-group" size={24} color={color} />
              </View>
            ),
            title: 'Create New Group',
          }}
        />
        <Drawer.Screen
          name="Logout"
          component={LogoutScreen}
          options={{
            drawerIcon: ({ color }) => (
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons name="logout" size={24} color="#DA121A" />
              </View>
            ),
            drawerLabel: ({ color }) => (
              <Text style={styles.logoutLabel}>
                Logout
              </Text>
            ),
            title: 'Logout',
          }}
        />
      </Drawer.Navigator>
    </>
  );
}

const styles = StyleSheet.create({
  headerBackground: {
    flex: 1,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 16,
  },
  headerRightText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  iconContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 8,
    padding: 6,
    marginRight: 8,
  },
  logoutLabel: {
    color: '#DA121A',
    fontSize: width < 400 ? 15 : 16,
    fontWeight: '600',
  },
});