import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet, Alert, TouchableOpacity } from "react-native";
import axios from "axios";

const Signup = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignup = async () => {
    if (!email || !username || !password) {
      Alert.alert("Please fill in all fields.");
      return;
    }
  
    setLoading(true);
    setError("");
  
    try {
      await axios.post("http://127.0.0.1:8000/auth/register/", {
        email,
        username,
        password,
      });
  
      Alert.alert("Signup successful!", "You can now log in.", [
        { text: "OK", onPress: () => navigation.replace("Login") }, // Use replace to avoid going back to Signup
      ]);
    } catch (error) {
      console.log("Signup error:", error);
      setError("Signup failed. Please try again.");
      Alert.alert("Signup failed", "Please try again.");
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign Up</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <TextInput
        style={styles.input}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Button title={loading ? "Signing Up..." : "Sign Up"} onPress={handleSignup} disabled={loading} />
      <TouchableOpacity onPress={() => navigation.navigate("Login")}>
        <Text style={styles.signupLink}>
          Already have an account? Log in
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 20 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 20 },
  input: { borderWidth: 1, padding: 10, marginBottom: 10 },
  error: { color: "red", marginBottom: 10 },
  signupLink: { marginTop: 20, color: "blue", textAlign: "center", textDecorationLine: "underline" },
});

export default Signup;