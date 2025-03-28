import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * @typedef {'connecting' | 'connected' | 'failed' | 'closed'} ConnectionStatusEnum
 */

/** @type {Record<ConnectionStatusEnum, ConnectionStatusEnum>} */
export const ConnectionStatus = {
  CONNECTING: "connecting",
  CONNECTED: "connected",
  FAILED: "failed",
  CLOSED: "closed",
};

/**
 * @typedef {Object} WebSocketMessage
 * @property {string} [id] - Temporary client-side ID
 * @property {string} [content] - Message content
 * @property {string} [message_type] - Type of message (e.g., "text", "image")
 * @property {string} [attachment_url] - URL of attachment
 * @property {string} [forward_id] - ID of forwarded message
 * @property {string} [type] - Event type (e.g., "typing", "edit")
 */

/**
 * @typedef {Object} UseWebSocketOptions
 * @property {string} chatId - The chat room ID
 * @property {boolean} isGroup - Whether it's a group chat
 * @property {string} [userId] - The authenticated user's ID
 * @property {number} [maxReconnectAttempts] - Max reconnection attempts (default: 5)
 * @property {number} [baseReconnectDelay] - Base delay in ms for reconnection (default: 1000)
 */

/**
 * Custom Event Emitter for WebSocket events
 * @class
 */
class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  /** @param {string} event @param {(data: any) => void} callback */
  on(event, callback) {
    const callbacks = this.listeners.get(event) || new Set();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);
    return () => callbacks.delete(callback);
  }

  /** @param {string} event @param {any} data */
  emit(event, data) {
    const callbacks = this.listeners.get(event) || new Set();
    callbacks.forEach((callback) => callback(data));
  }
}

/**
 * @param {UseWebSocketOptions} options
 * @returns {Object} WebSocket utilities and state
 */
export const useWebSocket = ({
  chatId,
  isGroup,
  userId,
  maxReconnectAttempts = 5,
  baseReconnectDelay = 1000,
}) => {
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(ConnectionStatus.CONNECTING);
  const [lastError, setLastError] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const ws = useRef(null);
  const eventEmitter = useRef(new EventEmitter());
  const pingInterval = useRef(null);
  const reconnectTimeout = useRef(null);
  const reconnectAttempts = useRef(0);
  const messageQueue = useRef([]);
  const connectionTimeout = useRef(null);
  const isConnecting = useRef(false);
  const lastMessageTimestamp = useRef(null);

  const url = useMemo(
    () => `${isGroup ? "ws://127.0.0.1:8000/ws/group_chat" : "ws://127.0.0.1:8000/ws/chat"}/${chatId}/`,
    [chatId, isGroup]
  );

  // Load queued messages from AsyncStorage
  const loadQueue = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(`ws_queue_${chatId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        messageQueue.current = Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.error("Failed to load WebSocket queue:", error);
      messageQueue.current = [];
    }
  }, [chatId]);

  // Save queue to AsyncStorage
  const saveQueue = useCallback(async () => {
    try {
      await AsyncStorage.setItem(`ws_queue_${chatId}`, JSON.stringify(messageQueue.current));
    } catch (error) {
      console.error("Failed to save WebSocket queue:", error);
    }
  }, [chatId]);

  // Connect to WebSocket
  const connect = useCallback(async () => {
    if (isConnecting.current || (ws.current && ws.current.readyState === WebSocket.OPEN)) return;
    if (reconnectAttempts.current >= maxReconnectAttempts) {
      setLastError(`Max reconnection attempts (${maxReconnectAttempts}) reached`);
      setConnectionStatus(ConnectionStatus.FAILED);
      return;
    }

    isConnecting.current = true;
    setConnectionStatus(ConnectionStatus.CONNECTING);
    setLastError(null);

    const token = await AsyncStorage.getItem("token");
    if (!token) {
      setLastError("Authentication token missing");
      setConnectionStatus(ConnectionStatus.FAILED);
      isConnecting.current = false;
      return;
    }

    ws.current = new WebSocket(`${url}?token=${token}`);

    connectionTimeout.current = setTimeout(() => {
      if (ws.current?.readyState !== WebSocket.OPEN) {
        ws.current.close();
        setLastError("Connection timed out after 5s");
        reconnect();
      }
    }, 5000);

    ws.current.onopen = () => {
      console.log(`WebSocket connected for chat ${chatId}`);
      setIsConnected(true);
      setConnectionStatus(ConnectionStatus.CONNECTED);
      clearTimeout(connectionTimeout.current);
      reconnectAttempts.current = 0;
      isConnecting.current = false;

      pingInterval.current = setInterval(() => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);

      while (messageQueue.current.length > 0 && ws.current.readyState === WebSocket.OPEN) {
        const msg = messageQueue.current.shift();
        ws.current.send(JSON.stringify(msg));
      }
      saveQueue();
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setLastError(data.error);
          if (data.error.includes("token") || data.error.includes("auth")) {
            ws.current.close();
            reconnectAttempts.current = 0;
            connect();
          }
          return;
        }

        switch (data.type) {
          case "message":
          case undefined:
            if (!lastMessageTimestamp.current || new Date(data.message.timestamp) > lastMessageTimestamp.current) {
              setMessages((prev) => {
                const exists = prev.some((m) => m.id === data.message.id);
                const updated = exists
                  ? prev.map((m) => (m.id === data.message.id ? data.message : m))
                  : [...prev, data.message];
                return updated.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
              });
              lastMessageTimestamp.current = new Date(data.message.timestamp);
            }
            eventEmitter.current.emit("message", data);
            break;
          case "typing":
            if (data.user !== userId) {
              setTypingUsers((prev) => {
                const updated = [...new Set([...prev, data.username])];
                setTimeout(() => setTypingUsers((current) => current.filter((u) => u !== data.username)), 2000);
                return updated;
              });
            }
            eventEmitter.current.emit("typing", data);
            break;
          case "ack":
            setMessages((prev) =>
              prev.map((msg) =>
                msg.tempId === data.messageId ? { ...msg, id: data.serverId, tempId: null } : msg
              )
            );
            eventEmitter.current.emit("ack", data);
            break;
          case "pong":
            break;
          default:
            eventEmitter.current.emit(data.type, data);
            break;
        }
      } catch (error) {
        console.error("WebSocket message parsing error:", error);
        setLastError("Invalid server message");
      }
    };

    ws.current.onerror = (error) => {
      console.error("WebSocket error:", error);
      setLastError("Connection error");
      setIsConnected(false);
      isConnecting.current = false;
    };

    ws.current.onclose = (event) => {
      console.log(`WebSocket closed for chat ${chatId} with code ${event.code}`);
      setIsConnected(false);
      setConnectionStatus(ConnectionStatus.CLOSED);
      clearInterval(pingInterval.current);
      clearTimeout(connectionTimeout.current);
      isConnecting.current = false;

      if (event.code !== 1000) {
        reconnect();
      }
    };
  }, [chatId, userId, url, maxReconnectAttempts, baseReconnectDelay, saveQueue]);

  // Reconnection logic with exponential backoff
  const reconnect = useCallback(() => {
    if (reconnectAttempts.current >= maxReconnectAttempts) {
      setLastError(`Max reconnection attempts (${maxReconnectAttempts}) reached`);
      setConnectionStatus(ConnectionStatus.FAILED);
      return;
    }
    const jitter = Math.random() * 500;
    const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts.current) + jitter;
    console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
    reconnectTimeout.current = setTimeout(() => {
      reconnectAttempts.current += 1;
      connect();
    }, delay);
  }, [connect, maxReconnectAttempts, baseReconnectDelay]);

  // Retry connection manually
  const retryConnection = useCallback(() => {
    if (!isConnected && !isConnecting.current) {
      reconnectAttempts.current = 0;
      connect();
    }
  }, [connect, isConnected]);

  // Send message with queueing
  const sendMessage = useCallback(
    /** @param {WebSocketMessage} message @returns {boolean} */
    (message) => {
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        if (!Array.isArray(messageQueue.current)) {
          console.warn("messageQueue.current is not an array, resetting...");
          messageQueue.current = [];
        }
        if (!messageQueue.current.some((m) => m.id === message.id)) {
          messageQueue.current.push(message);
          saveQueue();
        }
        setLastError("Not connected, message queued");
        retryConnection();
        return false;
      }
      try {
        ws.current.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error("Failed to send WebSocket message:", error);
        if (!Array.isArray(messageQueue.current)) {
          console.warn("messageQueue.current is not an array, resetting...");
          messageQueue.current = [];
        }
        if (!messageQueue.current.some((m) => m.id === message.id)) {
          messageQueue.current.push(message);
          saveQueue();
        }
        setLastError("Send failed, message queued");
        retryConnection();
        return false;
      }
    },
    [saveQueue, retryConnection]
  );

  // Close connection
  const closeConnection = useCallback(() => {
    if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
      ws.current.close(1000, "Manual closure");
    }
    clearInterval(pingInterval.current);
    clearTimeout(reconnectTimeout.current);
    clearTimeout(connectionTimeout.current);
    reconnectAttempts.current = 0;
    setConnectionStatus(ConnectionStatus.CLOSED);
    setIsConnected(false);
  }, []);

  // Subscribe to events
  const subscribeToEvent = useCallback(
    /**
     * @param {string} eventType
     * @param {(data: any) => void} callback
     * @returns {() => void}
     */
    (eventType, callback) => eventEmitter.current.on(eventType, callback),
    []
  );

  // Clear message queue
  const clearQueue = useCallback(async () => {
    messageQueue.current = [];
    await saveQueue();
  }, [saveQueue]);

  // Manage lifecycle
  useEffect(() => {
    if (chatId && userId) {
      loadQueue().then(connect);
    }
    return () => {
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        ws.current.close(1000, "Component unmounted");
      }
      clearInterval(pingInterval.current);
      clearTimeout(reconnectTimeout.current);
      clearTimeout(connectionTimeout.current);
      reconnectAttempts.current = 0;
    };
  }, [chatId, userId, connect, loadQueue]);

  return useMemo(
    () => ({
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
      retryConnection,
      ConnectionStatus,
    }),
    [messages, isConnected, typingUsers, connectionStatus, lastError, sendMessage, closeConnection, subscribeToEvent, clearQueue, retryConnection]
  );
};