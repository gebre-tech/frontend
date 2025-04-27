// app/(auth)/Signup.jsx
import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from "react-native";
import axios from "axios";
import { API_URL } from "../utils/constants";
import { Buffer } from 'buffer';
import { x25519 } from '@noble/curves/ed25519';
import AsyncStorage from '@react-native-async-storage/async-storage';

async function generateKeyPair() {
  const privateKey = Buffer.from(x25519.utils.randomPrivateKey());
  const publicKey = Buffer.from(x25519.getPublicKey(privateKey));
  return { privateKey, publicKey };
}

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
      const { privateKey, publicKey } = await generateKeyPair();
      const publicKeyHex = publicKey.toString('hex');
      const privateKeyHex = privateKey.toString('hex');

      await Promise.all([
        AsyncStorage.setItem(`private_key_${email}`, privateKeyHex),
        AsyncStorage.setItem(`public_key_${email}`, publicKeyHex)
      ]);
      
      // Verify storage by retrieving keys
      const [storedPrivateKey, storedPublicKey] = await Promise.all([
        AsyncStorage.getItem(`private_key_${email}`),
        AsyncStorage.getItem(`public_key_${email}`),
      ]);

      console.log('Stored Private Key:', storedPrivateKey);
      console.log('Stored Public Key:', storedPublicKey);
      console.log('Keys Match:', storedPrivateKey === privateKeyHex && storedPublicKey === publicKeyHex);

      const response = await axios.post(`${API_URL}/auth/register/`, {
        username,
        email,
        first_name: firstName,
        last_name: lastName,
        password,
        password2: confirmPassword,
        public_key: publicKeyHex,
      });

      if (response.status === 201) {
        Alert.alert("Success", "Account created! Please log in.");
        navigation.navigate("Login");
      }
    } catch (error) {
      console.log("Signup error:", error);
      await Promise.all([
        AsyncStorage.removeItem(`private_key_${email}`),
        AsyncStorage.removeItem(`public_key_${email}`),
      ]);
      if (error.response?.data) {
        const errorData = error.response.data;
        if (typeof errorData === "object") {
          const errorMessages = Object.values(errorData).flat().join("\n");
          setError(errorMessages);
          Alert.alert("Signup Failed", errorMessages);
        } else if (errorData.detail) {
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