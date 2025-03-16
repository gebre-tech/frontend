import React, { useContext } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Ionicons } from '@expo/vector-icons';
import ChatList from '../(tabs)/chat';
import ChatScreen from '../(tabs)/chatScreen';
import Contacts from '../(tabs)/Contacts';
import Groups from '../(tabs)/groups';
import { AuthContext } from '../../context/AuthContext'; // Import your AuthContext or any context you use for authentication

const Stack = createNativeStackNavigator();
const Tab = createMaterialTopTabNavigator();

const ChatStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="ChatList" component={ChatList} options={{ headerShown: false }} />
    <Stack.Screen name="ChatScreen" component={ChatScreen} options={{ title: 'Chat' }} />
  </Stack.Navigator>
);

const MainTabs = () => {
  const { user } = useContext(AuthContext); // Use context or any state to check user auth status

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          let iconName;

          if (route.name === 'Chat') {
            iconName = 'chatbubble';
          } else if (route.name === 'Contacts') {
            iconName = 'people';
          } else if (route.name === 'Groups') {
            iconName = 'person-circle';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: 'gray',
      })}
    >
      <Tab.Screen name="Chat" component={ChatStack} />
      <Tab.Screen name="Contacts" component={Contacts} />
      
      {/* Conditionally render the 'Groups' tab based on user authentication */}
      {user ? (
        <Tab.Screen name="Groups" component={Groups} />
      ) : null} 
    </Tab.Navigator>
  );
};

export default MainTabs;
