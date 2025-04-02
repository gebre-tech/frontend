import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Connection status enum
export const ConnectionStatus = {
  CONNECTING: "connecting",
  CONNECTED: "connected",
  FAILED: "failed",
  CLOSED: "closed",
  RECONNECTING: "reconnecting",
};

// Simple EventEmitter class
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
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }
}

export const useWebSocket = ({ chatId, isGroup, userId }) => {
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(ConnectionStatus.CONNECTING);
  const [lastError, setLastError] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(new Set()); // Track online users
  const [newMessageNotifications, setNewMessageNotifications] = useState([]); // Track new message notifications

  const ws = useRef(null);
  const eventEmitter = useRef(new EventEmitter());
  const pingInterval = useRef(null);
  const reconnectTimeout = useRef(null);
  const reconnectAttempts = useRef(0);
  const messageQueue = useRef([]);
  const isMountedRef = useRef(true);

  const url = useMemo(
    () =>
      `${isGroup ? "ws://127.0.0.1:8000/ws/group_chat" : "ws://127.0.0.1:8000/ws/chat"}/${chatId}/`,
    [chatId, isGroup]
  );

  const loadQueue = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(`ws_queue_${chatId}`);
      if (stored) messageQueue.current = JSON.parse(stored);
    } catch (error) {
      console.error("[useWebSocket] Failed to load queue:", error);
    }
  }, [chatId]);

  const saveQueue = useCallback(async () => {
    try {
      await AsyncStorage.setItem(`ws_queue_${chatId}`, JSON.stringify(messageQueue.current));
    } catch (error) {
      console.error("[useWebSocket] Failed to save queue:", error);
    }
  }, [chatId]);

  const connect = useCallback(async () => {
    if (ws.current?.readyState === WebSocket.OPEN) return;
    if (reconnectAttempts.current >= 5) {
      setConnectionStatus(ConnectionStatus.FAILED);
      console.error("[useWebSocket] Max reconnect attempts reached");
      return;
    }

    setConnectionStatus(
      reconnectAttempts.current > 0 ? ConnectionStatus.RECONNECTING : ConnectionStatus.CONNECTING
    );

    const token = await AsyncStorage.getItem("token");
    if (!token) {
      setLastError("Authentication token missing");
      setConnectionStatus(ConnectionStatus.FAILED);
      console.error("[useWebSocket] No token available");
      return;
    }

    ws.current = new WebSocket(`${url}?token=${token}`);

    ws.current.onopen = () => {
      if (!isMountedRef.current) return;
      setIsConnected(true);
      setConnectionStatus(ConnectionStatus.CONNECTED);
      setLastError(null);
      reconnectAttempts.current = 0;
      console.log("[useWebSocket] WebSocket connected");

      pingInterval.current = setInterval(() => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: "ping" }));
        } else {
          clearInterval(pingInterval.current);
        }
      }, 30000); // Ping every 30 seconds

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
      const data = JSON.parse(event.data);
      if (data.error) {
        setLastError(data.error);
        console.error("[useWebSocket] Server error:", data.error);
        if (data.error.includes("token")) ws.current.close(4003, "Auth failed");
        return;
      }

      switch (data.type) {
        case "ack":
          eventEmitter.current.emit("ack", data);
          break;
        case "typing":
          if (data.user !== userId) {
            setTypingUsers((prev) =>
              [...new Set([...prev, data.username])].slice(-3)
            );
            setTimeout(() => {
              if (isMountedRef.current) {
                setTypingUsers((prev) => prev.filter((u) => u !== data.username));
              }
            }, 5000); // Clear typing after 5 seconds
          }
          break;
        case "pong":
          break;
        case "reaction":
        case "pin":
        case "group_update":
          eventEmitter.current.emit(data.type, data);
          break;
        case "online_status":
          // Handle online status updates
          setOnlineUsers((prev) => {
            const updated = new Set(prev);
            if (data.status === "online") {
              updated.add(data.user_id);
            } else {
              updated.delete(data.user_id);
            }
            return updated;
          });
          eventEmitter.current.emit("online_status", data);
          break;
        case "chat_message":
          // Handle new messages and trigger notifications
          if (data.message && data.message.sender.id !== userId) {
            setNewMessageNotifications((prev) => [
              ...prev,
              {
                chatId: data.message.chat.id,
                message: data.message.content || data.message.message_type,
                sender: data.message.sender.username,
                timestamp: data.message.timestamp,
              },
            ]);
            eventEmitter.current.emit("chat_message", data);
          }
          setMessages((prev) =>
            [...prev.filter((m) => m.id !== data.message.id), data.message].sort((a, b) =>
              a.timestamp.localeCompare(b.timestamp)
            )
          );
          break;
        default:
          if (data.message) {
            setMessages((prev) =>
              [...prev.filter((m) => m.id !== data.message.id), data.message].sort((a, b) =>
                a.timestamp.localeCompare(b.timestamp)
              )
            );
          }
      }
    };

    ws.current.onerror = (error) => {
      if (!isMountedRef.current) return;
      setLastError("WebSocket connection failed");
      setConnectionStatus(ConnectionStatus.FAILED);
      setIsConnected(false);
      console.error("[useWebSocket] WebSocket error:", error);
    };

    ws.current.onclose = (event) => {
      if (!isMountedRef.current) return;
      setIsConnected(false);
      setConnectionStatus(ConnectionStatus.CLOSED);
      clearInterval(pingInterval.current);
      console.log("[useWebSocket] WebSocket closed:", event.code, event.reason);

      if (event.code !== 1000 && reconnectAttempts.current < 5) {
        const delay = Math.min(5000 * Math.pow(2, reconnectAttempts.current), 60000); // Start at 5s, cap at 60s
        console.log(`[useWebSocket] Reconnecting in ${delay}ms`);
        reconnectTimeout.current = setTimeout(() => {
          reconnectAttempts.current += 1;
          connect();
        }, delay);
      }
    };
  }, [chatId, userId, url, saveQueue]);

  const sendMessage = useCallback((message) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
      return true;
    } else {
      messageQueue.current.push(message);
      saveQueue();
      return false;
    }
  }, []);

  const closeConnection = useCallback(() => {
    if (ws.current) {
      ws.current.close(1000, "Component unmounted");
    }
    clearInterval(pingInterval.current);
    clearTimeout(reconnectTimeout.current);
  }, []);

  const subscribeToEvent = useCallback((event, callback) => {
    return eventEmitter.current.on(event, callback);
  }, []);

  const clearQueue = useCallback(() => {
    messageQueue.current = [];
    saveQueue();
  }, [saveQueue]);

  const retryConnection = useCallback(() => {
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);

  const clearNotifications = useCallback((chatId) => {
    setNewMessageNotifications((prev) => prev.filter((notif) => notif.chatId !== chatId));
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (chatId && userId) {
      loadQueue().then(connect);
    }

    return () => {
      isMountedRef.current = false;
      closeConnection();
      console.log("[useWebSocket] Cleanup completed");
    };
  }, [chatId, userId, connect, loadQueue, closeConnection]);

  return {
    messages,
    setMessages,
    sendMessage,
    isConnected,
    typingUsers,
    onlineUsers, // Expose online users
    newMessageNotifications, // Expose notifications
    clearNotifications, // Method to clear notifications
    connectionStatus,
    lastError,
    closeConnection,
    subscribeToEvent,
    clearQueue,
    retryConnection,
  };
};