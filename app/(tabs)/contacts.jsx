// app/tabs/Contacts.jsx
import React, { useState, useEffect, useContext, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Image,
} from "react-native";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { AuthContext } from "../../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import debounce from "lodash/debounce";
import tw from "twrnc";

const API_URL = "http://127.0.0.1:8000";

const Contacts = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const navigation = useNavigation();
  const { user } = useContext(AuthContext);
  const [ws, setWs] = useState(null);

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem("token");
      if (!token) throw new Error("No authentication token found");
      const response = await axios.get(`${API_URL}/contacts/list_with_profiles/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setContacts(response.data || []);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchContacts = useCallback(
    debounce(async (query) => {
      if (!query) return fetchContacts();
      try {
        setLoading(true);
        const token = await AsyncStorage.getItem("token");
        if (!token) throw new Error("No authentication token found");
        const response = await axios.get(`${API_URL}/contacts/search/`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { query },
        });
        setContacts(response.data.results || response.data || []);
      } catch (error) {
        handleError(error);
      } finally {
        setLoading(false);
      }
    }, 300),
    [fetchContacts]
  );

  const startChat = async (friendId, friendUsername) => {
    try {
      const token = await AsyncStorage.getItem("token");
      if (!token) throw new Error("No authentication token found");
  
      // Check if a chat room already exists
      const response = await axios.get(`${API_URL}/chat/rooms/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
  
      const existingChat = response.data.find(
        (chat) =>
          !chat.is_group &&
          chat.members.some((member) => member.id === friendId) &&
          chat.members.some((member) => member.id === user.id)
      );
  
      let chatId = existingChat?.id;
  
      if (!chatId) {
        // If no chat exists, we'll let the backend create it when the first message is sent
        // Navigate to ChatScreen with friend details, and let SendMessageView handle creation
        console.log(`No existing chat found, navigating to ChatScreen for ${friendUsername}`);
        navigation.navigate("ChatScreen", {
          chatId: null, // Pass null to indicate no existing chat
          friendId,     // Pass friendId to use in ChatScreen
          friendUsername,
          isGroup: false,
        });
      } else {
        console.log(`Navigating to ChatScreen with chatId=${chatId}, friendUsername=${friendUsername}`);
        navigation.navigate("ChatScreen", {
          chatId,
          friendUsername,
          isGroup: false,
        });
      }
    } catch (error) {
      console.error("Start chat error:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        headers: error.response?.headers,
      });
      Alert.alert("Error", error.response?.data?.error || error.message || "Failed to start chat");
    }
  };

  const removeFriend = async (friendId) => {
    try {
      const token = await AsyncStorage.getItem("token");
      if (!token) throw new Error("No authentication token found");
      await axios.delete(`${API_URL}/contacts/remove/${friendId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setContacts((prev) => prev.filter((contact) => contact.friend_id !== friendId));
      Alert.alert("Success", "Friend removed successfully");
    } catch (error) {
      if (error.response?.status === 404) {
        setContacts((prev) => prev.filter((contact) => contact.friend_id !== friendId));
        Alert.alert("Info", "Friend was already removed");
      } else {
        handleError(error);
      }
    }
  };

  const handleError = (error) => {
    console.error("Error:", error);
    if (error.response?.status === 401) {
      Alert.alert("Error", "Session expired. Please log in again.", [
        { text: "OK", onPress: () => navigation.navigate("Login") },
      ]);
    } else {
      Alert.alert("Error", error.response?.data?.error || error.message || "An error occurred");
    }
  };

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem("token");
    if (!token) return;

    const wsInstance = new WebSocket(`ws://127.0.0.1:8000/ws/contacts/?token=${token}`);
    wsInstance.onopen = () => console.log("Contacts WebSocket connected");
    wsInstance.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log("Contacts WebSocket message:", data);
        if (data.type === "friend_removed") {
          setContacts((prev) => prev.filter((contact) => contact.friend_id !== data.friend_id));
          Alert.alert("Notification", `${data.friend_first_name} removed you as a friend`);
        } else if (data.type === "friend_request_accepted") {
          setContacts((prev) => [...prev, data.contact]);
          Alert.alert(
            "Notification",
            `${data.contact.friend.user.username} accepted your friend request`
          );
        }
      } catch (error) {
        console.error("WebSocket message parsing error:", error);
      }
    };
    wsInstance.onerror = (error) => {
      console.error("WebSocket error:", error);
      setTimeout(setupWebSocket, 2000);
    };
    wsInstance.onclose = () => console.log("Contacts WebSocket closed");
    setWs(wsInstance);

    return () => {
      if (wsInstance) wsInstance.close();
    };
  }, []);

  useEffect(() => {
    if (user) {
      fetchContacts();
      setupWebSocket();
    }
    return () => {
      if (ws) {
        ws.close();
        console.log("Contacts WebSocket cleanup");
      }
    };
  }, [user, fetchContacts, setupWebSocket]);

  useFocusEffect(
    useCallback(() => {
      const currentRoute = navigation.getState()?.routes.find((r) => r.name === "Contacts");
      if (currentRoute?.params?.refresh) {
        fetchContacts();
        navigation.setParams({ refresh: false });
      }
    }, [fetchContacts, navigation])
  );

  useEffect(() => {
    searchContacts(searchText);
  }, [searchText, searchContacts]);

  const renderItem = ({ item }) => {
    const isOnline = item.is_online || (item.friend.last_seen && new Date() - new Date(item.friend.last_seen) < 5 * 60 * 1000);

    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-sm border-b border-gray-100`}
        onPress={() => startChat(item.friend_id, item.friend.user.username)}
      >
        <View style={tw`relative`}>
          <Image
            source={{
              uri: item.friend.profile_picture || "https://via.placeholder.com/40",
            }}
            style={tw`w-12 h-12 rounded-full mr-3`}
          />
          {isOnline && (
            <View
              style={tw`absolute bottom-0 right-2 w-5 h-5 bg-green-500 rounded-full border-2 border-white`}
            />
          )}
        </View>
        <View style={tw`flex-1`}>
          <Text style={tw`text-lg font-semibold text-gray-800`}>
            {item.friend.user.first_name || item.friend.user.username}
          </Text>
          <Text style={tw`text-xs mt-1 ${isOnline ? "text-green-500" : "text-gray-500"}`}>
            {isOnline
              ? "Online"
              : `Last seen: ${
                  item.friend.last_seen
                    ? new Date(item.friend.last_seen).toLocaleString()
                    : "Unknown"
                }`}
          </Text>
        </View>
        <TouchableOpacity onPress={() => removeFriend(item.friend_id)}>
          <Ionicons name="trash-outline" size={24} color="#EF4444" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <View style={tw`p-4`}>
        <TextInput
          style={tw`bg-white rounded-full px-4 py-2 text-gray-800 border border-gray-200 shadow-sm`}
          placeholder="Search contacts..."
          placeholderTextColor="#9CA3AF"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
        />
      </View>
      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />
      ) : (
        <FlatList
          data={contacts}
          renderItem={renderItem}
          keyExtractor={(item) => item.friend_id.toString()}
          ListEmptyComponent={
            <Text style={tw`text-center mt-5 text-gray-500`}>
              {searchText ? "No contacts found" : "No contacts available"}
            </Text>
          }
          contentContainerStyle={tw`pb-4`}
        />
      )}
    </View>
  );
};

export default Contacts;