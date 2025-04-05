import React from 'react';
import { View, Text } from 'react-native';
import tw from 'twrnc';
 import { Video } from 'expo-av';
const VideoMessage = ({ uri }) => {
  return (
    <View style={tw`w-48 h-48 rounded-lg bg-gray-200 justify-center items-center`}>
      <Text style={tw`text-gray-500`}>Video: {uri}</Text>
        {/* Assuming you have a Video component from expo-av or similar */}
        {/* You need to install expo-av if you haven't already */}
        {/* npm install expo-av */}                 
     
      <Video
        source={{ uri }}
        rate={1.0}
        volume={1.0}
        isMuted={false}
        resizeMode="contain"
        shouldPlay
        isLooping
        style={tw`w-48 h-48 rounded-lg`}
      />
      
    </View>
  );
};

export default VideoMessage;