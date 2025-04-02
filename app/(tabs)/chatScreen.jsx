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
  KeyboardAvoidingView,
  Platform,
  Animated,
} from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import { AuthContext } from "../../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Video } from "expo-av";
import tw from "twrnc";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import debounce from "lodash/debounce";

const API_URL = "http://127.0.0.1:8000";
const PLACEHOLDER_IMAGE = "https://via.placeholder.com/30";
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const PAGE_SIZE = 50;

const isUserOnline = (lastSeen) => {
  const now = new Date();
  const lastSeenDate = lastSeen ? new Date(lastSeen) : null;
  return lastSeenDate && now - lastSeenDate < 5 * 60 * 1000;
};

const logger = {
  info: (...args) => console.log("[ChatScreen]", ...args),
  error: (...args) => console.error("[ChatScreen]", ...args),
};

const VideoMessage = ({ uri }) => {
  const [error, setError] = useState(null);
  const videoRef = useRef(null);

  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.stopAsync().catch(() => {});
      }
    };
  }, [uri]);

  if (!uri) return <Text style={tw`text-gray-500`}>Loading video...</Text>;
  if (error) return <Text style={tw`text-red-500`}>Video failed: {error}</Text>;

  return (
    <Video
      ref={videoRef}
      source={{ uri }}
      style={tw`w-48 h-48 rounded-xl shadow-sm`}
      useNativeControls
      resizeMode="contain"
      isMuted={true}
      onError={(e) => setError(e.error?.message || "Unknown error")}
    />
  );
};

const ChatScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { chatId, friendUsername, isGroup = false } = route.params || {};
  const { user, loading: authLoading, refreshToken } = useContext(AuthContext);
  const queryClient = useQueryClient();
  const flatListRef = useRef(null);
  const inputRef = useRef(null);
  const isMountedRef = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [message, setMessage] = useState("");
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [queuedMessages, setQueuedMessages] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showReactions, setShowReactions] = useState(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);

  const {
    messages,
    setMessages,
    sendMessage,
    isConnected,
    typingUsers,
    retryConnection,
    subscribeToEvent,
    clearQueue,
  } = useWebSocket({ chatId, isGroup, userId: user?.id });

  const deduplicateMessages = useCallback((msgs) => {
    const map = new Map();
    msgs.forEach((msg) => {
      const key = msg.id || msg.tempId;
      if (key && !map.has(key)) {
        map.set(key, msg);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, []);

  const fetchMessages = useCallback(
    async (pageNum) => {
      try {
        const token = await AsyncStorage.getItem("token");
        const offset = (pageNum - 1) * PAGE_SIZE;
        const { data } = await axios.get(
          `${API_URL}/chat/get-messages/${chatId}/?limit=${PAGE_SIZE}&offset=${offset}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const deduplicatedData = deduplicateMessages(data);
        await AsyncStorage.setItem(`chat-${chatId}-page-${pageNum}`, JSON.stringify(deduplicatedData));
        return deduplicatedData;
      } catch (error) {
        logger.error("Error fetching messages:", error);
        const cached = await AsyncStorage.getItem(`chat-${chatId}-page-${pageNum}`);
        return cached ? deduplicateMessages(JSON.parse(cached)) : [];
      }
    },
    [chatId, deduplicateMessages]
  );

  const loadInitialMessages = useCallback(async () => {
    try {
      const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
      if (cachedMessages) {
        setMessages(deduplicateMessages(JSON.parse(cachedMessages)));
      }

      const serverMessages = await fetchMessages(1);
      setMessages(deduplicateMessages(serverMessages));
      setHasMoreMessages(serverMessages.length >= PAGE_SIZE);

      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 100);
    } catch (error) {
      logger.error("Error loading initial messages:", error);
    }
  }, [chatId, fetchMessages, setMessages, deduplicateMessages]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMoreMessages) return;

    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const newMessages = await fetchMessages(nextPage);
      setMessages((prev) => deduplicateMessages([...newMessages, ...prev]));
      setPage(nextPage);
      setHasMoreMessages(newMessages.length >= PAGE_SIZE);
    } catch (error) {
      logger.error("Error loading more messages:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreMessages, page, fetchMessages, deduplicateMessages, setMessages]);

  const handleScroll = useCallback(
    ({ nativeEvent }) => {
      const { contentOffset } = nativeEvent;
      setIsAtBottom(
        contentOffset.y + nativeEvent.layoutMeasurement.height >=
          nativeEvent.contentSize.height - 20
      );

      if (contentOffset.y <= 100 && !loadingMore && hasMoreMessages) {
        loadMoreMessages();
      }
    },
    [loadingMore, hasMoreMessages, loadMoreMessages]
  );

  useFocusEffect(
    useCallback(() => {
      loadInitialMessages();
      setQueuedMessages([]);
      clearQueue();
      return () => {
        isMountedRef.current = false;
      };
    }, [loadInitialMessages, clearQueue])
  );

  const handleNewMessage = useCallback(
    async (newMessage) => {
      if (!newMessage.content && !newMessage.attachment_url) return;

      const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
      const messages = cachedMessages ? JSON.parse(cachedMessages) : [];
      const updatedMessages = deduplicateMessages([...messages, newMessage]);
      await AsyncStorage.setItem(`chat-${chatId}-page-1`, JSON.stringify(updatedMessages));

      setMessages((prev) => {
        const updated = deduplicateMessages([...prev, newMessage]);
        if (isAtBottom) {
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        }
        return updated;
      });
    },
    [chatId, isAtBottom, deduplicateMessages]
  );

  useEffect(() => {
    const unsubscribers = [
      subscribeToEvent("message", handleNewMessage),
      subscribeToEvent("ack", async (event) => {
        const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
        if (cachedMessages) {
          const messages = JSON.parse(cachedMessages);
          const updatedMessages = messages.map((msg) =>
            msg.tempId === event.messageId ? { ...msg, id: event.serverId, tempId: null } : msg
          );
          await AsyncStorage.setItem(`chat-${chatId}-page-1`, JSON.stringify(deduplicateMessages(updatedMessages)));
        }

        setMessages((prev) => {
          const updated = prev.map((msg) =>
            msg.tempId === event.messageId ? { ...msg, id: event.serverId, tempId: null } : msg
          );
          return deduplicateMessages(updated);
        });
      }),
      subscribeToEvent("reaction", async (event) => {
        const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
        if (cachedMessages) {
          const messages = JSON.parse(cachedMessages);
          const updatedMessages = messages.map((m) =>
            m.id === event.message_id
              ? { ...m, reactions: [...(m.reactions || []), event.emoji] }
              : m
          );
          await AsyncStorage.setItem(`chat-${chatId}-page-1`, JSON.stringify(deduplicateMessages(updatedMessages)));
        }

        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === event.message_id
              ? { ...m, reactions: [...(m.reactions || []), event.emoji] }
              : m
          );
          return deduplicateMessages(updated);
        });
      }),
      subscribeToEvent("pin", () => queryClient.invalidateQueries(["profile", chatId])),
      subscribeToEvent("group_update", () => queryClient.invalidateQueries(["profile", chatId])),
    ];
    return () => unsubscribers.forEach((unsub) => unsub());
  }, [subscribeToEvent, handleNewMessage, chatId, queryClient, deduplicateMessages]);

  useEffect(() => {
    if (isConnected && queuedMessages.length) {
      const remaining = queuedMessages.filter((msg) => {
        if (!msg.content && !msg.attachment_url) {
          logger.info("Skipping empty queued message:", msg);
          return false;
        }
        return !sendMessage(msg);
      });
      if (isMountedRef.current) {
        setQueuedMessages(deduplicateMessages(remaining));
        if (!remaining.length) clearQueue();
      }
    }
  }, [isConnected, queuedMessages, sendMessage, clearQueue, deduplicateMessages]);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile", chatId, friendUsername],
    queryFn: async () => {
      const token = await AsyncStorage.getItem("token");
      const url = isGroup
        ? `${API_URL}/chat/rooms/${chatId}/`
        : `${API_URL}/profiles/friend/${friendUsername}/`;
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!isGroup && data.last_seen) {
        data.is_online = isUserOnline(data.last_seen);
      }
      return data;
    },
    enabled: !!chatId && !!user,
    staleTime: 5 * 60 * 1000,
  });

  const withTokenRefresh = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (error) {
      if (error.response?.status === 401 && refreshToken && isMountedRef.current) {
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
    mutationFn: (messageIds) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem("token");
        await axios.post(
          `${API_URL}/chat/mark-as-read/batch/`,
          { message_ids: messageIds },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }),
    onSuccess: async (_, messageIds) => {
      queryClient.invalidateQueries(["messages", chatId]);
      setMessages((prev) => {
        const updatedMessages = prev.map((msg) => {
          if (messageIds.includes(msg.id) && !msg.seen_by?.some((u) => u.id === user.id)) {
            return {
              ...msg,
              seen_by: [...(msg.seen_by || []), { id: user.id, username: user.username }],
            };
          }
          return msg;
        });
        return deduplicateMessages(updatedMessages);
      });

      const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
      if (cachedMessages) {
        const messages = JSON.parse(cachedMessages);
        const updatedMessages = messages.map((msg) => {
          if (messageIds.includes(msg.id) && !msg.seen_by?.some((u) => u.id === user.id)) {
            return {
              ...msg,
              seen_by: [...(msg.seen_by || []), { id: user.id, username: user.username }],
            };
          }
          return msg;
        });
        await AsyncStorage.setItem(
          `chat-${chatId}-page-1`,
          JSON.stringify(deduplicateMessages(updatedMessages))
        );
      }
    },
    onError: (error) => logger.error("Error marking messages as read:", error),
  });

  const markAsDelivered = useMutation({
    mutationFn: (messageIds) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem("token");
        await axios.post(
          `${API_URL}/chat/mark-as-delivered/batch/`,
          { message_ids: messageIds },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }),
    onSuccess: async (_, messageIds) => {
      setMessages((prev) => {
        const updatedMessages = prev.map((msg) => {
          if (messageIds.includes(msg.id) && !msg.delivered_to?.some((u) => u.id === user.id)) {
            return {
              ...msg,
              delivered_to: [...(msg.delivered_to || []), { id: user.id, username: user.username }],
            };
          }
          return msg;
        });
        return deduplicateMessages(updatedMessages);
      });

      const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
      if (cachedMessages) {
        const messages = JSON.parse(cachedMessages);
        const updatedMessages = messages.map((msg) => {
          if (messageIds.includes(msg.id) && !msg.delivered_to?.some((u) => u.id === user.id)) {
            return {
              ...msg,
              delivered_to: [...(msg.delivered_to || []), { id: user.id, username: user.username }],
            };
          }
          return msg;
        });
        await AsyncStorage.setItem(
          `chat-${chatId}-page-1`,
          JSON.stringify(deduplicateMessages(updatedMessages))
        );
      }

      messageIds.forEach((messageId) => {
        sendMessage({ type: "message_delivered", chat_id: chatId, message_id: messageId });
      });
    },
    onError: (error) => logger.error("Error marking messages as delivered:", error),
  });

  const throttledMarkAsRead = useMemo(
    () =>
      debounce((messageIds) => {
        if (isMountedRef.current) markAsRead.mutate(messageIds);
      }, 1000),
    [markAsRead]
  );

  const throttledMarkAsDelivered = useMemo(
    () =>
      debounce((messageIds) => {
        if (isMountedRef.current) markAsDelivered.mutate(messageIds);
      }, 1000),
    [markAsDelivered]
  );

  useEffect(() => {
    if (messages.length && isAtBottom) {
      const undelivered = messages.filter(
        (msg) => !msg.delivered_to?.some((u) => u.id === user.id) && msg.sender.id !== user.id
      );
      if (undelivered.length) throttledMarkAsDelivered(undelivered.map((msg) => msg.id));

      const unread = messages.filter((msg) => !msg.seen_by?.some((u) => u.id === user.id));
      if (unread.length) throttledMarkAsRead(unread.map((msg) => msg.id));
    }
    return () => {
      throttledMarkAsDelivered.cancel();
      throttledMarkAsRead.cancel();
    };
  }, [messages, isAtBottom, throttledMarkAsDelivered, throttledMarkAsRead]);

  const handleSendMessage = useCallback(
    async (type = "text", attachment) => {
      if (!message.trim() && !attachment) {
        logger.info("Prevented sending empty message");
        return;
      }

      let attachmentUrl = null;
      if (attachment) {
        const token = await AsyncStorage.getItem("token");
        const formData = new FormData();
        formData.append("file", {
          uri: attachment.uri,
          type: attachment.mimeType || "application/octet-stream",
          name: attachment.fileName || `file_${Date.now()}`,
        });

        const { data } = await withTokenRefresh(() =>
          axios.post(`${API_URL}/chat/upload-attachment/${chatId}/`, formData, {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
          })
        );
        attachmentUrl = data.attachment_url;
      }

      const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const newMessage = {
        id: tempId,
        tempId,
        sender: { id: user.id, username: user.username, first_name: user.first_name, profile_picture: user.profile_picture },
        content: type === "text" && !editingMessageId ? message : "",
        message_type: type,
        attachment_url: attachmentUrl,
        timestamp: new Date().toISOString(),
        delivered_to: [],
        seen_by: [],
        is_deleted: false,
        reactions: [],
        isPinned: false,
      };

      setMessages((prev) => deduplicateMessages([...prev, newMessage]));
      const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
      const messages = cachedMessages ? JSON.parse(cachedMessages) : [];
      const updatedMessages = deduplicateMessages([...messages, newMessage]);
      await AsyncStorage.setItem(`chat-${chatId}-page-1`, JSON.stringify(updatedMessages));

      if (type === "text") setMessage("");
      setPendingFile(null);

      const payload = {
        type: editingMessageId ? "edit" : "message",
        content: type === "text" && !editingMessageId ? message : "",
        message_type: type,
        attachment_url: attachmentUrl,
        ...(editingMessageId ? { message_id: editingMessageId } : { id: tempId }),
      };

      if (editingMessageId) {
        editMessage.mutate({ messageId: editingMessageId, content: message });
        sendMessage(payload);
      } else {
        if (!sendMessage(payload)) {
          setQueuedMessages((prev) => deduplicateMessages([...prev, payload]));
        }
      }

      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    },
    [message, chatId, editingMessageId, user, sendMessage, withTokenRefresh, deduplicateMessages]
  );

  const editMessage = useMutation({
    mutationFn: ({ messageId, content }) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem("token");
        const { data } = await axios.post(
          `${API_URL}/chat/edit-message/${messageId}/`,
          { content },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return data;
      }),
    onSuccess: async (updatedMessage) => {
      if (isMountedRef.current) {
        const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
        if (cachedMessages) {
          const messages = JSON.parse(cachedMessages);
          const updatedMessages = messages.map((m) =>
            m.id === updatedMessage.id ? updatedMessage : m
          );
          await AsyncStorage.setItem(
            `chat-${chatId}-page-1`,
            JSON.stringify(deduplicateMessages(updatedMessages))
          );
        }

        setMessages((prev) => {
          const updated = prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m));
          return deduplicateMessages(updated);
        });
        setEditingMessageId(null);
        setMessage("");
      }
    },
  });

  const pickMedia = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission required", "Please allow media access.");

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.7,
    });

    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setPendingFile({
        uri: asset.uri,
        mimeType: asset.type === "video" ? "video/mp4" : "image/jpeg",
        fileName: asset.fileName || `media_${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
      });
    }
  }, []);

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (result.type !== "cancel" && isMountedRef.current) {
      setPendingFile({
        uri: result.uri,
        fileName: result.name || `file_${Date.now()}`,
        mimeType: result.mimeType || "application/octet-stream",
      });
    }
  }, []);

  const debouncedTypingRef = useRef(
    debounce((text) => {
      if (isMountedRef.current && isConnected) {
        sendMessage({ type: "typing", user: user?.id });
      }
    }, 300, { leading: true, trailing: true })
  );

  const handleTyping = useCallback((text) => {
    debouncedTypingRef.current(text);
  }, []);

  const renderMessage = useCallback(
    ({ item }) => {
      const isSent = item.sender.id === user?.id;
      const status = item.seen_by?.length > (isGroup ? 1 : 0) ? "✓✓" : item.delivered_to?.length > (isGroup ? 1 : 0) ? "✓" : item.tempId ? "⌛" : "✓";
      const formattedTime = new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      return (
        <Animated.View
          style={tw`flex-row ${isSent ? "justify-end" : "justify-start"} mx-4 my-1 opacity-${fadeAnim}`}
        >
          <TouchableOpacity
            style={tw`rounded-lg p-3 max-w-[70%] ${
              isSent ? "bg-blue-600 text-white shadow-md" : "bg-gray-100 text-gray-800 shadow-sm"
            } ${item.isPinned ? "border-2 border-yellow-400" : ""}`}
            onLongPress={() => showMessageActions(item)}
          >
            {!isSent && (
              <Text style={tw`text-gray-600 text-xs mb-1`}>
                {item.sender.first_name || item.sender.username}
              </Text>
            )}
            {item.message_type === "text" && (
              <Text style={tw`${isSent ? "text-white" : "text-gray-800"} ${item.is_deleted ? "italic text-gray-400" : ""}`}>
                {item.content}
              </Text>
            )}
            {item.message_type === "image" && (
              <Image source={{ uri: item.attachment_url || PLACEHOLDER_IMAGE }} style={tw`w-48 h-48 rounded-lg`} />
            )}
            {item.message_type === "video" && <VideoMessage uri={item.attachment_url} />}
            {item.message_type === "file" && (
              <Text style={tw`${isSent ? "text-blue-200" : "text-blue-500"} underline`}>
                {item.attachment_url?.split('/').pop()}
              </Text>
            )}
            <View style={tw`flex-row items-center justify-end mt-1`}>
              <Text style={tw`text-xs ${isSent ? "text-blue-100" : "text-gray-500"} mr-1`}>
                {formattedTime}
              </Text>
              {isSent && (
                <Text style={tw`text-xs ${status === "✓✓" ? "text-blue-200" : "text-gray-300"}`}>{status}</Text>
              )}
            </View>
            {item.reactions?.length > 0 && (
              <View style={tw`flex-row mt-1 bg-gray-200 rounded-full px-2 py-1`}>
                {item.reactions.map((emoji, idx) => (
                  <Text key={idx} style={tw`text-sm mr-1`}>{emoji}</Text>
                ))}
              </View>
            )}
          </TouchableOpacity>
          {showReactions === item.id && (
            <View style={tw`absolute bottom-10 ${isSent ? "right-0" : "left-0"} bg-white p-2 rounded-xl shadow-md flex-row`}>
              {REACTION_EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => handleReaction(item.id, emoji)}
                  style={tw`p-1 mx-1`}
                >
                  <Text style={tw`text-lg`}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Animated.View>
      );
    },
    [user?.id, isGroup, showReactions, fadeAnim]
  );

  const showMessageActions = (item) => {
    Alert.alert("Message Actions", "", [
      ...(item.sender.id === user.id && !item.is_deleted
        ? [
            {
              text: "Edit",
              onPress: () => {
                setEditingMessageId(item.id);
                setMessage(item.content);
                inputRef.current?.focus();
              },
            },
            {
              text: "Delete",
              onPress: () => handleDeleteMessage(item.id),
            },
          ]
        : []),
      ...(isGroup && profile?.admins?.some((a) => a.id === user.id)
        ? [
            {
              text: item.isPinned ? "Unpin" : "Pin",
              onPress: () => {
                pinMessage.mutate(item.id);
                sendMessage({ type: "pin", message_id: item.id });
              },
            },
          ]
        : []),
      { text: "React", onPress: () => setShowReactions(item.id) },
      { text: "Cancel" },
    ]);
  };

  const pinMessage = useMutation({
    mutationFn: (messageId) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem("token");
        await axios.post(
          `${API_URL}/chat/pin-message/${chatId}/${messageId}/`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }),
    onSuccess: async (_, messageId) => {
      if (isMountedRef.current) {
        const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
        if (cachedMessages) {
          const messages = JSON.parse(cachedMessages);
          const updatedMessages = messages.map((m) => ({
            ...m,
            isPinned: m.id === messageId,
          }));
          await AsyncStorage.setItem(
            `chat-${chatId}-page-1`,
            JSON.stringify(deduplicateMessages(updatedMessages))
          );
        }

        setMessages((prev) => {
          const updated = prev.map((m) => ({ ...m, isPinned: m.id === messageId }));
          return deduplicateMessages(updated);
        });
        queryClient.invalidateQueries(["profile", chatId]);
      }
    },
  });

  const handleDeleteMessage = async (messageId) => {
    try {
      const token = await AsyncStorage.getItem("token");
      await axios.delete(`${API_URL}/chat/delete-message/${messageId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
      if (cachedMessages) {
        const messages = JSON.parse(cachedMessages);
        const updatedMessages = messages.map((m) =>
          m.id === messageId ? { ...m, is_deleted: true, content: "[Deleted]" } : m
        );
        await AsyncStorage.setItem(
          `chat-${chatId}-page-1`,
          JSON.stringify(deduplicateMessages(updatedMessages))
        );
      }

      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === messageId ? { ...m, is_deleted: true, content: "[Deleted]" } : m
        );
        return deduplicateMessages(updated);
      });

      sendMessage({ type: "delete", message_id: messageId });
    } catch (error) {
      logger.error("Error deleting message:", error);
    }
  };

  const handleReaction = async (messageId, emoji) => {
    try {
      const token = await AsyncStorage.getItem("token");
      await axios.post(
        `${API_URL}/chat/react-to-message/${messageId}/`,
        { emoji },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const cachedMessages = await AsyncStorage.getItem(`chat-${chatId}-page-1`);
      if (cachedMessages) {
        const messages = JSON.parse(cachedMessages);
        const updatedMessages = messages.map((m) =>
          m.id === messageId ? { ...m, reactions: [...(m.reactions || []), emoji] } : m
        );
        await AsyncStorage.setItem(
          `chat-${chatId}-page-1`,
          JSON.stringify(deduplicateMessages(updatedMessages))
        );
      }

      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === messageId ? { ...m, reactions: [...(m.reactions || []), emoji] } : m
        );
        return deduplicateMessages(updated);
      });
      setShowReactions(null);
      sendMessage({ type: "reaction", message_id: messageId, emoji });
    } catch (error) {
      logger.error("Error adding reaction:", error);
    }
  };

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const Header = useMemo(
    () => (
      <View style={tw`bg-white border-b border-gray-200 flex-row items-center px-3 py-2 shadow-sm`}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={tw`mr-2`}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={tw`flex-1 flex-row items-center`}>
          {!isGroup && profile?.profile_picture && (
            <Image
              source={{ uri: profile.profile_picture || PLACEHOLDER_IMAGE }}
              style={tw`w-10 h-10 rounded-full mr-3`}
              resizeMode="cover"
            />
          )}
          <View>
            <Text style={tw`text-lg font-semibold text-gray-800`}>
              {isGroup
                ? profile?.name || `Group ${chatId}`
                : profile?.user?.first_name || friendUsername}
            </Text>
            {!isGroup && (
              <Text style={tw`text-sm text-gray-500`}>
                {profile?.is_online
                  ? "Online"
                  : profile?.last_seen
                  ? `Last seen ${new Date(profile.last_seen).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : ""}
              </Text>
            )}
          </View>
        </View>
      </View>
    ),
    [navigation, isGroup, chatId, friendUsername, profile]
  );

  if (authLoading || profileLoading) {
    return (
      <View style={tw`flex-1 justify-center items-center bg-gray-50`}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={tw`flex-1 bg-gray-50`}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {Header}
      {profile?.pinned_message && (
        <View style={tw`bg-yellow-50 p-3 border-b border-gray-200 flex-row items-center mx-4 rounded-lg shadow-sm`}>
          <Ionicons name="pin" size={16} color="#666" style={tw`mr-2`} />
          <Text style={tw`text-sm text-gray-700 flex-1`}>{profile.pinned_message.content}</Text>
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id || item.tempId}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={tw`pb-2 flex-grow px-2`}
        ListEmptyComponent={<Text style={tw`text-center mt-5 text-gray-500`}>No messages yet</Text>}
        ListHeaderComponent={
          loadingMore ? (
            <View style={tw`py-4 justify-center items-center`}>
              <ActivityIndicator size="small" color="#3B82F6" />
            </View>
          ) : null
        }
        onContentSizeChange={() => {
          if (isAtBottom) {
            flatListRef.current?.scrollToEnd({ animated: false });
          }
        }}
      />
      {typingUsers.length > 0 && (
        <Text style={tw`text-xs text-gray-500 p-2 mx-4 mb-2 italic`}>
          {isGroup ? `${typingUsers.join(", ")} typing...` : `${profile?.user?.first_name || friendUsername} is typing...`}
        </Text>
      )}
      {!isAtBottom && (
        <TouchableOpacity
          style={tw`absolute bottom-16 right-4 bg-blue-600 p-3 rounded-full shadow-lg`}
          onPress={() => flatListRef.current?.scrollToEnd({ animated: true })}
        >
          <Ionicons name="chevron-down" size={20} color="white" />
        </TouchableOpacity>
      )}
      <View style={tw`bg-white border-t border-gray-200 p-2 flex-row items-center shadow-md`}>
        <TouchableOpacity onPress={pickMedia} style={tw`p-2`}>
          <Ionicons name="image" size={24} color="#3B82F6" />
        </TouchableOpacity>
        <TouchableOpacity onPress={pickFile} style={tw`p-2`}>
          <Ionicons name="attach" size={24} color="#3B82F6" />
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={tw`flex-1 bg-gray-100 rounded-full px-4 py-2 mx-2 text-gray-800 shadow-sm`}
          value={message}
          onChangeText={(text) => {
            setMessage(text);
            handleTyping(text);
          }}
          placeholder={editingMessageId ? "Edit message..." : "Type a message..."}
          placeholderTextColor="#9CA3AF"
          multiline
          maxLength={1000}
          onSubmitEditing={() => handleSendMessage("text")}
        />
        <TouchableOpacity onPress={() => handleSendMessage("text")} style={tw`p-2`}>
          <Ionicons name={editingMessageId ? "checkmark" : "send"} size={24} color="#3B82F6" />
        </TouchableOpacity>
      </View>
      {pendingFile && (
        <Modal visible={true} transparent animationType="fade" onRequestClose={() => setPendingFile(null)}>
          <View style={tw`flex-1 bg-black bg-opacity-80 justify-center items-center`}>
            {pendingFile.mimeType?.startsWith("image/") ? (
              <Image source={{ uri: pendingFile.uri }} style={tw`w-80 h-80 rounded-lg`} resizeMode="contain" />
            ) : pendingFile.mimeType?.startsWith("video/") ? (
              <VideoMessage uri={pendingFile.uri} />
            ) : (
              <Text style={tw`text-white text-lg`}>{pendingFile.fileName}</Text>
            )}
            <View style={tw`flex-row mt-4`}>
              <TouchableOpacity onPress={() => setPendingFile(null)} style={tw`p-2 mx-2`}>
                <Ionicons name="close" size={32} color="white" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const type = pendingFile.mimeType?.startsWith("image/")
                    ? "image"
                    : pendingFile.mimeType?.startsWith("video/")
                    ? "video"
                    : "file";
                  handleSendMessage(type, pendingFile);
                }}
                style={tw`p-2 mx-2`}
              >
                <Ionicons name="send" size={32} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
};

export default ChatScreen;