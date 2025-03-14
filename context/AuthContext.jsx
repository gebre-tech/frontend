import React, { createContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
const API_URL = "http://127.0.0.1:8000";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const token = await AsyncStorage.getItem("token");
      if (!token) {
        setLoading(false);
        return;
      }

      const res = await axios.get(`${API_URL}/auth/profile/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(res.data);
    } catch (error) {
      console.log("Auth check failed:", error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API_URL}/auth/login/`, { email, password });
      await AsyncStorage.setItem("token", res.data.access);
      await AsyncStorage.setItem("refresh", res.data.refresh);
      setUser(res.data.user);
      return true;
    } catch (error) {
      setError(error.response?.data?.detail || "Invalid credentials");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      // Optional: Make a logout API call if your backend supports it
      const token = await AsyncStorage.getItem("token");
      if (token) {
        await axios.post(
          `${API_URL}/auth/logout/`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
      
      await AsyncStorage.removeItem("token");
      await AsyncStorage.removeItem("refresh");
      setUser(null);
      return true;
    } catch (error) {
      console.log("Logout error:", error);
      setError("Failed to log out");
      return false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
};

export { AuthContext };