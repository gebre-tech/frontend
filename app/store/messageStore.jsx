
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persist, devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

const ENABLE_LOGS = true; // Enable logs for debugging hydration issues
const logger = {
  info: (...args) => ENABLE_LOGS && console.log('[MessageStore]', ...args),
  error: (...args) => console.error('[MessageStore]', ...args),
  warn: (...args) => console.warn('[MessageStore]', ...args),
};

const initialState = {
  messages: [], // Ensure messages is always an array
  typingUsers: {}, // { [chatId]: string[] }
};

const useMessageStore = create(
  devtools(
    persist(
      immer((set, get) => ({
        ...initialState,
        addMessage: (chatId, message) => {
          if (!message.id && !message.tempId) {
            logger.error('Skipping message without ID:', message);
            return;
          }
          const key = message.id || message.tempId;
          set((state) => {
            if (state.messages.some((m) => m.chatId === chatId && (m.id === key || m.tempId === key))) {
              logger.info(`Message ${key} already exists in chat ${chatId}, skipping`);
              return;
            }
            state.messages.push({ chatId, messageId: key, ...message });
            logger.info(`Added message ${key} to chat ${chatId}`);
          });
        },
        updateMessage: (chatId, messageId, updates) => {
          set((state) => {
            const index = state.messages.findIndex((m) => m.chatId === chatId && (m.id === messageId || m.tempId === messageId));
            if (index === -1) {
              logger.error(`Message ${messageId} not found in chat ${chatId}`);
              return;
            }
            state.messages[index] = { ...state.messages[index], ...updates };
            logger.info(`Updated message ${messageId} in chat ${chatId}`);
          });
        },
        deleteMessage: (chatId, messageId) => {
          set((state) => {
            const index = state.messages.findIndex((m) => m.chatId === chatId && (m.id === messageId || m.tempId === messageId));
            if (index === -1) {
              logger.error(`Message ${messageId} not found in chat ${chatId}`);
              return;
            }
            state.messages.splice(index, 1);
            logger.info(`Deleted message ${messageId} from chat ${chatId}`);
          });
        },
        setMessages: (chatId, messages) => {
          set((state) => {
            const safeMessages = Array.isArray(messages) ? messages : [];
            const normalizedMessages = safeMessages.map((msg) => ({
              chatId,
              messageId: msg.id || msg.tempId,
              ...msg,
            }));
            state.messages = [
              ...state.messages.filter((m) => m.chatId !== chatId),
              ...normalizedMessages,
            ];
            logger.info(`Set ${normalizedMessages.length} messages for chat ${chatId}`);
          });
        },
        addTypingUser: (chatId, username) => {
          set((state) => {
            const chatTypingUsers = state.typingUsers[chatId] || [];
            if (chatTypingUsers.includes(username)) return;
            state.typingUsers[chatId] = [...chatTypingUsers, username].slice(-3);
            logger.info(`Added typing user ${username} to chat ${chatId}`);
          });
        },
        removeTypingUser: (chatId, username) => {
          set((state) => {
            const chatTypingUsers = state.typingUsers[chatId] || [];
            state.typingUsers[chatId] = chatTypingUsers.filter((u) => u !== username);
            logger.info(`Removed typing user ${username} from chat ${chatId}`);
          });
        },
        clearMessages: (chatId) => {
          set((state) => {
            state.messages = state.messages.filter((m) => m.chatId !== chatId);
            delete state.typingUsers[chatId];
            logger.info(`Cleared messages and typing users for chat ${chatId}`);
          });
        },
        clearAll: () => {
          set((state) => {
            state.messages = [];
            state.typingUsers = {};
            logger.info('Cleared all messages and typing users');
          });
        },
      })),
      {
        name: 'message-store',
        storage: {
          getItem: async (name) => {
            try {
              const value = await AsyncStorage.getItem(name);
              if (!value) {
                logger.info(`No data found in AsyncStorage for ${name}`);
                return initialState;
              }
              const parsed = JSON.parse(value);
              // Validate that messages is an array
              if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.messages)) {
                logger.warn(`Invalid data in AsyncStorage for ${name}, resetting to initial state`);
                await AsyncStorage.removeItem(name);
                return initialState;
              }
              logger.info(`Successfully hydrated store from AsyncStorage for ${name}`);
              return parsed;
            } catch (error) {
              logger.error(`Failed to parse AsyncStorage data for ${name}:`, error);
              await AsyncStorage.removeItem(name);
              return initialState;
            }
          },
          setItem: async (name, value) => {
            try {
              await AsyncStorage.setItem(name, JSON.stringify(value));
              logger.info(`Saved state to AsyncStorage for ${name}`);
            } catch (error) {
              logger.error(`Failed to save state to AsyncStorage for ${name}:`, error);
            }
          },
          removeItem: async (name) => {
            try {
              await AsyncStorage.removeItem(name);
              logger.info(`Removed AsyncStorage data for ${name}`);
            } catch (error) {
              logger.error(`Failed to remove AsyncStorage data for ${name}:`, error);
            }
          },
        },
      }
    ),
    { name: 'MessageStore' }
  )
);

export default useMessageStore;
