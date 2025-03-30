import React, { useState, useEffect, useContext, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Image,
  Animated,
} from "react-native";
import axios from "axios";
import { AuthContext } from "../../context/AuthContext";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import tw from "twrnc";

const API_URL = "http://127.0.0.1:8000";
const INITIAL_CHAT_LIMIT = 5; // Limit to top 5 chats initially

const ChatList = () => {
  const { user } = useContext(AuthContext);
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();
  const wsRef = useRef(null);
  const [highlightedChatIds, setHighlightedChatIds] = useState(new Set()); // Track chats with recent activity

  const fadeAnim = useRef(new Animated.Value(0)).current;

  const fetchChats = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("token");
      if (!token) throw new Error("No token found");

      const cachedChats = await AsyncStorage.getItem("cached-chats");
      if (cachedChats) {
        setChats(JSON.parse(cachedChats).slice(0, INITIAL_CHAT_LIMIT));
      }

      const response = await axios.get(`${API_URL}/chat/rooms/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const enhancedChats = await Promise.all(
        (response.data || []).map(async (chat) => {
          const cachedMessages = await AsyncStorage.getItem(`chat-${chat.id}-page-1`);
          if (cachedMessages) {
            const messages = JSON.parse(cachedMessages);
            if (messages.length > 0) {
              return {
                ...chat,
                last_message: messages[messages.length - 1],
                unread_count: messages.filter(
                  (m) =>
                    !m.seen_by?.some((u) => u.id === user.id) &&
                    m.sender.id !== user.id
                ).length,
                delivered_count: messages.filter(
                  (m) => m.delivered_to?.length > 0 && !m.seen_by?.length
                ).length,
              };
            }
          }
          return chat;
        })
      );

      const sortedChats = enhancedChats.sort(
        (a, b) =>
          new Date(b.last_message?.timestamp || b.created_at) -
          new Date(a.last_message?.timestamp || a.created_at)
      );

      setChats(sortedChats.slice(0, INITIAL_CHAT_LIMIT));
      await AsyncStorage.setItem("cached-chats", JSON.stringify(sortedChats));
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    } catch (error) {
      console.error("Fetch chats error:", error);
      Alert.alert("Error", error.message || "Failed to fetch chats");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fadeAnim, user?.id]);

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem("token");
    if (!token) return;

    const ws = new WebSocket(`ws://127.0.0.1:8000/ws/contacts/?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => console.log("ChatList WebSocket connected");

    ws.onmessage = async (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log("ChatList WebSocket message:", data);

        if (data.type === "chat_message") {
          const newMessage = data.message;
          const chatId = newMessage.chat.id;

          const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
          const messages = cachedMessages ? JSON.parse(cachedMessages) : [];
          const updatedMessages = [...messages, newMessage];
          await AsyncStorage.setItem(`chat-${chatId}-page-1`, JSON.stringify(updatedMessages));

          setChats((prev) => {
            let updatedChats = prev.filter((chat) => chat.id !== chatId); // Remove if already in list
            const newChat = {
              id: chatId,
              members: newMessage.chat.members,
              last_message: newMessage,
              unread_count: newMessage.sender.id !== user.id ? 1 : 0,
              delivered_count: newMessage.delivered_to?.length > 0 ? 1 : 0,
              is_group: newMessage.chat.is_group || false,
              created_at: new Date().toISOString(),
            };
            updatedChats = [newChat, ...updatedChats].sort(
              (a, b) =>
                new Date(b.last_message?.timestamp || b.created_at) -
                new Date(a.last_message?.timestamp || a.created_at)
            ).slice(0, INITIAL_CHAT_LIMIT);

            AsyncStorage.setItem("cached-chats", JSON.stringify(updatedChats));
            return updatedChats;
          });

          setHighlightedChatIds((prev) => new Set(prev).add(chatId));
          Animated.sequence([
            Animated.timing(fadeAnim, {
              toValue: 0.7,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start();
        } else if (data.type === "message_delivered") {
          const { chat_id, message_id } = data;
          const cachedMessages = await AsyncStorage.getItem(`chat-${chat_id}-page-1`);
          const messages = cachedMessages ? JSON.parse(cachedMessages) : [];
          const updatedMessages = messages.map((m) =>
            m.id === message_id || m.tempId === message_id
              ? { ...m, delivered_to: [...(m.delivered_to || []), { id: user.id }] }
              : m
          );
          await AsyncStorage.setItem(`chat-${chat_id}-page-1`, JSON.stringify(updatedMessages));

          setChats((prev) => {
            let updatedChats = prev.filter((chat) => chat.id !== chat_id);
            const chatToUpdate = prev.find((chat) => chat.id === chat_id) || {
              id: chat_id,
              members: [],
              is_group: false,
              created_at: new Date().toISOString(),
            };
            const updatedChat = {
              ...chatToUpdate,
              last_message: updatedMessages[updatedMessages.length - 1],
              delivered_count: updatedMessages.filter(
                (m) => m.delivered_to?.length > 0 && !m.seen_by?.length
              ).length,
              unread_count: updatedMessages.filter(
                (m) =>
                  !m.seen_by?.some((u) => u.id === user.id) &&
                  m.sender.id !== user.id
              ).length,
            };
            updatedChats = [updatedChat, ...updatedChats].sort(
              (a, b) =>
                new Date(b.last_message?.timestamp || b.created_at) -
                new Date(a.last_message?.timestamp || a.created_at)
            ).slice(0, INITIAL_CHAT_LIMIT);

            AsyncStorage.setItem("cached-chats", JSON.stringify(updatedChats));
            return updatedChats;
          });

          setHighlightedChatIds((prev) => new Set(prev).add(chat_id));
        }
      } catch (error) {
        console.error("WebSocket message parsing error:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      ws.close();
    };

    ws.onclose = () => {
      console.log("ChatList WebSocket closed");
      if (user) setTimeout(setupWebSocket, 2000);
    };
  }, [user, fadeAnim]);

  useEffect(() => {
    if (user) {
      fetchChats();
      setupWebSocket();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        console.log("ChatList WebSocket cleanup");
      }
    };
  }, [user, fetchChats, setupWebSocket]);

  const onRefresh = () => {
    setRefreshing(true);
    setHighlightedChatIds(new Set());
    fetchChats();
  };

  const truncateMessage = (message) => {
    if (!message) return "";
    const lines = message.split("\n");
    return lines.slice(0, 2).join("\n");
  };

  const renderItem = ({ item }) => {
    const friend = item.members.find((m) => m.id !== user.id);
    const lastSeen = friend?.last_seen ? new Date(friend.last_seen) : null;
    const isOnline = lastSeen && new Date() - lastSeen < 5 * 60 * 1000;
    const isHighlighted = highlightedChatIds.has(item.id);

    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <View
          style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-sm border-b border-gray-100 ${
            isHighlighted ? "bg-blue-50" : ""
          }`}
        >
          <TouchableOpacity
            onPress={() => {
              if (!item.is_group) {
                navigation.navigate("FriendProfile", { username: friend?.username });
              }
            }}
          >
            <View style={tw`relative`}>
              <Image
                source={{
                  uri: friend?.profile_picture || "https://via.placeholder.com/40",
                }}
                style={tw`w-12 h-12 rounded-full mr-3`}
              />
              {isOnline && !item.is_group && (
                <View
                  style={tw`absolute bottom-0 right-2 w-5 h-5 bg-green-500 rounded-full border-2 border-white`}
                />
              )}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={tw`flex-1 flex-row justify-between items-center`}
            onPress={async () => {
              if (item.unread_count > 0) {
                try {
                  const token = await AsyncStorage.getItem("token");
                  await axios.post(
                    `${API_URL}/chat/mark-as-read/${item.id}/`,
                    {},
                    { headers: { Authorization: `Bearer ${token}` } }
                  );
                  setChats((prev) =>
                    prev.map((chat) =>
                      chat.id === item.id ? { ...chat, unread_count: 0 } : chat
                    )
                  );
                  setHighlightedChatIds((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(item.id);
                    return newSet;
                  });
                } catch (error) {
                  console.error("Error marking as read:", error);
                }
              }

              navigation.navigate("ChatScreen", {
                chatId: item.id,
                friendUsername: item.is_group ? null : item.name || friend?.username,
                isGroup: item.is_group || false,
              });
            }}
          >
            <View style={tw`flex-1`}>
              <View style={tw`flex-row justify-between`}>
                <Text style={tw`text-lg font-semibold text-gray-800`}>
                  {item.is_group
                    ? item.name || `Group ${item.id}`
                    : item.name || friend?.username || "Unknown"}
                </Text>
                <Text style={tw`text-xs text-gray-500`}>
                  {item.last_message
                    ? new Date(item.last_message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : ""}
                </Text>
              </View>
              <Text
                style={tw`text-sm text-gray-600 mt-1 ${
                  item.unread_count > 0 ? "font-medium" : ""
                }`}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {item.last_message
                  ? `${item.last_message.sender.username}: ${
                      truncateMessage(item.last_message.content) || item.last_message.message_type
                    }`
                  : "No messages yet"}
              </Text>
              {!item.is_group && (
                <Text
                  style={tw`text-xs mt-1 ${isOnline ? "text-green-500" : "text-gray-500"}`}
                >
                  {isOnline
                    ? "Online"
                    : lastSeen
                    ? `Last seen: ${lastSeen.toLocaleTimeString()}`
                    : "Offline"}
                </Text>
              )}
            </View>
            {(item.unread_count > 0 || item.delivered_count > 0) && (
              <View style={tw`flex-row items-center`}>
                {item.delivered_count > 0 && (
                  <Text style={tw`text-xs text-gray-500 mr-2`}>✓</Text>
                )}
                {item.unread_count > 0 && (
                  <View style={tw`bg-blue-500 rounded-full px-2 py-1`}>
                    <Text style={tw`text-white text-xs font-bold`}>{item.unread_count}</Text>
                  </View>
                )}
              </View>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  };

  if (loading) {
    return (
      <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />
    );
  }

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <FlatList
        data={chats}
        renderItem={renderItem}
        keyExtractor={(chat) => chat.id.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={tw`text-center mt-5 text-gray-500`}>No chats available</Text>
        }
      />
      <TouchableOpacity
        style={tw`absolute bottom-6 right-6 bg-blue-500 rounded-full w-16 h-16 justify-center items-center shadow-lg`}
        onPress={() => navigation.navigate("Contacts")}
      >
        <Ionicons name="chatbubble-ellipses" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

export default ChatList;