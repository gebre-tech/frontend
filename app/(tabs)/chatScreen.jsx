import React, { useEffect, useRef, useCallback, useMemo } from 'react';
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
import tw from 'twrnc';
import { useWebSocket } from '../hooks/useWebSocket';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import debounce from 'lodash/debounce';
import { create } from 'zustand';
import { API_URL, PLACEHOLDER_IMAGE, REACTION_EMOJIS, PAGE_SIZE } from '../utils/constants';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import AudioMessage from '../components/AudioMessage';
import VideoMessage from '../components/VideoMessage';
import ImageMessage from '../components/ImageMessage';
import TypingIndicator from '../components/TypingIndicator';
import useMessageStore from '../store/messageStore';

// Zustand store for chat screen state
const useChatScreenStore = create((set) => ({
  chatId: null,
  message: '',
  sending: false,
  editingMessageId: null,
  pendingFile: null,
  isAtBottom: true,
  showReactions: null,
  hasMoreMessages: true,
  loadingMore: false,
  page: 1,
  showScheduleModal: false,
  scheduleDate: new Date(),
  showReadReceipts: null,
  setChatId: (id) => set({ chatId: id }),
  setMessage: (text) => set({ message: text }),
  setSending: (value) => set({ sending: value }),
  setEditingMessageId: (id) => set({ editingMessageId: id }),
  setPendingFile: (file) => set({ pendingFile: file }),
  setIsAtBottom: (value) => set({ isAtBottom: value }),
  setShowReactions: (id) => set({ showReactions: id }),
  setHasMoreMessages: (value) => set({ hasMoreMessages: value }),
  setLoadingMore: (value) => set({ loadingMore: value }),
  setPage: (value) => set({ page: value }),
  setShowScheduleModal: (value) => set({ showScheduleModal: value }),
  setScheduleDate: (date) => set({ scheduleDate: date }),
  setShowReadReceipts: (id) => set({ showReadReceipts: id }),
}));

const ChatScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { chatId: initialChatId, friendId, friendUsername, isGroup = false } = route.params || {};
  const { user, loading: authLoading, refreshToken } = React.useContext(AuthContext);
  const queryClient = useQueryClient();
  const flatListRef = useRef(null);
  const inputRef = useRef(null);
  const isMountedRef = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const reactionAnim = useRef(new Animated.Value(0)).current;

  // Zustand state and actions
  const {
    chatId,
    message,
    sending,
    editingMessageId,
    pendingFile,
    isAtBottom,
    showReactions,
    hasMoreMessages,
    loadingMore,
    page,
    showScheduleModal,
    scheduleDate,
    showReadReceipts,
    setChatId,
    setMessage,
    setSending,
    setEditingMessageId,
    setPendingFile,
    setIsAtBottom,
    setShowReactions,
    setHasMoreMessages,
    setLoadingMore,
    setPage,
    setShowScheduleModal,
    setScheduleDate,
    setShowReadReceipts,
  } = useChatScreenStore();

  const messageStore = useMessageStore();
  const messages = useMemo(() => {
    if (!chatId) return [];
    const chatMessages = messageStore.messages[chatId] || {};
    return Object.values(chatMessages)
      .filter((msg) => {
        const hasTextContent = msg.content && msg.content.trim() !== '';
        const hasMediaContent = msg.message_type !== 'text' && msg.attachment_url;
        return hasTextContent || hasMediaContent;
      })
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }, [chatId, messageStore.messages]);

  const typingUsers = messageStore.typingUsers[chatId] || [];

  const { sendMessage, isConnected, subscribeToEvent } = useWebSocket({
    chatId: chatId || null,
    isGroup,
    userId: user?.id,
  });

  // Initialize chatId
  useEffect(() => {
    if (initialChatId && chatId !== initialChatId) {
      setChatId(initialChatId);
    }
  }, [initialChatId, chatId, setChatId]);

  // Load and save draft messages
  useEffect(() => {
    const loadDraft = async () => {
      if (!chatId) return;
      const draft = await AsyncStorage.getItem(`draft_${chatId}`);
      if (draft) setMessage(draft);
    };
    loadDraft();
  }, [chatId, setMessage]);

  useEffect(() => {
    const saveDraft = async () => {
      if (!chatId) return;
      if (message) {
        await AsyncStorage.setItem(`draft_${chatId}`, message);
      } else {
        await AsyncStorage.removeItem(`draft_${chatId}`);
      }
    };
    saveDraft();
  }, [message, chatId]);

  const fetchMessages = useCallback(async (pageNum) => {
    if (!chatId) return [];
    const token = await AsyncStorage.getItem('token');
    const offset = (pageNum - 1) * PAGE_SIZE;
    const { data } = await axios.get(`${API_URL}/chat/get-messages/${chatId}/?limit=${PAGE_SIZE}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data.filter((msg) => {
      const hasTextContent = msg.content && msg.content.trim() !== '';
      const hasMediaContent = msg.message_type !== 'text' && msg.attachment_url;
      return hasTextContent || hasMediaContent;
    });
  }, [chatId]);

  const loadInitialMessages = useCallback(async () => {
    if (!chatId) return;
    const serverMessages = await fetchMessages(1);
    messageStore.setMessages(chatId, serverMessages);
    setHasMoreMessages(serverMessages.length >= PAGE_SIZE);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
  }, [chatId, fetchMessages, messageStore, setHasMoreMessages]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMoreMessages || !chatId) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const newMessages = await fetchMessages(nextPage);
    messageStore.setMessages(chatId, [...messages, ...newMessages]);
    setPage(nextPage);
    setHasMoreMessages(newMessages.length >= PAGE_SIZE);
    setLoadingMore(false);
  }, [loadingMore, hasMoreMessages, page, fetchMessages, chatId, messages, messageStore, setLoadingMore, setPage, setHasMoreMessages]);

  const handleScroll = useCallback(
    ({ nativeEvent }) => {
      const isBottom =
        nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 20;
      setIsAtBottom(isBottom);
      if (nativeEvent.contentOffset.y <= 100 && !loadingMore && hasMoreMessages) loadMoreMessages();
    },
    [loadingMore, hasMoreMessages, loadMoreMessages, setIsAtBottom]
  );

  useFocusEffect(
    useCallback(() => {
      if (chatId) loadInitialMessages();
      return () => (isMountedRef.current = false);
    }, [chatId, loadInitialMessages])
  );

  const handleNewMessage = useCallback(
    (newMessage) => {
      const hasTextContent = newMessage.content && newMessage.content.trim() !== '';
      const hasMediaContent = newMessage.message_type !== 'text' && newMessage.attachment_url;
      if (!hasTextContent && !hasMediaContent) return;

      const newChatId = newMessage.chat?.id;
      if (!chatId && newChatId && newChatId !== chatId) {
        setChatId(newChatId);
      }
      messageStore.addMessage(chatId || newChatId, newMessage);
      if (isAtBottom) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    },
    [chatId, isAtBottom, messageStore, setChatId]
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
          reactions: [...(messageStore.messages[chatId]?.[event.message_id]?.reactions || []), event.emoji],
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
  }, [subscribeToEvent, handleNewMessage, chatId, queryClient, user?.id]);

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
    onError: (error) => {
      console.error('Mark as read error:', error);
      Alert.alert('Error', 'Failed to mark messages as read: ' + error.message);
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
    onError: (error) => {
      console.error('Mark as delivered error:', error);
      Alert.alert('Error', 'Failed to mark messages as delivered: ' + error.message);
    },
  });

  const throttledMarkAsRead = useMemo(() => debounce((messageIds) => markAsRead.mutate(messageIds), 1000), [markAsRead]);
  const throttledMarkAsDelivered = useMemo(() => debounce((messageIds) => markAsDelivered.mutate(messageIds), 1000), [markAsDelivered]);

  // Use refs to track previous message IDs to avoid infinite loops
  const prevUnreadMessageIds = useRef([]);
  const prevUndeliveredMessageIds = useRef([]);

  useEffect(() => {
    if (!chatId || !isAtBottom) return;

    // Compute unread and undelivered messages inside the effect
    const unreadMessages = messages.filter(
      (msg) => msg.sender.id !== user?.id && !(msg.seen_by_details || []).some((u) => u.user.id === user?.id)
    );
    const undeliveredMessages = messages.filter(
      (msg) => msg.sender.id !== user?.id && !(msg.delivered_to || []).some((u) => u.id === user?.id)
    );

    const unreadMessageIds = unreadMessages.map((msg) => msg.id);
    const undeliveredMessageIds = undeliveredMessages.map((msg) => msg.id);

    // Only mark as delivered/read if the message IDs have changed
    if (undeliveredMessageIds.length > 0 && !arraysEqual(undeliveredMessageIds, prevUndeliveredMessageIds.current)) {
      throttledMarkAsDelivered(undeliveredMessageIds);
      prevUndeliveredMessageIds.current = undeliveredMessageIds;
    }

    if (unreadMessageIds.length > 0 && !arraysEqual(unreadMessageIds, prevUnreadMessageIds.current)) {
      throttledMarkAsRead(unreadMessageIds);
      prevUnreadMessageIds.current = unreadMessageIds;
    }

    return () => {
      throttledMarkAsDelivered.cancel();
      throttledMarkAsRead.cancel();
    };
  }, [chatId, isAtBottom, messages, user?.id, throttledMarkAsDelivered, throttledMarkAsRead]);

  // Helper function to compare arrays
  const arraysEqual = (arr1, arr2) => {
    if (arr1.length !== arr2.length) return false;
    return arr1.every((value, index) => value === arr2[index]);
  };

  const getMimeTypeFromUri = useCallback((uri, fileName) => {
    if (!uri && !fileName) return 'application/octet-stream';
    const ext = (fileName || uri.split('/').pop()).split('.').pop()?.toLowerCase();
    const mimeTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
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
  }, []);

  const getFileIcon = useCallback((fileName) => {
    const ext = fileName?.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf': return 'file-pdf';
      case 'doc':
      case 'docx': return 'file-text';
      default: return 'file';
    }
  }, []);

  const getFileSize = useCallback(async (uri) => {
    if (Platform.OS === 'web') return null;
    const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
    return fileInfo.exists ? fileInfo.size : null;
  }, []);

  const handleSendMessage = useCallback(
  async (type = 'text', attachment, schedule = null) => {
    if (sending) return;

    const hasTextContent = type === 'text' && message.trim() !== '';
    const hasMediaContent = attachment && type !== 'text';
    if (!hasTextContent && !hasMediaContent) {
      Alert.alert('Error', 'Message cannot be empty');
      return;
    }

    setSending(true);
    try {
      let attachmentUrl = null;
      let newChatId = chatId;
      let attachmentSize = null;
      let determinedType = type;

      if (attachment) {
        if (!attachment.uri) throw new Error('Invalid attachment: Missing URI');

        console.log('Sending attachment:', attachment);

        if (Platform.OS !== 'web') {
          attachmentSize = await getFileSize(attachment.uri);
          if (attachmentSize > 100 * 1024 * 1024) {
            throw new Error('File size exceeds 100MB limit. Please choose a smaller file.');
          }
        }

        const fileExtension = (attachment.fileName || attachment.uri || '').split('.').pop()?.toLowerCase();
        const mimeType = attachment.mimeType || getMimeTypeFromUri(attachment.uri, attachment.fileName);

        if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif'].includes(fileExtension)) {
          determinedType = 'image';
        } else if (mimeType?.startsWith('video/') || ['mp4', 'mov'].includes(fileExtension)) {
          determinedType = 'video';
        } else if (mimeType?.startsWith('audio/') || ['mp3', 'wav'].includes(fileExtension)) {
          determinedType = 'audio';
        } else {
          determinedType = 'file';
        }

        const token = await AsyncStorage.getItem('token');
        const formData = new FormData();

        if (Platform.OS === 'web') {
          if (attachment.uri.startsWith('data:')) {
            formData.append('file', attachment.uri);
          } else if (attachment.uri.startsWith('blob:')) {
            const response = await fetch(attachment.uri);
            const blob = await response.blob();
            formData.append('file', new File([blob], attachment.fileName, { type: mimeType }));
          } else {
            throw new Error('Unsupported URI format on web');
          }
        } else {
          let uri = attachment.uri;
          const fileInfo = await FileSystem.getInfoAsync(uri);
          if (!fileInfo.exists) throw new Error('File not found at the specified URI');
          if (Platform.OS === 'android' && !uri.startsWith('file://')) uri = `file://${uri}`;
          formData.append('file', { uri, type: mimeType, name: attachment.fileName });
        }

        const response = await withTokenRefresh(() =>
          axios.post(
            chatId ? `${API_URL}/chat/upload-attachment/${chatId}/` : `${API_URL}/chat/send-message/`,
            formData,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'multipart/form-data',
              },
              onUploadProgress: (progressEvent) => {
                const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                console.log(`Upload progress: ${progress}%`);
              },
            }
          )
        ).catch((error) => {
          // Enhanced error handling for upload failures
          if (error.response?.status === 413) {
            throw new Error('File size too large. Maximum allowed is 100MB.');
          } else if (error.response?.status === 400) {
            throw new Error(error.response.data.error || 'Invalid file upload request.');
          } else {
            throw new Error(error.response?.data?.error || 'Failed to upload file. Please try again.');
          }
        });

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
        content: hasTextContent && !editingMessageId ? message : '',
        message_type: determinedType,
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
      if (hasTextContent) setMessage('');
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
        content: hasTextContent && !editingMessageId ? message : '',
        message_type: determinedType,
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
            axios.post(`${API_URL}/chat/send-message/`, { 
              receiver_id: friendId, 
              content: hasTextContent ? message : '', 
              message_type: determinedType, 
              attachment_url: attachmentUrl 
            }, {
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
      Alert.alert('Error', error.message || 'Failed to send message. Please try again.');
      setPendingFile(null);
    } finally {
      setSending(false);
    }
  },
  [message, chatId, editingMessageId, user, friendId, sendMessage, withTokenRefresh, messageStore, getMimeTypeFromUri, getFileSize, setSending, setMessage, setPendingFile, setShowScheduleModal, setChatId]
);

  const editMessage = useMutation({
    mutationFn: ({ messageId, content }) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem('token');
        const { data } = await axios.post(`${API_URL}/chat/edit-message/${messageId}/`, { content }, { 
          headers: { Authorization: `Bearer ${token}` } 
        });
        return data;
      }),
    onSuccess: (updatedMessage) => {
      const hasTextContent = updatedMessage.content && updatedMessage.content.trim() !== '';
      const hasMediaContent = updatedMessage.message_type !== 'text' && updatedMessage.attachment_url;
      if (!hasTextContent && !hasMediaContent) return;

      messageStore.updateMessage(chatId, updatedMessage.id, updatedMessage);
      setEditingMessageId(null);
      setMessage('');
    },
    onError: (error) => {
      console.error('Edit message error:', error);
      Alert.alert('Error', 'Failed to edit message: ' + error.message);
    },
  });

  const pickMedia = useCallback(async () => {
    try {
      let result;
      if (Platform.OS === 'web') {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          quality: 0.8,
          allowsMultipleSelection: false,
          base64: true,
        });
      } else {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission required', 'Please allow media access.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          quality: 0.8,
          allowsEditing: false,
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        if (!asset.uri) {
          Alert.alert('Error', 'Invalid media: Missing URI');
          return;
        }
        const mimeType = asset.mimeType || getMimeTypeFromUri(asset.uri, asset.fileName);
        setPendingFile({
          uri: Platform.OS === 'web' && asset.base64 
            ? `data:${mimeType};base64,${asset.base64}`
            : asset.uri,
          mimeType,
          fileName: asset.fileName || `media_${Date.now()}.${mimeType.split('/')[1] || 'bin'}`,
          size: asset.fileSize || null,
        });
      }
    } catch (error) {
      console.error('Pick media error:', error);
      Alert.alert('Error', 'Failed to pick media: ' + error.message);
    }
  }, [getMimeTypeFromUri, setPendingFile]);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) {
        console.log('File picking canceled');
        return;
      }

      const file = result.assets?.[0];
      if (!file) {
        Alert.alert('Error', 'Failed to pick file: No file selected');
        return;
      }

      if (!file.uri || !file.name) {
        Alert.alert('Error', 'Failed to pick file: Missing URI or name');
        return;
      }

      const fileInfo = Platform.OS !== 'web' ? await FileSystem.getInfoAsync(file.uri, { size: true }) : {};
      if (Platform.OS !== 'web' && !fileInfo.exists) {
        Alert.alert('Error', 'Selected file does not exist');
        return;
      }

      const mimeType = file.mimeType || getMimeTypeFromUri(file.uri, file.name);
      const fileObj = {
        uri: file.uri,
        fileName: file.name,
        mimeType,
        size: fileInfo.size || file.size || null,
      };

      console.log('Picked file:', fileObj);
      setPendingFile(fileObj);
    } catch (error) {
      console.error('Pick file error:', error);
      Alert.alert('Error', 'Failed to pick file: ' + error.message);
    }
  }, [getMimeTypeFromUri, setPendingFile]);

  const downloadFile = useCallback(async (attachmentUrl, attachmentName) => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission required', 'Please allow storage access.');
          return;
        }
        const fileUri = `${FileSystem.documentDirectory}${attachmentName}`;
        const { uri } = await FileSystem.downloadAsync(attachmentUrl, fileUri);
        await MediaLibrary.saveToLibraryAsync(uri);
        Alert.alert('Success', `File downloaded as ${attachmentName}. You can rename it in your gallery.`);
      } else {
        const link = document.createElement('a');
        link.href = attachmentUrl;
        link.download = attachmentName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Download file error:', error);
      Alert.alert('Error', 'Failed to download file: ' + error.message);
    }
  }, []);

  const debouncedTyping = useRef(debounce((text) => {
    if (isConnected && chatId) sendMessage({ type: 'typing', user: user?.id, username: user?.username });
  }, 500)).current;

  const handleTyping = useCallback((text) => {
    setMessage(text);
    debouncedTyping(text);
  }, [debouncedTyping, setMessage]);

  const retryMessage = useCallback(
    (messageId) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      messageStore.updateMessage(chatId, messageId, { status: 'pending' });
      sendMessage({ 
        type: 'message', 
        content: msg.content, 
        message_type: msg.message_type, 
        attachment_url: msg.attachment_url, 
        timestamp: new Date().toISOString(), 
        id: messageId, 
        chat_id: chatId 
      });
    },
    [messages, chatId, sendMessage, messageStore]
  );

  const handleDeleteMessage = useCallback(async (messageId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.delete(`${API_URL}/chat/delete-message/${messageId}/`, { headers: { Authorization: `Bearer ${token}` } });
      messageStore.deleteMessage(chatId, messageId);
      sendMessage({ type: 'delete', message_id: messageId });
    } catch (error) {
      console.error('Delete message error:', error);
      Alert.alert('Error', 'Failed to delete message: ' + error.message);
    }
  }, [chatId, messageStore, sendMessage]);

  const handleReaction = useCallback(async (messageId, emoji) => {
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.post(`${API_URL}/chat/react-to-message/${messageId}/`, { emoji }, { headers: { Authorization: `Bearer ${token}` } });
      messageStore.updateMessage(chatId, messageId, { 
        reactions: [...(messageStore.messages[chatId]?.[messageId]?.reactions || []), emoji] 
      });
      setShowReactions(null);
      sendMessage({ type: 'reaction', message_id: messageId, emoji });
    } catch (error) {
      console.error('Add reaction error:', error);
      Alert.alert('Error', 'Failed to add reaction: ' + error.message);
    }
  }, [chatId, messageStore, sendMessage, setShowReactions]);

  const pinMessage = useMutation({
    mutationFn: (messageId) =>
      withTokenRefresh(async () => {
        const token = await AsyncStorage.getItem('token');
        await axios.post(`${API_URL}/chat/pin-message/${chatId}/${messageId}/`, {}, { 
          headers: { Authorization: `Bearer ${token}` } 
        });
      }),
    onSuccess: (_, messageId) => {
      messageStore.updateMessage(chatId, messageId, { isPinned: true });
      sendMessage({ type: 'pin', message_id: messageId });
    },
    onError: (error) => {
      console.error('Pin message error:', error);
      Alert.alert('Error', 'Failed to pin message: ' + error.message);
    },
  });

  const showMessageActions = useCallback((item) => {
    const options = [
      ...(item.sender.id === user.id && !item.is_deleted
        ? [
            { text: 'Edit', onPress: () => { setEditingMessageId(item.id); setMessage(item.content); inputRef.current?.focus(); } },
            { text: 'Delete', onPress: () => handleDeleteMessage(item.id) },
            ...(item.status !== 'scheduled' ? [{ text: 'Schedule', onPress: () => { setEditingMessageId(item.id); setMessage(item.content); setShowScheduleModal(true); } }] : []),
          ]
        : []),
      ...(isGroup && profile?.admins?.some((a) => a.id === user.id)
        ? [{ text: item.isPinned ? 'Unpin' : 'Pin', onPress: () => pinMessage.mutate(item.id) }]
        : []),
      { text: 'React', onPress: () => setShowReactions(item.id) },
      ...(item.message_type === 'file' ? [{ text: 'Download', onPress: () => downloadFile(item.attachment_url, item.attachment_name) }] : []),
      { text: 'Cancel', style: 'cancel' },
    ];
    Alert.alert('Message Options', '', options);
  }, [user, isGroup, profile, handleDeleteMessage, pinMessage, sendMessage, downloadFile, setEditingMessageId, setMessage, setShowScheduleModal, setShowReactions]);

  const renderMediaContent = useCallback((item, isSent, status, time, onPressFile, retryMessage) => {
    if (!item.attachment_url) return null;

    const fileExtension = (item.attachment_url || item.attachment_name || '').split('.').pop()?.toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif'].includes(fileExtension);
    const isVideo = ['mp4', 'mov'].includes(fileExtension);
    const isAudio = ['mp3', 'wav'].includes(fileExtension);

    if (item.message_type === 'image' || (item.message_type === 'file' && isImage)) {
      return (
        <ImageMessage
          uri={item.attachment_url}
          fileName={item.attachment_name}
          fileSize={item.attachment_size}
          isSent={isSent}
          timestamp={item.timestamp}
          status={status}
          onRetry={() => retryMessage(item.id)}
        />
      );
    } else if (item.message_type === 'video' || (item.message_type === 'file' && isVideo)) {
      return (
        <VideoMessage
          uri={item.attachment_url}
          fileName={item.attachment_name}
          fileSize={item.attachment_size}
          timestamp={item.timestamp}
          status={status}
          isSent={isSent}
          onRetry={() => retryMessage(item.id)}
        />
      );
    } else if (item.message_type === 'audio' || (item.message_type === 'file' && isAudio)) {
      return (
        <AudioMessage
          uri={item.attachment_url}
          fileName={item.attachment_name}
          fileSize={item.attachment_size}
          timestamp={item.timestamp}
          status={status}
          isSent={isSent}
          onRetry={() => retryMessage(item.id)}
        />
      );
    } else if (item.message_type === 'file') {
      return (
        <TouchableOpacity
          onPress={onPressFile}
          style={tw`flex-row items-center bg-gray-200 dark:bg-gray-700 rounded-xl p-4 shadow-sm ${status === 'pending' ? 'opacity-70' : ''}`}
          accessibilityLabel={`Download file: ${item.attachment_name || item.attachment_url?.split('/').pop()}`}
        >
          <Feather name={getFileIcon(item.attachment_name || item.attachment_url)} size={24} color="#3B82F6" />
          <View style={tw`flex-1 ml-3`}>
            <Text style={tw`text-gray-800 dark:text-gray-200 text-sm font-medium`} numberOfLines={1}>
              {item.attachment_name || item.attachment_url?.split('/').pop()}
            </Text>
            {item.attachment_size && (
              <Text style={tw`text-gray-500 dark:text-gray-400 text-xs`}>
                {(item.attachment_size / 1024 / 1024).toFixed(2)} MB
              </Text>
            )}
          </View>
          <Feather name="download" size={24} color="#3B82F6" style={tw`ml-2`} />
          <View style={tw`flex-row items-center`}>
            <Text style={tw`text-xs text-gray-500 dark:text-gray-400 mr-2 font-medium`}>{time}</Text>
            {isSent && (
              <TouchableOpacity
                onPress={() => status === 'pending' && !isConnected ? retryMessage(item.id) : setShowReadReceipts(item.id)}
                accessibilityLabel={status === 'pending' && !isConnected ? "Retry sending message" : "View read receipts"}
              >
                <Text style={tw`text-xs font-medium ${status === '✓✓' ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`}>
                  {status === 'pending' && !isConnected ? 'Retry' : status}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      );
    }
    return null;
  }, [getFileIcon, isConnected, retryMessage, setShowReadReceipts]);

  const renderMessage = useCallback(
    ({ item }) => {
      const hasTextContent = item.content && item.content.trim() !== '';
      const hasMediaContent = item.message_type !== 'text' && item.attachment_url;
      if (!hasTextContent && !hasMediaContent) return null;

      const isSent = item.sender.id === user?.id;
      const status = item.status || (item.seen_by_details?.length > (isGroup ? 1 : 0) ? '✓✓' : item.delivered_to?.length > (isGroup ? 1 : 0) ? '✓' : item.tempId ? '⌛' : '✓');
      const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const onPressFile = () => {
        if (item.attachment_url) downloadFile(item.attachment_url, item.attachment_name);
      };

      if (!hasTextContent && hasMediaContent) {
        const mediaContent = renderMediaContent(item, isSent, status, time, onPressFile, retryMessage);
        if (!mediaContent) return null;

        return (
          <Animated.View style={[tw`flex-row ${isSent ? 'justify-end' : 'justify-start'} mx-3 my-1`, { opacity: fadeAnim }]}>
            <View>
              {mediaContent}
              {item.reactions?.length > 0 && (
                <View style={tw`flex-row mt-1 bg-gray-300 dark:bg-gray-600 rounded-full px-2 py-1 self-end shadow-sm`}>
                  {item.reactions.map((emoji, idx) => (
                    <Text key={idx} style={tw`text-sm mr-1`}>{emoji}</Text>
                  ))}
                </View>
              )}
            </View>
            {showReactions === item.id && (
              <Animated.View
                style={[
                  tw`absolute bottom-12 ${isSent ? 'right-0' : 'left-0'} bg-white dark:bg-gray-800 p-2 rounded-full shadow-lg flex-row border border-gray-200 dark:border-gray-700`,
                  { transform: [{ translateY: reactionAnim }] },
                ]}
              >
                {REACTION_EMOJIS.map((emoji) => (
                  <Pressable key={emoji} onPress={() => handleReaction(item.id, emoji)} style={tw`p-1`} accessibilityLabel={`React with ${emoji}`}>
                    <Text style={tw`text-lg`}>{emoji}</Text>
                  </Pressable>
                ))}
              </Animated.View>
            )}
          </Animated.View>
        );
      }

      return (
        <Animated.View style={[tw`flex-row ${isSent ? 'justify-end' : 'justify-start'} mx-3 my-1`, { opacity: fadeAnim }]}>
          <TouchableOpacity
            style={tw`rounded-3xl p-3 max-w-[80%] ${isSent ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'} ${item.isPinned ? 'border-2 border-amber-400' : ''} shadow-sm`}
            onLongPress={() => showMessageActions(item)}
            onPress={item.message_type === 'file' ? onPressFile : undefined}
            accessibilityLabel={item.message_type === 'text' ? item.content : `View ${item.message_type} message`}
          >
            {!isSent && isGroup && (
              <Text style={tw`text-gray-600 dark:text-gray-400 text-xs mb-1 font-semibold`}>
                {item.sender.first_name || item.sender.username}
              </Text>
            )}
            {hasTextContent && item.message_type === 'text' && (
              <Text style={tw`${isSent ? 'text-white' : 'text-gray-900 dark:text-gray-200'} ${item.is_deleted ? 'italic text-gray-400 dark:text-gray-500' : ''} text-sm leading-5 font-medium`}>
                {item.content}
              </Text>
            )}
            {hasMediaContent && renderMediaContent(item, isSent, status, time, onPressFile, retryMessage)}
            {item.status === 'scheduled' && (
              <Text style={tw`text-xs italic text-gray-400 dark:text-gray-500 mt-2`}>
                Scheduled for {new Date(item.scheduledTime).toLocaleString()}
              </Text>
            )}
            <View style={tw`flex-row items-center justify-end mt-1`}>
              <Text style={tw`text-xs ${isSent ? 'text-blue-200' : 'text-gray-500 dark:text-gray-400'} mr-2 font-medium`}>{time}</Text>
              {isSent && (
                <TouchableOpacity
                  onPress={() => status === 'pending' && !isConnected ? retryMessage(item.id) : setShowReadReceipts(item.id)}
                  accessibilityLabel={status === 'pending' && !isConnected ? "Retry sending message" : "View read receipts"}
                >
                  <Text style={tw`text-xs font-medium ${status === '✓✓' ? 'text-blue-400' : 'text-gray-300 dark:text-gray-500'}`}>
                    {status === 'pending' && !isConnected ? 'Retry' : status}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {item.reactions?.length > 0 && (
              <View style={tw`flex-row mt-1 bg-gray-300 dark:bg-gray-600 rounded-full px-2 py-1 shadow-sm`}>
                {item.reactions.map((emoji, idx) => (
                  <Text key={idx} style={tw`text-sm mr-1`}>{emoji}</Text>
                ))}
              </View>
            )}
          </TouchableOpacity>
          {showReactions === item.id && (
            <Animated.View
              style={[
                tw`absolute bottom-12 ${isSent ? 'right-0' : 'left-0'} bg-white dark:bg-gray-800 p-2 rounded-full shadow-lg flex-row border border-gray-200 dark:border-gray-700`,
                { transform: [{ translateY: reactionAnim }] },
              ]}
            >
              {REACTION_EMOJIS.map((emoji) => (
                <Pressable key={emoji} onPress={() => handleReaction(item.id, emoji)} style={tw`p-1`} accessibilityLabel={`React with ${emoji}`}>
                  <Text style={tw`text-lg`}>{emoji}</Text>
                </Pressable>
              ))}
            </Animated.View>
          )}
        </Animated.View>
      );
    },
    [user?.id, isGroup, showReactions, fadeAnim, reactionAnim, isConnected, retryMessage, downloadFile, showMessageActions, handleReaction, renderMediaContent]
  );

  useEffect(() => {
    const checkScheduledMessages = async () => {
      const scheduledMessages = JSON.parse(await AsyncStorage.getItem('scheduledMessages') || '[]');
      const now = new Date();
      const toSend = scheduledMessages.filter((msg) => new Date(msg.scheduledTime) <= now);
      if (toSend.length) {
        toSend.forEach((msg) => {
          const hasTextContent = msg.content && msg.content.trim() !== '';
          const hasMediaContent = msg.message_type !== 'text' && msg.attachment_url;
          if (!hasTextContent && !hasMediaContent) return;

          messageStore.updateMessage(msg.chatId, msg.id, { status: 'pending' });
          sendMessage({ 
            type: 'message', 
            content: msg.content, 
            message_type: msg.message_type, 
            attachment_url: msg.attachment_url, 
            timestamp: new Date().toISOString(), 
            id: msg.id, 
            chat_id: msg.chatId 
          });
        });
        const remaining = scheduledMessages.filter((msg) => new Date(msg.scheduledTime) > now);
        await AsyncStorage.setItem('scheduledMessages', JSON.stringify(remaining));
      }
    };
    const interval = setInterval(checkScheduledMessages, 60000);
    return () => clearInterval(interval);
  }, [sendMessage, messageStore]);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    if (showReactions) {
      Animated.timing(reactionAnim, { toValue: -10, duration: 200, useNativeDriver: true }).start();
    } else {
      Animated.timing(reactionAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [showReactions, reactionAnim]);

  const Header = useMemo(
    () => (
      <LinearGradient colors={['#1E90FF', '#3B82F6']} style={tw`p-4 pt-12 flex-row items-center shadow-md`}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={tw`mr-3`} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        {!isGroup ? (
          <TouchableOpacity 
            style={tw`flex-row items-center flex-1`} 
            onPress={() => navigation.navigate('FriendProfile', { username: friendUsername })} 
            accessibilityLabel={`View ${friendUsername}'s profile`}
          >
            <View style={tw`relative`}>
              <Image 
                source={{ uri: profile?.profile_picture || PLACEHOLDER_IMAGE }} 
                style={tw`w-12 h-12 rounded-full mr-3 border-2 border-white shadow-sm`} 
              />
              {profile?.is_online && (
                <View style={tw`absolute bottom-0 right-3 w-5 h-5 bg-green-500 rounded-full border-2 border-white`} />
              )}
            </View>
            <View>
              <Text style={tw`text-white text-xl font-bold`}>{profile?.user?.first_name || 'Unknown'}</Text>
              <Text style={tw`text-blue-100 text-sm`}>
                {profile?.is_online ? 'Online' : profile?.last_seen ? `Last seen ${new Date(profile.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Offline'}
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={tw`flex-1`}>
            <Text style={tw`text-white text-xl font-bold`}>{profile?.name || `Group ${chatId || ''}`}</Text>
          </View>
        )}
        <TouchableOpacity style={tw`ml-3`} accessibilityLabel="More options">
          <Feather name="more-vertical" size={24} color="white" />
        </TouchableOpacity>
      </LinearGradient>
    ),
    [navigation, isGroup, chatId, profile, friendUsername]
  );

  if (authLoading || (chatId && profileLoading)) {
    return (
      <View style={tw`flex-1 justify-center items-center bg-gray-100 dark:bg-gray-900`}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={tw`flex-1 bg-white dark:bg-gray-900`}
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
        contentContainerStyle={tw`pb-4 flex-grow bg-gray-50 dark:bg-gray-900`}
        initialNumToRender={15}
        ListEmptyComponent={
          <Text style={tw`text-center mt-10 text-gray-500 dark:text-gray-400 text-base font-medium`}>
            {chatId ? 'Start the conversation!' : 'Send a message to begin'}
          </Text>
        }
        ListHeaderComponent={loadingMore && <ActivityIndicator size="small" color="#3B82F6" style={tw`py-4`} />}
        onContentSizeChange={() => isAtBottom && flatListRef.current?.scrollToEnd({ animated: false })}
      />
      {typingUsers.length > 0 && (
        <TypingIndicator
          users={typingUsers}
          isGroup={isGroup}
          friendName={profile?.user?.first_name || friendUsername}
        />
      )}
      {!isAtBottom && (
        <TouchableOpacity 
          style={tw`absolute bottom-20 right-4 bg-blue-600 p-3 rounded-full shadow-lg`} 
          onPress={() => flatListRef.current?.scrollToEnd({ animated: true })} 
          accessibilityLabel="Scroll to bottom"
        >
          <Ionicons name="chevron-down" size={20} color="white" />
        </TouchableOpacity>
      )}
      <View style={tw`bg-white dark:bg-gray-800 p-3 flex-row items-center border-t border-gray-200 dark:border-gray-700 shadow-lg`}>
        <TouchableOpacity onPress={pickMedia} style={tw`p-2`} accessibilityLabel="Pick media">
          <Feather name="image" size={24} color="#3B82F6" />
        </TouchableOpacity>
        <TouchableOpacity onPress={pickFile} style={tw`p-2`} accessibilityLabel="Pick file">
          <Feather name="paperclip" size={24} color="#3B82F6" />
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={tw`flex-1 bg-gray-100 dark:bg-gray-700 rounded-full px-4 py-3 text-gray-900 dark:text-gray-200 text-sm border border-gray-200 dark:border-gray-600 shadow-sm`}
          value={message}
          onChangeText={handleTyping}
          placeholder={editingMessageId ? 'Edit message...' : message ? 'Continue typing...' : 'Message...'}
          placeholderTextColor="#9CA3AF"
          multiline
          maxLength={2000}
          onSubmitEditing={() => handleSendMessage('text')}
          accessibilityLabel="Message input"
        />
        {message || pendingFile ? (
          <TouchableOpacity 
            onPress={() => handleSendMessage('text')} 
            style={tw`p-2 ml-2 bg-blue-600 rounded-full`} 
            disabled={sending} 
            accessibilityLabel={editingMessageId ? "Confirm edit" : "Send message"}
          >
            <Ionicons name={editingMessageId ? 'checkmark' : 'send'} size={24} color="white" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setShowScheduleModal(true)} style={tw`p-2 ml-2`} accessibilityLabel="Schedule message">
            <Feather name="clock" size={24} color="#3B82F6" />
          </TouchableOpacity>
        )}
      </View>
      {pendingFile && (
        <Modal visible={true} transparent animationType="fade">
          <View style={tw`flex-1 bg-black bg-opacity-80 justify-center items-center`}>
            <View style={tw`bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-lg w-80`}>
              {pendingFile.mimeType?.startsWith('image/') ? (
                <Image source={{ uri: pendingFile.uri }} style={tw`w-72 h-72 rounded-xl shadow-md`} resizeMode="contain" />
              ) : pendingFile.mimeType?.startsWith('video/') ? (
                <VideoMessage uri={pendingFile.uri} timestamp={new Date().toISOString()} isSent={true} />
              ) : pendingFile.mimeType?.startsWith('audio/') ? (
                <AudioMessage uri={pendingFile.uri} timestamp={new Date().toISOString()} isSent={true} />
              ) : (
                <View style={tw`flex-row items-center justify-center py-4`}>
                  <Feather name={getFileIcon(pendingFile.fileName)} size={24} color="#3B82F6" />
                  <View style={tw`flex-1 ml-3`}>
                    <Text style={tw`text-gray-800 dark:text-gray-200 text-sm font-medium`} numberOfLines={1}>
                      {pendingFile.fileName}
                    </Text>
                    {pendingFile.size && (
                      <Text style={tw`text-gray-500 dark:text-gray-400 text-xs`}>
                        {(pendingFile.size / 1024 / 1024).toFixed(2)} MB
                      </Text>
                    )}
                  </View>
                </View>
              )}
              <View style={tw`flex-row mt-4 justify-between`}>
                <TouchableOpacity 
                  onPress={() => setPendingFile(null)} 
                  style={tw`p-3 bg-gray-500 rounded-full mx-2 shadow-md`} 
                  accessibilityLabel="Cancel file upload"
                >
                  <Feather name="x" size={24} color="white" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const type = pendingFile.mimeType?.startsWith('image/') 
                      ? 'image' 
                      : pendingFile.mimeType?.startsWith('video/') 
                      ? 'video' 
                      : pendingFile.mimeType?.startsWith('audio/') 
                      ? 'audio' 
                      : 'file';
                    handleSendMessage(type, pendingFile);
                  }}
                  style={tw`p-3 bg-blue-600 rounded-full mx-2 shadow-md`}
                  accessibilityLabel="Send file"
                >
                  <Ionicons name="send" size={24} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
      {showScheduleModal && (
        <Modal visible={true} transparent animationType="slide">
          <View style={tw`flex-1 bg-black bg-opacity-50 justify-center items-center`}>
            <View style={tw`bg-white dark:bg-gray-800 p-4 rounded-2xl w-80 shadow-lg`}>
              <Text style={tw`text-gray-800 dark:text-gray-200 text-lg font-semibold mb-4`}>Schedule Message</Text>
              <DateTimePicker
                value={scheduleDate}
                mode="datetime"
                display="default"
                onChange={(event, selectedDate) => setScheduleDate(selectedDate || scheduleDate)}
                minimumDate={new Date()}
              />
              <View style={tw`flex-row mt-4 justify-between`}>
                <TouchableOpacity 
                  onPress={() => setShowScheduleModal(false)} 
                  style={tw`p-3 bg-gray-500 rounded-full mx-2 shadow-md`} 
                  accessibilityLabel="Cancel scheduling"
                >
                  <Feather name="x" size={24} color="white" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    if (message.trim() || pendingFile) {
                      const type = pendingFile
                        ? (pendingFile.mimeType?.startsWith('image/') ? 'image' : pendingFile.mimeType?.startsWith('video/') ? 'video' : pendingFile.mimeType?.startsWith('audio/') ? 'audio' : 'file')
                        : 'text';
                      handleSendMessage(type, pendingFile, scheduleDate);
                    } else {
                      Alert.alert('Error', 'Message cannot be empty');
                    }
                  }}
                  style={tw`p-3 bg-blue-600 rounded-full mx-2 shadow-md`}
                  accessibilityLabel="Confirm schedule"
                >
                  <Ionicons name="checkmark" size={24} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
      {showReadReceipts && (
        <Modal visible={true} transparent animationType="fade">
          <View style={tw`flex-1 bg-black bg-opacity-50 justify-center items-center`}>
            <View style={tw`bg-white dark:bg-gray-800 p-4 rounded-2xl w-80 shadow-lg`}>
              <Text style={tw`text-gray-800 dark:text-gray-200 text-lg font-semibold mb-4`}>Read Receipts</Text>
              <ScrollView style={tw`max-h-60`}>
                {messages.find((m) => m.id === showReadReceipts)?.seen_by_details?.map((receipt, idx) => (
                  <View key={idx} style={tw`flex-row items-center mb-2`}>
                    <Text style={tw`text-gray-800 dark:text-gray-200 text-sm flex-1`}>
                      {receipt.user.username} seen at {new Date(receipt.seen_at).toLocaleString()}
                    </Text>
                  </View>
                )) || <Text style={tw`text-gray-500 dark:text-gray-400 text-sm`}>No read receipts yet.</Text>}
              </ScrollView>
              <TouchableOpacity 
                onPress={() => setShowReadReceipts(null)} 
                style={tw`mt-4 p-3 bg-blue-600 rounded-full self-center shadow-md`} 
                accessibilityLabel="Close read receipts"
              >
                <Feather name="x" size={24} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
};

export default ChatScreen;