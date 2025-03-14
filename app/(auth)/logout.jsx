import React, { useContext, useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { AuthContext } from "../../context/AuthContext";
import { useNavigation } from "@react-navigation/native";

const LogoutScreen = () => {
  const { logout } = useContext(AuthContext);
  const navigation = useNavigation();

  useEffect(() => {
    const performLogout = async () => {
      const success = await logout();
      if (success) {
        navigation.reset({
          index: 0,
          routes: [{ name: "Login" }],
        });
      }
    };
    performLogout();
  }, [logout, navigation]);

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
    marginBottom: 20,
    color: "#333",
  },
});

export default LogoutScreen;