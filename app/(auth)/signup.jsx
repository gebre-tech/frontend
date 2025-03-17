// app/(auth)/Signup.jsx
import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from "react-native";
import axios from "axios";

const Signup = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignup = async () => {
    // Frontend validation
    if (!email || !username || !firstName || !lastName || !password || !confirmPassword) {
      Alert.alert("Error", "Please fill in all required fields.");
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await axios.post("http://127.0.0.1:8000/auth/register/", {
        username,
        email,
        first_name: firstName,
        last_name: lastName,
        password,
        password2: confirmPassword,
      });

      if (response.status === 201) {
        Alert.alert("Success", "Account created! Please log in.");
        navigation.navigate("Login");
      }
    } catch (error) {
      console.log("Signup error:", error);
      // Handle backend validation errors
      if (error.response?.data) {
        const errorData = error.response.data;
        if (typeof errorData === "object") {
          // Handle field-specific errors
          const errorMessages = Object.values(errorData).flat().join("\n");
          setError(errorMessages);
          Alert.alert("Signup Failed", errorMessages);
        } else if (errorData.detail) {
          // Handle generic error messages
          setError(errorData.detail);
          Alert.alert("Signup Failed", errorData.detail);
        }
      } else {
        setError("Signup failed. Please try again.");
        Alert.alert("Signup Failed", "Signup failed. Please try again.");
      }
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
        placeholder="Username *"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="First Name *"
        value={firstName}
        onChangeText={setFirstName}
      />
      <TextInput
        style={styles.input}
        placeholder="Last Name *"
        value={lastName}
        onChangeText={setLastName}
      />
      <TextInput
        style={styles.input}
        placeholder="Email *"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password *"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm Password *"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSignup}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign Up</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate("Login")}>
        <Text style={styles.signupLink}>Already have an account? Log in</Text>
      </TouchableOpacity>
      <Text style={styles.note}>* Required fields</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "#f5f5f5" },
  title: { fontSize: 32, fontWeight: "bold", marginBottom: 20, textAlign: "center", color: "#333" },
  input: { borderWidth: 1, padding: 15, marginBottom: 15, borderRadius: 8, borderColor: "#ddd", backgroundColor: "#fff" },
  error: { color: "red", marginBottom: 15, textAlign: "center" },
  button: { backgroundColor: "#007AFF", padding: 15, borderRadius: 8, alignItems: "center" },
  buttonDisabled: { backgroundColor: "#99ccff" },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  signupLink: { marginTop: 20, color: "#007AFF", textAlign: "center", textDecorationLine: "underline", fontSize: 16 },
  note: { marginTop: 10, color: "#666", textAlign: "center", fontSize: 12 },
});

export default Signup;