import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as FileSystem from 'expo-file-system';

// Configure Google Sign-In with Web Client ID from google-services.json
export const configureGoogleSignIn = () => {
  GoogleSignin.configure({
    webClientId: '402055283365-va99v4n6ed17avhk6j9s8qttf053f5kl.apps.googleusercontent.com',
    offlineAccess: true,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
};

/**
 * Perform sign-in and return user details and accessToken.
 */
export const signInWithGoogle = async () => {
  try {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();
    
    // Get access token for REST API calls
    const { accessToken } = await GoogleSignin.getTokens();
    
    // Compatibility check for different Google Sign-In library versions
    const userEmail = userInfo.data?.user?.email || userInfo.user?.email || '';
    
    return {
      email: userEmail,
      accessToken
    };
  } catch (error) {
    console.error('Google Sign-In Error:', error);
    throw error;
  }
};

/**
 * Sign out of Google.
 */
export const signOutGoogle = async () => {
  try {
    await GoogleSignin.signOut();
  } catch (error) {
    console.error('Google Sign-Out Error:', error);
    throw error;
  }
};

/**
 * Search for a folder in Google Drive. If it doesn't exist, create it.
 */
export const findOrCreateAppFolder = async (accessToken) => {
  const folderName = 'Queensha App Backups';
  
  // 1. Search for existing folder
  const queryUrl = `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(folderName)}'+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id)`;
  
  const searchResponse = await fetch(queryUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!searchResponse.ok) {
    throw new Error(`Failed to search folder: ${searchResponse.statusText}`);
  }

  const searchData = await searchResponse.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // 2. Create folder if not found
  const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });

  if (!createResponse.ok) {
    throw new Error(`Failed to create folder: ${createResponse.statusText}`);
  }

  const createData = await createResponse.json();
  return createData.id;
};

/**
 * Upload a local file to Google Drive (2-step: media upload + metadata patch).
 */
export const uploadFileToGoogleDrive = async (accessToken, folderId, fileUri, fileName, mimeType) => {
  try {
    // Step 1: Upload media content to Google Drive (BINARY_CONTENT)
    const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=media';
    const uploadResult = await FileSystem.uploadAsync(uploadUrl, fileUri, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': mimeType
      },
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT
    });

    if (uploadResult.status !== 200) {
      throw new Error(`Upload failed with status ${uploadResult.status}: ${uploadResult.body}`);
    }

    const fileId = JSON.parse(uploadResult.body).id;

    // Step 2: Update file metadata (name & parent folder)
    const patchUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${folderId}`;
    const patchResponse = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: fileName
      })
    });

    if (!patchResponse.ok) {
      throw new Error(`Failed to update metadata: ${patchResponse.statusText}`);
    }

    return true;
  } catch (error) {
    console.error('Upload to Google Drive Error:', error);
    throw error;
  }
};

/**
 * Sign in silently to refresh access tokens in the background.
 */
export const signInSilentlyWithGoogle = async () => {
  try {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signInSilently();
    const { accessToken } = await GoogleSignin.getTokens();
    const userEmail = userInfo.data?.user?.email || userInfo.user?.email || '';
    return {
      email: userEmail,
      accessToken
    };
  } catch (error) {
    console.error('Google Sign-In Silently Error:', error);
    throw error;
  }
};
