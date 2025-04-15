import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_HOST} from '../utils/constants';

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

const addJitter = (delay) => delay + Math.random() * 1000;

const logger = {
  info: (...args) => console.log('[useWebSocket]', ...args),
  error: (...args) => console.error('[useWebSocket]', ...args),
  warn: (...args) => console.warn('[useWebSocket]', ...args),
};

export const useWebSocket = ({ chatId, isGroup = false, userId, isGlobal = false }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(ConnectionStatus.CONNECTING);
  const [lastError, setLastError] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [newMessageNotifications, setNewMessageNotifications] = useState([]);

  const ws = useRef(null);
  const eventEmitter = useRef(new EventEmitter());
  const pingInterval = useRef(null);
  const reconnectTimeout = useRef(null);
  const reconnectAttempts = useRef(0);
  const messageQueue = useRef([]);
  const isMountedRef = useRef(true);
  const lastPong = useRef(Date.now());
  const processedMessages = useRef(new Set()); // Track processed message IDs

  const url = useMemo(() => {
    if (isGlobal) return `ws://${API_HOST}/ws/global/`;
    return `${isGroup ? `ws://${API_HOST}/ws/group_chat` : `ws://${API_HOST}/ws/chat`}/${chatId}/`;
  }, [chatId, isGroup, isGlobal]);

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
    if (ws.current?.readyState === WebSocket.OPEN) {
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

    ws.current = new WebSocket(`${url}?token=${token}`);

    ws.current.onopen = () => {
      if (!isMountedRef.current) return;
      setIsConnected(true);
      setConnectionStatus(ConnectionStatus.CONNECTED);
      setLastError(null);
      reconnectAttempts.current = 0;
      lastPong.current = Date.now();
      logger.info('WebSocket connected');

      pingInterval.current = setInterval(() => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          const now = Date.now();
          if (now - lastPong.current > 60000) {
            logger.warn('No pong received for 60s, closing connection');
            ws.current.close(4004, 'Heartbeat timeout');
            return;
          }
          ws.current.send(JSON.stringify({ type: 'ping' }));
        } else {
          clearInterval(pingInterval.current);
        }
      }, 30000);

      if (messageQueue.current.length) {
        messageQueue.current.forEach((msg) => {
          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify(msg));
          }
        });
        messageQueue.current = [];
        saveQueue();
      }
    };

    ws.current.onmessage = (event) => {
      if (!isMountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setLastError(data.error);
          logger.error('Server error:', data.error);
          if (data.error.includes('token')) {
            ws.current.close(4003, 'Auth failed');
          }
          return;
        }

        if (data.message?.id && processedMessages.current.has(data.message.id)) {
          logger.info(`Message ${data.message.id} already processed, skipping`);
          return;
        }

        switch (data.type) {
          case 'ack':
            eventEmitter.current.emit(WebSocketEventTypes.ACK, data);
            break;
          case 'typing':
            if (data.user !== userId) {
              setTypingUsers((prev) => {
                if (prev.includes(data.username)) return prev;
                const updated = [...new Set([...prev, data.username])].slice(-3);
                return updated;
              });
              setTimeout(() => {
                if (isMountedRef.current) {
                  setTypingUsers((prev) => prev.filter((u) => u !== data.username));
                }
              }, 5000);
            }
            eventEmitter.current.emit(WebSocketEventTypes.TYPING, data);
            break;
          case 'pong':
            lastPong.current = Date.now();
            eventEmitter.current.emit(WebSocketEventTypes.PONG, data);
            break;
          case 'reaction':
            eventEmitter.current.emit(WebSocketEventTypes.REACTION, data);
            break;
          case 'pin':
            eventEmitter.current.emit(WebSocketEventTypes.PIN, data);
            break;
          case 'group_update':
            eventEmitter.current.emit(WebSocketEventTypes.GROUP_UPDATE, data);
            break;
          case 'online_status':
            setOnlineUsers((prev) => {
              const updated = new Set(prev);
              if (data.status === 'online') updated.add(data.user_id);
              else updated.delete(data.user_id);
              return updated;
            });
            eventEmitter.current.emit(WebSocketEventTypes.ONLINE_STATUS, data);
            break;
          case 'message_delivered':
            eventEmitter.current.emit(WebSocketEventTypes.MESSAGE_DELIVERED, data);
            break;
          default:
            if (data.message) {
              processedMessages.current.add(data.message.id);
              setNewMessageNotifications((prev) => {
                const exists = prev.some((notif) => notif.messageId === data.message.id);
                if (exists) return prev;
                return [
                  ...prev,
                  {
                    chatId: data.message.chat.id,
                    messageId: data.message.id,
                    message: data.message.content || data.message.message_type,
                    sender: data.message.sender.username,
                    timestamp: data.message.timestamp,
                  },
                ];
              });
              eventEmitter.current.emit(WebSocketEventTypes.MESSAGE, data.message);
            } else {
              logger.warn('Unknown message type:', data.type);
            }
        }
      } catch (error) {
        logger.error('Error parsing WebSocket message:', error);
      }
    };

    ws.current.onerror = (error) => {
      if (!isMountedRef.current) return;
      setLastError('WebSocket connection failed');
      setConnectionStatus(ConnectionStatus.FAILED);
      setIsConnected(false);
      logger.error('WebSocket error:', error);
    };

    ws.current.onclose = (event) => {
      if (!isMountedRef.current) return;
      setIsConnected(false);
      setConnectionStatus(ConnectionStatus.CLOSED);
      clearInterval(pingInterval.current);
      logger.info('WebSocket closed:', event.code, event.reason);

      if (event.code !== 1000 && reconnectAttempts.current < maxAttempts) {
        const baseDelay = Math.min(5000 * Math.pow(2, reconnectAttempts.current), 60000);
        const delay = addJitter(baseDelay);
        logger.info(`Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts.current + 1})`);
        reconnectTimeout.current = setTimeout(() => {
          reconnectAttempts.current += 1;
          connect();
        }, delay);
      }
    };
  }, [chatId, userId, url, saveQueue, isGlobal]);

  const sendMessage = useCallback(
    (message) => {
      if (message.type === 'message' && !message.content && !message.attachment_url) {
        logger.warn('Skipping empty message:', message);
        return false;
      }
  
      // Deduplicate messages in the queue
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
  
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(message));
        return true;
      } else {
        messageQueue.current.push(message);
        saveQueue();
        logger.info('Message queued:', message);
        return false;
      }
    },
    [saveQueue]
  );

  const closeConnection = useCallback(() => {
    if (ws.current) {
      ws.current.close(1000, 'Component unmounted');
    }
    clearInterval(pingInterval.current);
    clearTimeout(reconnectTimeout.current);
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
    setNewMessageNotifications((prev) => {
      const updated = prev.filter((notif) => notif.chatId !== chatId);
      logger.info(`Cleared notifications for chat ${chatId}`);
      return updated;
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
    isConnected,
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