import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadString } from 'firebase/storage';
import { db, storage } from './firebase';
import { generateExcelBase64 } from './excelExporter';
import { signInSilentlyWithGoogle, findOrCreateAppFolder, uploadFileToGoogleDrive } from './googleDriveHelper';

// Stable local file paths
export const LOCAL_JSON_URI = FileSystem.documentDirectory + 'local_backup.json';
export const LOCAL_XLSX_URI = FileSystem.documentDirectory + 'local_backup.xlsx';

/**
 * Silent local backup of Firestore data to local storage.
 * Runs instantly in the background without user prompt or UI block.
 */
export const triggerSilentLocalBackup = async () => {
  try {
    let trxData = [];
    let trxItemsData = [];
    let stockData = [];
    let catData = [];

    // Try to get fresh data from Firestore
    try {
      trxData = (await getDocs(collection(db, 'transactions'))).docs.map(d => ({ id: d.id, ...d.data() }));
      trxItemsData = (await getDocs(collection(db, 'transaction_items'))).docs.map(d => ({ id: d.id, ...d.data() }));
      stockData = (await getDocs(collection(db, 'products'))).docs.map(d => ({ id: d.id, ...d.data() }));
      catData = (await getDocs(collection(db, 'categories'))).docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (dbErr) {
      console.warn('Silent Backup: Offline or Firestore error, falling back to cache:', dbErr);
      // Fallback: Read cache if database is unreachable (offline)
      const cachedProducts = await AsyncStorage.getItem('PRODUCTS');
      const cachedCats = await AsyncStorage.getItem('CATEGORIES');
      if (cachedProducts) stockData = JSON.parse(cachedProducts);
      if (cachedCats) catData = JSON.parse(cachedCats).filter(c => c.id !== '1'); // Exclude 'Semua' pill
    }

    const backupObj = {
      tanggal_backup: new Date().toISOString(),
      transaksi: trxData,
      transaksi_items: trxItemsData,
      stok_barang: stockData,
      kategori: catData
    };

    // Save JSON
    const jsonStr = JSON.stringify(backupObj, null, 2);
    await FileSystem.writeAsStringAsync(LOCAL_JSON_URI, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });

    // Save Excel
    const xlsxBase64 = generateExcelBase64(catData, stockData, trxData, trxItemsData);
    await FileSystem.writeAsStringAsync(LOCAL_XLSX_URI, xlsxBase64, { encoding: FileSystem.EncodingType.Base64 });

    // Measure Size
    const fileInfo = await FileSystem.getInfoAsync(LOCAL_XLSX_URI);
    const fileSizeKb = (fileInfo.size || 0) / 1024;
    const sizeString = fileSizeKb > 1024 ? `${(fileSizeKb / 1024).toFixed(2)} MB` : `${fileSizeKb.toFixed(1)} KB`;

    // Save metadata
    const currentTimeStr = new Date().toLocaleString('id-ID', { hour12: false }).replace(/\//g, '-');
    await AsyncStorage.setItem('LAST_LOCAL_BACKUP_AT', currentTimeStr);
    await AsyncStorage.setItem('LAST_LOCAL_BACKUP_SIZE', sizeString);

    console.log('Silent local backup finished successfully at:', currentTimeStr, 'size:', sizeString);
    return { success: true, timestamp: currentTimeStr, size: sizeString };
  } catch (error) {
    console.error('Silent Local Backup Error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Standby Cloud backup to Google Drive and Firebase Storage.
 * Designed to be called either from manual button click or background fetch worker.
 */
export const triggerCloudBackup = async (progressCallback = () => {}) => {
  try {
    progressCallback(10);
    // Ensure local backup is refreshed
    const localRes = await triggerSilentLocalBackup();
    if (!localRes.success) {
      throw new Error(`Local backup step failed: ${localRes.error}`);
    }

    const sizeString = localRes.size;
    const timestamp = new Date().toISOString().split('T')[0] + '_' + new Date().toTimeString().split(' ')[0].replace(/:/g, '');

    progressCallback(30);
    // 1. Upload JSON to Firebase Storage
    const jsonStr = await FileSystem.readAsStringAsync(LOCAL_JSON_URI, { encoding: FileSystem.EncodingType.UTF8 });
    const jsonFileName = `Queensha_Backup_${timestamp}.json`;
    const fStorageRef = storageRef(storage, `backups/${jsonFileName}`);
    await uploadString(fStorageRef, jsonStr);
    progressCallback(60);

    // 2. Upload Excel to Google Drive
    let driveUploaded = false;
    let driveError = null;
    const googleEmail = await AsyncStorage.getItem('GOOGLE_DRIVE_EMAIL');
    if (googleEmail) {
      try {
        progressCallback(75);
        // Refresh token silently in background
        const { accessToken } = await signInSilentlyWithGoogle();
        progressCallback(85);
        const folderId = await findOrCreateAppFolder(accessToken);
        progressCallback(95);
        const xlsxFileName = `Queensha_Laporan_Stok_${timestamp}.xlsx`;
        await uploadFileToGoogleDrive(accessToken, folderId, LOCAL_XLSX_URI, xlsxFileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        driveUploaded = true;
      } catch (err) {
        console.error('Cloud Backup: Google Drive background upload failed:', err);
        driveError = err.message;
      }
    }

    progressCallback(100);
    const currentTimeStr = new Date().toLocaleString('id-ID', { hour12: false }).replace(/\//g, '-');
    await AsyncStorage.setItem('LAST_BACKUP_AT', currentTimeStr);
    await AsyncStorage.setItem('LAST_BACKUP_SIZE', sizeString);

    return {
      success: true,
      timestamp: currentTimeStr,
      size: sizeString,
      driveUploaded,
      driveError
    };
  } catch (error) {
    console.error('Cloud Backup Error:', error);
    return { success: false, error: error.message };
  }
};
