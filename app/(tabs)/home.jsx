import { StatusBar } from 'react-native';
import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
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
    <>
      <StatusBar barStyle="light-content" backgroundColor="#008000" />
      <Drawer.Navigator
        drawerContent={(props) => <CustomDrawerContent {...props} />}
        screenOptions={{
          drawerStyle: {
            width: width * 0.75,
            backgroundColor: 'rgba(255, 255, 255, 0.1)', // Glassmorphism background
            borderRightWidth: 1,
            borderRightColor: 'rgba(255, 255, 255, 0.2)',
            backdropFilter: 'blur(10px)', // Simulate glassmorphism
          },
          drawerActiveTintColor: '#FFD700', // Yellow for active items
          drawerInactiveTintColor: '#FFFFFF', // White for inactive items
          drawerActiveBackgroundColor: 'rgba(255, 215, 0, 0.2)', // Yellow with transparency
          drawerItemStyle: {
            borderRadius: 12,
            marginVertical: 4,
            paddingHorizontal: 10,
            backgroundColor: 'rgba(255, 255, 255, 0.05)', // Subtle background
          },
          drawerLabelStyle: {
            fontSize: width < 400 ? 16 : 18,
            fontWeight: '600',
            marginLeft: -10,
            textShadowColor: 'rgba(0, 0, 0, 0.3)',
            textShadowOffset: { width: 1, height: 1 },
            textShadowRadius: 3,
            fontFamily: 'Roboto', // Professional font (ensure font is loaded)
          },
          headerStyle: {
            elevation: 8,
            shadowOpacity: 0.3,
            shadowOffset: { width: 0, height: 4 },
            shadowRadius: 10,
            borderBottomLeftRadius: 30,
            borderBottomRightRadius: 30,
            height: headerHeight,
            backgroundColor: 'rgba(255, 255, 255, 0.1)', // Glassmorphism effect
          },
          headerBackground: () => (
            <LinearGradient
              colors={['#008000', '#FFD700', '#FF0000']} // Ethiopian flag colors
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerBackground}
            />
          ),
          headerTintColor: '#FFFFFF',
          headerTitleStyle: {
            fontSize: 26,
            fontWeight: '800',
            letterSpacing: 1.2,
            textShadowColor: 'rgba(0, 0, 0, 0.5)',
            textShadowOffset: { width: 2, height: 2 },
            textShadowRadius: 5,
            fontFamily: 'Roboto', // Professional font
          },
          headerTitleAlign: 'center',
          headerLeftContainerStyle: {
            paddingLeft: 16,
          },
          headerRight: () => (
            <View style={styles.headerRight}>
              <FontAwesome5 name="lock" size={20} color="#FFFFFF" />
              <Text style={styles.headerRightText}>Secure</Text>
            </View>
          ),
        }}
      >
        <Drawer.Screen
          name="HomeScreen"
          component={TopTabs}
          options={{
            drawerIcon: ({ color }) => (
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons name="home" size={26} color={color} />
              </View>
            ),
            title: 'HabChat',
          }}
        />
        <Drawer.Screen
          name="AddContacts"
          component={AddContacts}
          options={{
            drawerIcon: ({ color }) => (
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons name="account-plus" size={26} color={color} />
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
                <MaterialCommunityIcons name="account-group" size={26} color={color} />
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
                <MaterialCommunityIcons name="logout" size={26} color="#FF0000" />
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
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 16,
  },
  headerRightText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  iconContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    padding: 6,
    marginRight: 10,
  },
  logoutLabel: {
    color: '#FF0000',
    fontSize: width < 400 ? 16 : 18,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
});