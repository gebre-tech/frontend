import React, { useState, useEffect, useRef, useCallback, memo, useContext } from 'react';
import 'react-native-get-random-values';
import {
  View, FlatList, TextInput, Text, TouchableOpacity, Platform,
  TouchableWithoutFeedback, Keyboard, Image, Dimensions, Alert, ActivityIndicator,
  SafeAreaView, KeyboardAvoidingView, Animated, Pressable
} from 'react-native';
import { Ionicons, FontAwesome, MaterialIcons } from '@expo/vector-icons';
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
import tw from 'twrnc';
import { Modalize } from 'react-native-modalize';
import * as SQLite from 'expo-sqlite';
import { API_HOST, API_URL, PLACEHOLDER_IMAGE_ICON, DEFAULT_AVATAR_ICON } from '../utils/constants';
import { AuthContext } from '../../context/AuthContext';

// Singleton for database initialization
const getDatabase = (() => {
  let dbInstance = null;
  return () => {
    if (!dbInstance) {
      try {
        dbInstance = SQLite.openDatabaseSync('chat.db');
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Failed to initialize database:', error);
        throw error;
      }
    }
    return dbInstance;
  };
})();

const checkAESSupport = () => {
  const aesExists = !!Crypto.CryptoEncryptionAlgorithm?.AES256CBC;
  return aesExists;
};

async function fetchReceiverPublicKey(receiverId, token, retries = 3, delay = 1000) {
  while (retries > 0) {
    try {
      const response = await fetch(`${API_URL}/auth/user/${receiverId}/public_key/`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (response.ok && data.public_key && /^[0-9a-f]{64}$/i.test(data.public_key)) {
        console.log(`(NOBRIDGE) Successfully fetched receiver public key for ID: ${receiverId}`);
        return data.public_key;
      }
      throw new Error(`Invalid public key response: ${JSON.stringify(data)}`);
    } catch (error) {
      retries -= 1;
      console.error(`(NOBRIDGE) ERROR Fetch receiver public key (attempts left: ${retries}):`, error);
      if (retries === 0) return null;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
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

  async initialize(retries = 3) {
    while (retries > 0) {
      try {
        const [privateKeyHex, publicKeyHex] = await Promise.all([
          AsyncStorage.getItem(`private_key_${this.email}`),
          AsyncStorage.getItem(`public_key_${this.email}`),
        ]);

        if (!privateKeyHex || !publicKeyHex || !this.isValidKeyPair(privateKeyHex, publicKeyHex)) {
          console.log('(NOBRIDGE) Generating new key pair due to invalid or missing keys');
          const newKeyPair = await this.generateKeyPair();
          await Promise.all([
            AsyncStorage.setItem(`private_key_${this.email}`, newKeyPair.privateKey.toString('hex')),
            AsyncStorage.setItem(`public_key_${this.email}`, newKeyPair.publicKey.toString('hex')),
          ]);
          await this.syncPublicKeyWithServer(newKeyPair.publicKey.toString('hex'));
          this.baseKeyPair = newKeyPair;
        } else {
          this.baseKeyPair = {
            privateKey: Buffer.from(privateKeyHex, 'hex'),
            publicKey: Buffer.from(publicKeyHex, 'hex'),
          };
        }

        const receiverPublicKeyHex = await fetchReceiverPublicKey(this.receiverId, this.token);
        if (!receiverPublicKeyHex || !this.isValidPublicKey(receiverPublicKeyHex)) {
          throw new Error('Failed to fetch valid receiver public key');
        }

        await AsyncStorage.setItem(`receiver_public_key_${this.receiverId}`, receiverPublicKeyHex);
        this.remoteBasePublicKey = Buffer.from(receiverPublicKeyHex, 'hex');
        const rawSharedSecret = x25519.scalarMult(this.baseKeyPair.privateKey, this.remoteBasePublicKey);
        this.baseSharedSecret = Buffer.from(rawSharedSecret.slice(0, 32));
        this.handshakeFinished = true;
        console.log(`(NOBRIDGE) NoiseNN handshake completed for sender: ${this.senderId}, receiver: ${this.receiverId}`);
        return;
      } catch (error) {
        retries -= 1;
        console.error(`(NOBRIDGE) ERROR NoiseNN initialization failed (attempts left: ${retries}):`, error);
        if (retries === 0) {
          throw new Error(`NoiseNN initialization failed after retries: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
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
      return publicKey.length === 32 && /^[0-9a-f]{64}$/i.test(publicKeyHex);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Invalid public key format:', error);
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
      console.error('(NOBRIDGE) ERROR Invalid key pair:', error);
      return false;
    }
  }

  async syncPublicKeyWithServer(publicKeyHex) {
    try {
      const response = await fetch(`${API_URL}/auth/user/update_public_key/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify({ public_key: publicKeyHex }),
      });
      if (!response.ok) {
        console.error('(NOBRIDGE) ERROR Failed to sync public key:', await response.json());
      } else {
        console.log('(NOBRIDGE) Successfully synced public key with server');
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Sync public key error:', error);
    }
  }

  async generateMessageKey(remoteEphemeralPublicKey = null, retries = 2) {
    while (retries > 0) {
      try {
        if (!this.handshakeFinished) {
          throw new Error('Handshake not completed');
        }

        const ephemeralKeyPair = remoteEphemeralPublicKey ? null : await this.generateKeyPair();
        const ephPubKey = remoteEphemeralPublicKey
          ? Buffer.from(remoteEphemeralPublicKey, 'hex')
          : ephemeralKeyPair.publicKey;

        if (!ephPubKey || ephPubKey.length !== 32) {
          throw new Error('Invalid ephemeral public key');
        }

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

        console.log(`(NOBRIDGE) Generated message key: ${key.toString('hex')}`);
        return {
          publicKey: ephemeralKeyPair ? ephemeralKeyPair.publicKey : null,
          key,
        };
      } catch (error) {
        retries -= 1;
        console.error(`(NOBRIDGE) ERROR Generating message key (attempts left: ${retries}):`, error);
        if (retries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    throw new Error('Failed to generate message key after retries');
  }
}

const FileMessage = memo(({ uri, fileType, fileName, fileSize, nonce, messageKey, ephemeralKey, noise, onFullScreen, onDownload, formatFileSize, isDownloaded, localUri, onOpen }) => {
  const [isMounted, setIsMounted] = useState(false);
  const [error, setError] = useState(null);
  const [decryptedUri, setDecryptedUri] = useState(localUri || null);
  const [isLoading, setIsLoading] = useState(true);
  const videoRef = useRef(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const screenWidth = Dimensions.get('window').width * 0.4;
  const screenHeight = Dimensions.get('window').height * 0.3;
  const fileNameWidth = Dimensions.get('window').width * 0.6;

  const wrapFileName = useCallback((name, maxWidth) => {
    const words = name.split(/([._-])/);
    const lines = [];
    let currentLine = '';

    words.forEach((word, index) => {
      const testLine = currentLine + (currentLine ? '' : '') + word;
      const testWidth = new TextEncoder().encode(testLine).length;

      if (testWidth > maxWidth) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }

      if (index === words.length - 1) {
        lines.push(currentLine);
      }
    });

    return lines.join('\n');
  }, []);

  const wrappedFileName = wrapFileName(fileName, fileNameWidth);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
  };

  useEffect(() => {
    let isActive = true;

    const decryptFile = async () => {
      try {
        if (!uri) throw new Error('Missing file URI');
        if (!isDownloaded) {
          if (isActive) {
            setDecryptedUri(null);
            setIsMounted(true);
            setIsLoading(false);
          }
          return;
        }

        if (localUri) {
          if (isActive) {
            setDecryptedUri(localUri);
            setIsMounted(true);
            setIsLoading(false);
          }
          return;
        }

        if (!noise?.handshakeFinished || !nonce || !ephemeralKey) {
          if (isActive) {
            setError('Cannot decrypt file: missing encryption data or handshake incomplete');
            setDecryptedUri(uri);
            setIsMounted(true);
            setIsLoading(false);
          }
          return;
        }

        const { key } = await noise.generateMessageKey(ephemeralKey);
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        const encryptedBytes = new Uint8Array(arrayBuffer);
        const iv = Buffer.from(nonce, 'hex');
        const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        const decryptedBytes = aesCbc.decrypt(encryptedBytes);
        const unpaddedBytes = aesjs.padding.pkcs7.strip(decryptedBytes);

        let tempUri;
        if (Platform.OS === 'web') {
          const blob = new Blob([unpaddedBytes], { type: fileType });
          tempUri = URL.createObjectURL(blob);
        } else {
          const extension = fileType.startsWith('image/') ? 'jpg' : fileType.startsWith('video/') ? 'mp4' : fileType.startsWith('audio/') ? 'mp3' : fileName.split('.').pop() || 'file';
          tempUri = `${FileSystem.cacheDirectory}decrypted_file_${Date.now()}.${extension}`;
          await FileSystem.writeAsStringAsync(tempUri, Buffer.from(unpaddedBytes).toString('base64'), {
            encoding: FileSystem.EncodingType.Base64,
          });
        }

        if (isActive) {
          setDecryptedUri(tempUri);
          setIsMounted(true);
          setIsLoading(false);
        }
      } catch (e) {
        if (isActive) {
          setError(e.message || 'Failed to load file');
          setDecryptedUri(uri);
          setIsMounted(true);
          setIsLoading(false);
        }
      }
    };

    decryptFile();

    return () => {
      isActive = false;
      if (decryptedUri && decryptedUri !== uri && !localUri) {
        if (Platform.OS === 'web') {
          URL.revokeObjectURL(decryptedUri);
        } else {
          FileSystem.deleteAsync(decryptedUri).catch(() => {});
        }
      }
    };
  }, [uri, nonce, ephemeralKey, fileType, fileName, noise, isDownloaded, localUri]);

  if (isLoading) {
    return (
      <View style={tw`flex-row items-center p-2 bg-white rounded-lg shadow-md`}>
        <ActivityIndicator size="large" color="#666" />
        <Text style={tw`text-gray-800 ml-2`}>Loading file...</Text>
      </View>
    );
  }

  if (!isMounted || (!decryptedUri && isDownloaded)) {
    return <Text style={tw`text-gray-800`}>Loading file...</Text>;
  }

  if (error) {
    return <Text style={tw`text-gray-800`}>{error}</Text>;
  }

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={isDownloaded ? (fileType.startsWith('image/') || fileType.startsWith('video/') ? onFullScreen : onOpen) : null}>
      <Animated.View style={[tw`bg-white rounded-lg shadow-md p-3`, { transform: [{ scale: scaleAnim }] }]}>
        {isDownloaded && decryptedUri ? (
          <>
            {fileType.startsWith('image/') && (
              <View>
                <Image source={{ uri: decryptedUri }} style={{ width: screenWidth, height: screenHeight, borderRadius: 8 }} resizeMode="contain" />
                <Text style={tw`text-gray-600 text-sm mt-2`}>{wrappedFileName}</Text>
                <Text style={tw`text-gray-500 text-xs`}>{formatFileSize(fileSize)}</Text>
              </View>
            )}
            {fileType.startsWith('video/') && (
              <View>
                <Video
                  ref={videoRef}
                  source={{ uri: decryptedUri }}
                  style={{ width: screenWidth, height: screenHeight, borderRadius: 8 }}
                  useNativeControls
                  resizeMode="contain"
                  isLooping
                />
                <Text style={tw`text-gray-600 text-sm mt-2`}>{wrappedFileName}</Text>
                <Text style={tw`text-gray-500 text-xs`}>{formatFileSize(fileSize)}</Text>
              </View>
            )}
            {fileType.startsWith('audio/') && (
              <View>
                <View style={tw`flex-row items-center bg-gray-100 p-2 rounded-lg`}>
                  <Ionicons name="play-circle" size={30} color="#6200EA" onPress={() => videoRef.current?.playAsync()} />
                  <Text style={tw`text-gray-800 ml-2 flex-1`}>{wrappedFileName}</Text>
                </View>
                <Text style={tw`text-gray-500 text-xs mt-1`}>{formatFileSize(fileSize)}</Text>
              </View>
            )}
            {!['image/', 'video/', 'audio/'].some(prefix => fileType.startsWith(prefix)) && (
              <View style={tw`flex-row items-center`}>
                <MaterialIcons name="insert-drive-file" size={24} color="#6200EA" style={tw`mr-2`} />
                <View style={tw`flex-1`}>
                  <Text style={tw`text-blue-500 font-semibold text-base`}>{wrappedFileName}</Text>
                  <Text style={tw`text-gray-500 text-xs mt-1`}>Size: {formatFileSize(fileSize)}</Text>
                </View>
              </View>
            )}
          </>
        ) : (
          <View style={tw`flex-row items-center`}>
            <MaterialIcons name="insert-drive-file" size={24} color="#6200EA" style={tw`mr-2`} />
            <View style={tw`flex-1`}>
              <Text style={tw`text-gray-800 font-semibold text-base`}>{wrappedFileName}</Text>
              <Text style={tw`text-gray-500 text-xs mt-1`}>Size: {formatFileSize(fileSize)}</Text>
            </View>
            <TouchableOpacity onPress={onDownload}>
              <Ionicons name="cloud-download" size={24} color="#6200EA" />
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}, (prevProps, nextProps) => {
  return prevProps.uri === nextProps.uri &&
         prevProps.fileType === nextProps.fileType &&
         prevProps.fileName === nextProps.fileName &&
         prevProps.fileSize === nextProps.fileSize &&
         prevProps.nonce === nextProps.nonce &&
         prevProps.ephemeralKey === nextProps.ephemeralKey &&
         prevProps.isDownloaded === nextProps.isDownloaded &&
         prevProps.localUri === nextProps.localUri;
});

export default function ChatScreen() {
  const route = useRoute();
  const { senderId, contactId, contactUsername } = route.params || {};
  const navigation = useNavigation();
  const { accessToken, refreshToken: refreshAuthToken, user, error: authError } = useContext(AuthContext);

  const [senderIdState, setSenderId] = useState(null);
  const [receiverId, setReceiverId] = useState(null);
  const [email, setEmail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const flatListRef = useRef(null);
  const modalizeRef = useRef(null);
  const [fullScreenMedia, setFullScreenMedia] = useState(null);
  const [downloading, setDownloading] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});
  const [downloadedFiles, setDownloadedFiles] = useState(new Map());
  const noiseRef = useRef(null);
  const messageCache = useRef(new Map());
  const prevReceiverIdRef = useRef(null);
  const [friendProfile, setFriendProfile] = useState(null);
  const inputRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const storageKey = `downloaded_files_${senderId}_${contactId}`;
  const db = getDatabase();
  const pendingMessagesRef = useRef([]);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;

  const initializeMessageIdCounter = useCallback(async () => {
    try {
      const storedCounter = await AsyncStorage.getItem('message_id_counter');
      if (!storedCounter) {
        await AsyncStorage.setItem('message_id_counter', '360');
        return 360;
      }
      return parseInt(storedCounter, 10);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error initializing message ID counter:', error);
      return 360;
    }
  }, []);

  const getNextMessageId = useCallback(async () => {
    try {
      let counter = await initializeMessageIdCounter();
      let nextId = counter;

      let existing = db.getAllSync('SELECT message_id FROM message_keys WHERE message_id = ?', [nextId.toString()]);
      while (existing.length > 0) {
        counter += 1;
        nextId = counter;
        existing = db.getAllSync('SELECT message_id FROM message_keys WHERE message_id = ?', [nextId.toString()]);
      }

      await AsyncStorage.setItem('message_id_counter', (counter + 1).toString());
      return nextId.toString();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error generating next message ID:', error);
      throw error;
    }
  }, [initializeMessageIdCounter, db]);

  useEffect(() => {
    try {
      db.execSync('CREATE TABLE IF NOT EXISTS message_keys (message_id TEXT PRIMARY KEY, message_key TEXT);');
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error creating table:', error);
    }
  }, [db]);

  const storeMessageKey = useCallback((messageId, messageKey) => {
    try {
      if (!messageId || !messageKey || !/^[0-9a-f]{64}$/i.test(messageKey)) {
        throw new Error('Invalid messageId or messageKey');
      }
      db.runSync('INSERT OR REPLACE INTO message_keys (message_id, message_key) VALUES (?, ?)', [messageId, messageKey]);
      console.log(`(NOBRIDGE) Stored message key for ID: ${messageId}, Key: ${messageKey}`);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error storing message key:', error);
    }
  }, [db]);

  useEffect(() => {
    checkAESSupport();
    navigation.setOptions({ headerShown: false });

    const loadDownloadedFiles = async () => {
      try {
        const storedFiles = await AsyncStorage.getItem(storageKey);
        if (storedFiles) {
          setDownloadedFiles(new Map(JSON.parse(storedFiles)));
        }
      } catch (error) {
        console.error('Error loading downloaded files:', error);
      }
    };
    loadDownloadedFiles();
  }, [navigation, storageKey]);

  useEffect(() => {
    const saveDownloadedFiles = async () => {
      try {
        await AsyncStorage.setItem(storageKey, JSON.stringify([...downloadedFiles]));
      } catch (error) {
        console.error('Error saving downloaded files:', error);
      }
    };
    saveDownloadedFiles();
  }, [downloadedFiles, storageKey]);

  const fetchFriendProfile = useCallback(async () => {
    if (!contactUsername || !accessToken) return;

    try {
      const response = await axios.get(`${API_URL}/profiles/friend/${contactUsername}/`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profileData = response.data;
      const now = new Date();
      const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
      profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
      setFriendProfile(profileData);
    } catch (error) {
      console.error('Failed to fetch friend profile:', error.response?.status || error.message);
      if (error.response?.status === 404) {
        setFriendProfile({ user: { first_name: contactUsername }, is_online: false });
      }
    }
  }, [contactUsername, accessToken]);

  useEffect(() => {
    fetchFriendProfile();
    const interval = setInterval(fetchFriendProfile, 30000);
    return () => clearInterval(interval);
  }, [fetchFriendProfile]);

  const initializeParams = useCallback(async () => {
    try {
      if (!accessToken || !user) {
        Alert.alert('Error', 'Not authenticated. Please log in again.');
        navigation.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
        return false;
      }

      const userEmail = user.email;
      const cachedSenderId = user.id.toString();

      setEmail(userEmail);
      const sId = senderId ? parseInt(senderId, 10) : parseInt(cachedSenderId, 10);
      const rId = contactId ? parseInt(contactId, 10) : null;

      if (!sId || !rId) {
        Alert.alert('Error', 'Invalid chat parameters.');
        navigation.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
        return false;
      }

      setSenderId(sId);
      setReceiverId(rId);
      return true;
    } catch (error) {
      console.error('Initialize params error:', error);
      Alert.alert('Error', 'Failed to initialize chat.');
      navigation.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
      return false;
    }
  }, [senderId, contactId, navigation, accessToken, user]);

  const resetState = useCallback(() => {
    setMessages([]);
    setInputText('');
    setPendingFile(null);
    setFullScreenMedia(null);
    setDownloading({});
    setDownloadProgress({});
    messageCache.current.clear();
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    noiseRef.current = null;
    reconnectAttemptsRef.current = 0;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
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

  const normalizeMessage = useCallback((msg) => {
    const fileUrl = msg.file_url && !msg.file_url.startsWith('http')
      ? `${API_URL}${msg.file_url}`
      : msg.file_url || msg.file;

    let type = msg.type || 'text';
    if (msg.file_type?.startsWith('image/')) type = 'photo';
    else if (msg.file_type?.startsWith('video/')) type = 'video';
    else if (msg.file_type?.startsWith('audio/')) type = 'audio';
    else if (msg.file_type) type = 'file';

    const fileSize = msg.file_size || (msg.arrayBuffer ? msg.arrayBuffer.byteLength : null);

    return {
      ...msg,
      message: msg.content || msg.message || '',
      timestamp: msg.timestamp || msg.created_at || new Date().toISOString(),
      type,
      file_url: fileUrl,
      file_name: msg.file_name || (fileUrl ? fileUrl.split('/').pop() : null),
      file_type: msg.file_type || (fileUrl && fileUrl.includes('.mp4') ? 'video/mp4' : 'application/octet-stream'),
      file_size: fileSize,
      nonce: msg.nonce,
      ephemeral_key: msg.ephemeral_key,
      id: msg.message_id || `${msg.timestamp}-${msg.sender}`,
    };
  }, []);

  const validateFileMessage = useCallback((msg) => {
    if (['photo', 'video', 'audio', 'file'].includes(msg.type) && (!msg.file_url || !msg.file_type)) {
      return { ...msg, message: 'Failed to load file (missing data)' };
    }
    return msg;
  }, []);

  const decryptMessage = useCallback(async (ciphertext, key, nonce) => {
    try {
      if (!ciphertext || !/^[0-9a-f]+$/i.test(ciphertext)) {
        throw new Error('Invalid ciphertext format');
      }
      if (!nonce || !/^[0-9a-f]{32}$/i.test(nonce)) {
        throw new Error('Invalid nonce format');
      }
      if (!key || key.length !== 32) {
        throw new Error('Invalid key length');
      }

      console.log(`(NOBRIDGE) Decrypting message with ciphertext: ${ciphertext}, nonce: ${nonce}, key: ${key.toString('hex')}`);
      const iv = Buffer.from(nonce, 'hex');
      const encryptedBytes = aesjs.utils.hex.toBytes(ciphertext);
      const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
      const decryptedBytes = aesCbc.decrypt(encryptedBytes);
      const plaintext = aesjs.utils.utf8.fromBytes(aesjs.padding.pkcs7.strip(decryptedBytes));
      console.log(`(NOBRIDGE) Decryption successful for ciphertext: ${ciphertext}`);
      return plaintext;
    } catch (e) {
      console.error(`(NOBRIDGE) Decryption failed for ciphertext: ${ciphertext}`, e);
      return `[Decryption Failed: ${e.message}]`;
    }
  }, []);

  const processMessage = useCallback(async (msg, isHistory = false) => {
    console.log(`(NOBRIDGE) Processing message ID: ${msg.message_id || 'undefined'}`);
    const messageId = `${msg.timestamp || ''}${msg.content || msg.message || ''}${msg.sender || ''}${msg.receiver || ''}${msg.file_url || ''}${msg.message_id || ''}`;

    if (messageCache.current.has(messageId)) {
      console.log(`(NOBRIDGE) Message ID: ${msg.message_id || 'undefined'} already in cache`);
      return { normalizedMsg: messageCache.current.get(messageId), keyUsedFromSQLite: false };
    }

    let processedMsg = { ...msg };
    let keyUsedFromSQLite = false;

    if (msg.type === 'text' && msg.content && msg.nonce && msg.message_id && msg.ephemeral_key) {
      console.log(`(NOBRIDGE) Processing text message ID: ${msg.message_id}`);
      const result = db.getFirstSync('SELECT message_id, message_key FROM message_keys WHERE message_id = ?', [msg.message_id]);
      let key;

      if (result && result.message_key && /^[0-9a-f]{64}$/i.test(result.message_key)) {
        console.log(`(NOBRIDGE) Using SQLite key for ID: ${msg.message_id}`);
        key = Buffer.from(result.message_key, 'hex');
        keyUsedFromSQLite = true;
      } else {
        console.log(`(NOBRIDGE) Generating key for ID: ${msg.message_id}`);
        try {
          const keyData = await noiseRef.current.generateMessageKey(msg.ephemeral_key);
          key = keyData.key;
          storeMessageKey(msg.message_id, key.toString('hex')); // Store key for received messages
          console.log(`(NOBRIDGE) Stored generated key for ID: ${msg.message_id}`);
        } catch (error) {
          console.error(`(NOBRIDGE) Failed to generate key for Message ID: ${msg.message_id}`, error);
          processedMsg.content = `[Key Generation Failed: ${error.message}]`;
        }
      }

      if (key) {
        processedMsg.content = await decryptMessage(msg.content, key, msg.nonce);
      }
    } else {
      console.log(`(NOBRIDGE) Skipping message ID: ${msg.message_id || 'undefined'}, Type: ${msg.type}, Content: ${!!msg.content}, Nonce: ${!!msg.nonce}, Ephemeral Key: ${!!msg.ephemeral_key}`);
      if (['photo', 'video', 'audio', 'file'].includes(msg.type)) {
        processedMsg = validateFileMessage(processedMsg);
      }
    }

    const normalizedMsg = normalizeMessage(processedMsg);
    if (!isHistory) {
      messageCache.current.set(messageId, normalizedMsg);
    }

    return { normalizedMsg, keyUsedFromSQLite };
  }, [decryptMessage, normalizeMessage, validateFileMessage, db, storeMessageKey]);

  const connectWebSocket = useCallback(async () => {
    if (!accessToken || !senderIdState || !receiverId) {
      console.log('(NOBRIDGE) Missing required parameters for WebSocket connection');
      return;
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log('(NOBRIDGE) WebSocket already open');
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const protocol = Platform.OS === 'web' || API_HOST.includes('https') ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${API_HOST}/ws/chat/${senderIdState}/${receiverId}/?token=${accessToken}`;
    console.log('(NOBRIDGE) Connecting to WebSocket:', wsUrl);

    try {
      socketRef.current = new WebSocket(wsUrl);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to create WebSocket:', error);
      scheduleReconnect();
      return;
    }

    noiseRef.current = new NoiseNN(senderIdState, receiverId, accessToken, email);

    try {
      await noiseRef.current.initialize();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR NoiseNN initialization error:', error);
      Alert.alert('Error', 'Failed to initialize encryption. Please try again.');
      socketRef.current.close();
      fetchChatHistoryViaHttp();
      return;
    }

    let pingInterval = null;
    const sendPing = () => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'ping' }));
        console.log('(NOBRIDGE) Sent ping');
      }
    };

    socketRef.current.onopen = () => {
      console.log('(NOBRIDGE) WebSocket opened for contact', receiverId);
      reconnectAttemptsRef.current = 0;
      socketRef.current.send(JSON.stringify({ request_history: true }));
      pingInterval = setInterval(sendPing, 30000);
    };

    socketRef.current.onmessage = async (event) => {
      try {
        let messageData;
        if (typeof event === 'string') {
          messageData = event;
        } else if (event && typeof event === 'object' && 'data' in event) {
          messageData = event.data;
        } else {
          console.error('(NOBRIDGE) ERROR Unexpected WebSocket event structure:', JSON.stringify(event));
          return;
        }

        const data = JSON.parse(messageData);
        console.log('(NOBRIDGE) Received WebSocket data:', JSON.stringify(data));

        if (data.type === 'pong') {
          console.log('(NOBRIDGE) Received pong');
          return;
        }

        const messageId = `${data.timestamp || ''}${data.message || ''}${data.sender || ''}${data.receiver || ''}${data.file_url || ''}${data.message_id || ''}`;

        if (data.messages) {
          let sqliteKeyCount = 0;
          const decryptedMessages = await Promise.all(
            data.messages.map(async (msg) => {
              const { normalizedMsg, keyUsedFromSQLite } = await processMessage(msg, true);
              if (keyUsedFromSQLite) sqliteKeyCount += 1;
              return normalizedMsg;
            })
          );
          console.log(`(NOBRIDGE) Processed ${data.messages.length} history messages, ${sqliteKeyCount} used SQLite-stored encryption keys`);
          setMessages(decryptedMessages.filter(msg => msg.type !== 'handshake'));
          scrollToBottom();
        } else if (
          (data.sender === senderIdState && data.receiver === receiverId) ||
          (data.sender === receiverId && data.receiver === senderIdState)
        ) {
          if (messageCache.current.has(messageId)) {
            console.log(`(NOBRIDGE) Live message ID: ${data.message_id || 'undefined'} already in cache, skipping`);
            return;
          }

          const { normalizedMsg, keyUsedFromSQLite } = await processMessage(data);
          if (normalizedMsg.type !== 'handshake') {
            pendingMessagesRef.current.push({ ...normalizedMsg, __keyUsedFromSQLite: keyUsedFromSQLite });
            setTimeout(() => {
              if (pendingMessagesRef.current.length > 0) {
                const sqliteKeyCount = pendingMessagesRef.current.reduce((count, msg) => count + (msg.__keyUsedFromSQLite ? 1 : 0), 0);
                console.log(`(NOBRIDGE) Processed ${pendingMessagesRef.current.length} live messages, ${sqliteKeyCount} used SQLite-stored encryption keys`);
                setMessages(prev => [...prev, ...pendingMessagesRef.current.map(msg => {
                  const { __keyUsedFromSQLite, ...cleanMsg } = msg;
                  return cleanMsg;
                })]);
                pendingMessagesRef.current = [];
                scrollToBottom();
              }
            }, 100);
          }
        }
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Parsing WebSocket message:', error.message, 'Event:', JSON.stringify(event));
      }
    };

    socketRef.current.onerror = (error) => {
      console.error('(NOBRIDGE) ERROR WebSocket error for contact', receiverId, ':', error.message || error);
      scheduleReconnect();
    };

    socketRef.current.onclose = (event) => {
      console.log('(NOBRIDGE) LOG WebSocket closed for contact', receiverId, ': Code', event.code, 'Reason', event.reason || 'No reason provided');
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      scheduleReconnect();
    };

    const scheduleReconnect = () => {
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
        console.log(`(NOBRIDGE) Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1})`);
        reconnectTimeoutRef.current = setTimeout(async () => {
          reconnectAttemptsRef.current += 1;
          if (reconnectAttemptsRef.current > 2) {
            try {
              const newToken = await refreshAuthToken();
              if (!newToken) {
                Alert.alert('Error', 'Session expired. Please log in again.');
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Login' }],
                });
                return;
              }
            } catch (error) {
              console.error('(NOBRIDGE) ERROR Failed to refresh token:', error);
              Alert.alert('Error', 'Failed to refresh session. Please log in again.');
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
              return;
            }
          }
          connectWebSocket();
        }, delay);
      } else {
        console.log('(NOBRIDGE) Max reconnection attempts reached for contact', receiverId);
        Alert.alert('Connection Error', 'Unable to connect to chat server. Falling back to HTTP for history.');
        fetchChatHistoryViaHttp();
      }
    };
  }, [accessToken, senderIdState, receiverId, email, navigation, processMessage, refreshAuthToken]);

  const fetchChatHistoryViaHttp = useCallback(async () => {
    if (!accessToken) return;

    try {
      const response = await axios.get(`${API_URL}/chat/messages/?sender=${senderIdState}&receiver=${receiverId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const messages = response.data;
      console.log('(NOBRIDGE) Fetched chat history via HTTP:', messages.length, 'messages');
      let sqliteKeyCount = 0;
      const decryptedMessages = await Promise.all(
        messages.map(async (msg) => {
          const { normalizedMsg, keyUsedFromSQLite } = await processMessage(msg, true);
          if (keyUsedFromSQLite) sqliteKeyCount += 1;
          return normalizedMsg;
        })
      );
      console.log(`(NOBRIDGE) Processed ${messages.length} HTTP history messages, ${sqliteKeyCount} used SQLite-stored encryption keys`);
      setMessages(decryptedMessages.filter(msg => msg.type !== 'handshake'));
      scrollToBottom();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to fetch chat history via HTTP:', error);
      if (error.response?.status === 401) {
        const newToken = await refreshAuthToken();
        if (newToken) {
          fetchChatHistoryViaHttp();
        } else {
          Alert.alert('Error', 'Session expired. Please log in again.');
          navigation.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          });
        }
      } else {
        Alert.alert('Error', 'Failed to load chat history.');
      }
    }
  }, [senderIdState, receiverId, accessToken, processMessage, refreshAuthToken, navigation]);

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
    if (!senderIdState || !receiverId || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !noiseRef.current?.handshakeFinished || !inputText.trim()) {
      Alert.alert('Cannot Send Message', 'Chat connection is not established or message is empty.');
      return;
    }

    try {
      const { ciphertext, nonce, ephemeralKey, messageKey } = await encryptMessage(inputText);
      const messageId = await getNextMessageId();
      storeMessageKey(messageId, messageKey);
      const messageData = {
        sender: senderIdState,
        receiver: receiverId,
        message: ciphertext,
        nonce,
        ephemeral_key: ephemeralKey,
        message_key: messageKey,
        type: 'text',
        timestamp: new Date().toISOString(),
        message_id: messageId,
      };
      socketRef.current.send(JSON.stringify(messageData));
      setInputText('');
      scrollToBottom();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to send message:', error);
      Alert.alert('Send Failed', 'Failed to send message: ' + error.message);
    }
  }, [senderIdState, receiverId, inputText, encryptMessage, getNextMessageId, storeMessageKey]);

  const sendFile = useCallback(async (fileData) => {
    if (!senderIdState || !receiverId || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !noiseRef.current?.handshakeFinished) {
      Alert.alert('Cannot Send File', 'Chat connection is not established.');
      return;
    }

    const { uri, fileName, mimeType, arrayBuffer, fileSize } = fileData;
    try {
      const { encryptedData, nonce, ephemeralKey, messageKey } = await encryptFile(arrayBuffer);
      const messageId = await getNextMessageId();
      storeMessageKey(messageId, messageKey);
      const metadata = {
        sender: senderIdState,
        receiver: receiverId,
        file_name: fileName || `file_${Date.now()}`,
        file_type: mimeType || 'application/octet-stream',
        file_size: fileSize || arrayBuffer.byteLength,
        file_url: uri,
        nonce,
        ephemeral_key: ephemeralKey,
        message_key: messageKey,
        type: mimeType.startsWith('image/') ? 'photo' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'file',
        timestamp: new Date().toISOString(),
        message_id: messageId,
      };
      socketRef.current.send(JSON.stringify(metadata));
      await new Promise(resolve => setTimeout(resolve, 100));
      socketRef.current.send(encryptedData);
      setPendingFile(null);
      scrollToBottom();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to send encrypted file:', error);
      Alert.alert('File Send Failed', 'Failed to send file: ' + error.message);
    }
  }, [senderIdState, receiverId, encryptFile, getNextMessageId, storeMessageKey]);

  const pickFile = useCallback(async () => {
    try {
      const isWeb = Platform.OS === 'web';
      let fileData;

      if (isWeb) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '*/*';
        input.onchange = async (event) => {
          const file = event.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            const mimeType = file.type || 'application/octet-stream';
            fileData = {
              uri: URL.createObjectURL(file),
              fileName: file.name,
              mimeType,
              arrayBuffer,
              fileSize: file.size || arrayBuffer.byteLength,
            };
            setPendingFile(fileData);
          };
          reader.readAsArrayBuffer(file);
        };
        input.click();
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
        if (!result.canceled) {
          const file = result.assets[0];
          const { uri, name, mimeType, size } = file;
          const base64Data = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          const binaryString = atob(base64Data);
          const arrayBuffer = new ArrayBuffer(binaryString.length);
          const uint8Array = new Uint8Array(arrayBuffer);
          for (let i = 0; i < binaryString.length; i++) uint8Array[i] = binaryString.charCodeAt(i);

          fileData = {
            uri,
            fileName: name,
            mimeType,
            arrayBuffer,
            fileSize: size || arrayBuffer.byteLength
          };
          setPendingFile(fileData);
        }
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR pickFile Error:', error);
      Alert.alert('File Pick Failed', 'Failed to pick file: ' + error.message);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const formatTimestamp = useCallback((timestamp) => {
    const date = new Date(timestamp.replace(/[\u00A0]/g, ' '));
    return isNaN(date.getTime()) ? 'Invalid time' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  const formatFileSize = useCallback((bytes) => {
    if (!bytes && bytes !== 0) return 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = parseFloat(bytes);
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }, []);

  const openFile = useCallback(async (uri) => {
    try {
      if (await Linking.canOpenURL(uri)) {
        await Linking.openURL(uri);
      } else {
        Alert.alert('File Open Failed', 'Unable to open the file.');
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to open file:', error);
      Alert.alert('File Open Failed', 'Failed to open file: ' + error.message);
    }
  }, []);

  const downloadFile = useCallback(async (uri, fileName, nonce, ephemeralKey, fileType, messageId) => {
    setDownloading(prev => ({ ...prev, [messageId]: true }));
    setDownloadProgress(prev => ({ ...prev, [messageId]: 0 }));

    try {
      let downloadUri = uri;
      let decryptedBytes;

      if (nonce && ephemeralKey && noiseRef.current?.handshakeFinished) {
        const { key } = await noiseRef.current.generateMessageKey(ephemeralKey);
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let loaded = 0;

        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          loaded += value.length;

          if (total > 0) {
            const progress = Math.round((loaded / total) * 100);
            setDownloadProgress(prev => ({ ...prev, [messageId]: progress }));
          }
        }

        const encryptedBytes = new Uint8Array(
          chunks.reduce((acc, chunk) => acc + chunk.length, 0)
        );
        let offset = 0;
        for (const chunk of chunks) {
          encryptedBytes.set(chunk, offset);
          offset += chunk.length;
        }

        const iv = Buffer.from(nonce, 'hex');
        const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        decryptedBytes = aesCbc.decrypt(encryptedBytes);
        decryptedBytes = aesjs.padding.pkcs7.strip(decryptedBytes);
      } else {
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let loaded = 0;

        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          loaded += value.length;

          if (total > 0) {
            const progress = Math.round((loaded / total) * 100);
            setDownloadProgress(prev => ({ ...prev, [messageId]: progress }));
          }
        }

        decryptedBytes = new Uint8Array(
          chunks.reduce((acc, chunk) => acc + chunk.length, 0)
        );
        let offset = 0;
        for (const chunk of chunks) {
          decryptedBytes.set(chunk, offset);
          offset += chunk.length;
        }
      }

      if (Platform.OS === 'web') {
        const blob = new Blob([decryptedBytes], { type: fileType });
        downloadUri = URL.createObjectURL(blob);
      } else {
        const extension = fileType.startsWith('image/') ? 'jpg' : fileType.startsWith('video/') ? 'mp4' : fileType.startsWith('audio/') ? 'mp3' : fileName.split('.').pop() || 'file';
        downloadUri = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}downloaded_${Date.now()}.${extension}`;
        await FileSystem.writeAsStringAsync(downloadUri, Buffer.from(decryptedBytes).toString('base64'), {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      setDownloadedFiles((prev) => {
        const newMap = new Map(prev);
        newMap.set(uri, downloadUri);
        return newMap;
      });

      if (Platform.OS === 'web') {
        const blob = await (await fetch(downloadUri)).blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        Alert.alert('File Downloaded', `File saved to ${downloadUri}`);
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to download file:', error);
      Alert.alert('Download Failed', 'Failed to download file: ' + error.message);
    } finally {
      setDownloading(prev => {
        const newState = { ...prev };
        delete newState[messageId];
        return newState;
      });
      setDownloadProgress(prev => {
        const newState = { ...prev };
        delete newState[messageId];
        return newState;
      });
    }
  }, []);

  const handleContainerPress = useCallback((event) => {
    const { locationY } = event.nativeEvent;
    const inputAreaHeight = 100;
    const screenHeight = Dimensions.get('window').height;

    if (locationY < screenHeight - inputAreaHeight) {
      Keyboard.dismiss();
    }
  }, []);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const getFileIcon = useCallback((fileType) => {
    if (fileType?.startsWith('image/')) return 'image';
    if (fileType?.startsWith('video/')) return 'video';
    if (fileType?.startsWith('audio/')) return 'mic';
    if (fileType?.includes('pdf')) return 'picture-as-pdf';
    if (fileType?.includes('document') || fileType?.includes('msword') || fileType?.includes('text')) return 'description';
    return 'insert-drive-file';
  }, []);

  const openFilePreview = useCallback((file) => {
    setFullScreenMedia({ uri: file.url, type: file.type === 'photo' ? 'photo' : 'video' });
    modalizeRef.current?.open();
  }, []);

  const closeFilePreview = useCallback(() => {
    setFullScreenMedia(null);
    modalizeRef.current?.close();
  }, []);

  const wrapText = useCallback((text, maxWidth) => {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach((word, index) => {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const testWidth = new TextEncoder().encode(testLine).length;

      if (testWidth > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }

      if (index === words.length - 1) {
        lines.push(currentLine);
      }
    });

    return lines.join('\n');
  }, []);

  const renderMessage = useCallback(({ item, index }) => {
    const isCurrentUser = item.sender === senderIdState;
    const messageId = item.id;
    const isDownloaded = downloadedFiles.has(item.file_url);
    const localUri = downloadedFiles.get(item.file_url);
    const screenWidth = Dimensions.get('window').width * 0.75;
    const wrappedMessage = item.type === 'text' ? wrapText(item.message, screenWidth) : item.message;

    return (
      <Animated.View style={[tw`flex-row mb-2 ${isCurrentUser ? 'justify-end' : 'justify-start'} px-4`, { opacity: fadeAnim }]}>
        <View style={tw`max-w-[75%] flex-row ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
          {!isCurrentUser && (
            <TouchableOpacity
              onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
            >
              <Image
                source={{ uri: friendProfile?.profile_picture || DEFAULT_AVATAR_ICON }}
                style={tw`w-8 h-8 rounded-full mr-2`}
              />
            </TouchableOpacity>
          )}
          <View
            style={tw`p-3 rounded-2xl shadow-md ${
              isCurrentUser ? 'bg-blue-500' : 'bg-white'
            }`}
          >
            {!isCurrentUser && (
              <Text style={tw`text-xs font-semibold text-gray-600 mb-1`}>
                {friendProfile?.user?.first_name || contactUsername || 'Unknown User'}
              </Text>
            )}
            {item.type === 'text' && (
              <Text style={tw`${isCurrentUser ? 'text-white text-base font-medium' : 'text-gray-800 text-base font-medium'}`}>
                {wrappedMessage}
              </Text>
            )}
            {(item.type === 'photo' || item.type === 'video' || item.type === 'audio' || item.type === 'file') && (
              <View style={tw`mt-2`}>
                <FileMessage
                  uri={item.file_url}
                  fileType={item.file_type}
                  fileName={item.file_name}
                  fileSize={item.file_size}
                  nonce={item.nonce}
                  messageKey={item.message_key}
                  ephemeralKey={item.ephemeral_key}
                  noise={noiseRef.current}
                  formatFileSize={formatFileSize}
                  isDownloaded={isCurrentUser || isDownloaded}
                  localUri={localUri}
                  onFullScreen={() => {
                    if (item.file_type?.startsWith('image/') || item.file_type?.startsWith('video/')) {
                      openFilePreview({
                        url: localUri || item.file_url,
                        type: item.type,
                      });
                    }
                  }}
                  onDownload={() => downloadFile(item.file_url, item.file_name, item.nonce, item.ephemeral_key, item.file_type, messageId)}
                  onOpen={() => openFile(localUri)}
                />
                {!isCurrentUser && !isDownloaded && downloading[messageId] && (
                  <View style={tw`mt-2`}>
                    <View style={tw`bg-gray-200 rounded-full h-2 w-full`}>
                      <View
                        style={[tw`bg-blue-500 h-2 rounded-full`, { width: `${downloadProgress[messageId] || 0}%` }]}
                      />
                    </View>
                    <Text style={tw`text-gray-500 text-xs mt-1 text-center`}>
                      Downloading... {downloadProgress[messageId] || 0}%
                    </Text>
                  </View>
                )}
              </View>
            )}
            <Text style={tw`text-xs ${isCurrentUser ? 'text-white/70' : 'text-gray-500'} mt-1 text-right`}>
              {formatTimestamp(item.timestamp)}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  }, [senderIdState, friendProfile, contactUsername, downloadedFiles, downloading, downloadProgress, navigation, fadeAnim, wrapText, formatTimestamp, openFilePreview, downloadFile, openFile]);

  const getItemLayout = useCallback((data, index) => {
    const length = 100;
    const offset = length * index;
    return { length, offset, index };
  }, []);

  const renderPendingFile = useCallback(() => {
    if (!pendingFile) return null;

    const screenWidth = Dimensions.get('window').width * 0.6;
    const wrapFileName = (name, maxWidth) => {
      const words = name.split(/([._-])/);
      const lines = [];
      let currentLine = '';

      words.forEach((word, index) => {
        const testLine = currentLine + (currentLine ? '' : '') + word;
        const testWidth = new TextEncoder().encode(testLine).length;

        if (testWidth > maxWidth) {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }

        if (index === words.length - 1) {
          lines.push(currentLine);
        }
      });

      return lines.join('\n');
    };

    const wrappedFileName = wrapFileName(pendingFile.fileName, screenWidth);

    return (
      <View style={tw`flex-row items-center bg-white rounded-lg p-2 mx-4 mb-2 shadow-md`}>
        {pendingFile.mimeType?.startsWith('image/') ? (
          <Image source={{ uri: pendingFile.uri }} style={tw`w-12 h-12 rounded-md mr-2`} resizeMode="contain" />
        ) : pendingFile.mimeType?.startsWith('video/') ? (
          <Video source={{ uri: pendingFile.uri }} style={tw`w-12 h-12 rounded-md mr-2`} resizeMode="contain" />
        ) : pendingFile.mimeType?.startsWith('audio/') ? (
          <Ionicons name="mic" size={24} color="#6200EA" style={tw`mr-2`} />
        ) : (
          <MaterialIcons name={getFileIcon(pendingFile.mimeType)} size={24} color="#6200EA" style={tw`mr-2`} />
        )}
        <View style={tw`flex-1`}>
          <Text style={tw`text-gray-800 text-base font-medium`}>{wrappedFileName}</Text>
          <Text style={tw`text-gray-600 text-xs`}>Size: {formatFileSize(pendingFile.fileSize)}</Text>
        </View>
        <TouchableOpacity onPress={() => setPendingFile(null)} style={tw`mr-2`}>
          <Ionicons name="close" size={20} color="#6200EA" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => sendFile(pendingFile)} style={tw`bg-blue-500 rounded-full p-2`}>
          <Ionicons name="send" size={20} color="white" />
        </TouchableOpacity>
      </View>
    );
  }, [pendingFile, formatFileSize, getFileIcon, sendFile]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    if (accessToken && senderIdState && receiverId && email) {
      connectWebSocket();
      fetchChatHistoryViaHttp();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [accessToken, senderIdState, receiverId, email, connectWebSocket, fetchChatHistoryViaHttp]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  return (
    <SafeAreaView style={tw`flex-1 bg-gray-100`}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={tw`flex-1`}
      >
        <TouchableWithoutFeedback onPress={handleContainerPress}>
          <View style={tw`flex-1`}>
            <View style={tw`bg-[#1a73e8] p-2 flex-row items-center justify-between h-16 shadow-md`}>
              <View style={tw`flex-row items-center flex-1`}>
                <TouchableOpacity
                  style={tw`mr-3`}
                  onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
                >
                  <Image
                    source={{ uri: friendProfile?.profile_picture || DEFAULT_AVATAR_ICON }}
                    style={tw`w-10 h-10 rounded-full border-2 border-white`}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={tw`flex-1`}
                  onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
                >
                  <Text style={tw`text-lg font-bold text-white`}>
                    {friendProfile?.user?.first_name || contactUsername || 'Unknown User'}
                  </Text>
                  <Text style={tw`text-xs text-white/70`}>
                    {friendProfile?.is_online ? 'Online' : 'Offline'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => navigation.goBack()}>
                <Ionicons name="arrow-back" size={24} color="white" />
              </TouchableOpacity>
            </View>

            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              contentContainerStyle={tw`pb-20`}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              removeClippedSubviews={true}
              getItemLayout={getItemLayout}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={tw`flex-1 justify-center items-center`}>
                  <Text style={tw`text-gray-500 text-lg`}>Start the conversation!</Text>
                </View>
              }
              onContentSizeChange={scrollToBottom}
              onLayout={scrollToBottom}
            />

            {renderPendingFile()}

            <View style={tw`flex-row items-center p-3 bg-white border-t border-gray-200 shadow-md`}>
              <TouchableOpacity onPress={pickFile} style={tw`mr-3`}>
                <Ionicons name="attach" size={24} color="#6200EA" />
              </TouchableOpacity>
              <TextInput
                ref={inputRef}
                style={tw`flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-gray-800 shadow-sm`}
                placeholder="Type a message..."
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={sendMessage}
                onPressIn={focusInput}
                autoFocus={true}
                returnKeyType="send"
                multiline={true}
              />
              <TouchableOpacity onPress={sendMessage} style={tw`ml-3`} disabled={!inputText.trim()}>
                <Ionicons name="send" size={24} color="#6200EA" />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>

        <Modalize
          ref={modalizeRef}
          adjustToContentHeight={false}
          snapPoint={Dimensions.get('window').height * 0.4}
          modalHeight={Dimensions.get('window').height}
          handlePosition="outside"
          onClose={closeFilePreview}
        >
          <View style={tw`flex-1 bg-black justify-center items-center p-4`}>
            <TouchableOpacity
              style={tw`absolute top-4 right-4 z-10 bg-black/50 rounded-full p-2`}
              onPress={closeFilePreview}
            >
              <Ionicons name="close" size={30} color="white" />
            </TouchableOpacity>
            {fullScreenMedia?.type === 'photo' && (
              <Image
                source={{ uri: fullScreenMedia.uri }}
                style={tw`w-full h-full`}
                resizeMode="contain"
              />
            )}
            {fullScreenMedia?.type === 'video' && (
              <Video
                source={{ uri: fullScreenMedia.uri }}
                style={tw`w-full h-full`}
                useNativeControls
                resizeMode="contain"
                isLooping
              />
            )}
          </View>
        </Modalize>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}