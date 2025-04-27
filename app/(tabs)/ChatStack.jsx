// app/(tabs)/chatStack.jsx
import React from "react";
import { createStackNavigator } from "@react-navigation/stack";
import { Ionicons } from "@expo/vector-icons"; // Add this import
import ChatList from "./ChatList";
import ChatScreen from "./chatScreen";
import FriendProfile from "./FriendProfile";
import Contacts from "./Contacts";

const Stack = createStackNavigator();

export default function ChatStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { 
          backgroundColor: "#fff", 
          elevation: 0, 
          shadowOpacity: 0,
          borderBottomWidth: 0 
        },
        headerTintColor: "#333",
        headerTitleStyle: { 
          fontSize: 18, 
          fontWeight: "600" 
        },
        headerBackTitleVisible: false,
        headerBackImage: ({ tintColor }) => (
          <Ionicons name="arrow-back" size={24} color={tintColor} style={{ marginLeft: 10 }} />
        ),
      }}
    >
      <Stack.Screen 
        name="ChatList" 
        component={ChatList} 
        options={{ 
          headerShown: false 
        }} 
      />
      <Stack.Screen
        name="ChatScreen"
        component={ChatScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen 
        name="Contacts" 
        component={Contacts} 
        options={{ 
          title: "Contacts",
          headerLeftContainerStyle: { paddingLeft: 10 },
        }} 
      />
      <Stack.Screen 
        name="FriendProfile" 
        component={FriendProfile} 
        options={({ route }) => ({ 
          title: route.params?.username || "Profile",
          headerLeftContainerStyle: { paddingLeft: 10 },
        })} 
      />
    </Stack.Navigator>
  );
}