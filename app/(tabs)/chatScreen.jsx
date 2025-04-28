import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import 'react-native-get-random-values';
import {
  View, FlatList, TextInput, Text, TouchableOpacity,
  TouchableWithoutFeedback, Keyboard, Image, Modal, Dimensions, StyleSheet, Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Video } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';
import { Buffer } from 'buffer';
import aesjs from 'aes-js';
import { x25519 } from '@noble/curves/ed25519';
import axios from 'axios';
import { API_HOST, API_URL, PLACEHOLDER_IMAGE_ICON, DEFAULT_AVATAR_ICON, REACTION_EMOJIS } from '../utils/constants';

if (!global.crypto || !global.crypto.getRandomValues) {
  console.error("(NOBRIDGE) ERROR crypto.getRandomValues is not defined in chatroom.tsx");
  throw new Error("crypto.getRandomValues must be defined");
}

const checkAESSupport = () => {
  const aesExists = !!Crypto.CryptoEncryptionAlgorithm?.AES256CBC;
  console.log("(NOBRIDGE) CHECK AES-256-CBC exists:", aesExists);
  return aesExists;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' }, // Updated to a professional off-white
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: 'transparent',
    backgroundImage: 'linear-gradient(to right, #1E90FF, #8A2BE2)',
  },
  backButton: {
    marginRight: 10,
  },
  headerProfileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  profileImageContainer: {
    position: 'relative',
    marginRight: 10,
  },
  headerProfileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e0e0e0',
  },
  onlineStatusRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#4CAF50',
    top: -4,
    left: -4,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginRight: 8,
  },
  messageContainer: {
    padding: 10,
    borderRadius: 10,
    maxWidth: '80%',
    marginBottom: 10,
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  senderMessage: {
    backgroundColor: '#D1FAE5', // Updated to a subtle teal
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  receiverMessage: {
    backgroundColor: '#E5E7EB', // Updated to a light gray
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  messageText: { fontSize: 16, marginBottom: 5 },
  imageMessage: { width: 200, height: 200, marginBottom: 5 },
  videoMessage: { width: 200, height: 200, marginBottom: 5 },
  messageTime: { fontSize: 12, color: '#888', alignSelf: 'flex-end' },
  inputContainer: {
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 25,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pendingFileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    padding: 5,
    marginBottom: 10,
  },
  pendingImage: {
    width: 50,
    height: 50,
    borderRadius: 5,
  },
  pendingFileText: {
    fontSize: 14,
    color: '#333',
    marginRight: 10,
  },
  removeFileButton: {
    backgroundColor: '#ff4444',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    color: '#333',
  },
  sendButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  photoButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2196F3',
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 5,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  closeButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 15,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

async function fetchReceiverPublicKey(receiverId, token) {
  try {
    const response = await fetch(`${API_URL}/auth/user/${receiverId}/public_key/`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = await response.json();
    if (response.ok) {
      console.log("(NOBRIDGE) LOG Fetched receiver_public_key:", data.public_key);
      return data.public_key;
    }
    return null;
  } catch (error) {
    console.error("(NOBRIDGE) ERROR Fetch receiver public key error:", error);
    return null;
  }
}

class NoiseNN {
  constructor(senderId, receiverId, token, email) {
    this.senderId = senderId;
    this.receiverId = receiverId;
    this.token = token;
    this.email = email;
    this.baseKeyPair = null;
    this.remoteBasePublicKey = null;
    this.baseSharedSecret = null;
    this.handshakeFinished = false;
  }

  async initialize() {
    try {
      const [privateKeyHex, publicKeyHex] = await Promise.all([
        AsyncStorage.getItem(`private_key_${this.email}`),
        AsyncStorage.getItem(`public_key_${this.email}`),
      ]);

      if (!privateKeyHex || !publicKeyHex || !this.isValidKeyPair(privateKeyHex, publicKeyHex)) {
        throw new Error("Keys not found or invalid.");
      }

      this.baseKeyPair = {
        privateKey: Buffer.from(privateKeyHex, 'hex'),
        publicKey: Buffer.from(publicKeyHex, 'hex'),
      };

      const receiverPublicKeyHex = await fetchReceiverPublicKey(this.receiverId, this.token);
      if (receiverPublicKeyHex && this.isValidPublicKey(receiverPublicKeyHex)) {
        await AsyncStorage.setItem(`receiver_public_key_${this.receiverId}`, receiverPublicKeyHex);
        this.remoteBasePublicKey = Buffer.from(receiverPublicKeyHex, 'hex');
        const rawSharedSecret = x25519.scalarMult(this.baseKeyPair.privateKey, this.remoteBasePublicKey);
        this.baseSharedSecret = Buffer.from(rawSharedSecret.slice(0, 32));
        this.handshakeFinished = true;
      }
    } catch (error) {
      console.error("(NOBRIDGE) ERROR NoiseNN initialization failed:", error);
      throw error;
    }
  }

  async generateKeyPair() {
    const privateKey = Buffer.from(x25519.utils.randomPrivateKey());
    const publicKey = Buffer.from(x25519.getPublicKey(privateKey));
    return { privateKey, publicKey };
  }

  isValidPublicKey(publicKeyHex) {
    try {
      const publicKey = Buffer.from(publicKeyHex, 'hex');
      return publicKey.length === 32;
    } catch (error) {
      return false;
    }
  }

  isValidKeyPair(privateKeyHex, publicKeyHex) {
    try {
      const privateKey = Buffer.from(privateKeyHex, 'hex');
      const publicKey = Buffer.from(publicKeyHex, 'hex');
      const computedPublicKey = Buffer.from(x25519.getPublicKey(privateKey));
      return privateKey.length === 32 && publicKey.length === 32 && computedPublicKey.equals(publicKey);
    } catch (error) {
      return false;
    }
  }

  async syncPublicKeyWithServer(publicKeyHex) {
    try {
      const response = await fetch(`${API_URL}/auth/user/update_public_key/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ public_key: publicKeyHex }),
      });
      if (!response.ok) {
        console.error("(NOBRIDGE) ERROR Failed to sync public key:", await response.json());
      }
    } catch (error) {
      console.error("(NOBRIDGE) ERROR Sync public key error:", error);
    }
  }

  async generateMessageKey(remoteEphemeralPublicKey = null) {
    if (!this.handshakeFinished) {
      throw new Error("Handshake not completed.");
    }

    const ephemeralKeyPair = remoteEphemeralPublicKey ? null : await this.generateKeyPair();
    const ephPubKey = remoteEphemeralPublicKey ? Buffer.from(remoteEphemeralPublicKey, 'hex') : ephemeralKeyPair.publicKey;

    const normalizedSharedSecret = Buffer.from(this.baseSharedSecret).slice(0, 32);
    const normalizedEphPubKey = Buffer.from(ephPubKey).slice(0, 32);

    const concatBytes = new Uint8Array(64);
    concatBytes.set(normalizedSharedSecret, 0);
    concatBytes.set(normalizedEphPubKey, 32);

    const messageKey = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      concatBytes
    );
    const key = Buffer.from(messageKey).slice(0, 32);

    return {
      publicKey: ephemeralKeyPair ? ephemeralKeyPair.publicKey : null,
      key,
    };
  }
}

const ImageMessage = memo(({ uri, style, nonce, messageKey, ephemeralKey, noise, onPress }) => {
  const [isMounted, setIsMounted] = useState(false);
  const [error, setError] = useState(null);
  const [decryptedUri, setDecryptedUri] = useState(null);

  useEffect(() => {
    const decryptImage = async () => {
      try {
        if (!uri) throw new Error("Missing file URI");
        if (!nonce || !ephemeralKey) {
          setError("Image is encrypted but missing decryption keys");
          setDecryptedUri(uri);
          setIsMounted(true);
          return;
        }
        const { key } = await noise.generateMessageKey(ephemeralKey);
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        const encryptedBytes = new Uint8Array(arrayBuffer);
        const iv = Buffer.from(nonce, 'hex');
        const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        const decryptedBytes = aesCbc.decrypt(encryptedBytes);
        const unpaddedBytes = aesjs.padding.pkcs7.strip(decryptedBytes);
        const tempUri = `${FileSystem.cacheDirectory}decrypted_image_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(tempUri, Buffer.from(unpaddedBytes).toString('base64'), {
          encoding: FileSystem.EncodingType.Base64,
        });
        setDecryptedUri(tempUri);
        setIsMounted(true);
      } catch (e) {
        setError(e.message || 'Failed to load image');
      }
    };

    decryptImage();

    return () => {
      setIsMounted(false);
      if (decryptedUri && decryptedUri !== uri) {
        FileSystem.deleteAsync(decryptedUri).catch(() => {});
      }
    };
  }, [uri, nonce, ephemeralKey]);

  if (!isMounted || !decryptedUri) return <Text style={styles.messageText}>Loading image...</Text>;
  if (error) return <Text style={styles.messageText}>{error}</Text>;

  return (
    <TouchableOpacity onPress={onPress}>
      <Image source={{ uri: decryptedUri }} style={style} resizeMode="contain" />
    </TouchableOpacity>
  );
});

const VideoMessage = memo(({ uri, style, nonce, messageKey, ephemeralKey, noise }) => {
  const [isMounted, setIsMounted] = useState(false);
  const [error, setError] = useState(null);
  const [decryptedUri, setDecryptedUri] = useState(null);

  useEffect(() => {
    const decryptVideo = async () => {
      try {
        if (!uri) throw new Error("Missing file URI");
        if (!nonce || !ephemeralKey) {
          setError("Video is encrypted but missing decryption keys");
          setDecryptedUri(uri);
          setIsMounted(true);
          return;
        }
        const { key } = await noise.generateMessageKey(ephemeralKey);
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        const encryptedBytes = new Uint8Array(arrayBuffer);
        const iv = Buffer.from(nonce, 'hex');
        const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        const decryptedBytes = aesCbc.decrypt(encryptedBytes);
        const unpaddedBytes = aesjs.padding.pkcs7.strip(decryptedBytes);
        const tempUri = `${FileSystem.cacheDirectory}decrypted_video_${Date.now()}.mp4`;
        await FileSystem.writeAsStringAsync(tempUri, Buffer.from(unpaddedBytes).toString('base64'), {
          encoding: FileSystem.EncodingType.Base64,
        });
        setDecryptedUri(tempUri);
        setIsMounted(true);
      } catch (e) {
        setError(e.message || 'Failed to load video');
      }
    };

    decryptVideo();

    return () => {
      setIsMounted(false);
      if (decryptedUri && decryptedUri !== uri) {
        FileSystem.deleteAsync(decryptedUri).catch(() => {});
      }
    };
  }, [uri, nonce, ephemeralKey]);

  if (!isMounted || !decryptedUri) return <Text style={styles.messageText}>Loading video...</Text>;
  if (error) return <Text style={styles.messageText}>{error}</Text>;

  return (
    <Video
      source={{ uri: decryptedUri }}
      style={style}
      useNativeControls
      resizeMode="contain"
      isMuted={true}
      onError={(e) => setError(e.error?.message || 'Failed to play video')}
    />
  );
});

export default function ChatScreen() {
  const route = useRoute();
  const { senderId, contactId, contactUsername } = route.params || {};
  const navigation = useNavigation();

  const [senderIdState, setSenderId] = useState(null);
  const [receiverId, setReceiverId] = useState(null);
  const [email, setEmail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const socketRef = useRef(null);
  const flatListRef = useRef(null);
  const [token, setToken] = useState(null);
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const noiseRef = useRef(null);
  const messageCache = useRef(new Set());
  const prevReceiverIdRef = useRef(null);
  const [friendProfile, setFriendProfile] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    checkAESSupport();
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const fetchFriendProfile = useCallback(async () => {
    if (!contactUsername) return;

    try {
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${API_URL}/profiles/friend/${contactUsername}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const profileData = response.data;
      const now = new Date();
      const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
      profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
      setFriendProfile(profileData);
    } catch (error) {
      console.error('Failed to fetch friend profile:', error);
      Alert.alert('Error', 'Failed to load friend profile');
    }
  }, [contactUsername]);

  useEffect(() => {
    fetchFriendProfile();
    const interval = setInterval(fetchFriendProfile, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [fetchFriendProfile]);

  const initializeParams = useCallback(async () => {
    try {
      let [token, userEmail, cachedSenderId] = await Promise.all([
        AsyncStorage.getItem('token'),
        AsyncStorage.getItem('user_email'),
        AsyncStorage.getItem('user_id'),
      ]);

      if (!token) {
        Alert.alert('Error', 'Authentication token missing. Please log in again.');
        navigation.navigate('index');
        return false;
      }

      if (!userEmail || !cachedSenderId) {
        const res = await axios.get(`${API_URL}/auth/profile/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        userEmail = res.data.email;
        cachedSenderId = res.data.id.toString();
        await AsyncStorage.setItem('user_email', userEmail);
        await AsyncStorage.setItem('user_id', cachedSenderId);
      }

      if (!token || !userEmail || !cachedSenderId) {
        console.error('Missing required AsyncStorage items:', { token, userEmail, cachedSenderId });
        Alert.alert('Error', 'Authentication data missing. Please log in again.');
        navigation.navigate('index');
        return false;
      }

      setToken(token);
      setEmail(userEmail);

      const sId = senderId ? parseInt(senderId, 10) : parseInt(cachedSenderId, 10);
      const rId = contactId ? parseInt(contactId, 10) : null;

      if (!sId || !rId) {
        console.error('Invalid senderId or receiverId:', { sId, rId });
        Alert.alert('Error', 'Invalid chat parameters. Returning to home screen.');
        navigation.navigate('index');
        return false;
      }

      setSenderId(sId);
      setReceiverId(rId);
      return true;
    } catch (error) {
      console.error('Initialize params error:', error);
      Alert.alert('Error', 'Failed to initialize chat. Please try again.');
      navigation.navigate('index');
      return false;
    }
  }, [senderId, contactId, contactUsername, navigation]);

  const resetState = useCallback(() => {
    setMessages([]);
    setInputText('');
    setPendingFile(null);
    setFullScreenImage(null);
    messageCache.current.clear();
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    noiseRef.current = null;
  }, []);

  useEffect(() => {
    if (receiverId && receiverId !== prevReceiverIdRef.current) {
      resetState();
      prevReceiverIdRef.current = receiverId;
    }
  }, [receiverId, resetState]);

  useFocusEffect(
    useCallback(() => {
      initializeParams();
    }, [initializeParams])
  );

  const connectWebSocket = useCallback(async () => {
    console.log('Attempting WebSocket connection with:', { token, senderIdState, receiverId, email, socketState: socketRef.current?.readyState });
    if (!token || !senderIdState || !receiverId || socketRef.current?.readyState === WebSocket.OPEN) {
      console.log('WebSocket connection skipped:', { token, senderIdState, receiverId, socketState: socketRef.current?.readyState });
      Alert.alert('Connection Warning', 'Unable to connect to chat. Please ensure you are logged in and try again.');
      return;
    }

    const wsUrl = `ws://${API_HOST}/ws/chat/${senderIdState}/${receiverId}/?token=${token}`;
    console.log('Connecting to WebSocket URL:', wsUrl);
    socketRef.current = new WebSocket(wsUrl);
    noiseRef.current = new NoiseNN(senderIdState, receiverId, token, email);

    try {
      await noiseRef.current.initialize();
    } catch (error) {
      console.error('NoiseNN initialization error:', error);
      Alert.alert('Error', 'Failed to initialize encryption. Returning to home screen.');
      navigation.navigate('index');
      return;
    }

    socketRef.current.onopen = async () => {
      console.log('WebSocket connected');
      socketRef.current.send(JSON.stringify({ request_history: true }));
    };

    socketRef.current.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        const messageId = `${data.timestamp || ''}${data.message || ''}${data.sender || ''}${data.receiver || ''}${data.file_url || ''}`;
        if (messageCache.current.has(messageId)) return;
        messageCache.current.add(messageId);

        if (data.messages) {
          const decryptedMessages = await Promise.all(data.messages.map(async msg => {
            if (msg.type === 'text' && msg.message && msg.nonce && msg.ephemeral_key) {
              try {
                const { key } = await noiseRef.current.generateMessageKey(msg.ephemeral_key);
                return { ...msg, message: await decryptMessage(msg.message, key, msg.nonce) };
              } catch (e) {
                return { ...msg, message: "[Decryption Failed: " + e.message + "]" };
              }
            }
            return msg;
          }));
          setMessages(normalizeMessages(decryptedMessages.filter(msg => msg.type !== 'handshake')));
          scrollToBottom();
        } else if (
          (data.sender === senderIdState && data.receiver === receiverId) ||
          (data.sender === receiverId && data.receiver === senderIdState)
        ) {
          let decryptedMessage = { ...data };
          if (data.type === 'text' && data.message && data.nonce && data.ephemeral_key) {
            try {
              const { key } = await noiseRef.current.generateMessageKey(data.ephemeral_key);
              decryptedMessage.message = await decryptMessage(data.message, key, data.nonce);
            } catch (e) {
              decryptedMessage.message = "[Decryption Failed: " + e.message + "]";
            }
          }
          if (decryptedMessage.type !== 'handshake') {
            setMessages(prev => [...prev, normalizeMessages([decryptedMessage])[0]]);
            scrollToBottom();
          }
        }
      } catch (error) {
        console.error("(NOBRIDGE) ERROR Parsing WebSocket message:", error);
      }
    };

    socketRef.current.onerror = (error) => {
      console.error("(NOBRIDGE) ERROR WebSocket Error:", error.message || error);
      Alert.alert('Connection Error', 'Failed to connect to chat server. Please check your network and try again.');
    };

    socketRef.current.onclose = () => {
      console.log('WebSocket closed');
      Alert.alert('Connection Closed', 'Chat connection closed. Please try reconnecting.');
    };
  }, [senderIdState, receiverId, token, email, navigation]);

  useEffect(() => {
    if (token && senderIdState && receiverId && email) {
      connectWebSocket();
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [token, senderIdState, receiverId, email, connectWebSocket]);

  const encryptMessage = useCallback(async (plaintext) => {
    const { publicKey, key } = await noiseRef.current.generateMessageKey();
    const iv = Buffer.from(await Crypto.getRandomBytesAsync(16));
    const textBytes = aesjs.utils.utf8.toBytes(plaintext);
    const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
    const encryptedBytes = aesCbc.encrypt(aesjs.padding.pkcs7.pad(textBytes));
    const ciphertext = aesjs.utils.hex.fromBytes(encryptedBytes);
    return {
      ciphertext,
      nonce: iv.toString('hex'),
      ephemeralKey: publicKey.toString('hex'),
      messageKey: key.toString('hex'),
    };
  }, []);

  const decryptMessage = useCallback(async (ciphertext, key, nonce) => {
    const iv = Buffer.from(nonce, 'hex');
    const encryptedBytes = aesjs.utils.hex.toBytes(ciphertext);
    const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
    const decryptedBytes = aesCbc.decrypt(encryptedBytes);
    return aesjs.utils.utf8.fromBytes(aesjs.padding.pkcs7.strip(decryptedBytes));
  }, []);

  const encryptFile = useCallback(async (arrayBuffer) => {
    const { publicKey, key } = await noiseRef.current.generateMessageKey();
    const iv = Buffer.from(await Crypto.getRandomBytesAsync(16));
    const fileBytes = new Uint8Array(arrayBuffer);
    const paddedBytes = aesjs.padding.pkcs7.pad(fileBytes);
    const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
    const encryptedBytes = aesCbc.encrypt(paddedBytes);
    return {
      encryptedData: Buffer.from(encryptedBytes),
      nonce: iv.toString('hex'),
      ephemeralKey: publicKey.toString('hex'),
      messageKey: key.toString('hex'),
    };
  }, []);

  const sendMessage = useCallback(async () => {
    if (!senderIdState || !receiverId || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !noiseRef.current?.handshakeFinished) {
      Alert.alert('Cannot Send Message', 'Chat connection is not established. Please try again later.');
      return;
    }

    if (inputText.trim()) {
      try {
        const { ciphertext, nonce, ephemeralKey, messageKey } = await encryptMessage(inputText);
        const messageData = {
          sender: senderIdState,
          receiver: receiverId,
          message: ciphertext,
          nonce,
          ephemeral_key: ephemeralKey,
          message_key: messageKey,
          type: 'text',
          timestamp: new Date().toISOString(),
        };
        socketRef.current.send(JSON.stringify(messageData));
        setInputText('');
        scrollToBottom();
      } catch (error) {
        console.error("(NOBRIDGE) ERROR Failed to send message:", error);
        Alert.alert('Send Failed', 'Failed to send message: ' + error.message);
      }
    }
  }, [senderIdState, receiverId, inputText, encryptMessage]);

  const sendFile = useCallback(async (fileData) => {
    if (!senderIdState || !receiverId || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !noiseRef.current?.handshakeFinished) {
      Alert.alert('Cannot Send File', 'Chat connection is not established. Please try again later.');
      return;
    }

    const { uri, fileName, mimeType, arrayBuffer } = fileData;
    try {
      const { encryptedData, nonce, ephemeralKey, messageKey } = await encryptFile(arrayBuffer);
      const metadata = {
        sender: senderIdState,
        receiver: receiverId,
        file_name: fileName || `file_${Date.now()}`,
        file_type: mimeType || 'application/octet-stream',
        nonce,
        ephemeral_key: ephemeralKey,
        message_key: messageKey,
        type: mimeType.startsWith('image/') ? 'photo' : mimeType.startsWith('video/') ? 'video' : 'file',
        timestamp: new Date().toISOString(),
      };
      socketRef.current.send(JSON.stringify(metadata));
      await new Promise(resolve => setTimeout(resolve, 100));
      socketRef.current.send(encryptedData);
      setPendingFile(null);
      scrollToBottom();
    } catch (error) {
      console.error("(NOBRIDGE) ERROR Failed to send encrypted file:", error);
      Alert.alert('File Send Failed', 'Failed to send file: ' + error.message);
    }
  }, [senderIdState, receiverId, encryptFile]);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (!result.canceled) {
        const file = result.assets[0];
        const { uri, name, mimeType } = file;
        const base64Data = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const binaryString = atob(base64Data);
        const arrayBuffer = new ArrayBuffer(binaryString.length);
        const uint8Array = new Uint8Array(arrayBuffer);
        for (let i = 0; i < binaryString.length; i++) uint8Array[i] = binaryString.charCodeAt(i);

        const fileData = { uri, fileName: name, mimeType, arrayBuffer };
        setPendingFile(fileData);
        await sendFile(fileData);
      }
    } catch (error) {
      console.error("(NOBRIDGE) ERROR pickFile Error:", error);
      Alert.alert('File Pick Failed', 'Failed to pick file: ' + error.message);
    }
  }, [sendFile]);

  const normalizeMessages = useCallback((messages) => {
    return messages.map(msg => {
      const fileUrl = msg.file_url && !msg.file_url.startsWith('http')
        ? `${API_URL}${msg.file_url}`
        : msg.file_url || msg.file;

      let type = msg.type || 'text';
      if (msg.file_type?.startsWith('image/')) type = 'photo';
      else if (msg.file_type?.startsWith('video/')) type = 'video';
      else if (msg.file_type) type = 'file';
      else if (msg.message || msg.content) type = 'text';

      return {
        ...msg,
        message: msg.content || msg.message || '',
        timestamp: msg.timestamp || msg.created_at || new Date().toISOString(),
        type,
        file_url: fileUrl,
        file_name: msg.file_name || (fileUrl ? fileUrl.split('/').pop() : null),
        file_type: msg.file_type || (fileUrl && fileUrl.includes('.mp4') ? 'video/mp4' : null),
      };
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const formatTimestamp = useCallback((timestamp) => {
    const date = new Date(timestamp.replace(/[\u00A0]/g, ' '));
    return isNaN(date.getTime()) ? 'Invalid time' : `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }, []);

  const openFile = useCallback(async (url, nonce, ephemeralKey) => {
    try {
      if (!nonce || !ephemeralKey) {
        if (await Linking.canOpenURL(url)) await Linking.openURL(url);
        return;
      }
      const { key } = await noiseRef.current.generateMessageKey(ephemeralKey);
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const encryptedBytes = new Uint8Array(arrayBuffer);
      const iv = Buffer.from(nonce, 'hex');
      const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
      const decryptedBytes = aesCbc.decrypt(encryptedBytes);
      const unpaddedBytes = aesjs.padding.pkcs7.strip(decryptedBytes);
      const tempUri = `${FileSystem.cacheDirectory}decrypted_file_${Date.now()}`;
      await FileSystem.writeAsStringAsync(tempUri, Buffer.from(unpaddedBytes).toString('base64'), {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Linking.canOpenURL(tempUri)) await Linking.openURL(tempUri);
    } catch (error) {
      console.error("(NOBRIDGE) ERROR Failed to open decrypted file:", error);
      Alert.alert('File Open Failed', 'Failed to open file: ' + error.message);
    }
  }, []);

  const handleContainerPress = (event) => {
    const { locationY } = event.nativeEvent;
    const inputAreaHeight = 100; // Approximate height of input container
    const screenHeight = Dimensions.get('window').height;
    
    // Only dismiss keyboard if the tap is outside the input area
    if (locationY < screenHeight - inputAreaHeight) {
      Keyboard.dismiss();
    }
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  return (
    <View style={styles.container}>
      <TouchableWithoutFeedback onPress={handleContainerPress}>
        <View style={{ flex: 1 }}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerProfileContainer}
              onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
            >
              <View style={styles.profileImageContainer}>
                <Image
                  source={{ uri: friendProfile?.profile_picture || DEFAULT_AVATAR_ICON }}
                  style={styles.headerProfileImage}
                  resizeMode="cover"
                  onError={() => console.log("Failed to load profile picture")}
                />
                {friendProfile?.is_online && (
                  <View style={styles.onlineStatusRing} />
                )}
              </View>
              <View style={styles.headerTitleContainer}>
                <Text style={styles.headerTitle}>
                  {friendProfile?.user?.first_name || contactUsername || 'Unknown User'}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Ionicons name="ellipsis-vertical" size={24} color="white" />
            </TouchableOpacity>
          </View>

          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={({ item }) => (
              <View style={[
                styles.messageContainer,
                item.sender === senderIdState ? styles.senderMessage : styles.receiverMessage
              ]}>
                {item.type === 'photo' && item.file_url ? (
                  <ImageMessage
                    uri={item.file_url}
                    style={styles.imageMessage}
                    nonce={item.nonce}
                    messageKey={item.message_key}
                    ephemeralKey={item.ephemeral_key}
                    noise={noiseRef.current}
                    onPress={() => setFullScreenImage(item.file_url)}
                  />
                ) : item.type === 'video' && item.file_url ? (
                  <VideoMessage
                    uri={item.file_url}
                    style={styles.videoMessage}
                    nonce={item.nonce}
                    messageKey={item.message_key}
                    ephemeralKey={item.ephemeral_key}
                    noise={noiseRef.current}
                  />
                ) : item.type === 'file' && item.file_url ? (
                  <TouchableOpacity onPress={() => openFile(item.file_url, item.nonce, item.ephemeral_key)}>
                    <Text style={styles.messageText}>File: {item.file_name}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.messageText}>{item.message}</Text>
                )}
                <Text style={styles.messageTime}>{formatTimestamp(item.timestamp)}</Text>
              </View>
            )}
            keyExtractor={(item, index) => `${item.timestamp}-${item.sender}-${index}`}
            contentContainerStyle={{ paddingBottom: 20 }}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={3}
            removeClippedSubviews={true}
            keyboardShouldPersistTaps="handled"
          />

          <View style={styles.inputContainer}>
            {pendingFile && (
              <View style={styles.pendingFileContainer}>
                {pendingFile.mimeType.startsWith('image/') ? (
                  <Image source={{ uri: pendingFile.uri }} style={styles.pendingImage} />
                ) : pendingFile.mimeType.startsWith('video/') ? (
                  <Video
                    source={{ uri: pendingFile.uri }}
                    style={styles.pendingImage}
                    useNativeControls
                    resizeMode="contain"
                    isMuted={true}
                  />
                ) : (
                  <Text style={styles.pendingFileText}>{pendingFile.fileName}</Text>
                )}
                <TouchableOpacity style={styles.removeFileButton} onPress={() => setPendingFile(null)}>
                  <Ionicons name="close" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.inputRow}>
              <TouchableOpacity style={styles.photoButton} onPress={pickFile}>
                <Ionicons name="attach" size={24} color="#fff" />
              </TouchableOpacity>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Type a message..."
                placeholderTextColor="#888"
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={sendMessage}
                onPressIn={focusInput}
                autoFocus={true}
                returnKeyType="send"
                multiline={true}
              />
              <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
                <Ionicons name="send" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </TouchableWithoutFeedback>

      <Modal
        visible={!!fullScreenImage}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setFullScreenImage(null)}
      >
        <View style={styles.fullScreenContainer}>
          <TouchableOpacity style={styles.closeButton} onPress={() => setFullScreenImage(null)}>
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          <ImageMessage
            uri={fullScreenImage}
            style={styles.fullScreenImage}
            nonce={messages.find(m => m.file_url === fullScreenImage)?.nonce}
            messageKey={messages.find(m => m.file_url === fullScreenImage)?.message_key}
            ephemeralKey={messages.find(m => m.file_url === fullScreenImage)?.ephemeral_key}
            noise={noiseRef.current}
            onPress={() => setFullScreenImage(null)}
          />
        </View>
      </Modal>
    </View>
  );
}