import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const ConnectionStatus = {
  CONNECTING: "connecting",
  CONNECTED: "connected",
  FAILED: "failed",
  CLOSED: "closed",
};

class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }
  on(event, callback) {
    const callbacks = this.listeners.get(event) || new Set();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);
    return () => callbacks.delete(callback);
  }
  emit(event, data) {
    const callbacks = this.listeners.get(event) || new Set();
    callbacks.forEach((callback) => callback(data));
  }
  removeAllListeners() {
    this.listeners.clear();
  }
}

export const useWebSocket = ({
  chatId,
  isGroup,
  userId,
  maxReconnectAttempts = 10, // Increased for better resilience
  baseReconnectDelay = 1000,
  wsUrl = "ws://127.0.0.1:8000", // Customize this
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
  const connectionTimeout = useRef(null);
  const reconnectAttempts = useRef(0);
  const messageQueue = useRef([]);
  const isConnecting = useRef(false);
  const lastMessageTimestamp = useRef(null);
  const mounted = useRef(true);

  const url = useMemo(() => {
    if (!chatId) return null;
    return `${isGroup ? `${wsUrl}/ws/group_chat` : `${wsUrl}/ws/chat`}/${chatId}/`;
  }, [chatId, isGroup, wsUrl]);

  const loadQueue = useCallback(async () => {
    if (!mounted.current) return;
    try {
      const stored = await AsyncStorage.getItem(`ws_queue_${chatId}`);
      if (stored) {
        messageQueue.current = JSON.parse(stored) || [];
      }
    } catch (error) {
      console.error("Failed to load queue:", error);
      messageQueue.current = [];
    }
  }, [chatId]);

  const saveQueue = useCallback(async () => {
    if (!mounted.current) return;
    try {
      await AsyncStorage.setItem(`ws_queue_${chatId}`, JSON.stringify(messageQueue.current));
    } catch (error) {
      console.error("Failed to save queue:", error);
    }
  }, [chatId]);

  const connect = useCallback(async () => {
    if (!mounted.current || isConnecting.current || (ws.current && ws.current.readyState === WebSocket.OPEN)) return;
    if (reconnectAttempts.current >= maxReconnectAttempts) {
      setLastError(`Max reconnection attempts (${maxReconnectAttempts}) reached. Please check your network.`);
      setConnectionStatus(ConnectionStatus.FAILED);
      return;
    }

    isConnecting.current = true;
    setConnectionStatus(ConnectionStatus.CONNECTING);
    setLastError(null);

    const token = await AsyncStorage.getItem("token");
    if (!token) {
      setLastError("Authentication token missing. Please log in again.");
      setConnectionStatus(ConnectionStatus.FAILED);
      isConnecting.current = false;
      return;
    }

    console.log(`Connecting to WebSocket at ${url}?token=${token.slice(0, 10)}...`);
    ws.current = new WebSocket(`${url}?token=${token}`);

    connectionTimeout.current = setTimeout(() => {
      if (ws.current?.readyState !== WebSocket.OPEN) {
        ws.current.close();
        setLastError("Connection timed out after 5s. Retrying...");
        reconnect();
      }
    }, 5000);

    ws.current.onopen = () => {
      if (!mounted.current) return;
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
      if (!mounted.current) return;
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          console.error("WebSocket server error:", data.error);
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
          case "delivered":
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === data.messageId ? { ...msg, delivered_to: data.delivered_to } : msg
              )
            );
            eventEmitter.current.emit("delivered", data);
            break;
          case "seen":
            setMessages((prev) =>
              prev.map((msg) => (msg.id === data.messageId ? { ...msg, seen_by: data.seen_by } : msg))
            );
            eventEmitter.current.emit("seen", data);
            break;
          default:
            eventEmitter.current.emit(data.type, data);
            break;
        }
      } catch (error) {
        console.error("Message parsing error:", error);
        setLastError("Invalid server message format.");
      }
    };

    ws.current.onerror = (error) => {
      if (!mounted.current) return;
      console.error("WebSocket error:", error);
      setLastError("Connection error. Retrying automatically...");
      setIsConnected(false);
      isConnecting.current = false;
    };

    ws.current.onclose = (event) => {
      if (!mounted.current) return;
      console.log(`WebSocket closed with code ${event.code}, reason: ${event.reason}`);
      setIsConnected(false);
      setConnectionStatus(ConnectionStatus.CLOSED);
      clearInterval(pingInterval.current);
      clearTimeout(connectionTimeout.current);
      isConnecting.current = false;
      if (event.code !== 1000) reconnect();
    };
  }, [chatId, userId, url, maxReconnectAttempts, baseReconnectDelay, saveQueue]);

  const reconnect = useCallback(() => {
    if (!mounted.current || reconnectAttempts.current >= maxReconnectAttempts) {
      setLastError(`Max reconnection attempts (${maxReconnectAttempts}) reached. Please check your network.`);
      setConnectionStatus(ConnectionStatus.FAILED);
      return;
    }
    const jitter = Math.random() * 500;
    const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts.current) + jitter, 30000); // Cap at 30s
    console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
    reconnectTimeout.current = setTimeout(() => {
      reconnectAttempts.current += 1;
      connect();
    }, delay);
  }, [connect, maxReconnectAttempts, baseReconnectDelay]);

  const sendMessage = useCallback((message) => {
    if (!mounted.current) return false;
    if (!message || typeof message !== "object") {
      setLastError("Invalid message payload");
      return false;
    }
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      if (!messageQueue.current.some((m) => m.id === message.id)) {
        messageQueue.current.push(message);
        saveQueue();
      }
      setLastError("Not connected, message queued. Retrying connection...");
      reconnect();
      return false;
    }
    try {
      ws.current.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error("Send failed:", error);
      if (!messageQueue.current.some((m) => m.id === message.id)) {
        messageQueue.current.push(message);
        saveQueue();
      }
      setLastError("Send failed, message queued. Retrying connection...");
      reconnect();
      return false;
    }
  }, [saveQueue, reconnect]);

  const closeConnection = useCallback(() => {
    if (!mounted.current) return;
    if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
      ws.current.close(1000, "Manual closure");
    }
    clearInterval(pingInterval.current);
    clearTimeout(reconnectTimeout.current);
    clearTimeout(connectionTimeout.current);
    reconnectAttempts.current = 0;
    setConnectionStatus(ConnectionStatus.CLOSED);
    setIsConnected(false);
    eventEmitter.current.removeAllListeners();
  }, []);

  const subscribeToEvent = useCallback((eventType, callback) => {
    if (!mounted.current) return () => {};
    return eventEmitter.current.on(eventType, callback);
  }, []);

  const clearQueue = useCallback(async () => {
    if (!mounted.current) return;
    messageQueue.current = [];
    await saveQueue();
  }, [saveQueue]);

  useEffect(() => {
    mounted.current = true;
    if (chatId && userId) {
      loadQueue().then(connect);
    }
    return () => {
      mounted.current = false;
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        ws.current.close(1000, "Component unmounted");
      }
      clearInterval(pingInterval.current);
      clearTimeout(reconnectTimeout.current);
      clearTimeout(connectionTimeout.current);
      eventEmitter.current.removeAllListeners();
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
      ConnectionStatus,
    }),
    [messages, isConnected, typingUsers, connectionStatus, lastError, sendMessage, closeConnection, subscribeToEvent, clearQueue]
  );
};