import React, { useEffect, useContext, useRef, useCallback, useState, useMemo } from 'react';
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
  ScrollView,
  Linking,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { AuthContext } from '../../context/AuthContext';
import { Ionicons, Feather } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Video } from 'expo-av';
import tw from 'twrnc';
import { useWebSocket } from '../hooks/useWebSocket';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import debounce from 'lodash/debounce';
import useMessageStore from '../store/messageStore';
import { API_URL, PLACEHOLDER_IMAGE, REACTION_EMOJIS, PAGE_SIZE } from '../utils/constants';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';

// VideoMessage Component
const VideoMessage = ({ uri }) => {
  const [error, setError] = useState(null);
  const videoRef = useRef(null);

  useEffect(() => {
    return () => {
      if (videoRef.current) videoRef.current.stopAsync().catch(() => {});
    };
  }, [uri]);

  return !uri ? (
    <Text style={tw`text-gray-500`}>Loading...</Text>
  ) : error ? (
    <Text style={tw`text-red-500`}>{error}</Text>
  ) : (
    <Video
      ref={videoRef}
      source={{ uri }}
      style={tw`w-64 h-64 rounded-2xl`}
      useNativeControls
      resizeMode="cover"
      onError={(e) => setError(e.error?.message || 'Unknown error')}
    />
  );
};
// Main ChatScreen Component
const ChatScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { chatId: initialChatId, friendId, friendUsername, isGroup = false } = route.params || {};
  const { user, loading: authLoading, refreshToken } = useContext(AuthContext);
  const queryClient = useQueryClient();
  const flatListRef = useRef(null);
  const inputRef = useRef(null);
  const isMountedRef = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const messageStore = useMessageStore();
  const [chatId, setChatId] = useState(initialChatId || null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showReactions, setShowReactions] = useState(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [draftMessage, setDraftMessage] = useState('');
  const [showReadReceipts, setShowReadReceipts] = useState(null);

  const messages = useMemo(() => {
    if (!chatId) return [];
    const chatMessages = messageStore.messages[chatId] || {};
    return Object.values(chatMessages).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }, [chatId, messageStore.messages]);

  const typingUsers = useMemo(() => messageStore.typingUsers[chatId] || [], [chatId, messageStore.typingUsers]);

  const { sendMessage, isConnected, retryConnection, subscribeToEvent } = useWebSocket({
    chatId: chatId || null,
    isGroup,
    userId: user?.id,
  });

  useEffect(() => {
    const loadDraft = async () => {
      const draft = await AsyncStorage.getItem(`draft_${chatId}`);
      if (draft) {
        setMessage(draft);
        setDraftMessage(draft);
      }
    };
    if (chatId) loadDraft();
  }, [chatId]);

  useEffect(() => {
    const saveDraft = async () => {
      if (message && chatId) await AsyncStorage.setItem(`draft_${chatId}`, message);
      else if (chatId) await AsyncStorage.removeItem(`draft_${chatId}`);
      setDraftMessage(message);
    };
    saveDraft();
  }, [message, chatId]);

  const fetchMessages = useCallback(
    async (pageNum) => {
      if (!chatId) return [];
      const token = await AsyncStorage.getItem('token');
      const offset = (pageNum - 1) * PAGE_SIZE;
      const { data } = await axios.get(`${API_URL}/chat/get-messages/${chatId}/?limit=${PAGE_SIZE}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return data;
    },
    [chatId]
  );

  const loadInitialMessages = useCallback(async () => {
    if (!chatId) return;
    const serverMessages = await fetchMessages(1);
    messageStore.setMessages(chatId, serverMessages);
    setHasMoreMessages(serverMessages.length >= PAGE_SIZE);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
  }, [chatId, fetchMessages, messageStore]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMoreMessages || !chatId) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const newMessages = await fetchMessages(nextPage);
    messageStore.setMessages(chatId, [...messages, ...newMessages]);
    setPage(nextPage);
    setHasMoreMessages(newMessages.length >= PAGE_SIZE);
    setLoadingMore(false);
  }, [loadingMore, hasMoreMessages, page, fetchMessages, chatId, messages, messageStore]);

  const handleScroll = useCallback(
    ({ nativeEvent }) => {
      const isBottom =
        nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 20;
      setIsAtBottom(isBottom);
      if (nativeEvent.contentOffset.y <= 100 && !loadingMore && hasMoreMessages) loadMoreMessages();
    },
    [loadingMore, hasMoreMessages, loadMoreMessages]
  );

  useFocusEffect(
    useCallback(() => {
      if (chatId) loadInitialMessages();
      return () => (isMountedRef.current = false);
    }, [chatId, loadInitialMessages])
  );

  const handleNewMessage = useCallback(
    (newMessage) => {
      if (!newMessage.content && !newMessage.attachment_url) return;
      if (!chatId && newMessage.chat?.id) setChatId(newMessage.chat.id);
      messageStore.addMessage(chatId || newMessage.chat.id, newMessage);
      if (isAtBottom) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    },
    [chatId, isAtBottom, messageStore]
  );

  useEffect(() => {
    if (!chatId) return;
    const unsubscribers = [
      subscribeToEvent('message', handleNewMessage),
      subscribeToEvent('ack', (event) => {
        const messageId = event.messageId;
        const serverId = event.serverId;
        const chatMessages = messageStore.messages[chatId] || {};
        if (!chatMessages[messageId]) return;
        messageStore.updateMessage(chatId, messageId, { id: serverId, tempId: null, status: null });
      }),
      subscribeToEvent('reaction', (event) =>
        messageStore.updateMessage(chatId, event.message_id, {
          reactions: [...(messages.find((m) => m.id === event.message_id)?.reactions || []), event.emoji],
        })
      ),
      subscribeToEvent('pin', () => queryClient.invalidateQueries(['profile', chatId])),
      subscribeToEvent('group_update', () => queryClient.invalidateQueries(['profile', chatId])),
      subscribeToEvent('typing', (data) => {
        if (data.user !== user?.id) {
          messageStore.addTypingUser(chatId, data.username);
          setTimeout(() => isMountedRef.current && messageStore.removeTypingUser(chatId, data.username), 5000);
        }
      }),
    ];
    return () => unsubscribers.forEach((unsub) => unsub());
  }, [subscribeToEvent, handleNewMessage, chatId, queryClient, user?.id, messageStore, messages]);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', chatId, friendUsername],
    queryFn: async () => {
      const token = await AsyncStorage.getItem('token');
      const url = isGroup ? `${API_URL}/chat/rooms/${chatId}/` : `${API_URL}/profiles/friend/${friendUsername}/`;
      const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!isGroup && data.last_seen) {
        const now = new Date();
        const lastSeen = new Date(data.last_seen);
        data.is_online = now - lastSeen < 5 * 60 * 1000;
      }
      return data;
    },
    enabled: !!user && (!isGroup || !!chatId) && !!friendUsername,
    staleTime: 5 * 60 * 1000,
    onError: (error) => {
      if (error.response?.status === 401) {
        Alert.alert('Error', 'Session expired. Please log in again.', [
          { text: 'OK', onPress: () => navigation.navigate('Login') },
        ]);
      } else {
        Alert.alert('Error', error.response?.data?.error || 'Failed to load profile');
      }
    },
  });

  const withTokenRefresh = useCallback(
    async (fn) => {
      try {
        return await fn();
      } catch (error) {
        if (error.response?.status === 401 && refreshToken && isMountedRef.current) {
          const newToken = await refreshToken();
          if (newToken) {
            await AsyncStorage.setItem('token', newToken);
            return await fn();
          }
        }
        throw error;
      }
    },
    [refreshToken]
  );

  const markAsRead = useMutation({
    mutationFn: (messageIds) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem('token');
        await axios.post(`${API_URL}/chat/mark-as-read/batch/`, { message_ids: messageIds }, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }),
    onSuccess: (_, messageIds) => {
      messageIds.forEach((messageId) => {
        const currentMessage = messages.find((m) => m.id === messageId);
        messageStore.updateMessage(chatId, messageId, {
          seen_by_details: [
            ...(currentMessage?.seen_by_details || []),
            { user: { id: user.id, username: user.username }, seen_at: new Date().toISOString() },
          ],
        });
      });
    },
  });

  const markAsDelivered = useMutation({
    mutationFn: (messageIds) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem('token');
        await axios.post(`${API_URL}/chat/mark-as-delivered/batch/`, { message_ids: messageIds }, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }),
    onSuccess: (_, messageIds) => {
      messageIds.forEach((messageId) => {
        messageStore.updateMessage(chatId, messageId, {
          delivered_to: [...(messages.find((m) => m.id === messageId)?.delivered_to || []), { id: user.id, username: user.username }],
        });
        sendMessage({ type: 'message_delivered', chat_id: chatId, message_id: messageId });
      });
    },
  });

  const throttledMarkAsRead = useMemo(() => debounce((messageIds) => markAsRead.mutate(messageIds), 1000), [markAsRead]);
  const throttledMarkAsDelivered = useMemo(() => debounce((messageIds) => markAsDelivered.mutate(messageIds), 1000), [markAsDelivered]);

  const unreadMessages = useMemo(() =>
    messages.filter((msg) =>
      msg.sender.id !== user?.id && !(msg.seen_by_details || []).some((u) => u.user.id === user?.id)
    ),
    [messages, user?.id]
  );

  const undeliveredMessages = useMemo(() =>
    messages.filter((msg) =>
      msg.sender.id !== user?.id && !(msg.delivered_to || []).some((u) => u.id === user?.id)
    ),
    [messages, user?.id]
  );

  useEffect(() => {
    if (!chatId || !isAtBottom) return;
    if (undeliveredMessages.length) throttledMarkAsDelivered(undeliveredMessages.map((msg) => msg.id));
    if (unreadMessages.length) throttledMarkAsRead(unreadMessages.map((msg) => msg.id));
    return () => {
      throttledMarkAsDelivered.cancel();
      throttledMarkAsRead.cancel();
    };
  }, [unreadMessages, undeliveredMessages, isAtBottom, chatId, throttledMarkAsDelivered, throttledMarkAsRead]);

  const getMimeTypeFromUri = (uri, fileName) => {
    // If both uri and fileName are undefined, return a default MIME type
    if (!uri && !fileName) {
      return 'application/octet-stream'; // Default MIME type
    }
  
    const ext = (fileName || uri).split('.').pop().toLowerCase();
    const mimeTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  };

  const getFileSize = async (uri) => {
    if (Platform.OS === 'web') return null; // Size not available pre-upload on web
    const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
    return fileInfo.size;
  };

  const handleSendMessage = useCallback(
    async (type = 'text', attachment, schedule = null) => {
      if ((!message.trim() && !attachment) || sending) return;

      setSending(true);
      try {
        let attachmentUrl = null;
        let newChatId = chatId;
        let attachmentSize = null;

        if (attachment) {
          if (Platform.OS !== 'web') {
            attachmentSize = await getFileSize(attachment.uri);
            if (attachmentSize > 100 * 1024 * 1024) {
              throw new Error('File size exceeds 100MB limit');
            }
          }

          const token = await AsyncStorage.getItem('token');
          const formData = new FormData();
          const uri = Platform.OS === 'android' && !attachment.uri.startsWith('file://') ? `file://${attachment.uri}` : attachment.uri;

          if (Platform.OS === 'web' && attachment.uri.startsWith('blob:')) {
            const response = await fetch(attachment.uri);
            const blob = await response.blob();
            formData.append('file', new File([blob], attachment.fileName, { type: attachment.mimeType }));
          } else {
            formData.append('file', {
              uri,
              type: attachment.mimeType || getMimeTypeFromUri(uri, attachment.fileName),
              name: attachment.fileName,
            });
          }

          console.log('Sending attachment:', { uri: attachment.uri, mimeType: attachment.mimeType, fileName: attachment.fileName });

          const response = await withTokenRefresh(() =>
            axios.post(
              chatId ? `${API_URL}/chat/upload-attachment/${chatId}/` : `${API_URL}/chat/send-message/`,
              chatId ? formData : { ...formData, receiver_id: friendId, content: '', message_type: type },
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'multipart/form-data',
                },
              }
            ).catch((error) => {
              console.error('Upload failed with response:', error.response?.data);
              throw error;
            })
          );
          attachmentUrl = response.data.attachment_url;
          attachmentSize = response.data.attachment_size || attachmentSize;
          if (!chatId) {
            newChatId = response.data.chat.id;
            setChatId(newChatId);
          }
        }

        const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const timestamp = schedule ? schedule.toISOString() : new Date().toISOString();
        const newMessage = {
          id: tempId,
          tempId,
          sender: { id: user.id, username: user.username, first_name: user.first_name, profile_picture: user.profile_picture },
          content: type === 'text' && !editingMessageId ? message : '',
          message_type: type,
          attachment_url: attachmentUrl,
          attachment_mime_type: attachment?.mimeType,
          attachment_size: attachmentSize,
          attachment_name: attachment?.fileName,
          timestamp,
          delivered_to: [],
          seen_by_details: [],
          is_deleted: false,
          reactions: [],
          isPinned: false,
          status: schedule ? 'scheduled' : 'pending',
          chatId: newChatId || chatId,
          scheduledTime: schedule ? schedule.toISOString() : null,
        };

        messageStore.addMessage(newChatId || chatId, newMessage);
        if (type === 'text') setMessage('');
        setPendingFile(null);
        setShowScheduleModal(false);

        if (schedule) {
          const scheduledMessages = JSON.parse(await AsyncStorage.getItem('scheduledMessages') || '[]');
          scheduledMessages.push(newMessage);
          await AsyncStorage.setItem('scheduledMessages', JSON.stringify(scheduledMessages));
          return;
        }

        const payload = {
          type: editingMessageId ? 'edit' : 'message',
          content: type === 'text' && !editingMessageId ? message : '',
          message_type: type,
          attachment_url: attachmentUrl,
          timestamp,
          ...(editingMessageId ? { message_id: editingMessageId } : { id: tempId }),
          ...(chatId ? { chat_id: chatId } : { receiver_id: friendId }),
        };

        if (editingMessageId) {
          editMessage.mutate({ messageId: editingMessageId, content: message });
          sendMessage(payload);
        } else {
          if (!chatId) {
            const token = await AsyncStorage.getItem('token');
            const response = await withTokenRefresh(() =>
              axios.post(`${API_URL}/chat/send-message/`, { receiver_id: friendId, content: type === 'text' ? message : '', message_type: type, attachment_url: attachmentUrl }, {
                headers: { Authorization: `Bearer ${token}` },
              })
            );
            newChatId = response.data.chat.id;
            setChatId(newChatId);
            payload.chat_id = newChatId;
          }
          sendMessage(payload);
        }

        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      } catch (error) {
        console.error('Send message error:', error);
        Alert.alert('Error', error.message || error.response?.data?.error || 'Failed to send message');
      } finally {
        setSending(false);
      }
    },
    [message, chatId, editingMessageId, user, friendId, sendMessage, withTokenRefresh, messageStore]
  );

  useEffect(() => {
    const checkScheduledMessages = async () => {
      const scheduledMessages = JSON.parse(await AsyncStorage.getItem('scheduledMessages') || '[]');
      const now = new Date();
      const toSend = scheduledMessages.filter((msg) => new Date(msg.scheduledTime) <= now);
      if (toSend.length) {
        toSend.forEach((msg) => {
          messageStore.updateMessage(msg.chatId, msg.id, { status: 'pending' });
          sendMessage({ type: 'message', content: msg.content, message_type: msg.message_type, attachment_url: msg.attachment_url, timestamp: new Date().toISOString(), id: msg.id, chat_id: msg.chatId });
        });
        const remaining = scheduledMessages.filter((msg) => new Date(msg.scheduledTime) > now);
        await AsyncStorage.setItem('scheduledMessages', JSON.stringify(remaining));
      }
    };
    const interval = setInterval(checkScheduledMessages, 60000);
    return () => clearInterval(interval);
  }, [sendMessage, messageStore]);

  const editMessage = useMutation({
    mutationFn: ({ messageId, content }) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem('token');
        const { data } = await axios.post(`${API_URL}/chat/edit-message/${messageId}/`, { content }, { headers: { Authorization: `Bearer ${token}` } });
        return data;
      }),
    onSuccess: (updatedMessage) => {
      messageStore.updateMessage(chatId, updatedMessage.id, updatedMessage);
      setEditingMessageId(null);
      setMessage('');
    },
  });

  const pickMedia = useCallback(async () => {
    if (Platform.OS === 'web') {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.8 });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const mimeType = asset.mimeType || getMimeTypeFromUri(asset.uri, asset.fileName);
        setPendingFile({
          uri: asset.uri,
          mimeType,
          fileName: asset.fileName || `media_${Date.now()}.${mimeType.split('/')[1] || 'bin'}`,
          size: asset.fileSize || null,
        });
      }
      return;
    }

    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission required', 'Please allow media access.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      const fileInfo = await FileSystem.getInfoAsync(asset.uri, { size: true });
      const mimeType = asset.mimeType || getMimeTypeFromUri(asset.uri, asset.fileName);
      setPendingFile({
        uri: asset.uri,
        mimeType,
        fileName: asset.fileName || `media_${Date.now()}.${mimeType.split('/')[1] || 'bin'}`,
        size: fileInfo.size,
      });
    }
  }, []);

  const pickFile = useCallback(async () => {
    if (Platform.OS === 'web') {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (result.type !== 'cancel') {
        // Validate that uri or name exists
        if (!result.uri && !result.name) {
          Alert.alert('Error', 'Failed to pick file: No URI or name provided');
          return;
        }
        const mimeType = result.mimeType || getMimeTypeFromUri(result.uri, result.name);
        setPendingFile({
          uri: result.uri,
          fileName: result.name || `file_${Date.now()}`,
          mimeType,
          size: result.size || null,
        });
      }
      return;
    }
  
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.type !== 'cancel') {
      // Validate that uri or name exists
      if (!result.uri && !result.name) {
        Alert.alert('Error', 'Failed to pick file: No URI or name provided');
        return;
      }
      const fileInfo = await FileSystem.getInfoAsync(result.uri, { size: true });
      const mimeType = result.mimeType || getMimeTypeFromUri(result.uri, result.name);
      setPendingFile({
        uri: result.uri,
        fileName: result.name || `file_${Date.now()}`,
        mimeType,
        size: fileInfo.size,
      });
    }
  }, []);

  const downloadFile = useCallback(async (attachmentUrl, attachmentName, mimeType) => {
    try {
      if (Platform.OS === 'web') {
        Linking.openURL(attachmentUrl);
        return;
      }
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission required', 'Please allow storage access.');

      const fileUri = `${FileSystem.documentDirectory}${attachmentName || attachmentUrl.split('/').pop()}`;
      const { uri } = await FileSystem.downloadAsync(attachmentUrl, fileUri);
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Success', 'File downloaded to your device');
    } catch (error) {
      console.error('Download error:', error);
      Alert.alert('Error', 'Failed to download file');
    }
  }, []);

  const debouncedTyping = useRef(debounce((text) => {
    if (isConnected && chatId) sendMessage({ type: 'typing', user: user?.id, username: user?.username });
  }, 500)).current;

  const handleTyping = useCallback((text) => {
    setMessage(text);
    debouncedTyping(text);
  }, [debouncedTyping]);

  const retryMessage = useCallback(
    (messageId) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      messageStore.updateMessage(chatId, messageId, { status: 'pending' });
      sendMessage({ type: 'message', content: msg.content, message_type: msg.message_type, attachment_url: msg.attachment_url, timestamp: new Date().toISOString(), id: messageId, chat_id: chatId });
    },
    [messages, chatId, sendMessage, messageStore]
  );

  const renderMessage = useCallback(
    ({ item }) => {
      const isSent = item.sender.id === user?.id;
      const status = item.status || (item.seen_by_details?.length > (isGroup ? 1 : 0) ? '✓✓' : item.delivered_to?.length > (isGroup ? 1 : 0) ? '✓' : item.tempId ? '⌛' : '✓');
      const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const onPressFile = () => {
        if (item.attachment_url) {
          downloadFile(item.attachment_url, item.attachment_name, item.attachment_mime_type);
        }
      };

      return (
        <Animated.View style={tw`flex-row ${isSent ? 'justify-end' : 'justify-start'} mx-3 my-1 opacity-${fadeAnim}`}>
          <TouchableOpacity
            style={tw`rounded-3xl p-3 max-w-[75%] shadow-md ${isSent ? 'bg-blue-500' : 'bg-white'} ${item.isPinned ? 'border-2 border-amber-400' : ''}`}
            onLongPress={() => showMessageActions(item)}
            onPress={item.message_type === 'file' ? onPressFile : undefined}
          >
            {!isSent && isGroup && <Text style={tw`text-gray-500 text-xs mb-1 font-semibold`}>{item.sender.first_name || item.sender.username}</Text>}
            {item.message_type === 'text' && (
              <Text style={tw`${isSent ? 'text-white' : 'text-gray-900'} ${item.is_deleted ? 'italic text-gray-400' : ''} text-base`}>{item.content}</Text>
            )}
            {item.message_type === 'image' && (
              <Image source={{ uri: item.attachment_url || PLACEHOLDER_IMAGE }} style={tw`w-64 h-64 rounded-2xl`} resizeMode="contain" />
            )}
            {item.message_type === 'video' && <VideoMessage uri={item.attachment_url} />}
            {item.message_type === 'file' && (
              <TouchableOpacity onPress={onPressFile}>
                <Text style={tw`${isSent ? 'text-blue-100' : 'text-blue-600'} underline text-base`}>
                  {item.attachment_name || item.attachment_url?.split('/').pop()} {item.attachment_size ? `(${(item.attachment_size / 1024 / 1024).toFixed(2)} MB)` : ''}
                </Text>
              </TouchableOpacity>
            )}
            {item.status === 'scheduled' && (
              <Text style={tw`text-xs italic text-gray-400 mt-1`}>Scheduled for {new Date(item.scheduledTime).toLocaleString()}</Text>
            )}
            <View style={tw`flex-row items-center justify-end mt-1`}>
              <Text style={tw`text-xs ${isSent ? 'text-blue-100' : 'text-gray-400'} mr-2`}>{time}</Text>
              {isSent && (
                <TouchableOpacity onPress={() => item.status === 'pending' && !isConnected ? retryMessage(item.id) : setShowReadReceipts(item.id)}>
                  <Text style={tw`text-xs ${status === '✓✓' ? 'text-blue-200' : 'text-gray-300'}`}>{status === 'pending' && !isConnected ? 'Retry' : status}</Text>
                </TouchableOpacity>
              )}
            </View>
            {item.reactions?.length > 0 && (
              <View style={tw`flex-row mt-2 bg-gray-100 rounded-full px-2 py-1`}>
                {item.reactions.map((emoji, idx) => (
                  <Text key={idx} style={tw`text-sm mr-1`}>{emoji}</Text>
                ))}
              </View>
            )}
          </TouchableOpacity>
          {showReactions === item.id && (
            <View style={tw`absolute bottom-12 ${isSent ? 'right-0' : 'left-0'} bg-white p-2 rounded-full shadow-lg flex-row`}>
              {REACTION_EMOJIS.map((emoji) => (
                <Pressable key={emoji} onPress={() => handleReaction(item.id, emoji)} style={tw`p-2`}>
                  <Text style={tw`text-xl`}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Animated.View>
      );
    },
    [user?.id, isGroup, showReactions, fadeAnim, isConnected, retryMessage, downloadFile]
  );

  const showMessageActions = (item) => {
    const options = [
      ...(item.sender.id === user.id && !item.is_deleted
        ? [
            { text: 'Edit', onPress: () => { setEditingMessageId(item.id); setMessage(item.content); inputRef.current?.focus(); } },
            { text: 'Delete', onPress: () => handleDeleteMessage(item.id) },
            ...(item.status !== 'scheduled' ? [{ text: 'Schedule', onPress: () => { setEditingMessageId(item.id); setMessage(item.content); setShowScheduleModal(true); } }] : []),
          ]
        : []),
      ...(isGroup && profile?.admins?.some((a) => a.id === user.id)
        ? [{ text: item.isPinned ? 'Unpin' : 'Pin', onPress: () => { pinMessage.mutate(item.id); sendMessage({ type: 'pin', message_id: item.id }); } }]
        : []),
      { text: 'React', onPress: () => setShowReactions(item.id) },
      ...(item.attachment_url ? [{ text: 'Download', onPress: () => downloadFile(item.attachment_url, item.attachment_name, item.attachment_mime_type) }] : []),
      { text: 'Cancel', style: 'cancel' },
    ];
    Alert.alert('Message Options', '', options);
  };

  const pinMessage = useMutation({
    mutationFn: (messageId) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem('token');
        await axios.post(`${API_URL}/chat/pin-message/${chatId}/${messageId}/`, {}, { headers: { Authorization: `Bearer ${token}` } });
      }),
    onSuccess: (_, messageId) => messageStore.updateMessage(chatId, messageId, { isPinned: true }),
  });

  const handleDeleteMessage = async (messageId) => {
    const token = await AsyncStorage.getItem('token');
    await axios.delete(`${API_URL}/chat/delete-message/${messageId}/`, { headers: { Authorization: `Bearer ${token}` } });
    messageStore.deleteMessage(chatId, messageId);
    sendMessage({ type: 'delete', message_id: messageId });
  };

  const handleReaction = async (messageId, emoji) => {
    const token = await AsyncStorage.getItem('token');
    await axios.post(`${API_URL}/chat/react-to-message/${messageId}/`, { emoji }, { headers: { Authorization: `Bearer ${token}` } });
    messageStore.updateMessage(chatId, messageId, { reactions: [...(messages.find((m) => m.id === messageId)?.reactions || []), emoji] });
    setShowReactions(null);
    sendMessage({ type: 'reaction', message_id: messageId, emoji });
  };

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const Header = useMemo(
    () => (
      <LinearGradient colors={['#3B82F6', '#60A5FA']} style={tw`p-4 flex-row items-center shadow-md`}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={tw`mr-3`}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        {!isGroup ? (
          <TouchableOpacity style={tw`flex-row items-center flex-1`} onPress={() => navigation.navigate('FriendProfile', { username: friendUsername })}>
            <Image source={{ uri: profile?.profile_picture || PLACEHOLDER_IMAGE }} style={tw`w-12 h-12 rounded-full mr-3 border-2 border-white`} />
            <View>
              <Text style={tw`text-white text-lg font-bold`}>{profile?.user?.first_name || 'Unknown'}</Text>
              <Text style={tw`text-blue-100 text-sm`}>{profile?.is_online ? 'Online' : profile?.last_seen ? `Last seen ${new Date(profile.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Offline'}</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={tw`flex-1`}>
            <Text style={tw`text-white text-lg font-bold`}>{profile?.name || `Group ${chatId || ''}`}</Text>
          </View>
        )}
        <TouchableOpacity style={tw`ml-3`}>
          <Feather name="more-vertical" size={24} color="white" />
        </TouchableOpacity>
      </LinearGradient>
    ),
    [navigation, isGroup, chatId, profile, friendUsername]
  );

  if (authLoading || (chatId && profileLoading)) {
    return (
      <View style={tw`flex-1 justify-center items-center bg-gray-100`}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={tw`flex-1 bg-gray-100`}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      {Header}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => (item.id || item.tempId || Math.random()).toString()}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={tw`pb-4 flex-grow`}
        initialNumToRender={15}
        ListEmptyComponent={<Text style={tw`text-center mt-10 text-gray-500 text-lg`}>{chatId ? 'Start the conversation!' : 'Send a message to begin'}</Text>}
        ListHeaderComponent={loadingMore && <ActivityIndicator size="small" color="#3B82F6" style={tw`py-4`} />}
        onContentSizeChange={() => isAtBottom && flatListRef.current?.scrollToEnd({ animated: false })}
      />
      {typingUsers.length > 0 && (
        <View style={tw`flex-row items-center mx-4 mb-2`}>
          <Text style={tw`text-gray-600 text-sm italic`}>{isGroup ? `${typingUsers.join(', ')} typing...` : `${profile?.user?.first_name || friendUsername} is typing...`}</Text>
          <ActivityIndicator size="small" color="#3B82F6" style={tw`ml-2`} />
        </View>
      )}
      {!isAtBottom && (
        <TouchableOpacity style={tw`absolute bottom-20 right-4 bg-blue-500 p-3 rounded-full shadow-lg`} onPress={() => flatListRef.current?.scrollToEnd({ animated: true })}>
          <Ionicons name="chevron-down" size={20} color="white" />
        </TouchableOpacity>
      )}
      <View style={tw`bg-white p-3 flex-row items-center shadow-lg rounded-t-3xl`}>
        <TouchableOpacity onPress={pickMedia} style={tw`p-2`}>
          <Feather name="image" size={24} color="#3B82F6" />
        </TouchableOpacity>
        <TouchableOpacity onPress={pickFile} style={tw`p-2`}>
          <Feather name="paperclip" size={24} color="#3B82F6" />
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={tw`flex-1 bg-gray-200 rounded-full px-4 py-3 text-gray-900 text-base shadow-sm`}
          value={message}
          onChangeText={handleTyping}
          placeholder={editingMessageId ? 'Edit message...' : draftMessage ? 'Continue typing...' : 'Message...'}
          placeholderTextColor="#9CA3AF"
          multiline
          maxLength={2000}
          onSubmitEditing={() => handleSendMessage('text')}
        />
        {message || pendingFile ? (
          <TouchableOpacity onPress={() => handleSendMessage('text')} style={tw`p-2 ml-2 bg-blue-500 rounded-full`} disabled={sending}>
            <Ionicons name={editingMessageId ? 'checkmark' : 'send'} size={24} color="white" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setShowScheduleModal(true)} style={tw`p-2 ml-2`}>
            <Feather name="clock" size={24} color="#3B82F6" />
          </TouchableOpacity>
        )}
      </View>
      {pendingFile && (
        <Modal visible={true} transparent animationType="slide">
          <View style={tw`flex-1 bg-black bg-opacity-70 justify-center items-center`}>
            {pendingFile.mimeType?.startsWith('image/') ? (
              <Image source={{ uri: pendingFile.uri }} style={tw`w-80 h-80 rounded-2xl`} resizeMode="contain" />
            ) : pendingFile.mimeType?.startsWith('video/') ? (
              <VideoMessage uri={pendingFile.uri} />
            ) : (
              <Text style={tw`text-white text-lg font-semibold`}>
                {pendingFile.fileName} {pendingFile.size ? `(${(pendingFile.size / 1024 / 1024).toFixed(2)} MB)` : ''}
              </Text>
            )}
            <View style={tw`flex-row mt-4`}>
              <TouchableOpacity onPress={() => setPendingFile(null)} style={tw`p-3 bg-gray-700 rounded-full mx-2`}>
                <Feather name="x" size={24} color="white" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const type = pendingFile.mimeType?.startsWith('image/') ? 'image' : pendingFile.mimeType?.startsWith('video/') ? 'video' : 'file';
                  handleSendMessage(type, pendingFile);
                }}
                style={tw`p-3 bg-blue-500 rounded-full mx-2`}
              >
                <Feather name="send" size={24} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
      {showScheduleModal && (
        <Modal transparent animationType="slide">
          <View style={tw`flex-1 justify-center items-center bg-black bg-opacity-60`}>
            <View style={tw`bg-white p-6 rounded-3xl w-80 shadow-xl`}>
              <Text style={tw`text-xl font-bold text-gray-900 mb-4`}>Schedule Message</Text>
              <DateTimePicker
                value={scheduleDate}
                mode="datetime"
                display="default"
                onChange={(event, selectedDate) => selectedDate && setScheduleDate(selectedDate)}
                minimumDate={new Date()}
              />
              <View style={tw`flex-row justify-end mt-6`}>
                <TouchableOpacity onPress={() => setShowScheduleModal(false)} style={tw`p-2`}>
                  <Text style={tw`text-gray-600 text-lg`}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleSendMessage('text', null, scheduleDate)} style={tw`p-2 ml-4`}>
                  <Text style={tw`text-blue-600 text-lg font-semibold`}>Schedule</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
      {showReadReceipts && (
        <Modal transparent animationType="slide">
          <View style={tw`flex-1 justify-center items-center bg-black bg-opacity-60`}>
            <View style={tw`bg-white p-6 rounded-3xl w-80 shadow-xl`}>
              <Text style={tw`text-xl font-bold text-gray-900 mb-4`}>Read Receipts</Text>
              <ScrollView style={tw`max-h-60`}>
                {messages.find((m) => m.id === showReadReceipts)?.seen_by_details?.map((seen) => (
                  <Text key={seen.user.id} style={tw`text-gray-700 text-base py-1`}>
                    {seen.user.username} at {new Date(seen.seen_at).toLocaleString()}
                  </Text>
                ))}
              </ScrollView>
              <TouchableOpacity onPress={() => setShowReadReceipts(null)} style={tw`mt-4 self-end`}>
                <Text style={tw`text-blue-600 text-lg font-semibold`}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
};

export default ChatScreen;