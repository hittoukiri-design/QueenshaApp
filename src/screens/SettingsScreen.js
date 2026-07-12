import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar, Alert, Image, ScrollView, Modal, Linking, ActivityIndicator, Dimensions, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, auth, storage } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { collection, getDocs, doc, getDoc, writeBatch, deleteDoc, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadString } from 'firebase/storage';
import { configureGoogleSignIn, signInWithGoogle, signOutGoogle, findOrCreateAppFolder, uploadFileToGoogleDrive } from '../lib/googleDriveHelper';
import { triggerCloudBackup, LOCAL_XLSX_URI } from '../lib/backupEngine';
import { registerBackgroundBackupTask, unregisterBackgroundBackupTask } from '../lib/backgroundBackup';
import * as TaskManager from 'expo-task-manager';

export default function SettingsScreen({ navigation }) {
  const [userRole, setUserRole] = useState('kasir');
  const [permissions, setPermissions] = useState([]);
  const [userEmail, setUserEmail] = useState('');
  const [userId, setUserId] = useState(null);
  const [todaySales, setTodaySales] = useState(0);
  const [isClosingShift, setIsClosingShift] = useState(false);

  // Backup & About States
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupFreq, setBackupFreq] = useState('bulanan');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);

  const [googleEmail, setGoogleEmail] = useState(null);
  const [googleAccessToken, setGoogleAccessToken] = useState(null);
  const [syncProgress, setSyncProgress] = useState(null);
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const [lastBackupSize, setLastBackupSize] = useState(null);
  const [isAutoBackupActive, setIsAutoBackupActive] = useState(false);
  const [lastLocalBackupAt, setLastLocalBackupAt] = useState(null);
  const [lastLocalBackupSize, setLastLocalBackupSize] = useState(null);

  useEffect(() => {
    checkUserRole();
    configureGoogleSignIn();
    loadBackupSettings();
  }, []);

  const loadBackupSettings = async () => {
    try {
      const email = await AsyncStorage.getItem('GOOGLE_DRIVE_EMAIL');
      const token = await AsyncStorage.getItem('GOOGLE_DRIVE_TOKEN');
      const lastAt = await AsyncStorage.getItem('LAST_BACKUP_AT');
      const lastSize = await AsyncStorage.getItem('LAST_BACKUP_SIZE');
      const lastLocalAt = await AsyncStorage.getItem('LAST_LOCAL_BACKUP_AT');
      const lastLocalSize = await AsyncStorage.getItem('LAST_LOCAL_BACKUP_SIZE');
      if (email) setGoogleEmail(email);
      if (token) setGoogleAccessToken(token);
      if (lastAt) setLastBackupAt(lastAt);
      if (lastSize) setLastBackupSize(lastSize);
      if (lastLocalAt) setLastLocalBackupAt(lastLocalAt);
      if (lastLocalSize) setLastLocalBackupSize(lastLocalSize);

      try {
        const isBgRegistered = await TaskManager.isTaskRegisteredAsync('BACKGROUND_AUTO_BACKUP_TASK');
        setIsAutoBackupActive(isBgRegistered);
      } catch (bgErr) {
        console.error('TaskManager check error:', bgErr);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleAutoBackup = async (value) => {
    setIsAutoBackupActive(value);
    if (value) {
      await registerBackgroundBackupTask();
      Alert.alert('Backup Otomatis Aktif', 'Aplikasi akan melakukan pencadangan otomatis di latar belakang saat perangkat standby/idle (setiap 12 jam).');
    } else {
      await unregisterBackgroundBackupTask();
      Alert.alert('Backup Otomatis Dinonaktifkan', 'Pencadangan otomatis di latar belakang telah dimatikan.');
    }
  };

  const checkUserRole = async () => {
    const user = auth.currentUser;
    if (user) {
      setUserEmail(user.email);
      setUserId(user.uid);
      
      let currentRole = 'kasir';
      let currentPerms = [];
      const docSnap = await getDoc(doc(db, 'profiles', user.uid));
      if (docSnap.exists()) {
        currentRole = docSnap.data().role;
        currentPerms = docSnap.data().permissions || [];
      } else if (user.email === 'chris@tambayong.com') {
        currentRole = 'master';
      }
      setUserRole(currentRole);
      setPermissions(currentPerms);

      // Hitung penjualan hari ini untuk kasir/user ini
      const startOfDay = new Date();
      startOfDay.setHours(0,0,0,0);
      
      // Since complex queries might require indexes, we fetch all for this user and filter in memory
      const trxSnap = await getDocs(collection(db, 'transactions'));
      const trxData = trxSnap.docs.map(d => d.data());
      
      const userTrx = trxData.filter(t => t.kasir_id === user.uid && new Date(t.created_at) >= startOfDay);
      const total = userTrx.reduce((acc, curr) => acc + (curr.total_harga || 0), 0);
      setTodaySales(total);
    }
  };

  const handleCloseShift = async () => {
    Alert.alert(
      'Tutup Penjualan', 
      `Total penjualan Anda hari ini adalah Rp ${todaySales.toLocaleString('id-ID')}.\n\nApakah Anda yakin ingin menutup penjualan dan keluar?`, 
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Tutup & Keluar', style: 'destructive', onPress: async () => {
          setIsClosingShift(true);
          await signOut(auth);
        }}
      ]
    );
  };

  const handleResetTransactions = () => {
    Alert.alert(
      'Peringatan Keras',
      'Apakah Anda yakin ingin MENGHAPUS SEMUA DATA TRANSAKSI? Tindakan ini tidak dapat dibatalkan.',
      [
        { text: 'Batal', style: 'cancel' },
        { 
          text: 'Hapus Semua', 
          style: 'destructive', 
          onPress: async () => {
            try {
              // Hapus semua di collection transactions & transaction_items
              const trxSnap = await getDocs(collection(db, 'transactions'));
              const itemsSnap = await getDocs(collection(db, 'transaction_items'));
              
              const batch = writeBatch(db);
              trxSnap.docs.forEach(d => batch.delete(d.ref));
              itemsSnap.docs.forEach(d => batch.delete(d.ref));
              await batch.commit();
              
              Alert.alert('Sukses', 'Semua data transaksi berhasil dihapus.');
            } catch (err) {
              Alert.alert('Error', 'Gagal menghapus data transaksi.');
            }
          }
        }
      ]
    );
  };

  const handleConnectGoogleDrive = async () => {
    try {
      if (googleEmail) {
        await signOutGoogle();
        await AsyncStorage.removeItem('GOOGLE_DRIVE_EMAIL');
        await AsyncStorage.removeItem('GOOGLE_DRIVE_TOKEN');
        setGoogleEmail(null);
        setGoogleAccessToken(null);
        Alert.alert('Akun Diputuskan', 'Koneksi akun Google Drive berhasil diputuskan.');
      } else {
        const res = await signInWithGoogle();
        if (res && res.email) {
          await AsyncStorage.setItem('GOOGLE_DRIVE_EMAIL', res.email);
          if (res.accessToken) {
            await AsyncStorage.setItem('GOOGLE_DRIVE_TOKEN', res.accessToken);
            setGoogleAccessToken(res.accessToken);
          }
          setGoogleEmail(res.email);
          Alert.alert('Sukses', `Berhasil menghubungkan ke Google Drive: ${res.email}`);
        }
      }
    } catch (err) {
      Alert.alert('Koneksi Gagal', `Gagal menghubungkan Google Drive. Pastikan SHA-1 sudah terdaftar di Firebase Console. (Error: ${err.message})`);
    }
  };

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    setSyncProgress(0);
    try {
      const result = await triggerCloudBackup(progress => setSyncProgress(progress));
      
      if (result.success) {
        const sizeString = result.size;
        setLastBackupAt(result.timestamp);
        setLastBackupSize(sizeString);
        
        let driveMessage = "";
        if (result.driveUploaded) {
          driveMessage = "\n\n✓ Laporan Excel berhasil diunggah ke Google Drive.";
        } else if (googleEmail) {
          driveMessage = `\n\n✗ Gagal unggah ke Google Drive: ${result.driveError || 'Terjadi kesalahan'}`;
        }
        
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(LOCAL_XLSX_URI, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Simpan Laporan Excel',
          });
        }
        
        Alert.alert(
          'Backup Sukses',
          `Pencadangan berhasil dijalankan:${driveMessage}\n\n✓ JSON diunggah ke Firebase Storage.\n✓ File Excel dibuat (${sizeString}).`
        );
      } else {
        throw new Error(result.error);
      }
      setShowBackupModal(false);
    } catch (err) {
      Alert.alert('Gagal Backup', err.message);
    } finally {
      setIsBackingUp(false);
      setSyncProgress(null);
    }
  };

  const handleRestoreData = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (result.canceled) return;
      
      const fileUri = result.assets[0].uri;
      const fileContent = await FileSystem.readAsStringAsync(fileUri);
      const backupData = JSON.parse(fileContent);

      Alert.prompt(
        'Konfirmasi RESTORE',
        'Restore backup akan menimpa data toko saat ini. Tindakan ini tidak dapat dibatalkan.\n\nKetik RESTORE untuk melanjutkan.',
        [
          { text: 'Batal', style: 'cancel' },
          { 
            text: 'Restore', 
            style: 'destructive',
            onPress: async (text) => {
              if (text !== 'RESTORE') {
                Alert.alert('Gagal', 'Teks konfirmasi tidak cocok.');
                return;
              }
              
              try {
                // Upsert data secara bertahap
                const batch = writeBatch(db);
                if (backupData.kategori) backupData.kategori.forEach(item => batch.set(doc(db, 'categories', item.id), item));
                if (backupData.stok_barang) backupData.stok_barang.forEach(item => batch.set(doc(db, 'products', item.id), item));
                if (backupData.transaksi) backupData.transaksi.forEach(item => batch.set(doc(db, 'transactions', item.id), item));
                if (backupData.transaksi_items) backupData.transaksi_items.forEach(item => batch.set(doc(db, 'transaction_items', item.id), item));
                await batch.commit();

                Alert.alert('Sukses', 'Data berhasil di-restore dari backup.');
              } catch (restoreErr) {
                Alert.alert('Error Restore', restoreErr.message);
              }
            }
          }
        ]
      );
    } catch (err) {
      Alert.alert('Error', 'Gagal membaca file backup.');
    }
  };

  const handleDeleteCurrentMonth = () => {
    Alert.alert(
      'Hapus Transaksi Bulan Ini',
      'Pastikan Anda sudah melakukan backup ke Google Drive. Apakah Anda yakin ingin menghapus data transaksi bulan ini demi menghemat penyimpanan?',
      [
        { text: 'Batal', style: 'cancel' },
        { 
          text: 'Hapus', 
          style: 'destructive', 
          onPress: async () => {
            try {
              const now = new Date();
              const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
              
              const trxSnap = await getDocs(collection(db, 'transactions'));
              const itemsSnap = await getDocs(collection(db, 'transaction_items'));
              
              const trxsToDelete = trxSnap.docs.filter(d => new Date(d.data().created_at) >= new Date(firstDay));
              const trxIds = trxsToDelete.map(d => d.id);
              const itemsToDelete = itemsSnap.docs.filter(d => trxIds.includes(d.data().transaction_id));
              
              const batch = writeBatch(db);
              trxsToDelete.forEach(d => batch.delete(d.ref));
              itemsToDelete.forEach(d => batch.delete(d.ref));
              await batch.commit();
              
              Alert.alert('Sukses', 'Data transaksi bulan ini berhasil dihapus.');
            } catch (err) {
              Alert.alert('Error', 'Gagal menghapus data: ' + err.message);
            }
          }
        }
      ]
    );
  };

  const handleOpenWA = () => {
    Linking.openURL('whatsapp://send?phone=+628999787787').catch(() => {
      Alert.alert('Error', 'Aplikasi WhatsApp tidak terinstall.');
    });
  };

  const handleOpenEmail = () => {
    Linking.openURL('mailto:Chris@tambayong.com').catch(() => {
      Alert.alert('Error', 'Tidak dapat membuka aplikasi email.');
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lainnya</Text>
      </View>

      <View style={styles.content}>
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          <View style={styles.profileSection}>
            <Image 
              source={
                userEmail === 'chris@tambayong.com'
                  ? require('../../assets/master.jpg')
                  : userRole === 'owner' || userRole === 'master'
                    ? require('../../assets/owner.jpg')
                    : require('../../assets/kasir.jpg')
              }
              style={{ width: 60, height: 60, borderRadius: 30, marginRight: 16 }}
            />
            <View>
              <Text style={styles.profileEmail}>{userEmail}</Text>
              <Text style={styles.profileRole}>Mode: {userEmail === 'chris@tambayong.com' ? 'MASTER APP' : userRole.toUpperCase() === 'STAFF' ? 'KASIR' : userRole.toUpperCase()}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Pengaturan Sistem</Text>
          
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('PrinterSettings')}>
            <View style={[styles.menuIconBg, {backgroundColor: '#2563EB'}]}>
              <Ionicons name="print" size={24} color="#FFF" />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={styles.menuText}>Atur Printer</Text>
              <Text style={styles.menuSubText}>Hubungkan printer bluetooth kasir</Text>
            </View>
          </TouchableOpacity>

          {(userRole === 'master' || userRole === 'owner' || permissions.includes('menu_history')) && (
            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('History')}>
              <View style={[styles.menuIconBg, {backgroundColor: '#16A34A'}]}>
                <Ionicons name="receipt" size={24} color="#FFF" />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={styles.menuText}>Riwayat Penjualan</Text>
                <Text style={styles.menuSubText}>Cek laporan dan detail transaksi</Text>
              </View>
            </TouchableOpacity>
          )}

          {userRole === 'master' && (
            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('MasterPanel')}>
              <View style={[styles.menuIconBg, {backgroundColor: '#111827'}]}>
                <Ionicons name="shield-checkmark" size={24} color="#FFF" />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={styles.menuText}>Master Panel</Text>
                <Text style={styles.menuSubText}>Kelola Owner Khusus Master</Text>
              </View>
            </TouchableOpacity>
          )}

          {(userRole === 'owner' || userRole === 'master') && (
            <TouchableOpacity style={styles.menuItem} onPress={handleRestoreData}>
              <View style={[styles.menuIconBg, {backgroundColor: '#FEF3C7'}]}>
                <Ionicons name="cloud-download" size={24} color="#D97706" />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={styles.menuText}>Restore Data</Text>
                <Text style={styles.menuSubText}>Kembalikan dari Backup JSON</Text>
              </View>
            </TouchableOpacity>
          )}

          {(userRole === 'master' || userRole === 'owner' || permissions.includes('menu_users')) && (
            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Users')}>
              <View style={[styles.menuIconBg, {backgroundColor: '#0284C7'}]}>
                <Ionicons name="people" size={24} color="#FFF" />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={styles.menuText}>Manajemen Pengguna</Text>
                <Text style={styles.menuSubText}>Atur staf kasir dan hak akses</Text>
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowAboutModal(true)}>
            <View style={[styles.menuIconBg, {backgroundColor: '#8B5CF6'}]}>
              <Ionicons name="information-circle" size={24} color="#FFF" />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={styles.menuText}>Tentang Aplikasi</Text>
              <Text style={styles.menuSubText}>Info developer & bantuan</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowBackupModal(true)}>
            <View style={[styles.menuIconBg, {backgroundColor: '#10B981'}]}>
              <Ionicons name="cloud-upload" size={24} color="#FFF" />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={styles.menuText}>Pusat Pencadangan (Backup)</Text>
              <Text style={styles.menuSubText}>Pencadangan Firebase, Drive & Lokal</Text>
            </View>
          </TouchableOpacity>

          {userRole !== 'kasir' && (
            <TouchableOpacity style={styles.menuItem} onPress={handleDeleteCurrentMonth}>
              <View style={[styles.menuIconBg, {backgroundColor: '#F59E0B'}]}>
                <Ionicons name="calendar-clear" size={24} color="#FFF" />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={styles.menuText}>Hapus Transaksi Bulan Ini</Text>
                <Text style={styles.menuSubText}>Hemat penyimpanan aplikasi</Text>
              </View>
            </TouchableOpacity>
          )}

          {userRole === 'master' && (
            <TouchableOpacity style={styles.menuItem} onPress={handleResetTransactions}>
              <View style={[styles.menuIconBg, {backgroundColor: '#EF4444'}]}>
                <Ionicons name="trash-bin" size={24} color="#FFF" />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={[styles.menuText, {color: '#EF4444'}]}>Reset Data Transaksi</Text>
                <Text style={styles.menuSubText}>Hapus seluruh data penjualan</Text>
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.menuItem, {marginTop: 16}]} onPress={handleCloseShift} disabled={isClosingShift}>
            <View style={[styles.menuIconBg, {backgroundColor: '#EF4444'}]}>
              <Ionicons name="power" size={24} color="#FFF" />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={[styles.menuText, {color: '#EF4444'}]}>
                {isClosingShift ? 'Memproses...' : 'Tutup Penjualan'}
              </Text>
              <Text style={styles.menuSubText}>Tutup shift dan keluar aplikasi</Text>
            </View>
          </TouchableOpacity>
        </ScrollView>

        {/* FIXED FLOATING ROUNDED RECTANGLE FOOTER */}
        <View style={styles.floatingFooter}>
          <Text style={{ fontSize: 11, color: '#6B7280', marginBottom: 2 }}>
            Designed by <Text style={{ fontWeight: 'bold', color: '#0284C7' }}>© Chris Tambayong</Text>
          </Text>
          <Text style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 2 }}>
            Created for Toko Queensha™
          </Text>
          <Text style={{ fontSize: 9, color: '#9CA3AF' }}>
            Denpasar 2026
          </Text>
          <Text style={{ fontSize: 9, color: '#9CA3AF', marginTop: 4 }}>
            Versi Aplikasi: {require('../../package.json').version}
          </Text>
        </View>

      </View>

      {/* Modal Tentang Aplikasi */}
      <Modal visible={showAboutModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={{ maxHeight: '85%' }} showsVerticalScrollIndicator={true} contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>Tentang Aplikasi Ini</Text>
            
            <Text style={{ fontSize: 14, color: '#374151', lineHeight: 22, marginBottom: 12 }}>
              <Text style={{ fontWeight: 'bold' }}>Queensha App</Text> adalah aplikasi kasir dan manajemen toko retail yang dibuat untuk membantu operasional bisnis menjadi lebih mudah, cepat, dan rapi.
            </Text>
            
            <Text style={{ fontSize: 14, color: '#374151', lineHeight: 22, marginBottom: 12 }}>
              Melalui aplikasi ini, pengguna dapat mengelola produk, mencatat transaksi, memantau stok barang, melihat laporan penjualan, serta mendukung aktivitas kasir harian dengan sistem yang lebih modern dan praktis.
            </Text>

            <Text style={{ fontSize: 14, color: '#374151', lineHeight: 22, marginBottom: 12 }}>
              Aplikasi ini dikembangkan oleh <Text style={{ fontWeight: 'bold' }}>Chris Tambayong</Text>, seorang Web, iOS, dan Android Developer yang berfokus pada pembuatan solusi digital untuk kebutuhan bisnis. Dengan pengalaman dalam pengembangan website, aplikasi mobile, sistem kasir, dan platform digital custom, Chris membangun aplikasi yang tidak hanya terlihat modern, tetapi juga mudah digunakan dan sesuai dengan kebutuhan nyata di lapangan.
            </Text>

            <Text style={{ fontSize: 14, color: '#374151', lineHeight: 22, marginBottom: 16 }}>
              Queensha App dibuat sebagai contoh solusi digital sederhana namun fungsional untuk membantu pelaku usaha bekerja lebih efisien, terlihat lebih profesional, dan siap berkembang mengikuti era digital.
            </Text>

            <View style={{ backgroundColor: '#F3F4F6', padding: 16, borderRadius: 12, marginBottom: 20 }}>
              <Text style={{ fontSize: 13, color: '#4B5563', marginBottom: 12 }}>
                Ingin dibuatkan aplikasi serupa seperti Queensha App, atau membutuhkan website bisnis dengan harga bersahabat?
              </Text>
              
              <TouchableOpacity onPress={handleOpenWA} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <Ionicons name="logo-whatsapp" size={20} color="#16A34A" style={{ marginRight: 8 }} />
                <Text style={{ fontSize: 14, color: '#1D4ED8', fontWeight: 'bold', textDecorationLine: 'underline' }}>+62 8999 787 787</Text>
              </TouchableOpacity>
              
              <TouchableOpacity onPress={handleOpenEmail} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="mail" size={20} color="#EF4444" style={{ marginRight: 8 }} />
                <Text style={{ fontSize: 14, color: '#1D4ED8', fontWeight: 'bold', textDecorationLine: 'underline' }}>Chris@tambayong.com</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.closeModalBtn} onPress={() => setShowAboutModal(false)}>
              <Text style={styles.closeModalText}>Tutup</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
      {/* Modal Backup Google Drive */}
      <Modal visible={showBackupModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <Ionicons name="cloud-upload" size={24} color="#166534" style={{ marginRight: 8 }} />
              <Text style={styles.modalTitle}>Pusat Pencadangan (Backup)</Text>
            </View>
            
            <Text style={{ fontSize: 13, color: '#4B5563', marginBottom: 16, lineHeight: 18 }}>
              Sistem akan mencadangkan seluruh data penjualan, stok, dan kategori secara otomatis ke Firebase Storage (JSON), Google Drive (Excel), and penyimpanan lokal tablet.
            </Text>

            {/* Google Drive Status */}
            <View style={{ backgroundColor: '#F3F4F6', padding: 12, borderRadius: 8, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={{ fontSize: 11, color: '#166534', fontWeight: 'bold' }}>Akun Google Drive</Text>
                  <Text style={{ fontSize: 13, color: '#1F2937', fontWeight: 'bold', marginTop: 2 }}>
                    {googleEmail || "Belum terhubung"}
                  </Text>
                </View>
                <TouchableOpacity 
                  style={{ 
                    backgroundColor: googleEmail ? '#FEE2E2' : '#E0E7FF', 
                    paddingHorizontal: 12, 
                    paddingVertical: 6, 
                    borderRadius: 6 
                  }} 
                  onPress={handleConnectGoogleDrive}
                  disabled={isBackingUp}
                >
                  <Text style={{ fontSize: 11, fontWeight: 'bold', color: googleEmail ? '#EF4444' : '#4F46E5' }}>
                    {googleEmail ? "Putuskan" : "Hubungkan"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Auto Backup Toggle Switch */}
            <View style={{ backgroundColor: '#F3F4F6', padding: 12, borderRadius: 8, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontSize: 11, color: '#166534', fontWeight: 'bold' }}>Backup Otomatis (Standby)</Text>
                  <Text style={{ fontSize: 11, color: '#4B5563', marginTop: 2 }}>
                    Backup ke Firebase & Drive setiap 12 jam saat standby
                  </Text>
                </View>
                <Switch 
                  value={isAutoBackupActive} 
                  onValueChange={handleToggleAutoBackup}
                  trackColor={{ false: '#D1D5DB', true: '#A7F3D0' }}
                  thumbColor={isAutoBackupActive ? '#166534' : '#9CA3AF'}
                />
              </View>
            </View>

            {/* Local Backup Status */}
            {lastLocalBackupAt && (
              <View style={{ backgroundColor: '#F3F4F6', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <Text style={{ fontSize: 11, color: '#166534', fontWeight: 'bold' }}>Auto-Backup Lokal Terakhir (HP/Tablet)</Text>
                <Text style={{ fontSize: 13, color: '#1F2937', fontWeight: 'bold', marginTop: 2 }}>
                  {lastLocalBackupAt} ({lastLocalBackupSize || "-"})
                </Text>
              </View>
            )}

            {/* Last Backup Info */}
            {lastBackupAt && (
              <View style={{ backgroundColor: '#F3F4F6', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                <Text style={{ fontSize: 11, color: '#6B7280' }}>Backup Cloud Terakhir</Text>
                <Text style={{ fontSize: 13, color: '#1F2937', fontWeight: 'bold', marginTop: 2 }}>
                  {lastBackupAt} ({lastBackupSize || "-"})
                </Text>
              </View>
            )}

            {/* Linear Progress Bar */}
            {isBackingUp && syncProgress !== null && (
              <View style={{ width: '100%', marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 11, color: '#4B5563' }}>
                    {syncProgress < 30 ? "Mengambil data Firestore..." :
                     syncProgress < 45 ? "Menulis JSON lokal..." :
                     syncProgress < 60 ? "Mengunggah ke Firebase Storage..." :
                     syncProgress < 75 ? "Membuat spreadsheet Excel..." :
                     syncProgress < 95 ? "Mengunggah Excel ke Google Drive..." :
                     "Hampir selesai..."}
                  </Text>
                  <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#166534' }}>{syncProgress}%</Text>
                </View>
                <View style={{ height: 6, backgroundColor: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${syncProgress}%`, backgroundColor: '#166534' }} />
                </View>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowBackupModal(false)} disabled={isBackingUp}>
                <Text style={styles.modalCancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalConfirmBtn, { backgroundColor: isBackingUp ? '#9CA3AF' : '#166534' }]} 
                onPress={handleBackupNow} 
                disabled={isBackingUp}
              >
                <Text style={styles.modalConfirmText}>Backup Sekarang</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const isTablet = Math.min(screenWidth, screenHeight) >= 600;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F9FAFB', paddingTop: (Platform.OS === 'android' && !isTablet) ? StatusBar.currentHeight : 0 },
  header: { padding: 24, paddingBottom: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#111827' },
  content: { flex: 1, padding: 16 },
  
  profileSection: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: '#E5E7EB' },
  profileIconBg: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#DCFCE7', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  profileEmail: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  profileRole: { fontSize: 12, color: '#166534', fontWeight: '600' },

  sectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#6B7280', marginBottom: 12, marginLeft: 4, textTransform: 'uppercase' },
  
  menuItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingVertical: 10, paddingHorizontal: 8, marginBottom: 8, borderRadius: 16 },
  menuIconBg: { width: 44, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  menuTextContainer: { flex: 1, justifyContent: 'center' },
  menuText: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 2 },
  menuSubText: { fontSize: 13, color: '#6B7280' },
  floatingFooter: {
    position: 'absolute',
    bottom: 20,
    left: 24,
    right: 24,
    backgroundColor: '#FFF',
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#FFF', borderRadius: 20, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  closeModalBtn: { backgroundColor: '#F3F4F6', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  closeModalText: { color: '#4B5563', fontWeight: 'bold', fontSize: 16 },
  
  freqBtn: { flex: 1, backgroundColor: '#F3F4F6', paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  freqBtnActive: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  freqText: { fontSize: 12, fontWeight: 'bold', color: '#6B7280' },
  freqTextActive: { color: '#FFF' },
  
  modalCancelBtn: { flex: 1, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 12 },
  modalCancelText: { color: '#4B5563', fontWeight: 'bold', fontSize: 16 },
  modalConfirmBtn: { flex: 1, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#10B981', borderRadius: 12 },
  modalConfirmText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
});
