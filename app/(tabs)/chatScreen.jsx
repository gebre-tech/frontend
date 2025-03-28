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
const PLACEHOLDER_IMAGE = "https://via.placeholder.com/30";
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

/**
 * @typedef {Object} Message
 * @property {string} id - Message ID
 * @property {string} [tempId] - Temporary client-side ID
 * @property {{id: string, username: string, profile_picture?: string}} sender - Sender details
 * @property {string} content - Message content
 * @property {string} message_type - Type (e.g., "text", "image", "location")
 * @property {string} [attachment_url] - Attachment URL
 * @property {string} timestamp - ISO timestamp
 * @property {{id: string}[]} delivered_to - Users who received the message
 * @property {{id: string}[]} seen_by - Users who saw the message
 * @property {boolean} is_deleted - Deletion status
 * @property {Message} [forwarded_from] - Forwarded message details
 * @property {string} [edited_at] - Edit timestamp
 * @property {string[]} [reactions] - Reactions to the message
 * @property {boolean} [isPinned] - Pinned status
 */

/**
 * @typedef {Object} ChatScreenProps
 * @property {string} chatId - Chat room ID
 * @property {string} friendUsername - Friend's username (for non-group chats)
 * @property {boolean} [isGroup] - Whether it's a group chat
 */

const ChatScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { chatId, friendUsername, isGroup = false } = /** @type {ChatScreenProps} */ (route.params || {});
  const { user, loading: authLoading, refreshToken } = useContext(AuthContext);
  const queryClient = useQueryClient();
  const flatListRef = useRef(null);
  const inputRef = useRef(null);

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
    ConnectionStatus,
  } = useWebSocket({ chatId, isGroup, userId: user?.id, maxReconnectAttempts: 10 });

  // Debugging: Log WebSocket state
  useEffect(() => {
    console.log(`[WebSocket Debug] chatId: ${chatId}, isConnected: ${isConnected}, status: ${connectionStatus}, error: ${lastError}`);
  }, [chatId, isConnected, connectionStatus, lastError]);

  // Load queued messages
  useEffect(() => {
    const loadQueuedMessages = async () => {
      try {
        const stored = await AsyncStorage.getItem(`queuedMessages_${chatId}`);
        if (stored) {
          const queued = JSON.parse(stored);
          setQueuedMessages(queued);
          console.log(`[Debug] Loaded queued messages: ${queued.length}`);
        }
      } catch (error) {
        console.error("[Debug] Failed to load queued messages:", error);
      }
    };
    loadQueuedMessages();
  }, [chatId]);

  // Persist queued messages
  useEffect(() => {
    AsyncStorage.setItem(`queuedMessages_${chatId}`, JSON.stringify(queuedMessages)).catch((error) =>
      console.error("[Debug] Failed to save queued messages:", error)
    );
  }, [queuedMessages, chatId]);

  // Deduplicate messages helper
  const deduplicateMessages = useCallback((msgs) => {
    const messageMap = new Map();
    msgs.forEach((msg) => {
      const key = msg.id || msg.tempId;
      if (key) messageMap.set(key, msg); // Only add if key exists
    });
    const result = Array.from(messageMap.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    console.log("[Debug] Deduplicated message keys:", result.map((m) => m.id || m.tempId));
    return result;
  }, []);

  // Fetch messages with pagination
  const { data: fetchedMessages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["messages", chatId],
    queryFn: async () => {
      const token = await AsyncStorage.getItem("token");
      console.log("[Debug] Fetching messages with token:", token?.slice(0, 10));
      const res = await axios.get(`${API_URL}/chat/get-messages/${chatId}/?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!chatId && !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
    initialData: [],
    onSuccess: (data) => {
      setMessages((prev) => deduplicateMessages([...prev, ...data]));
    },
    onError: (error) => {
      console.error("[Debug] Fetch messages error:", error.response?.data || error.message);
      Alert.alert("Error", "Failed to load messages");
    },
  });

  // Fetch profile
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile", chatId, friendUsername],
    queryFn: async () => {
      const token = await AsyncStorage.getItem("token");
      const url = isGroup ? `${API_URL}/chat/rooms/${chatId}/` : `${API_URL}/profiles/friend/${friendUsername}/`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = res.data || {};
      if (!isGroup) {
        const lastSeen = data.last_seen ? new Date(data.last_seen) : null;
        data.is_online = lastSeen && new Date() - lastSeen < 5 * 60 * 1000;
      }
      console.log("[Debug] Profile fetched:", data.username || data.name);
      return data;
    },
    enabled: !!chatId && !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Token refresh wrapper
  const withTokenRefresh = useCallback(
    async (fn) => {
      try {
        return await fn();
      } catch (error) {
        if (error.response?.status === 401 && refreshToken) {
          console.log("[Debug] Token expired, attempting refresh");
          const newToken = await refreshToken();
          if (newToken) {
            await AsyncStorage.setItem("token", newToken);
            return await fn();
          }
        }
        throw error;
      }
    },
    [refreshToken]
  );

  // Mutations
  const markAsRead = useMutation({
    mutationFn: (messageIds) =>
      withTokenRefresh(async () => {
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
    mutationFn: ({ messageId, content }) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem("token");
        const res = await axios.post(`${API_URL}/chat/edit-message/${messageId}/`, { content }, { headers: { Authorization: `Bearer ${token}` } });
        return res.data;
      }),
    onSuccess: (updatedMessage) => {
      setMessages((prev) => prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m)));
      setEditingMessageId(null);
      setMessage("");
    },
    onError: () => Alert.alert("Error", "Failed to edit message"),
  });

  const deleteMessage = useMutation({
    mutationFn: (messageId) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem("token");
        await axios.delete(`${API_URL}/chat/delete-message/${messageId}/`, { headers: { Authorization: `Bearer ${token}` } });
      }),
    onSuccess: (_, messageId) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, is_deleted: true, content: "[Deleted]" } : m)));
    },
    onError: () => Alert.alert("Error", "Failed to delete message"),
  });

  const pinMessage = useMutation({
    mutationFn: (messageId) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem("token");
        await axios.post(`${API_URL}/chat/pin-message/${chatId}/${messageId}/`, {}, { headers: { Authorization: `Bearer ${token}` } });
      }),
    onSuccess: (_, messageId) => {
      setMessages((prev) => prev.map((m) => ({ ...m, isPinned: m.id === messageId })));
      queryClient.invalidateQueries(["profile", chatId]);
    },
  });

  const addReaction = useMutation({
    mutationFn: ({ messageId, emoji }) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem("token");
        await axios.post(`${API_URL}/chat/react-to-message/${messageId}/`, { emoji }, { headers: { Authorization: `Bearer ${token}` } });
      }),
    onSuccess: (_, { messageId, emoji }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions: [...(m.reactions || []), emoji] } : m))
      );
      setShowReactions(null);
    },
  });

  // Sync queued messages
  useEffect(() => {
    if (isConnected && queuedMessages.length > 0) {
      const remaining = queuedMessages.filter((msg) => !sendMessage(msg));
      setQueuedMessages(remaining);
      if (remaining.length === 0) clearQueue();
      console.log("[Debug] Queued messages synced, remaining:", remaining.length);
    }
  }, [isConnected, queuedMessages, sendMessage, clearQueue]);

  // Validate and mark unread messages
  useEffect(() => {
    if (!chatId || !user) {
      navigation.goBack();
      return;
    }
    if (fetchedMessages.length > 0 && isAtBottom) {
      const unread = fetchedMessages.filter((msg) => !msg.seen_by?.some((u) => u.id === user.id));
      if (unread.length > 0) {
        markAsRead.mutate(unread.map((msg) => msg.id));
        console.log("[Debug] Marking unread messages:", unread.length);
      }
    }
  }, [chatId, user, fetchedMessages, markAsRead, navigation, isAtBottom]);

  // WebSocket subscriptions
  useEffect(() => {
    const subscriptions = [
      subscribeToEvent("ack", (event) => {
        setMessages((prev) =>
          prev.map((msg) => (msg.tempId === event.messageId ? { ...msg, id: event.serverId, tempId: null } : msg))
        );
      }),
      subscribeToEvent("message", (event) => {
        setMessages((prev) => deduplicateMessages([...prev, event.message]));
        if (isAtBottom && event.message.sender.id !== user.id) {
          markAsRead.mutate([event.message.id]);
        }
      }),
      subscribeToEvent("reaction", (event) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, reactions: [...(m.reactions || []), event.emoji] } : m))
        );
      }),
      subscribeToEvent("pin", () => queryClient.invalidateQueries(["profile", chatId])),
      subscribeToEvent("group_update", () => queryClient.invalidateQueries(["profile", chatId])),
    ];
    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      closeConnection();
    };
  }, [subscribeToEvent, setMessages, queryClient, chatId, user?.id, isAtBottom, markAsRead, deduplicateMessages, closeConnection]);

  // Send message
  const handleSend = useCallback(
    async (type = "text", attachment, forwardId) => {
      if (!message.trim() && !attachment && type !== "location") return;

      try {
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

        const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const payload = {
          content: type === "text" ? message : "",
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
            content: payload.content,
            message_type: payload.message_type,
            attachment_url: payload.attachment_url,
            timestamp: new Date().toISOString(),
            delivered_to: [],
            seen_by: [],
            is_deleted: false,
            forwarded_from: forwardId ? messages.find((m) => m.id === forwardId) || null : null,
            reactions: [],
            isPinned: false,
          };

          setMessages((prev) => deduplicateMessages([...prev, newMessage]));
          flatListRef.current?.scrollToEnd({ animated: true });
          if (!sendMessage(payload)) {
            setQueuedMessages((prev) => deduplicateMessages([...prev, payload]));
          } else if (type === "text") {
            setMessage("");
          }
        }
      } catch (error) {
        console.error("[Debug] Send error:", error.response?.data || error.message);
        Alert.alert("Error", "Failed to send. Queued.");
      } finally {
        setPreviewImage(null);
        if (type === "location") setLiveLocation(null);
      }
    },
    [message, sendMessage, chatId, editingMessageId, user, setMessages, messages, editMessage, withTokenRefresh, deduplicateMessages, liveLocation]
  );

  // Media picker
  const pickMedia = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission required", "Please allow media access.");
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled) setPreviewImage(result.assets[0].uri);
  }, []);

  // Live location sharing
  const shareLiveLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission required", "Please allow location access.");
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setLiveLocation({ latitude: location.coords.latitude, longitude: location.coords.longitude });
    handleSend("location");
  }, [handleSend]);

  // Debounced typing
  const debouncedTyping = useMemo(
    () => debounce((text) => text && isConnected && sendMessage({ type: "typing", user: user?.id }), 300),
    [isConnected, sendMessage, user?.id]
  );

  // Message actions
  const handleEdit = useCallback((msg) => {
    if (msg.sender.id === user?.id && !msg.is_deleted) {
      setEditingMessageId(msg.id);
      setMessage(msg.content);
      inputRef.current?.focus();
    }
  }, [user?.id]);

  const handleDelete = useCallback(
    (messageId) => {
      if (messages.find((m) => m.id === messageId)?.sender.id === user?.id) {
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
      }
    },
    [messages, user?.id, deleteMessage, sendMessage]
  );

  const handleForward = useCallback(
    (messageId) => navigation.navigate("ForwardMessage", { messageId, currentChatId: chatId }),
    [navigation, chatId]
  );

  const handlePin = useCallback(
    (messageId) => {
      if (isGroup && profile?.admins?.some((admin) => admin.id === user.id)) {
        pinMessage.mutate(messageId);
        sendMessage({ type: "pin", message_id: messageId });
      }
    },
    [isGroup, profile?.admins, user?.id, pinMessage, sendMessage]
  );

  const handleReact = useCallback(
    (messageId, emoji) => {
      addReaction.mutate({ messageId, emoji });
      sendMessage({ type: "reaction", message_id: messageId, emoji });
    },
    [addReaction, sendMessage]
  );

  // Render message
  const renderMessage = useCallback(
    ({ item }) => {
      const isSent = item.sender?.id === user?.id;
      const seenBy = Array.isArray(item.seen_by) ? item.seen_by : [];
      const deliveredTo = Array.isArray(item.delivered_to) ? item.delivered_to : [];
      const reactions = Array.isArray(item.reactions) ? item.reactions : [];
      const status = seenBy.length > (isGroup ? 1 : 0) ? "✓✓" : deliveredTo.length > (isGroup ? 1 : 0) ? "✓✓" : item.tempId ? "⌛" : "✓";
      const isEdited = item.edited_at && new Date(item.edited_at) > new Date(item.timestamp);

      return (
        <View style={tw`relative ${item.isPinned ? "bg-yellow-50" : ""} mx-2 my-1 rounded-lg`}>
          <TouchableOpacity
            style={tw`flex-row ${isSent ? "self-end" : "self-start"} items-${isSent ? "end" : "start"}`}
            onLongPress={() =>
              Alert.alert("Actions", "", [
                ...(isSent && !item.is_deleted
                  ? [
                      { text: "Edit", onPress: () => handleEdit(item) },
                      { text: "Delete", onPress: () => handleDelete(item.id) },
                    ]
                  : []),
                { text: "Forward", onPress: () => handleForward(item.id) },
                ...(isGroup && profile?.admins?.some((a) => a.id === user.id)
                  ? [{ text: item.isPinned ? "Unpin" : "Pin", onPress: () => handlePin(item.id) }]
                  : []),
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
            <View style={tw`bg-${isSent ? "blue-100" : "white"} p-2 rounded-xl max-w-[70%] shadow-sm`}>
              {!isSent && <Text style={tw`text-blue-600 text-xs font-semibold`}>{item.sender?.username || "Unknown"}</Text>}
              {item.forwarded_from && (
                <Text style={tw`text-gray-500 text-xs italic border-l-2 border-gray-300 pl-1`}>
                  Forwarded from {item.forwarded_from.sender?.username || "Unknown"}
                </Text>
              )}
              {item.message_type === "text" && (
                <Text style={tw`text-gray-800 ${item.is_deleted ? "italic text-gray-500" : ""}`}>
                  {item.content}
                </Text>
              )}
              {item.message_type === "image" && (
                <Image source={{ uri: item.attachment_url || PLACEHOLDER_IMAGE }} style={tw`w-40 h-40 rounded-md`} />
              )}
              {item.message_type === "location" && (
                <Text style={tw`text-blue-500`}>Location: {item.attachment_url}</Text>
              )}
              <Text style={tw`text-gray-400 text-xs mt-1`}>
                {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {isEdited && " (Edited)"}
                {isSent && ` ${status}`}
              </Text>
              {reactions.length > 0 && (
                <View style={tw`flex-row mt-1`}>
                  {reactions.map((emoji, idx) => (
                    <Text key={idx} style={tw`text-sm mr-1`}>
                      {emoji}
                    </Text>
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
      );
    },
    [user?.id, isGroup, profile?.admins, handleEdit, handleDelete, handleForward, handlePin, handleReact, showReactions]
  );

  // Scroll tracking
  const handleScroll = useCallback(({ nativeEvent }) => {
    const isBottom = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 20;
    setIsAtBottom(isBottom);
  }, []);

  // Filtered messages
  const filteredMessages = useMemo(() => {
    if (!searchFilter) return messages;
    return messages.filter((msg) => msg.content?.toLowerCase().includes(searchFilter.toLowerCase()));
  }, [messages, searchFilter]);

  // Memoized header
  const Header = useMemo(
    () => (
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
    ),
    [navigation, isGroup, chatId, friendUsername, profile, lastError, connectionStatus, isConnected, shareLiveLocation, searchFilter]
  );

  if (authLoading || messagesLoading || profileLoading) {
    return <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />;
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
        ListEmptyComponent={<Text style={tw`text-center mt-5 text-gray-500`}>No messages yet</Text>}
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