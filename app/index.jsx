// Code: index.jsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { ThemeProvider } from '../context/ThemeContext';
import Layout from './_layout';
const App = () => {
  return ( 
  
      <ThemeProvider>
      
        <NavigationContainer>
          <Layout />
        </NavigationContainer>
        
      </ThemeProvider>

  );
};

export default App;