import { StatusBar } from 'react-native';
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
    <>
      <StatusBar barStyle="light-content" backgroundColor="#008000" />
      <Drawer.Navigator
        drawerContent={(props) => <CustomDrawerContent {...props} />}
        screenOptions={{
          drawerStyle: { width: width * 0.75 },
          drawerActiveTintColor: '#1a73e8',
          drawerInactiveTintColor: '#fff', // White for better contrast
          drawerActiveBackgroundColor: 'rgba(255, 255, 255, 0.2)', // Semi-transparent active background
          drawerItemStyle: {
            borderRadius: 10,
            marginVertical: 3, // Reduced vertical margin for tighter spacing
            paddingHorizontal: 8, // Slightly reduced padding
            backgroundColor: 'rgba(255, 255, 255, 0.1)', // Subtle background for each item
          },
          drawerLabelStyle: {
            fontSize: width < 400 ? 16 : 18,
            fontWeight: '700',
            marginLeft: -10, // Adjusted to reduce space between icon and text (was -20)
            textShadowColor: 'rgba(0, 0, 0, 0.3)',
            textShadowOffset: { width: 1, height: 1 },
            textShadowRadius: 2,
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
              colors={['#008000', '#FFD700', '#FF0000']} // Ethiopian flag colors: Green, Yellow, Red
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerBackground}
            />
          ),
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontSize: 24,
            fontWeight: '800',
            letterSpacing: 1,
            textShadowColor: 'rgba(0, 0, 0, 0.4)',
            textShadowOffset: { width: 2, height: 2 },
            textShadowRadius: 4,
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
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons name="home" size={26} color={color} /> {/* Reduced size slightly */}
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
                <MaterialCommunityIcons name="logout" size={26} color="red" />
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
    backgroundColor: 'rgba(255, 255, 255, 0.1)', // Subtle glassmorphism effect
  },
  iconContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    padding: 4, // Reduced padding to make icon area more compact
    marginRight: 8, // Added margin to create space between icon and text
  },
  logoutLabel: {
    color: '#000', // Changed to black as requested
    fontSize: width < 400 ? 16 : 18,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
});