// WebSocketManager.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { Buffer } from 'buffer';
import aesjs from 'aes-js';
import { API_HOST, API_URL } from '../utils/constants';

const getDatabase = (() => {
  let dbInstance = null;
  return () => {
    if (!dbInstance) {
      try {
        dbInstance = SQLite.openDatabaseSync('chat.db');
        dbInstance.execSync(`
          CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            sender INTEGER,
            receiver INTEGER,
            message TEXT,
            type TEXT,
            file_url TEXT,
            file_name TEXT,
            file_type TEXT,
            file_size INTEGER,
            nonce TEXT,
            ephemeral_key TEXT,
            message_key TEXT,
            timestamp TEXT
          );
          CREATE TABLE IF NOT EXISTS message_keys (
            message_id TEXT PRIMARY KEY,
            message_key TEXT
          );
        `);
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Failed to initialize database:', error);
        throw error;
      }
    }
    return dbInstance;
  };
})();

class WebSocketManager {
  constructor() {
    this.ws = null;
    this.token = null;
    this.senderId = null;
    this.receiverId = null;
    this.messageQueue = [];
    this.listeners = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 2000;
    this.db = getDatabase();
  }

  async initialize(token, senderId, receiverId) {
    this.token = token;
    this.senderId = senderId;
    this.receiverId = receiverId;
    await this.connect();
  }

  async connect() {
    if (!this.token || !this.senderId || !this.receiverId || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const wsUrl = `ws://${API_HOST}/ws/chat/${this.senderId}/${this.receiverId}/?token=${this.token}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket opened');
      this.reconnectAttempts = 0;
      this.processMessageQueue();
      this.notifyListeners({ type: 'connected' });
    };

    this.ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.messages) {
          await this.storeMessages(data.messages);
          this.notifyListeners({ type: 'history', messages: data.messages });
        } else if (
          (data.sender === this.senderId && data.receiver === this.receiverId) ||
          (data.sender === this.receiverId && data.receiver === this.senderId)
        ) {
          await this.storeMessage(data);
          this.notifyListeners({ type: 'message', message: data });
        }
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Parsing WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('(NOBRIDGE) ERROR WebSocket error:', error);
      this.notifyListeners({ type: 'error', error });
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
      this.notifyListeners({ type: 'disconnected' });
      this.reconnect();
    };
  }

  async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      this.notifyListeners({ type: 'error', error: new Error('Max reconnect attempts reached') });
      return;
    }

    this.reconnectAttempts += 1;
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts);
    console.log(`Reconnecting in ${delay}ms... Attempt ${this.reconnectAttempts}`);
    setTimeout(() => this.connect(), delay);
  }

  async sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
      await this.connect();
    }
  }

  async sendFile(metadata, encryptedData) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(metadata));
      await new Promise(resolve => setTimeout(resolve, 100));
      this.ws.send(encryptedData);
    } else {
      this.messageQueue.push({ metadata, encryptedData });
      await this.connect();
    }
  }

  processMessageQueue() {
    while (this.messageQueue.length > 0 && this.ws.readyState === WebSocket.OPEN) {
      const item = this.messageQueue.shift();
      if (item.metadata && item.encryptedData) {
        this.ws.send(JSON.stringify(item.metadata));
        setTimeout(() => this.ws.send(item.encryptedData), 100);
      } else {
        this.ws.send(JSON.stringify(item));
      }
    }
  }

  async storeMessage(message) {
    try {
      this.db.runSync(
        `INSERT OR REPLACE INTO messages (
          id, sender, receiver, message, type, file_url, file_name, file_type, file_size, nonce, ephemeral_key, message_key, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.message_id || `${message.timestamp}-${message.sender}`,
          message.sender,
          message.receiver,
          message.message || message.content || '',
          message.type || 'text',
          message.file_url || message.file || null,
          message.file_name || null,
          message.file_type || null,
          message.file_size || null,
          message.nonce || null,
          message.ephemeral_key || null,
          message.message_key || null,
          message.timestamp || message.created_at || new Date().toISOString(),
        ]
      );
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Storing message:', error);
    }
  }

  async storeMessages(messages) {
    try {
      const stmt = this.db.prepareSync(
        `INSERT OR REPLACE INTO messages (
          id, sender, receiver, message, type, file_url, file_name, file_type, file_size, nonce, ephemeral_key, message_key, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const message of messages) {
        stmt.run(
          message.message_id || `${message.timestamp}-${message.sender}`,
          message.sender,
          message.receiver,
          message.message || message.content || '',
          message.type || 'text',
          message.file_url || message.file || null,
          message.file_name || null,
          message.file_type || null,
          message.file_size || null,
          message.nonce || null,
          message.ephemeral_key || null,
          message.message_key || null,
          message.timestamp || message.created_at || new Date().toISOString()
        );
      }
      stmt.finalizeSync();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Storing messages:', error);
    }
  }

  async storeMessageKey(messageId, messageKey) {
    try {
      this.db.runSync(
        'INSERT OR REPLACE INTO message_keys (message_id, message_key) VALUES (?, ?)',
        [messageId, messageKey]
      );
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Storing message key:', error);
    }
  }

  async getMessages(senderId, receiverId) {
    try {
      const messages = this.db.getAllSync(
        `SELECT * FROM messages WHERE 
        (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) 
        ORDER BY timestamp ASC`,
        [senderId, receiverId, receiverId, senderId]
      );
      return messages;
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Fetching messages:', error);
      return [];
    }
  }

  addListener(listener) {
    this.listeners.add(listener);
  }

  removeListener(listener) {
    this.listeners.delete(listener);
  }

  notifyListeners(event) {
    this.listeners.forEach(listener => listener(event));
  }

  async close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const webSocketManager = new WebSocketManager();