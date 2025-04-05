// store/messageStore.js
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const useMessageStore = create((set, get) => ({
  messages: {}, // Normalized state: { [messageId]: message }
  typingUsers: [],
  addMessage: (message) => {
    if (!message.id && !message.tempId) return; // Skip if no ID
    const key = message.id || message.tempId;
    set((state) => {
      if (state.messages[key]) return state; // Prevent duplicates
      const updatedMessages = { ...state.messages, [key]: message };
      // Persist to AsyncStorage
      AsyncStorage.setItem(`chat-${message.chatId}-messages`, JSON.stringify(updatedMessages)).catch((error) =>
        console.error('Failed to save messages to AsyncStorage:', error)
      );
      return { messages: updatedMessages };
    });
  },
  updateMessage: (messageId, updates) => {
    set((state) => {
      if (!state.messages[messageId]) return state;
      const updatedMessages = {
        ...state.messages,
        [messageId]: { ...state.messages[messageId], ...updates },
      };
      AsyncStorage.setItem(`chat-${state.messages[messageId].chatId}-messages`, JSON.stringify(updatedMessages)).catch(
        (error) => console.error('Failed to update messages in AsyncStorage:', error)
      );
      return { messages: updatedMessages };
    });
  },
  setMessages: (messages) => {
    const normalizedMessages = messages.reduce((acc, msg) => {
      const key = msg.id || msg.tempId;
      if (key && !acc[key]) acc[key] = msg;
      return acc;
    }, {});
    set((state) => {
      const chatId = messages[0]?.chatId;
      if (chatId) {
        AsyncStorage.setItem(`chat-${chatId}-messages`, JSON.stringify(normalizedMessages)).catch((error) =>
          console.error('Failed to set messages in AsyncStorage:', error)
        );
      }
      return { messages: normalizedMessages };
    });
  },
  addTypingUser: (username) => {
    set((state) => ({
      typingUsers: [...new Set([...state.typingUsers, username])].slice(-3),
    }));
  },
  removeTypingUser: (username) => {
    set((state) => ({
      typingUsers: state.typingUsers.filter((u) => u !== username),
    }));
  },
  clearMessages: () => {
    set({ messages: {}, typingUsers: [] });
  },
}));

export default useMessageStore;