import React, { useState, useEffect, useRef, useContext } from "react";
import { View, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Alert, Text } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { AuthContext } from "../../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

const API_URL = "http://127.0.0.1:8000"; // Replace with your device's IP if needed

const ChatScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { chatId, friendUsername, isGroup = false } = route.params || {};
  const { user } = useContext(AuthContext);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState(false);
  const ws = useRef(null);
  const flatListRef = useRef(null);
  const [friendProfile, setFriendProfile] = useState(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    console.log("ChatScreen params:", { chatId, friendUsername, isGroup }); // Debug params
    if (!chatId) {
      Alert.alert("Error", "Chat ID is missing. Returning to previous screen.");
      navigation.goBack();
      return;
    }
    if (!user) {
      Alert.alert("Error", "User not authenticated. Please log in.");
      navigation.navigate("Login");
      return;
    }

    fetchMessages();
    if (!isGroup) fetchFriendProfile();
    connectWebSocket();

    return () => {
      if (ws.current) {
        ws.current.close();
        console.log("WebSocket cleanup on unmount");
      }
    };
  }, [chatId, user, isGroup]);

  const fetchMessages = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error("No authentication token found");
      const response = await axios.get(`${API_URL}/chat/get-messages/${chatId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log("Fetched messages:", response.data); // Debug messages
      setMessages(response.data || []);
      markMessagesAsRead(response.data || []);
    } catch (error) {
      console.error("Fetch messages error:", error);
      Alert.alert("Error", error.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  };

  const fetchFriendProfile = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token || !friendUsername) return;
      const response = await axios.get(`${API_URL}/profiles/friend/${friendUsername}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const profileData = response.data || {};
      const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
      profileData.is_online = lastSeen && (new Date() - lastSeen) < 5 * 60 * 1000;
      setFriendProfile(profileData);
    } catch (error) {
      console.error("Fetch friend profile error:", error);
      setFriendProfile({ username: friendUsername });
    }
  };

  const connectWebSocket = async () => {
    if (!chatId || !user) {
      console.error("Cannot connect WebSocket: Missing chatId or user");
      return;
    }

    const token = await AsyncStorage.getItem('token');
    if (!token) {
      console.error("Cannot connect WebSocket: No token found");
      return;
    }

    const wsPath = isGroup ? `ws/group_chat/${chatId}` : `ws/chat/${chatId}`;
    const wsUrl = `ws://127.0.0.1:8000/${wsPath}/?token=${token}`;
    console.log(`Attempting WebSocket connection to: ${wsUrl}`);
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log("Chat WebSocket connected");
      reconnectAttempts.current = 0;
    };

    ws.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log("WebSocket message received:", data);
        if (data.type === 'typing') {
          setTyping(data.user !== user.id);
          setTimeout(() => setTyping(false), 2000);
        } else if (data.message) {
          setMessages((prev) => {
            const updated = prev.some(msg => msg.id === data.message.id) ? prev : [...prev, data.message];
            return updated.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
          });
          if (data.message.sender?.id !== user.id) markMessagesAsRead([data.message]);
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };

    ws.current.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.current.onclose = (event) => {
      console.log("WebSocket closed:", event.code, event.reason || "No reason provided");
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 10000);
        console.log(`Reconnecting in ${delay}ms... Attempt ${reconnectAttempts.current + 1}`);
        setTimeout(() => {
          reconnectAttempts.current += 1;
          connectWebSocket();
        }, delay);
      } else {
        Alert.alert("Connection Error", "Unable to connect to chat server.");
      }
    };
  };

  const markMessagesAsRead = async (msgs) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token || !msgs.length) return;
      for (const msg of msgs) {
        if (!msg.seen_by?.some(u => u.id === user.id)) {
          await axios.post(`${API_URL}/chat/mark-as-read/${msg.id}/`, {}, {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  };

  const sendMessage = async (type = "text", attachment = null) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      Alert.alert("Error", "Connection lost. Reconnecting...");
      connectWebSocket();
      return;
    }
    try {
      let attachmentUrl = null;
      if (attachment) {
        const formData = new FormData();
        formData.append('file', {
          uri: attachment.uri,
          type: attachment.type || 'application/octet-stream',
          name: attachment.fileName || 'attachment',
        });
        const token = await AsyncStorage.getItem('token');
        const response = await axios.post(`${API_URL}/chat/upload-attachment/${chatId}/`, formData, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' },
        });
        attachmentUrl = response.data.file_url;
      }
      const messageData = { content: type === "text" ? message : "", message_type: type, attachment_url: attachmentUrl };
      ws.current.send(JSON.stringify(messageData));
      if (type === "text") setMessage("");
    } catch (error) {
      console.error("Send message error:", error);
      Alert.alert("Error", "Failed to send message");
    }
  };

  const sendTypingIndicator = () => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'typing', user: user.id }));
    }
  };

  const pickMedia = async (type) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Permission required", "Please allow access to your media library.");
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: type === 'image' ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.All,
    });
    if (!result.canceled) sendMessage(type, result.assets[0]);
  };

  const renderMessage = ({ item }) => {
    const isSent = item.sender?.id === user.id;
    const status = item.seen_by?.length > 1 ? "✓✓" : item.seen_by?.length === 1 ? "✓" : "Sent";
    return (
      <View style={isSent ? styles.sent : styles.received}>
        <Image
          source={{ uri: item.sender?.profile_picture || 'https://via.placeholder.com/30' }}
          style={styles.messageAvatar}
        />
        <View style={styles.messageContent}>
          <Text style={styles.senderName}>{item.sender?.username || "Unknown"}</Text>
          {item.message_type === "text" && <Text style={styles.messageText}>{item.content || "(Empty)"}</Text>}
          {item.message_type === "image" && <Image source={{ uri: item.attachment_url || 'https://via.placeholder.com/200' }} style={styles.media} />}
          {item.message_type === "video" && <Text style={styles.messageText}>Video: {item.attachment_url || "N/A"}</Text>}
          {item.message_type === "file" && <Text style={styles.messageText}>File: {item.attachment_url || "N/A"}</Text>}
          <Text style={styles.timestamp}>
            {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : "Unknown time"} {isSent && `• ${status}`}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) return <ActivityIndicator size="large" color="#007AFF" style={styles.loadingContainer} />;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => navigation.navigate(isGroup ? 'GroupProfile' : 'FriendProfile', { chatId, username: friendUsername })}
      >
        <Image
          source={{ uri: friendProfile?.profile_picture || 'https://via.placeholder.com/40' }}
          style={styles.headerAvatar}
        />
        <View>
          <Text style={styles.headerTitle}>{isGroup ? `Group ${chatId}` : (friendProfile?.username || friendUsername || "Unknown")}</Text>
          {!isGroup && (
            <Text style={styles.headerStatus}>
              {friendProfile?.is_online
                ? 'Online'
                : `Last seen: ${friendProfile?.last_seen ? new Date(friendProfile.last_seen).toLocaleString() : 'Unknown'}`}
            </Text>
          )}
        </View>
      </TouchableOpacity>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id?.toString() || Math.random().toString()}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<Text style={styles.emptyText}>No messages yet</Text>}
      />
      {typing && <Text style={styles.typingIndicator}>{isGroup ? "Someone" : friendUsername} is typing...</Text>}
      <View style={styles.inputContainer}>
        <TouchableOpacity onPress={() => pickMedia('image')}>
          <Ionicons name="image" size={24} color="#007AFF" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => pickMedia('video')}>
          <Ionicons name="videocam" size={24} color="#007AFF" />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={(text) => {
            setMessage(text);
            if (text) sendTypingIndicator();
          }}
          placeholder="Type a message..."
          multiline
        />
        <TouchableOpacity onPress={() => sendMessage("text")}>
          <Ionicons name="send" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  header: { flexDirection: 'row', padding: 15, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', alignItems: 'center' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  headerStatus: { fontSize: 12, color: '#666' },
  sent: { flexDirection: 'row', alignSelf: 'flex-end', margin: 5, alignItems: 'flex-end' },
  received: { flexDirection: 'row', alignSelf: 'flex-start', margin: 5, alignItems: 'flex-start' },
  messageAvatar: { width: 30, height: 30, borderRadius: 15, marginRight: 5 },
  messageContent: { backgroundColor: '#fff', padding: 10, borderRadius: 10, elevation: 1, maxWidth: '70%' },
  senderName: { fontSize: 12, fontWeight: '600', color: '#007AFF' },
  messageText: { fontSize: 16, color: '#333' },
  timestamp: { fontSize: 12, color: '#999', marginTop: 2 },
  inputContainer: { flexDirection: "row", padding: 10, alignItems: "center", backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' },
  input: { flex: 1, padding: 10, backgroundColor: "#f0f0f0", borderRadius: 20, marginHorizontal: 10, maxHeight: 100 },
  media: { width: 200, height: 200, borderRadius: 8 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  typingIndicator: { fontSize: 12, color: '#666', padding: 5, alignSelf: 'flex-start' },
  emptyText: { textAlign: "center", marginTop: 20, fontSize: 16, color: "#666" },
});

export default ChatScreen;