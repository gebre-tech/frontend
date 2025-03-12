// Code:messages/context/AuthContext.jsx
import React, { createContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

const API_URL = "http://127.0.0.1:8000"; // Replace with actual machine IP

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
      if (!token) return;

      const res = await axios.get(`${API_URL}/auth/profile/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setUser(res.data);
    } catch (error) {
      console.log("Auth check failed:", error);
      setError("Failed to check user authentication");
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API_URL}/auth/login/`, {
        email,
        password,
      });

      await AsyncStorage.setItem("token", res.data.access);
      await AsyncStorage.setItem("refresh", res.data.refresh);
      setUser(res.data.user); // Ensure Django returns user details
    } catch (error) {
      console.log("Login error:", error);
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  const logout = async (navigation) => {
    setLoading(true);
    try {
      await AsyncStorage.multiRemove(["token", "refresh"]); // ✅ Clear session data
      setUser(null); // ✅ Reset user state
      navigation.reset({ // ✅ Reset navigation to ensure user can't go back
        index: 0,
        routes: [{ name: "Login" }],
      });
    } catch (error) {
      console.log("Logout error:", error);
      setError("Failed to log out.");
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
