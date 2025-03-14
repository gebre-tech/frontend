import React, { useState, useEffect, useRef } from "react";
import { View, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AuthContext } from "../../context/AuthContext"; // Fixed import
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";

const ChatScreen = () => {
  const { chatId } = useLocalSearchParams();
  const { user } = useContext(AuthContext);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const ws = useRef(null);

  useEffect(() => {
    fetchMessages();
    connectWebSocket();
    return () => ws.current?.close();
  }, [chatId]);

  const fetchMessages = async () => {
    try {
      const res = await axios.get(`http://127.0.0.1:8000/chat/${chatId}/messages/`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setMessages(res.data);
    } catch (error) {
      console.error("Fetch messages error:", error);
    } finally {
      setLoading(false);
    }
  };

  const connectWebSocket = () => {
    ws.current = new WebSocket(`ws://127.0.0.1:8000/ws/chat/${chatId}/?token=${user.token}`);
    ws.current.onopen = () => console.log("WebSocket connected");
    ws.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setMessages((prev) => [...prev, data]);
    };
    ws.current.onerror = (e) => console.error("WebSocket error:", e);
    ws.current.onclose = () => console.log("WebSocket closed");
  };

  const sendMessage = () => {
    if (message.trim() && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ content: message, sender: user.id }));
      setMessage("");
    }
  };

  if (loading) return <ActivityIndicator size="large" color="#007AFF" />;

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={item.sender === user.id ? styles.sent : styles.received}>
            <Text>{item.content}</Text>
            <Text style={styles.seen}>{item.seen ? "✓✓" : "✓"}</Text>
          </View>
        )}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Type a message..."
        />
        <TouchableOpacity onPress={sendMessage}>
          <Ionicons name="send" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  sent: { alignSelf: "flex-end", backgroundColor: "#DCF8C6", padding: 10, margin: 5, borderRadius: 8 },
  received: { alignSelf: "flex-start", backgroundColor: "#ECECEC", padding: 10, margin: 5, borderRadius: 8 },
  inputContainer: { flexDirection: "row", padding: 10, alignItems: "center" },
  input: { flex: 1, padding: 10, backgroundColor: "#f0f0f0", borderRadius: 20, marginRight: 10 },
  seen: { fontSize: 12, color: "#666" },
});

export default ChatScreen;