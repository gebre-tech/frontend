import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persist, devtools } from 'zustand/middleware';

// Logger utility with toggle
const ENABLE_LOGS = false; // Toggle to false in production
const logger = {
  info: (...args) => ENABLE_LOGS && console.log('[MessageStore]', ...args),
  error: (...args) => console.error('[MessageStore]', ...args),
};

const useMessageStore = create(
  devtools(
    persist(
      (set, get) => ({
        messages: {}, // { [chatId]: { [messageId]: message } }
        typingUsers: {}, // { [chatId]: string[] }
        addMessage: (chatId, message) => {
          if (!message.id && !message.tempId) {
            logger.error('Skipping message without ID:', message);
            return;
          }
          const key = message.id || message.tempId;
          set((state) => {
            const chatMessages = state.messages[chatId] || {};
            if (chatMessages[key]) {
              logger.info(`Message ${key} already exists in chat ${chatId}, skipping`);
              return state; // Prevent duplicates
            }
            const updatedChatMessages = { ...chatMessages, [key]: message };
            logger.info(`Added message ${key} to chat ${chatId}`);
            return { messages: { ...state.messages, [chatId]: updatedChatMessages } };
          });
        },
        updateMessage: (chatId, messageId, updates) => {
          set((state) => {
            const chatMessages = state.messages[chatId] || {};
            if (!chatMessages[messageId]) {
              logger.error(`Message ${messageId} not found in chat ${chatId}`);
              return state;
            }
            const updatedChatMessages = {
              ...chatMessages,
              [messageId]: { ...chatMessages[messageId], ...updates },
            };
            logger.info(`Updated message ${messageId} in chat ${chatId}`);
            return { messages: { ...state.messages, [chatId]: updatedChatMessages } };
          });
        },
        deleteMessage: (chatId, messageId) => {
          set((state) => {
            const chatMessages = state.messages[chatId] || {};
            if (!chatMessages[messageId]) {
              logger.error(`Message ${messageId} not found in chat ${chatId}`);
              return state;
            }
            const updatedChatMessages = { ...chatMessages };
            delete updatedChatMessages[messageId];
            logger.info(`Deleted message ${messageId} from chat ${chatId}`);
            return { messages: { ...state.messages, [chatId]: updatedChatMessages } };
          });
        },
        setMessages: (chatId, messages) => {
          const normalizedMessages = messages.reduce((acc, msg) => {
            const key = msg.id || msg.tempId;
            if (key && !acc[key]) acc[key] = msg;
            return acc;
          }, {});
          set((state) => {
            const existingMessages = state.messages[chatId] || {};
            const hasChanged = Object.keys(normalizedMessages).length !== Object.keys(existingMessages).length ||
              Object.keys(normalizedMessages).some(
                (key) => JSON.stringify(normalizedMessages[key]) !== JSON.stringify(existingMessages[key])
              );
            if (!hasChanged) {
              logger.info(`No changes in messages for chat ${chatId}, skipping update`);
              return state; // Prevent unnecessary updates
            }
            logger.info(`Set ${Object.keys(normalizedMessages).length} messages for chat ${chatId}`);
            return { messages: { ...state.messages, [chatId]: normalizedMessages } };
          });
        },
        addTypingUser: (chatId, username) => {
          set((state) => {
            const chatTypingUsers = state.typingUsers[chatId] || [];
            if (chatTypingUsers.includes(username)) return state; // Prevent duplicates
            const updatedTypingUsers = [...chatTypingUsers, username].slice(-3);
            logger.info(`Added typing user ${username} to chat ${chatId}`);
            return { typingUsers: { ...state.typingUsers, [chatId]: updatedTypingUsers } };
          });
        },
        removeTypingUser: (chatId, username) => {
          set((state) => {
            const chatTypingUsers = state.typingUsers[chatId] || [];
            const updatedTypingUsers = chatTypingUsers.filter((u) => u !== username);
            logger.info(`Removed typing user ${username} from chat ${chatId}`);
            return { typingUsers: { ...state.typingUsers, [chatId]: updatedTypingUsers } };
          });
        },
        clearMessages: (chatId) => {
          set((state) => {
            const updatedMessages = { ...state.messages };
            const updatedTypingUsers = { ...state.typingUsers };
            delete updatedMessages[chatId];
            delete updatedTypingUsers[chatId];
            logger.info(`Cleared messages and typing users for chat ${chatId}`);
            return { messages: updatedMessages, typingUsers: updatedTypingUsers };
          });
        },
        clearAll: () => {
          set({ messages: {}, typingUsers: {} });
          logger.info('Cleared all messages and typing users');
        },
      }),
      {
        name: 'message-store',
        storage: {
          getItem: async (name) => {
            const value = await AsyncStorage.getItem(name);
            return value ? JSON.parse(value) : null;
          },
          setItem: async (name, value) => {
            await AsyncStorage.setItem(name, JSON.stringify(value));
          },
          removeItem: async (name) => {
            await AsyncStorage.removeItem(name);
          },
        },
      }
    ),
    { name: 'MessageStore' }
  )
);

export default useMessageStore;