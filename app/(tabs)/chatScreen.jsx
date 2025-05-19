
import React, { useState, useEffect, useRef, useCallback, memo, useContext } from 'react';
import 'react-native-get-random-values';
import {
  View, FlatList, TextInput, Text, TouchableOpacity, Platform,
  TouchableWithoutFeedback, Keyboard, Dimensions, Alert, SafeAreaView,
  KeyboardAvoidingView, Animated, ActivityIndicator
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
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
import { Image } from 'expo-image';
import { Audio, Video } from 'expo-av';
import * as Progress from 'react-native-progress';
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

// Modern MediaMessage Component
const MediaMessage = memo(({ item, isCurrentUser, isDownloaded, localUri, onFullScreen, onDownload, onOpen, formatFileSize, downloading, downloadProgress, messageId, noise }) => {
  const [decryptedUri, setDecryptedUri] = useState(localUri || null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playbackObj, setPlaybackObj] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const screenWidth = Dimensions.get('window').width * 0.6;
  const screenHeight = Dimensions.get('window').height * 0.3;

  const wrapFileName = useCallback((name) => {
    const maxWidth = screenWidth;
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
  }, [screenWidth]);

  const wrappedFileName = wrapFileName(item.file_name);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
  };

  const handleAudioPlayPause = useCallback(async () => {
    if (!playbackObj || !decryptedUri) return;

    try {
      if (isPlaying) {
        await playbackObj.pauseAsync();
        setIsPlaying(false);
      } else {
        await playbackObj.playAsync();
        setIsPlaying(true);
      }
    } catch (e) {
      console.error('(NOBRIDGE) ERROR Audio play/pause error:', e);
      setError('Failed to play audio');
    }
  }, [playbackObj, isPlaying, decryptedUri]);

  useEffect(() => {
    let isActive = true;

    const decryptFile = async () => {
      try {
        if (!item.file_url) throw new Error('Missing file URI');
        if (!isDownloaded) {
          if (isActive) {
            setDecryptedUri(null);
            setIsLoading(false);
          }
          return;
        }

        if (localUri) {
          if (isActive) {
            setDecryptedUri(localUri);
            setIsLoading(false);
          }
          return;
        }

        if (!noise?.handshakeFinished || !item.nonce || !item.ephemeral_key) {
          if (isActive) {
            setError('Cannot decrypt file: missing encryption data or handshake incomplete');
            setDecryptedUri(item.file_url);
            setIsLoading(false);
          }
          return;
        }

        const { key } = await noise.generateMessageKey(item.ephemeral_key);
        const tempFile = `${FileSystem.cacheDirectory}encrypted_${Date.now()}`;
        const downloadRes = await FileSystem.downloadAsync(item.file_url, tempFile);
        if (!downloadRes.status === 200) throw new Error(`Failed to fetch file: ${downloadRes.status}`);

        const encryptedData = await FileSystem.readAsStringAsync(tempFile, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const encryptedBytes = Buffer.from(encryptedData, 'base64');
        const iv = Buffer.from(item.nonce, 'hex');
        const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        const decryptedBytes = aesCbc.decrypt(encryptedBytes);
        const unpaddedBytes = aesjs.padding.pkcs7.strip(decryptedBytes);

        let tempUri;
        if (Platform.OS === 'web') {
          const blob = new Blob([unpaddedBytes], { type: item.file_type });
          tempUri = URL.createObjectURL(blob);
        } else {
          const extension = item.file_type.startsWith('image/') ? 'jpg' :
                           item.file_type.startsWith('video/') ? 'mp4' :
                           item.file_type.startsWith('audio/') ? 'mp3' : item.file_name.split('.').pop() || 'file';
          tempUri = `${FileSystem.cacheDirectory}decrypted_file_${Date.now()}.${extension}`;
          await FileSystem.writeAsStringAsync(tempUri, Buffer.from(unpaddedBytes).toString('base64'), {
            encoding: FileSystem.EncodingType.Base64,
          });
        }

        if (isActive) {
          setDecryptedUri(tempUri);
          setIsLoading(false);
        }
      } catch (e) {
        if (isActive) {
          setError(e.message || 'Failed to load file');
          setDecryptedUri(item.file_url);
          setIsLoading(false);
        }
      }
    };

    decryptFile();

    return () => {
      isActive = false;
      if (decryptedUri && decryptedUri !== item.file_url && !localUri) {
        if (Platform.OS === 'web') {
          URL.revokeObjectURL(decryptedUri);
        } else {
          FileSystem.deleteAsync(decryptedUri).catch(() => {});
        }
      }
    };
  }, [item.file_url, item.nonce, item.ephemeral_key, item.file_type, item.file_name, isDownloaded, localUri, noise]);

  useEffect(() => {
    if (item.file_type.startsWith('audio/') && decryptedUri && isDownloaded) {
      const loadAudio = async () => {
        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri: decryptedUri },
            { shouldPlay: false }
          );
          setPlaybackObj(sound);
          sound.setOnPlaybackStatusUpdate(status => {
            if (status.didJustFinish) {
              setIsPlaying(false);
            }
          });
        } catch (e) {
          console.error('(NOBRIDGE) ERROR Loading audio:', e);
          setError('Failed to load audio');
        }
      };
      loadAudio();
    }

    return () => {
      if (playbackObj) {
        playbackObj.unloadAsync().catch(() => {});
      }
    };
  }, [decryptedUri, isDownloaded, item.file_type]);

  if (isLoading) {
    return (
      <View style={tw`flex-row items-center p-2 bg-white rounded-lg shadow-md`}>
        <ActivityIndicator size="small" color="#6200EA" />
        <Text style={tw`text-gray-600 ml-2`}>Loading...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={tw`p-2 bg-red-100 rounded-lg`}>
        <Text style={tw`text-red-600`}>{error}</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={isDownloaded && decryptedUri ? (item.file_type.startsWith('image/') || item.file_type.startsWith('video/') ? onFullScreen : onOpen) : onDownload}
      disabled={downloading[messageId]}
      accessibilityLabel={`File: ${item.file_name}`}
      accessibilityRole="button"
    >
      <Animated.View style={[tw`bg-white rounded-lg shadow-md p-3`, { transform: [{ scale: scaleAnim }] }]}>
        <View style={tw`flex-row items-center justify-between`}>
          <View style={tw`flex-1`}>
            <Text style={tw`text-gray-800 font-semibold`}>{wrappedFileName}</Text>
            <Text style={tw`text-gray-500 text-xs mt-1`}>{formatFileSize(item.file_size)}</Text>
          </View>
          {!isDownloaded && (
            <TouchableOpacity
              onPress={onDownload}
              disabled={downloading[messageId]}
              accessibilityLabel={`Download ${item.file_name}`}
            >
              <Ionicons name="cloud-download" size={24} color={downloading[messageId] ? '#ccc' : '#6200EA'} />
            </TouchableOpacity>
          )}
        </View>
        {isDownloaded && decryptedUri && (
          <>
            {item.file_type.startsWith('image/') && (
              <Image
                source={{ uri: decryptedUri }}
                style={tw`w-[${screenWidth}px] h-[${screenHeight}px] rounded-lg mt-2`}
                contentFit="contain"
                cachePolicy="memory-disk"
                accessibilityLabel={`Image: ${item.file_name}`}
                onError={() => setError('Failed to load image')}
              />
            )}
            {item.file_type.startsWith('video/') && (
              <Video
                source={{ uri: decryptedUri }}
                style={tw`w-[${screenWidth}px] h-[${screenHeight}px] rounded-lg mt-2`}
                useNativeControls
                resizeMode="contain"
                isLooping={false}
                accessibilityLabel={`Video: ${item.file_name}`}
              />
            )}
            {item.file_type.startsWith('audio/') && (
              <View style={tw`flex-row items-center bg-gray-100 p-2 rounded-lg mt-2`}>
                <TouchableOpacity onPress={handleAudioPlayPause} accessibilityLabel={isPlaying ? 'Pause audio' : 'Play audio'}>
                  <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={28} color="#6200EA" />
                </TouchableOpacity>
                <Text style={tw`text-gray-800 ml-2`}>{wrappedFileName}</Text>
              </View>
            )}
            {!['image/', 'video/', 'audio/'].some(prefix => item.file_type.startsWith(prefix)) && (
              <View style={tw`flex-row items-center mt-2`}>
                <MaterialIcons name="insert-drive-file" size={24} color="#6200EA" style={tw`mr-2`} />
                <Text style={tw`text-blue-500 font-semibold`}>{wrappedFileName}</Text>
              </View>
            )}
          </>
        )}
        {!isCurrentUser && downloading[messageId] && (
          <View style={tw`mt-2`}>
            <Progress.Bar
              progress={(downloadProgress[messageId] || 0) / 100}
              width={screenWidth - 20}
              color="#6200EA"
              unfilledColor="#e0e0e0"
              borderWidth={0}
              height={4}
            />
            <Text style={tw`text-gray-500 text-xs mt-1 text-center`}>
              Downloading... {downloadProgress[messageId] || 0}%
            </Text>
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}, (prevProps, nextProps) => {
  return prevProps.item.file_url === nextProps.item.file_url &&
         prevProps.item.file_type === nextProps.item.file_type &&
         prevProps.item.file_name === nextProps.item.file_name &&
         prevProps.item.file_size === nextProps.item.file_size &&
         prevProps.item.nonce === nextProps.item.nonce &&
         prevProps.item.ephemeral_key === nextProps.item.ephemeral_key &&
         prevProps.isDownloaded === nextProps.isDownloaded &&
         prevProps.localUri === nextProps.localUri &&
         prevProps.downloading[prevProps.messageId] === nextProps.downloading[nextProps.messageId] &&
         prevProps.downloadProgress[prevProps.messageId] === nextProps.downloadProgress[nextProps.messageId];
});

export default function ChatScreen() {
  const route = useRoute();
  const { senderId, contactId, contactUsername } = route.params || {};
  const navigation = useNavigation();
  const { accessToken, refreshToken: refreshAuthToken, user } = useContext(AuthContext);

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
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;

  // Initialize SQLite table for message keys
  useEffect(() => {
    try {
      db.execSync('CREATE TABLE IF NOT EXISTS message_keys (message_id TEXT PRIMARY KEY, message_key TEXT);');
      db.execSync('CREATE INDEX IF NOT EXISTS idx_message_id ON message_keys (message_id);');
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error creating table or index:', error);
    }
  }, [db]);

  // Store message key in SQLite
  const storeMessageKey = useCallback((messageId, messageKey) => {
    try {
      if (!messageId || !messageKey || !/^[0-9a-f]{64}$/i.test(messageKey)) {
        throw new Error('Invalid messageId or messageKey');
      }
      db.runSync('INSERT OR REPLACE INTO message_keys (message_id, message_key) VALUES (?, ?)', [messageId, messageKey]);
      console.log(`(NOBRIDGE) Stored message key for ID: ${messageId}`);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error storing message key:', error);
    }
  }, [db]);

  // Retrieve message key from SQLite
  const retrieveMessageKey = useCallback((messageId) => {
    try {
      const result = db.getFirstSync('SELECT message_key FROM message_keys WHERE message_id = ?', [messageId]);
      if (result && result.message_key && /^[0-9a-f]{64}$/i.test(result.message_key)) {
        console.log(`(NOBRIDGE) Retrieved message key for ID: ${messageId}`);
        return Buffer.from(result.message_key, 'hex');
      }
      return null;
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error retrieving message key:', error);
      return null;
    }
  }, [db]);

  // Generate UUID for message_id
  const getNextMessageId = useCallback(async () => {
    try {
      const uuid = await Crypto.randomUUID();
      console.log(`(NOBRIDGE) Generated UUID for message_id: ${uuid}`);
      return uuid;
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Generating UUID:', error);
      throw error;
    }
  }, []);

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
        console.error('(NOBRIDGE) ERROR Loading downloaded files:', error);
      }
    };
    loadDownloadedFiles();
  }, [navigation, storageKey]);

  useEffect(() => {
    const saveDownloadedFiles = async () => {
      try {
        await AsyncStorage.setItem(storageKey, JSON.stringify([...downloadedFiles]));
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Saving downloaded files:', error);
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
      console.error('(NOBRIDGE) ERROR Failed to fetch friend profile:', error.response?.status || error.message);
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
      console.error('(NOBRIDGE) ERROR Initialize params error:', error);
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
      content: msg.message || msg.content || '',
      message: msg.message || msg.content || '',
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
    console.log(`(NOBRIDGE) Processing message ID: ${msg.message_id || 'undefined'}, isHistory: ${isHistory}`);
    const messageId = `${msg.timestamp || ''}${msg.content || msg.message || ''}${msg.sender || ''}${msg.receiver || ''}${msg.file_url || ''}${msg.message_id || ''}`;

    if (messageCache.current.has(messageId) && !isHistory) {
      console.log(`(NOBRIDGE) Message ID: ${msg.message_id || 'undefined'} already in cache`);
      return { normalizedMsg: messageCache.current.get(messageId), keyUsedFromSQLite: false };
    }

    let processedMsg = { ...msg };
    let keyUsedFromSQLite = false;

    if (msg.type === 'text' && (msg.content || msg.message) && msg.nonce && msg.ephemeral_key) {
      console.log(`(NOBRIDGE) Processing text message ID: ${msg.message_id || 'undefined'}`);

      let key;
      if (msg.message_id) {
        key = retrieveMessageKey(msg.message_id);
        if (key) {
          console.log(`(NOBRIDGE) Using SQLite key for ID: ${msg.message_id}`);
          keyUsedFromSQLite = true;
        }
      }

      if (!key) {
        if (msg.message_key && /^[0-9a-f]{64}$/i.test(msg.message_key)) {
          console.log(`(NOBRIDGE) Using provided message key for ID: ${msg.message_id || 'undefined'}`);
          key = Buffer.from(msg.message_key, 'hex');
          if (msg.message_id) {
            storeMessageKey(msg.message_id, msg.message_key);
          }
          keyUsedFromSQLite = false;
        } else {
          console.log(`(NOBRIDGE) Generating key for ID: ${msg.message_id || 'undefined'}`);
          try {
            const keyData = await noiseRef.current.generateMessageKey(msg.ephemeral_key);
            key = keyData.key;
            if (msg.message_id) {
              storeMessageKey(msg.message_id, key.toString('hex'));
            }
            console.log(`(NOBRIDGE) Stored generated key for ID: ${msg.message_id || 'undefined'}`);
          } catch (error) {
            console.error(`(NOBRIDGE) ERROR Failed to generate key for Message ID: ${msg.message_id || 'undefined'}`, error);
            processedMsg.content = `[Key Generation Failed: ${error.message}]`;
          }
        }
      }

      if (key) {
        const ciphertext = msg.content || msg.message;
        processedMsg.content = await decryptMessage(ciphertext, key, msg.nonce);
        processedMsg.message = processedMsg.content;
      } else {
        processedMsg.content = `[Missing Key: Unable to decrypt]`;
        processedMsg.message = processedMsg.content;
      }
    } else {
      console.log(`(NOBRIDGE) Skipping message ID: ${msg.message_id || 'undefined'}, Type: ${msg.type}, Content: ${!!(msg.content || msg.message)}, Nonce: ${!!msg.nonce}, Ephemeral Key: ${!!msg.ephemeral_key}`);
      if (['photo', 'video', 'audio', 'file'].includes(msg.type)) {
        processedMsg = validateFileMessage(processedMsg);
      }
    }

    const normalizedMsg = normalizeMessage(processedMsg);
    if (!isHistory) {
      messageCache.current.set(messageId, normalizedMsg);
    }

    return { normalizedMsg, keyUsedFromSQLite };
  }, [decryptMessage, normalizeMessage, validateFileMessage, retrieveMessageKey, storeMessageKey]);

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

        if (data.error) {
          console.error('(NOBRIDGE) ERROR WebSocket error:', data.error);
          if (data.error.includes('message_id must be unique')) {
            console.log('(NOBRIDGE) Duplicate message_id detected, UUID should prevent this');
          }
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
            setMessages(prev => {
              if (prev.some(msg => msg.id === normalizedMsg.id)) {
                console.log(`(NOBRIDGE) Message ID: ${normalizedMsg.id} already in state, skipping`);
                return prev;
              }
              console.log(`(NOBRIDGE) Processed 1 live message, ${keyUsedFromSQLite ? 1 : 0} used SQLite-stored encryption keys`);
              return [...prev, normalizedMsg];
            });
            scrollToBottom();
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

      const { normalizedMsg } = await processMessage(messageData);
      setMessages(prev => [...prev, normalizedMsg]);
      setInputText('');
      scrollToBottom();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to send message:', error);
      Alert.alert('Send Failed', 'Failed to send message: ' + error.message);
    }
  }, [senderIdState, receiverId, inputText, encryptMessage, getNextMessageId, storeMessageKey, processMessage]);

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
    const date61 = new Date(timestamp.replace(/[\u00A0]/g, ' '));
    return isNaN(date61.getTime()) ? 'Invalid time' : date61.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      let downloadUri;
      let decryptedBytes;

      if (nonce && ephemeralKey && noiseRef.current?.handshakeFinished) {
        const { key } = await noiseRef.current.generateMessageKey(ephemeralKey);
        const tempFile = `${FileSystem.cacheDirectory}encrypted_${Date.now()}`;
        const downloadRes = await FileSystem.downloadAsync(uri, tempFile, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (downloadRes.status !== 200) {
          throw new Error(`Failed to fetch file: ${downloadRes.status}`);
        }

        // Simulate progress (since downloadAsync doesn't provide progress events)
        setDownloadProgress(prev => ({ ...prev, [messageId]: 50 }));

        const encryptedData = await FileSystem.readAsStringAsync(tempFile, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const encryptedBytes = Buffer.from(encryptedData, 'base64');
        const iv = Buffer.from(nonce, 'hex');
        const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        decryptedBytes = aesCbc.decrypt(encryptedBytes);
        decryptedBytes = aesjs.padding.pkcs7.strip(decryptedBytes);

        await FileSystem.deleteAsync(tempFile).catch(() => {});
      } else {
        const tempFile = `${FileSystem.cacheDirectory}raw_${Date.now()}`;
        const downloadRes = await FileSystem.downloadAsync(uri, tempFile, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (downloadRes.status !== 200) {
          throw new Error(`Failed to fetch file: ${downloadRes.status}`);
        }

        setDownloadProgress(prev => ({ ...prev, [messageId]: 50 }));

        const rawData = await FileSystem.readAsStringAsync(tempFile, {
          encoding: FileSystem.EncodingType.Base64,
        });
        decryptedBytes = Buffer.from(rawData, 'base64');

        await FileSystem.deleteAsync(tempFile).catch(() => {});
      }

      if (Platform.OS === 'web') {
        const blob = new Blob([decryptedBytes], { type: fileType });
        downloadUri = URL.createObjectURL(blob);
      } else {
        const extension = fileType.startsWith('image/') ? 'jpg' :
                         fileType.startsWith('video/') ? 'mp4' :
                         fileType.startsWith('audio/') ? 'mp3' : fileName.split('.').pop() || 'file';
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

      setDownloadProgress(prev => ({ ...prev, [messageId]: 100 }));

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
  }, [accessToken]);

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
    const isDownloaded = downloadedFiles.has(item.file_url) || isCurrentUser;
    const localUri = downloadedFiles.get(item.file_url);
    const screenWidth = Dimensions.get('window').width * 0.75;
    const wrappedMessage = item.type === 'text' ? wrapText(item.message, screenWidth) : item.message;

    return (
      <Animated.View style={[tw`flex-row mb-2 ${isCurrentUser ? 'justify-end' : 'justify-start'} px-4`, { opacity: fadeAnim }]}>
        <View style={tw`max-w-[75%] flex-row ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
          {!isCurrentUser && (
            <TouchableOpacity
              onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
              accessibilityLabel={`View ${contactUsername}'s profile`}
            >
              <Image
                source={{ uri: friendProfile?.profile_picture || DEFAULT_AVATAR_ICON }}
                style={tw`w-8 h-8 rounded-full mr-2 border border-gray-200`}
                contentFit="cover"
                cachePolicy="memory-disk"
                accessibilityLabel={`${contactUsername}'s avatar`}
              />
            </TouchableOpacity>
          )}
          <View
            style={tw`p-3 rounded-2xl shadow-md ${
              isCurrentUser ? 'bg-blue-500' : 'bg-white border border-gray-100'
            }`}
          >
            {!isCurrentUser && (
              <Text style={tw`text-xs font-semibold text-gray-600 mb-1`}>
                {friendProfile?.user?.first_name || contactUsername || 'Unknown User'}
              </Text>
            )}
            {item.type === 'text' && (
              <Text style={tw`${isCurrentUser ? 'text-white text-base font-medium' : 'text-gray-800 text-base font-medium'}`} accessibilityLabel="Message text">
                {wrappedMessage}
              </Text>
            )}
            {(item.type === 'photo' || item.type === 'video' || item.type === 'audio' || item.type === 'file') && (
              <View style={tw`mt-2`}>
                <MediaMessage
                  item={item}
                  isCurrentUser={isCurrentUser}
                  isDownloaded={isDownloaded}
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
                  formatFileSize={formatFileSize}
                  downloading={downloading}
                  downloadProgress={downloadProgress}
                  messageId={messageId}
                  noise={noiseRef.current}
                />
              </View>
            )}
            <Text style={tw`text-xs ${isCurrentUser ? 'text-white/70' : 'text-gray-500'} mt-1 text-right`} accessibilityLabel="Message timestamp">
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
    const wrapFileName = (name) => {
      const words = name.split(/([._-])/);
      const lines = [];
      let currentLine = '';

      words.forEach((word, index) => {
        const testLine = currentLine + (currentLine ? '' : '') + word;
        const testWidth = new TextEncoder().encode(testLine).length;

        if (testWidth > screenWidth) {
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

    const wrappedFileName = wrapFileName(pendingFile.fileName);

    return (
      <View style={tw`flex-row items-center bg-white rounded-lg p-3 mx-4 mb-2 shadow-md border border-gray-100`}>
        {pendingFile.mimeType?.startsWith('image/') ? (
          <Image
            source={{ uri: pendingFile.uri }}
            style={tw`w-12 h-12 rounded-md mr-3`}
            contentFit="cover"
            cachePolicy="memory-disk"
            accessibilityLabel={`Preview of ${pendingFile.fileName}`}
          />
        ) : pendingFile.mimeType?.startsWith('video/') ? (
          <View style={tw`w-12 h-12 rounded-md mr-3 bg-gray-200 flex items-center justify-center`}>
            <Ionicons name="play" size={24} color="#6200EA" />
            <Text style={tw`absolute text-white text-xs`}>Video</Text>
          </View>
        ) : pendingFile.mimeType?.startsWith('audio/') ? (
          <View style={tw`w-12 h-12 rounded-md mr-3 bg-gray-200 flex items-center justify-center`}>
            <Ionicons name="mic" size={24} color="#6200EA" />
          </View>
        ) : (
          <MaterialIcons name={getFileIcon(pendingFile.mimeType)} size={24} color="#6200EA" style={tw`mr-3`} />
        )}
        <View style={tw`flex-1`}>
          <Text style={tw`text-gray-800 font-semibold`} accessibilityLabel={`File name: ${pendingFile.fileName}`}>
            {wrappedFileName}
          </Text>
          <Text style={tw`text-gray-500 text-xs mt-1`}>Size: {formatFileSize(pendingFile.fileSize)}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setPendingFile(null)}
          style={tw`p-2`}
          accessibilityLabel="Cancel file upload"
        >
          <Ionicons name="close" size={20} color="#6200EA" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => sendFile(pendingFile)}
          style={tw`bg-blue-500 rounded-full p-2`}
          accessibilityLabel="Send file"
        >
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
            <View style={tw`bg-blue-500 p-4 flex-row items-center justify-between shadow-md`}>
              <View style={tw`flex-row items-center flex-1`}>
                <TouchableOpacity
                  style={tw`mr-3`}
                  onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
                  accessibilityLabel={`View ${contactUsername}'s profile`}
                >
                  <Image
                    source={{ uri: friendProfile?.profile_picture || DEFAULT_AVATAR_ICON }}
                    style={tw`w-10 h-10 rounded-full border-2 border-white`}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    accessibilityLabel={`${contactUsername}'s avatar`}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={tw`flex-1`}
                  onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
                >
                  <Text style={tw`text-lg font-bold text-white`}>
                    {friendProfile?.user?.first_name || contactUsername || 'Unknown User'}
                  </Text>
                  <Text style={tw`text-xs text-white/80`}>
                    {friendProfile?.is_online ? 'Online' : 'Offline'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                accessibilityLabel="Go back"
              >
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
                <View style={tw`flex-1 justify-center items-center mt-10`}>
                  <Text style={tw`text-gray-500 text-lg`}>Start the conversation!</Text>
                </View>
              }
              onContentSizeChange={scrollToBottom}
              onLayout={scrollToBottom}
            />

            {renderPendingFile()}

            <View style={tw`flex-row items-center p-3 bg-white border-t border-gray-200 shadow-md`}>
              <TouchableOpacity
                onPress={pickFile}
                style={tw`mr-3 p-2`}
                accessibilityLabel="Attach file"
              >
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
                accessibilityLabel="Message input"
              />
              <TouchableOpacity
                onPress={sendMessage}
                style={tw`ml-3 p-2`}
                disabled={!inputText.trim()}
                accessibilityLabel="Send message"
              >
                <Ionicons name="send" size={24} color={inputText.trim() ? '#6200EA' : '#ccc'} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>

        <Modalize
          ref={modalizeRef}
          adjustToContentHeight={false}
          modalHeight={Dimensions.get('window').height}
          handlePosition="outside"
          onClose={closeFilePreview}
          modalStyle={tw`bg-black`}
        >
          <View style={tw`flex-1 justify-center items-center p-4`}>
            <TouchableOpacity
              style={tw`absolute top-4 right-4 z-10 bg-black/50 rounded-full p-2`}
              onPress={closeFilePreview}
              accessibilityLabel="Close media preview"
            >
              <Ionicons name="close" size={30} color="white" />
            </TouchableOpacity>
            {fullScreenMedia?.type === 'photo' && (
              <Image
                source={{ uri: fullScreenMedia.uri }}
                style={tw`w-full h-full`}
                contentFit="contain"
                cachePolicy="memory-disk"
                accessibilityLabel="Full screen image"
              />
            )}
            {fullScreenMedia?.type === 'video' && (
              <Video
                source={{ uri: fullScreenMedia.uri }}
                style={tw`w-full h-full`}
                useNativeControls
                resizeMode="contain"
                isLooping={false}
                accessibilityLabel="Full screen video"
              />
            )}
          </View>
        </Modalize>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
