import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import tw from 'twrnc';

class ErrorBoundary extends React.Component {
  state = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error) {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error details for debugging
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ errorInfo });
    // Optionally send error to a logging service
    // e.g., logToService(error, errorInfo);
  }

  handleTryAgain = () => {
    // Reset error state to attempt re-rendering
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={tw`flex-1 justify-center items-center bg-gray-100 dark:bg-gray-900 p-4`}>
          <Text style={tw`text-red-500 text-lg font-bold mb-4`}>Something went wrong</Text>
          <Text style={tw`text-gray-700 dark:text-gray-300 text-base mb-4 text-center`}>
            An error occurred while rendering this screen. Please try again.
          </Text>
          <TouchableOpacity
            onPress={this.handleTryAgain}
            style={tw`bg-blue-600 px-6 py-3 rounded-full shadow-md`}
            accessibilityLabel="Try again"
          >
            <Text style={tw`text-white text-base font-semibold`}>Try Again</Text>
          </TouchableOpacity>
          {__DEV__ && (
            <View style={tw`mt-4 max-w-full`}>
              <Text style={tw`text-gray-500 dark:text-gray-400 text-sm font-mono`}>
                Error: {this.state.error?.message || 'Unknown error'}
              </Text>
              <Text style={tw`text-gray-500 dark:text-gray-400 text-sm font-mono mt-2`}>
                Stack: {this.state.errorInfo?.componentStack?.slice(0, 200) || 'No stack trace'}
              </Text>
            </View>
          )}
        </View>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;