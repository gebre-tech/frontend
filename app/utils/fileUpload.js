// utils/fileUpload.js
export const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
  
      if (result.type === 'success') {
        // Read file as base64
        const fileContent = await FileSystem.readAsStringAsync(result.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        return {
          name: result.name,
          type: result.mimeType,
          size: result.size,
          uri: result.uri,
          data: fileContent,
        };
      }
      return null;
    } catch (error) {
      console.error('Error picking file:', error);
      return null;
    }
  };
  
  export const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });
  
      if (!result.canceled) {
        return {
          name: `image_${Date.now()}.jpg`,
          type: 'image/jpeg',
          size: result.assets[0].fileSize,
          uri: result.assets[0].uri,
          data: result.assets[0].base64,
        };
      }
      return null;
    } catch (error) {
      console.error('Error picking image:', error);
      return null;
    }
  };