import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, PermissionsAndroid, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BluetoothManager } from 'react-native-thermal-receipt-printer-image-qr';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function PrinterSettingsScreen({ navigation }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [boundAddress, setBoundAddress] = useState(null);

  useEffect(() => {
    checkPermissions();
    loadSavedPrinter();
  }, []);

  const checkPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        if (granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED) {
          // Permssions granted
        }
      } catch (err) {
        console.warn(err);
      }
    }
  };

  const loadSavedPrinter = async () => {
    const savedPrinter = await AsyncStorage.getItem('saved_printer_mac');
    if (savedPrinter) {
      setBoundAddress(savedPrinter);
    }
  };

  const enableBluetooth = async () => {
    try {
      await BluetoothManager.enableBluetooth();
      Alert.alert('Sukses', 'Bluetooth berhasil dinyalakan.');
    } catch (err) {
      Alert.alert('Error', 'Gagal menyalakan Bluetooth.');
    }
  };

  const scanDevices = async () => {
    setLoading(true);
    setDevices([]);
    try {
      const res = await BluetoothManager.scanDevices();
      const parsedDevices = JSON.parse(res);
      const allDevices = [...(parsedDevices.paired || []), ...(parsedDevices.found || [])];
      
      // Remove duplicates
      const uniqueDevices = Array.from(new Set(allDevices.map(a => a.address)))
        .map(address => {
          return allDevices.find(a => a.address === address);
        });

      setDevices(uniqueDevices);
    } catch (err) {
      Alert.alert('Error', 'Gagal mencari perangkat Bluetooth: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const connectDevice = async (device) => {
    setLoading(true);
    try {
      await BluetoothManager.connect(device.address);
      setBoundAddress(device.address);
      await AsyncStorage.setItem('saved_printer_mac', device.address);
      Alert.alert('Berhasil', 'Printer terhubung: ' + (device.name || device.address));
    } catch (err) {
      Alert.alert('Gagal Koneksi', err.message);
    } finally {
      setLoading(false);
    }
  };

  const disconnectDevice = async () => {
    if (!boundAddress) return;
    try {
      // Library automatically manages connections on next print, but we can clear bound address
      await AsyncStorage.removeItem('saved_printer_mac');
      setBoundAddress(null);
      Alert.alert('Info', 'Koneksi printer diputuskan dari aplikasi.');
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Koneksi Printer (Native)</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>Status Printer Terhubung:</Text>
          <Text style={styles.statusValue}>{boundAddress ? boundAddress : 'Belum Ada Printer'}</Text>
          {boundAddress && (
            <TouchableOpacity style={styles.disconnectBtn} onPress={disconnectDevice}>
              <Text style={styles.disconnectBtnText}>Putuskan</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={enableBluetooth}>
            <Ionicons name="bluetooth" size={20} color="#FFF" />
            <Text style={styles.actionBtnText}>Aktifkan Bluetooth</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={scanDevices} disabled={loading}>
            {loading ? <ActivityIndicator color="#FFF" /> : <Ionicons name="search" size={20} color="#FFF" />}
            <Text style={styles.actionBtnText}>Cari Perangkat</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.listTitle}>Perangkat Ditemukan:</Text>

        <FlatList
          data={devices}
          keyExtractor={(item, index) => item.address || index.toString()}
          ListEmptyComponent={<Text style={styles.emptyText}>Tekan 'Cari Perangkat' untuk mencari printer terdekat.</Text>}
          renderItem={({ item }) => (
            <View style={styles.deviceCard}>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
                <Text style={styles.deviceMac}>{item.address}</Text>
              </View>
              <TouchableOpacity 
                style={[styles.connectBtn, boundAddress === item.address && styles.connectedBtn]}
                onPress={() => connectDevice(item)}
              >
                <Text style={styles.connectBtnText}>{boundAddress === item.address ? 'Terhubung' : 'Hubungkan'}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  header: { backgroundColor: '#1D4ED8', flexDirection: 'row', alignItems: 'center', paddingTop: 50, paddingBottom: 20, paddingHorizontal: 16 },
  backBtn: { marginRight: 16 },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  content: { padding: 16, flex: 1 },
  statusBox: { backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 24, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4, elevation: 2 },
  statusLabel: { fontSize: 14, color: '#6B7280' },
  statusValue: { fontSize: 18, fontWeight: 'bold', color: '#111827', marginTop: 4 },
  disconnectBtn: { marginTop: 12, backgroundColor: '#EF4444', padding: 8, borderRadius: 6, alignSelf: 'flex-start' },
  disconnectBtnText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  actionBtn: { flex: 1, flexDirection: 'row', backgroundColor: '#166534', height: 48, borderRadius: 8, justifyContent: 'center', alignItems: 'center', gap: 8 },
  actionBtnText: { color: '#FFF', fontWeight: 'bold' },
  listTitle: { fontSize: 16, fontWeight: 'bold', color: '#374151', marginBottom: 12 },
  deviceCard: { backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4, elevation: 2 },
  deviceInfo: { flex: 1 },
  deviceName: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
  deviceMac: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  connectBtn: { backgroundColor: '#1D4ED8', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  connectedBtn: { backgroundColor: '#10B981' },
  connectBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  emptyText: { textAlign: 'center', color: '#9CA3AF', marginTop: 40 }
});
