import React, { useEffect, useContext, useRef, useCallback, useState, useMemo } from "react";
import {
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  Text,
  Modal,
  Pressable,
  Animated,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { AuthContext } from "../../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import tw from "twrnc";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import debounce from "lodash/debounce";

const API_URL = "http://127.0.0.1:8000";
const WS_URL = "ws://127.0.0.1:8000"; // Customize this
const PLACEHOLDER_IMAGE = "https://via.placeholder.com/30";
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

const ChatScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { chatId, friendUsername, isGroup = false } = route.params || {};
  const { user, loading: authLoading, refreshToken } = useContext(AuthContext);
  const queryClient = useQueryClient();
  const flatListRef = useRef(null);
  const inputRef = useRef(null);
  const mounted = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current; // For message animation

  const [message, setMessage] = useState("");
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [queuedMessages, setQueuedMessages] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [showReactions, setShowReactions] = useState(null);
  const [liveLocation, setLiveLocation] = useState(null);

  const {
    messages,
    setMessages,
    sendMessage,
    isConnected,
    typingUsers,
    connectionStatus,
    lastError,
    closeConnection,
    subscribeToEvent,
    clearQueue,
  } = useWebSocket({ chatId, isGroup, userId: user?.id, maxReconnectAttempts: 10, wsUrl: WS_URL });

  const deduplicateMessages = useCallback((msgs) => {
    const messageMap = new Map();
    msgs.forEach((msg) => {
      const key = msg.id || msg.tempId;
      if (key) messageMap.set(key, msg);
    });
    return Array.from(messageMap.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!mounted.current) return [];
    const token = await AsyncStorage.getItem("token");
    if (!token) throw new Error("Authentication token missing. Please log in again.");
    const res = await axios.get(`${API_URL}/chat/get-messages/${chatId}/?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return Array.isArray(res.data) ? res.data : [];
  }, [chatId]);

  const fetchProfile = useCallback(async () => {
    if (!mounted.current) return {};
    const token = await AsyncStorage.getItem("token");
    if (!token) throw new Error("Authentication token missing. Please log in again.");
    const url = isGroup ? `${API_URL}/chat/rooms/${chatId}/` : `${API_URL}/profiles/friend/${friendUsername}/`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = res.data || {};
    if (!isGroup) {
      const lastSeen = data.last_seen ? new Date(data.last_seen) : null;
      data.is_online = lastSeen && new Date() - lastSeen < 5 * 60 * 1000;
    }
    return data;
  }, [chatId, isGroup, friendUsername]);

  const { data: fetchedMessages = [], isLoading: messagesLoading, error: messagesError, refetch: refetchMessages } = useQuery({
    queryKey: ["messages", chatId],
    queryFn: fetchMessages,
    enabled: !!chatId && !!user,
    staleTime: 5 * 60 * 1000,
    initialData: [],
    onSuccess: (data) => {
      if (mounted.current) setMessages((prev) => deduplicateMessages([...prev, ...data]));
    },
    onError: (error) => {
      console.error("Failed to fetch messages:", error.message);
    },
  });

  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery({
    queryKey: ["profile", chatId, friendUsername],
    queryFn: fetchProfile,
    enabled: !!chatId && !!user,
    staleTime: 5 * 60 * 1000,
  });

  const withTokenRefresh = useCallback(async (fn) => {
    if (!mounted.current) return;
    try {
      return await fn();
    } catch (error) {
      if (error.response?.status === 401 && refreshToken) {
        const newToken = await refreshToken();
        if (newToken) {
          await AsyncStorage.setItem("token", newToken);
          return await fn();
        }
      }
      throw error;
    }
  }, [refreshToken]);

  const markAsRead = useMutation({
    mutationFn: (messageIds) => withTokenRefresh(async () => {
      const token = await AsyncStorage.getItem("token");
      await Promise.all(
        messageIds.map((id) =>
          axios.post(`${API_URL}/chat/mark-as-read/${id}/`, {}, { headers: { Authorization: `Bearer ${token}` } })
        )
      );
    }),
    onSuccess: () => queryClient.invalidateQueries(["messages", chatId]),
  });

  const editMessage = useMutation({
    mutationFn: ({ messageId, content }) => withTokenRefresh(async () => {
      const token = await AsyncStorage.getItem("token");
      const res = await axios.post(`${API_URL}/chat/edit-message/${messageId}/`, { content }, { headers: { Authorization: `Bearer ${token}` } });
      return res.data;
    }),
    onSuccess: (updatedMessage) => {
      if (mounted.current) {
        setMessages((prev) => prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m)));
        setEditingMessageId(null);
        setMessage("");
      }
    },
  });

  const deleteMessage = useMutation({
    mutationFn: (messageId) => withTokenRefresh(async () => {
      const token = await AsyncStorage.getItem("token");
      await axios.delete(`${API_URL}/chat/delete-message/${messageId}/`, { headers: { Authorization: `Bearer ${token}` } });
    }),
    onSuccess: (_, messageId) => {
      if (mounted.current) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, is_deleted: true, content: "[Deleted]" } : m)));
      }
    },
  });

  const pinMessage = useMutation({
    mutationFn: (messageId) => withTokenRefresh(async () => {
      const token = await AsyncStorage.getItem("token");
      await axios.post(`${API_URL}/chat/pin-message/${chatId}/${messageId}/`, {}, { headers: { Authorization: `Bearer ${token}` } });
    }),
    onSuccess: (_, messageId) => {
      if (mounted.current) {
        setMessages((prev) => prev.map((m) => ({ ...m, isPinned: m.id === messageId })));
        queryClient.invalidateQueries(["profile", chatId]);
      }
    },
  });

  const addReaction = useMutation({
    mutationFn: ({ messageId, emoji }) => withTokenRefresh(async () => {
      const token = await AsyncStorage.getItem("token");
      await axios.post(`${API_URL}/chat/react-to-message/${messageId}/`, { emoji }, { headers: { Authorization: `Bearer ${token}` } });
    }),
    onSuccess: (_, { messageId, emoji }) => {
      if (mounted.current) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions: [...(m.reactions || []), emoji] } : m))
        );
        setShowReactions(null);
      }
    },
  });

  useEffect(() => {
    mounted.current = true;
    let isCancelled = false;

    const loadQueuedMessages = async () => {
      try {
        const stored = await AsyncStorage.getItem(`queuedMessages_${chatId}`);
        if (stored && !isCancelled && mounted.current) {
          setQueuedMessages(JSON.parse(stored) || []);
        }
      } catch (error) {
        console.error("Failed to load queued messages:", error);
      }
    };

    if (chatId) loadQueuedMessages();

    return () => {
      isCancelled = true;
      mounted.current = false;
    };
  }, [chatId]);

  useEffect(() => {
    if (!chatId || !user) return;

    const subscriptions = [
      subscribeToEvent("ack", (event) => {
        if (!mounted.current) return;
        setMessages((prev) =>
          prev.map((msg) => (msg.tempId === event.messageId ? { ...msg, id: event.serverId, tempId: null } : msg))
        );
      }),
      subscribeToEvent("message", (event) => {
        if (!mounted.current) return;
        setMessages((prev) => deduplicateMessages([...prev, event.message]));
        if (isAtBottom && event.message.sender.id !== user.id) {
          markAsRead.mutate([event.message.id]);
          sendMessage({ type: "seen", message_id: event.message.id });
        }
      }),
      subscribeToEvent("reaction", (event) => {
        if (!mounted.current) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, reactions: [...(m.reactions || []), event.emoji] } : m))
        );
      }),
      subscribeToEvent("pin", () => {
        if (mounted.current) queryClient.invalidateQueries(["profile", chatId]);
      }),
      subscribeToEvent("group_update", () => {
        if (mounted.current) queryClient.invalidateQueries(["profile", chatId]);
      }),
      subscribeToEvent("delivered", (event) => {
        if (!mounted.current) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, delivered_to: event.delivered_to } : m))
        );
      }),
      subscribeToEvent("seen", (event) => {
        if (!mounted.current) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, seen_by: event.seen_by } : m))
        );
      }),
    ];

    if (isConnected && queuedMessages.length > 0) {
      const remaining = queuedMessages.filter((msg) => !sendMessage(msg));
      setQueuedMessages(remaining);
      if (remaining.length === 0) clearQueue();
    }

    if (fetchedMessages.length > 0 && isAtBottom) {
      const unread = fetchedMessages.filter((msg) => !msg.seen_by?.some((u) => u.id === user.id));
      if (unread.length > 0) {
        markAsRead.mutate(unread.map((msg) => msg.id));
        unread.forEach((msg) => sendMessage({ type: "seen", message_id: msg.id }));
      }
    }

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      closeConnection();
      AsyncStorage.setItem(`queuedMessages_${chatId}`, JSON.stringify(queuedMessages)).catch(() => {});
    };
  }, [chatId, user, isConnected, queuedMessages, fetchedMessages, isAtBottom, sendMessage, clearQueue, subscribeToEvent, setMessages, markAsRead, closeConnection, deduplicateMessages, queryClient]);

  const handleSend = useCallback(async (type = "text", attachment, forwardId) => {
    if (!mounted.current || (!message.trim() && !attachment && type !== "location")) return;

    let attachmentUrl = null;
    if (type === "image" && attachment) {
      const token = await AsyncStorage.getItem("token");
      const formData = new FormData();
      formData.append("file", {
        uri: attachment.uri,
        type: attachment.type || "image/jpeg",
        name: attachment.fileName || `attachment_${Date.now()}.jpg`,
      });
      const res = await withTokenRefresh(() =>
        axios.post(`${API_URL}/chat/upload-attachment/${chatId}/`, formData, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
        })
      );
      attachmentUrl = res.data.file_url;
    } else if (type === "location" && liveLocation) {
      attachmentUrl = `geo:${liveLocation.latitude},${liveLocation.longitude}`;
    }

    // Simulate end-to-end encryption (for demo purposes)
    const encryptedContent = type === "text" ? btoa(message) : ""; // Base64 encoding as a placeholder

    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const payload = {
      content: encryptedContent,
      message_type: type,
      attachment_url: attachmentUrl,
      id: tempId,
      forward_id: forwardId,
    };

    if (editingMessageId) {
      editMessage.mutate({ messageId: editingMessageId, content: message });
      sendMessage({ type: "edit", message_id: editingMessageId, content: message });
      setEditingMessageId(null);
      setMessage("");
    } else {
      const newMessage = {
        id: tempId,
        tempId,
        sender: { id: user.id, username: user.username, profile_picture: user.profile_picture },
        content: type === "text" ? message : "", // Display decrypted content locally
        message_type: payload.message_type,
        attachment_url: payload.attachment_url,
        timestamp: new Date().toISOString(),
        delivered_to: [],
        seen_by: [],
        is_deleted: false,
        forwarded_from: forwardId ? messages.find((m) => m.id === forwardId) || null : null,
        reactions: [],
        isPinned: false,
        is_encrypted: true,
      };
      setMessages((prev) => deduplicateMessages([...prev, newMessage]));
      flatListRef.current?.scrollToEnd({ animated: true });
      if (!sendMessage(payload)) {
        setQueuedMessages((prev) => deduplicateMessages([...prev, payload]));
      } else if (type === "text") {
        setMessage("");
      }
    }
    setPreviewImage(null);
    if (type === "location") setLiveLocation(null);

    // Animate new message
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [message, sendMessage, chatId, editingMessageId, user, setMessages, messages, editMessage, withTokenRefresh, deduplicateMessages, liveLocation, fadeAnim]);

  const pickMedia = useCallback(async () => {
    if (!mounted.current) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission required", "Please allow media access.");
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && mounted.current) setPreviewImage(result.assets[0].uri);
  }, []);

  const shareLiveLocation = useCallback(async () => {
    if (!mounted.current) return;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission required", "Please allow location access.");
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    if (mounted.current) {
      setLiveLocation({ latitude: location.coords.latitude, longitude: location.coords.longitude });
      handleSend("location");
    }
  }, [handleSend]);

  const debouncedTyping = useMemo(
    () => debounce((text) => mounted.current && text && isConnected && sendMessage({ type: "typing", user: user?.id }), 300),
    [isConnected, sendMessage, user?.id]
  );

  const handleEdit = useCallback((msg) => {
    if (!mounted.current || msg.sender.id !== user?.id || msg.is_deleted) return;
    setEditingMessageId(msg.id);
    setMessage(msg.content);
    inputRef.current?.focus();
  }, [user?.id]);

  const handleDelete = useCallback((messageId) => {
    if (!mounted.current || messages.find((m) => m.id === messageId)?.sender.id !== user?.id) return;
    Alert.alert("Delete Message", "Are you sure?", [
      { text: "Cancel" },
      {
        text: "Delete",
        onPress: () => {
          deleteMessage.mutate(messageId);
          sendMessage({ type: "delete", message_id: messageId });
        },
        style: "destructive",
      },
    ]);
  }, [messages, user?.id, deleteMessage, sendMessage]);

  const handleForward = useCallback((messageId) => {
    if (!mounted.current) return;
    navigation.navigate("ForwardMessage", { messageId, currentChatId: chatId });
  }, [navigation, chatId]);

  const handlePin = useCallback((messageId) => {
    if (!mounted.current || !isGroup || !profile?.admins?.some((admin) => admin.id === user.id)) return;
    pinMessage.mutate(messageId);
    sendMessage({ type: "pin", message_id: messageId });
  }, [isGroup, profile?.admins, user?.id, pinMessage, sendMessage]);

  const handleReact = useCallback((messageId, emoji) => {
    if (!mounted.current) return;
    addReaction.mutate({ messageId, emoji });
    sendMessage({ type: "reaction", message_id: messageId, emoji });
  }, [addReaction, sendMessage]);

  const renderMessage = useCallback(({ item }) => {
    const isSent = item.sender?.id === user?.id;
    const seenBy = Array.isArray(item.seen_by) ? item.seen_by : [];
    const deliveredTo = Array.isArray(item.delivered_to) ? item.delivered_to : [];
    const reactions = Array.isArray(item.reactions) ? item.reactions : [];
    const status = seenBy.some((u) => u.id !== user.id) ? "✓✓" : deliveredTo.some((u) => u.id !== user.id) ? "✓✓" : item.tempId ? "⌛" : "✓";
    const statusColor = seenBy.some((u) => u.id !== user.id) ? "blue" : deliveredTo.some((u) => u.id !== user.id) ? "gray" : item.tempId ? "gray" : "gray";
    const isEdited = item.edited_at && new Date(item.edited_at) > new Date(item.timestamp);

    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <View style={tw`relative ${item.isPinned ? "bg-yellow-50" : ""} mx-2 my-1 rounded-lg`}>
          <TouchableOpacity
            style={tw`flex-row ${isSent ? "self-end" : "self-start"} items-${isSent ? "end" : "start"}`}
            onLongPress={() =>
              Alert.alert("Actions", "", [
                ...(isSent && !item.is_deleted ? [
                  { text: "Edit", onPress: () => handleEdit(item) },
                  { text: "Delete", onPress: () => handleDelete(item.id) },
                ] : []),
                { text: "Forward", onPress: () => handleForward(item.id) },
                ...(isGroup && profile?.admins?.some((a) => a.id === user.id) ? [
                  { text: item.isPinned ? "Unpin" : "Pin", onPress: () => handlePin(item.id) },
                ] : []),
                { text: "React", onPress: () => setShowReactions(item.id) },
                { text: "Cancel" },
              ])
            }
          >
            {!isSent && (
              <Image
                source={{ uri: item.sender?.profile_picture || PLACEHOLDER_IMAGE }}
                style={tw`w-8 h-8 rounded-full mr-2`}
              />
            )}
            <View
              style={tw`bg-${isSent ? "green-100" : "white"} p-3 rounded-xl max-w-[70%] shadow-sm border border-gray-200 ${isSent ? "rounded-br-none" : "rounded-bl-none"}`}
            >
              {!isSent && <Text style={tw`text-blue-600 text-xs font-semibold`}>{item.sender?.username || "Unknown"}</Text>}
              {item.forwarded_from && (
                <Text style={tw`text-gray-500 text-xs italic border-l-2 border-gray-300 pl-1`}>
                  Forwarded from {item.forwarded_from.sender?.username || "Unknown"}
                </Text>
              )}
              {item.is_encrypted && (
                <View style={tw`flex-row items-center mb-1`}>
                  <Ionicons name="lock-closed" size={12} color="gray" style={tw`mr-1`} />
                  <Text style={tw`text-gray-500 text-xs`}>End-to-end encrypted</Text>
                </View>
              )}
              {item.message_type === "text" && (
                <Text style={tw`text-gray-800 ${item.is_deleted ? "italic text-gray-500" : ""}`}>
                  {item.is_deleted ? "[Deleted]" : item.content}
                </Text>
              )}
              {item.message_type === "image" && (
                <Image source={{ uri: item.attachment_url || PLACEHOLDER_IMAGE }} style={tw`w-40 h-40 rounded-md`} />
              )}
              {item.message_type === "location" && (
                <Text style={tw`text-blue-500`}>Location: {item.attachment_url}</Text>
              )}
              <View style={tw`flex-row justify-between items-center mt-1`}>
                <Text style={tw`text-gray-400 text-xs`}>
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {isEdited && " (Edited)"}
                </Text>
                {isSent && (
                  <Text style={tw`text-${statusColor}-500 text-xs`}>{status}</Text>
                )}
              </View>
              {reactions.length > 0 && (
                <View style={tw`flex-row mt-1`}>
                  {reactions.map((emoji, idx) => (
                    <Text key={idx} style={tw`text-sm mr-1`}>{emoji}</Text>
                  ))}
                </View>
              )}
            </View>
          </TouchableOpacity>
          {showReactions === item.id && (
            <View style={tw`absolute bottom-0 ${isSent ? "right-0" : "left-0"} bg-white p-2 rounded-lg shadow`}>
              {REACTION_EMOJIS.map((emoji) => (
                <Pressable key={emoji} onPress={() => handleReact(item.id, emoji)} style={tw`p-1`}>
                  <Text style={tw`text-lg`}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </Animated.View>
    );
  }, [user?.id, isGroup, profile?.admins, handleEdit, handleDelete, handleForward, handlePin, handleReact, showReactions, fadeAnim]);

  const handleScroll = useCallback(({ nativeEvent }) => {
    if (!mounted.current) return;
    const isBottom = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 20;
    setIsAtBottom(isBottom);
  }, []);

  const filteredMessages = useMemo(() => {
    if (!searchFilter) return messages;
    return messages.filter((msg) => msg.content?.toLowerCase().includes(searchFilter.toLowerCase()));
  }, [messages, searchFilter]);

  const Header = useMemo(() => (
    <View style={tw`p-2 bg-white border-b border-gray-200`}>
      <View style={tw`flex-row items-center justify-between`}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={tw`p-2`}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <TouchableOpacity
          style={tw`flex-row items-center flex-1`}
          onPress={() => navigation.navigate(isGroup ? "GroupProfile" : "FriendProfile", { chatId, username: friendUsername })}
        >
          <Image
            source={{ uri: profile?.profile_picture || PLACEHOLDER_IMAGE }}
            style={tw`w-10 h-10 rounded-full mr-2`}
          />
          <View style={tw`flex-1`}>
            <Text style={tw`text-lg font-semibold text-gray-800`}>
              {isGroup ? profile?.name || `Group ${chatId}` : profile?.username || friendUsername}
            </Text>
            {!isGroup && (
              <Text style={tw`text-xs ${profile?.is_online ? "text-green-500" : "text-gray-500"}`}>
                {profile?.is_online ? "Online" : profile?.last_seen ? `Last seen ${new Date(profile.last_seen).toLocaleTimeString()}` : ""}
              </Text>
            )}
          </View>
        </TouchableOpacity>
        <View style={tw`flex-row items-center`}>
          <TouchableOpacity onPress={shareLiveLocation} style={tw`p-2`}>
            <Ionicons name="location" size={24} color="#007AFF" />
          </TouchableOpacity>
          <Text style={tw`text-xs ${lastError ? "text-red-500" : "text-gray-500"} capitalize mr-2`}>
            {lastError || (isConnected ? "Connected" : connectionStatus)}
          </Text>
        </View>
      </View>
      <TextInput
        style={tw`bg-gray-200 rounded-full px-3 py-1 mt-2`}
        placeholder="Search messages..."
        value={searchFilter}
        onChangeText={setSearchFilter}
      />
    </View>
  ), [navigation, isGroup, chatId, friendUsername, profile, lastError, connectionStatus, isConnected, shareLiveLocation, searchFilter]);

  if (authLoading || messagesLoading || profileLoading) {
    return <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />;
  }

  if (messagesError || profileError) {
    return (
      <View style={tw`flex-1 justify-center items-center bg-gray-100`}>
        <Text style={tw`text-red-500 mb-4`}>{messagesError?.message || profileError?.message || "Failed to load chat"}</Text>
        <Text style={tw`text-gray-500`}>Retrying automatically...</Text>
      </View>
    );
  }

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      {Header}
      {profile?.pinned_message && (
        <View style={tw`bg-yellow-50 p-2 border-b border-gray-200 flex-row items-center`}>
          <Ionicons name="pin" size={16} color="#666" style={tw`mr-1`} />
          <Text style={tw`text-sm text-gray-700 flex-1`}>{profile.pinned_message.content}</Text>
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={filteredMessages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id || item.tempId || `${Date.now()}-${Math.random()}`}
        onContentSizeChange={() => isAtBottom && flatListRef.current?.scrollToEnd({ animated: false })}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        initialNumToRender={20}
        ListEmptyComponent={
          <View style={tw`flex-1 justify-center items-center mt-5`}>
            <Text style={tw`text-gray-500`}>No messages yet</Text>
            {lastError && (
              <Text style={tw`text-red-500 mt-2`}>Connection issue. Retrying automatically...</Text>
            )}
          </View>
        }
        contentContainerStyle={tw`pb-2 flex-grow`}
      />
      {typingUsers.length > 0 && (
        <Text style={tw`text-xs text-gray-500 p-1 bg-gray-200`}>
          {isGroup ? `${typingUsers.join(", ")} typing...` : `${friendUsername} is typing...`}
        </Text>
      )}
      {!isAtBottom && (
        <TouchableOpacity
          style={tw`absolute bottom-16 right-4 bg-blue-500 p-2 rounded-full shadow`}
          onPress={() => flatListRef.current?.scrollToEnd({ animated: true })}
        >
          <Ionicons name="chevron-down" size={20} color="white" />
        </TouchableOpacity>
      )}
      <View style={tw`bg-white border-t border-gray-200 p-2`}>
        <View style={tw`flex-row items-center`}>
          <TouchableOpacity onPress={pickMedia} style={tw`p-2`}>
            <Ionicons name="image" size={24} color="#007AFF" />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={tw`flex-1 bg-gray-200 rounded-full px-3 py-1 mx-2 text-base`}
            value={message}
            onChangeText={(text) => {
              setMessage(text);
              debouncedTyping(text);
            }}
            placeholder={editingMessageId ? "Edit message..." : "Type a message..."}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity onPress={() => handleSend("text")} style={tw`p-2`}>
            <Ionicons name={editingMessageId ? "checkmark" : "send"} size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </View>
      <Modal visible={!!previewImage} transparent animationType="fade">
        <View style={tw`flex-1 bg-black bg-opacity-80 justify-center items-center`}>
          <Image source={{ uri: previewImage }} style={tw`w-80 h-80 rounded-lg`} resizeMode="contain" />
          <View style={tw`flex-row mt-4`}>
            <TouchableOpacity onPress={() => setPreviewImage(null)} style={tw`p-2 mx-2`}>
              <Ionicons name="close" size={32} color="white" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleSend("image", { uri: previewImage })} style={tw`p-2 mx-2`}>
              <Ionicons name="send" size={32} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default ChatScreen;