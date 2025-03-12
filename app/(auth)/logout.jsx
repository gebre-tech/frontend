import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';

const LogoutScreen = () => {
  const navigation = useNavigation();

  useEffect(() => {
    const performLogout = async () => {
      await AsyncStorage.clear(); // ✅ Clear all stored data
      navigation.reset({ index: 0, routes: [{ name: "Login" }] }); // ✅ Navigate to Login
    };

    performLogout();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Logging Out...</Text>
      <ActivityIndicator size="large" color="#1a73e8" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  text: {
    fontSize: 18,
    marginBottom: 10,
  },
});

export default LogoutScreen;
