// Code: index.jsx
import  'react-native-get-random-values'
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { ThemeProvider } from '../context/ThemeContext';
import Layout from './_layout';
const App = () => {
  return ( 
    <GestureHandlerRootView style={{ flex: 1 }}>
       <SafeAreaProvider>
      <ThemeProvider>
      
        <NavigationContainer>
          <Layout />
        </NavigationContainer>
        
      </ThemeProvider>
    </SafeAreaProvider>
</GestureHandlerRootView>
  );
};

export default App;