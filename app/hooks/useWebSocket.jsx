import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_HOST } from '../utils/constants';
import { useSyncExternalStore } from 'react';

export const ConnectionStatus = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  FAILED: 'failed',
  CLOSED: 'closed',
  RECONNECTING: 'reconnecting',
};

const WebSocketEventTypes = {
  MESSAGE: 'message',
  ACK: 'ack',
  TYPING: 'typing',
  PONG: 'pong',
  REACTION: 'reaction',
  PIN: 'pin',
  GROUP_UPDATE: 'group_update',
  ONLINE_STATUS: 'online_status',
  MESSAGE_DELIVERED: 'message_delivered',
  MESSAGE_STATUS: 'message_status',
};

class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!Object.values(WebSocketEventTypes).includes(event)) {
      console.warn(`[EventEmitter] Unknown event type: ${event}`);
    }
    const callbacks = this.listeners.get(event) || new Set();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);
    return () => callbacks.delete(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }
  }
}

const logger = {
  info: (...args) => console.log('[useWebSocket]', ...args),
  error: (...args) => console.error('[useWebSocket]', ...args),
  warn: (...args) => console.warn('[useWebSocket]', ...args),
};

export const useWebSocket = ({ chatId, isGroup = false, userId, isGlobal = false }) => {
  const [connectionStatus, setConnectionStatus] = useState(ConnectionStatus.CONNECTING);
  const [lastError, setLastError] = useState(null);
  const wsRef = useRef(null);
  const eventEmitter = useRef(new EventEmitter());
  const reconnectAttempts = useRef(0);
  const messageQueue = useRef([]);
  const isMountedRef = useRef(true);
  const processedMessages = useRef(new Set());
  const batchedMessages = useRef([]);
  const batchTimeout = useRef(null);

  const url = useMemo(() => {
    if (isGlobal) return `ws://${API_HOST}/ws/global/`;
    return `${isGroup ? `ws://${API_HOST}/ws/group_chat` : `ws://${API_HOST}/ws/chat`}/${chatId}/`;
  }, [chatId, isGroup, isGlobal]);

  // Store for derived state (typingUsers, onlineUsers, notifications)
  const subscribeToStore = useCallback((selector) => {
    let state = {
      typingUsers: [],
      onlineUsers: new Set(),
      newMessageNotifications: [],
    };

    const subscribe = (onStoreChange) => {
      const listener = (event, data) => {
        if (!isMountedRef.current) return;
        switch (event) {
          case WebSocketEventTypes.TYPING:
            if (data.user !== userId) {
              state = {
                ...state,
                typingUsers: [...new Set([...state.typingUsers, data.username])].slice(-3),
              };
              setTimeout(() => {
                if (isMountedRef.current) {
                  state = {
                    ...state,
                    typingUsers: state.typingUsers.filter((u) => u !== data.username),
                  };
                  onStoreChange();
                }
              }, 5000);
            }
            break;
          case WebSocketEventTypes.ONLINE_STATUS:
            state = {
              ...state,
              onlineUsers: new Set(state.onlineUsers),
            };
            if (data.status === 'online') state.onlineUsers.add(data.user_id);
            else state.onlineUsers.delete(data.user_id);
            onStoreChange();
            break;
          case WebSocketEventTypes.MESSAGE:
          case WebSocketEventTypes.MESSAGE_DELIVERED:
            if (data.message?.id && !processedMessages.current.has(data.message.id)) {
              state = {
                ...state,
                newMessageNotifications: [
                  ...state.newMessageNotifications,
                  {
                    chatId: data.message.chat.id,
                    messageId: data.message.id,
                    message: data.message.content || data.message.message_type,
                    sender: data.message.sender.username,
                    timestamp: data.message.timestamp,
                  },
                ],
              };
              processedMessages.current.add(data.message.id);
              onStoreChange();
            }
            break;
        }
      };

      const unsubscribers = [
        eventEmitter.current.on(WebSocketEventTypes.TYPING, listener.bind(null, WebSocketEventTypes.TYPING)),
        eventEmitter.current.on(WebSocketEventTypes.ONLINE_STATUS, listener.bind(null, WebSocketEventTypes.ONLINE_STATUS)),
        eventEmitter.current.on(WebSocketEventTypes.MESSAGE, listener.bind(null, WebSocketEventTypes.MESSAGE)),
        eventEmitter.current.on(WebSocketEventTypes.MESSAGE_DELIVERED, listener.bind(null, WebSocketEventTypes.MESSAGE_DELIVERED)),
      ];

      return () => unsubscribers.forEach((unsub) => unsub());
    };

    return useSyncExternalStore(
      subscribe,
      () => selector(state),
      () => selector(state)
    );
  }, [userId]);

  const typingUsers = subscribeToStore((state) => state.typingUsers);
  const onlineUsers = subscribeToStore((state) => state.onlineUsers);
  const newMessageNotifications = subscribeToStore((state) => state.newMessageNotifications);

  const loadQueue = useCallback(async () => {
    try {
      const queueKey = isGlobal ? 'ws_queue_global' : `ws_queue_${chatId}`;
      const stored = await AsyncStorage.getItem(queueKey);
      if (stored) {
        messageQueue.current = JSON.parse(stored);
        logger.info(`Loaded ${messageQueue.current.length} messages from queue for ${queueKey}`);
      }
    } catch (error) {
      logger.error('Failed to load queue:', error);
    }
  }, [chatId, isGlobal]);

  const saveQueue = useCallback(async () => {
    try {
      const queueKey = isGlobal ? 'ws_queue_global' : `ws_queue_${chatId}`;
      await AsyncStorage.setItem(queueKey, JSON.stringify(messageQueue.current));
      logger.info(`Saved ${messageQueue.current.length} messages to queue for ${queueKey}`);
    } catch (error) {
      logger.error('Failed to save queue:', error);
    }
  }, [chatId, isGlobal]);

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      logger.info('WebSocket already connected');
      return;
    }

    const maxAttempts = 5;
    if (reconnectAttempts.current >= maxAttempts) {
      setConnectionStatus(ConnectionStatus.FAILED);
      logger.error(`Max reconnect attempts (${maxAttempts}) reached`);
      return;
    }

    setConnectionStatus(reconnectAttempts.current > 0 ? ConnectionStatus.RECONNECTING : ConnectionStatus.CONNECTING);

    const token = await AsyncStorage.getItem('token');
    if (!token) {
      setLastError('Authentication token missing');
      setConnectionStatus(ConnectionStatus.FAILED);
      logger.error('No token available');
      return;
    }

    wsRef.current = new WebSocket(`${url}?token=${token}`);

    wsRef.current.onopen = () => {
      if (!isMountedRef.current) return;
      setConnectionStatus(ConnectionStatus.CONNECTED);
      setLastError(null);
      reconnectAttempts.current = 0;
      logger.info('WebSocket connected');

      // Send queued messages
      if (messageQueue.current.length) {
        messageQueue.current.forEach((msg) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg));
          }
        });
        messageQueue.current = [];
        saveQueue();
      }

      // Start ping interval
      const pingInterval = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'ping' }));
        }
      }, 60000);
      wsRef.current.pingInterval = pingInterval;
    };

    wsRef.current.onmessage = (event) => {
      if (!isMountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setLastError(data.error);
          logger.error('Server error:', data.error);
          if (data.error.includes('token')) {
            wsRef.current.close(4003, 'Auth failed');
          }
          return;
        }

        // Batch messages to reduce state updates
        batchedMessages.current.push(data);
        if (!batchTimeout.current) {
          batchTimeout.current = setTimeout(() => {
            batchedMessages.current.forEach((batchedData) => {
              if (batchedData.message?.id && processedMessages.current.has(batchedData.message.id)) {
                logger.info(`Message ${batchedData.message.id} already processed, skipping`);
                return;
              }

              eventEmitter.current.emit(batchedData.type, batchedData);
              if (batchedData.message?.id) {
                processedMessages.current.add(batchedData.message.id);
              }
            });
            batchedMessages.current = [];
            batchTimeout.current = null;
          }, 100);
        }
      } catch (error) {
        logger.error('Error parsing WebSocket message:', error);
      }
    };

    wsRef.current.onerror = (error) => {
      if (!isMountedRef.current) return;
      setLastError('WebSocket connection failed');
      setConnectionStatus(ConnectionStatus.FAILED);
      logger.error('WebSocket error:', error);
    };

    wsRef.current.onclose = (event) => {
      if (!isMountedRef.current) return;
      setConnectionStatus(ConnectionStatus.CLOSED);
      clearInterval(wsRef.current?.pingInterval);
      logger.info('WebSocket closed:', event.code, event.reason);

      if (event.code !== 1000 && reconnectAttempts.current < maxAttempts) {
        const baseDelay = Math.min(5000 * Math.pow(2, reconnectAttempts.current), 60000);
        const delay = baseDelay + Math.random() * 1000;
        logger.info(`Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts.current + 1})`);
        setTimeout(() => {
          if (isMountedRef.current) {
            reconnectAttempts.current += 1;
            connect();
          }
        }, delay);
      }
    };
  }, [url, saveQueue]);

  const sendMessage = useCallback((message) => {
    if (message.type === 'message' && !message.content && !message.attachment_url) {
      logger.warn('Skipping empty message:', message);
      return false;
    }

    const isDuplicate = messageQueue.current.some(
      (queuedMsg) =>
        queuedMsg.type === message.type &&
        queuedMsg.content === message.content &&
        queuedMsg.chat_id === message.chat_id &&
        queuedMsg.id === message.id
    );

    if (isDuplicate) {
      logger.warn('Duplicate message in queue, skipping:', message);
      return false;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    } else {
      messageQueue.current.push(message);
      saveQueue();
      logger.info('Message queued:', message);
      return false;
    }
  }, [saveQueue]);

  const closeConnection = useCallback(() => {
    if (wsRef.current) {
      clearInterval(wsRef.current.pingInterval);
      wsRef.current.close(1000, 'Component unmounted');
      wsRef.current = null;
    }
    clearTimeout(batchTimeout.current);
    logger.info('WebSocket connection closed');
  }, []);

  const subscribeToEvent = useCallback((event, callback) => {
    return eventEmitter.current.on(event, callback);
  }, []);

  const retryConnection = useCallback(() => {
    reconnectAttempts.current = 0;
    connect();
    logger.info('Retrying WebSocket connection');
  }, [connect]);

  const clearNotifications = useCallback((chatId) => {
    subscribeToStore((state) => {
      state.newMessageNotifications = state.newMessageNotifications.filter((notif) => notif.chatId !== chatId);
      logger.info(`Cleared notifications for chat ${chatId}`);
      return state;
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if ((chatId || isGlobal) && userId) {
      loadQueue().then(connect);
    }

    return () => {
      isMountedRef.current = false;
      closeConnection();
    };
  }, [chatId, userId, connect, loadQueue, closeConnection, isGlobal]);

  return {
    sendMessage,
    isConnected: connectionStatus === ConnectionStatus.CONNECTED,
    typingUsers,
    onlineUsers,
    newMessageNotifications,
    clearNotifications,
    connectionStatus,
    lastError,
    closeConnection,
    subscribeToEvent,
    retryConnection,
  };
};