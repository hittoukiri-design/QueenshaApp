import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, SafeAreaView, Platform, StatusBar, Modal, ActivityIndicator, Alert, Dimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { db, auth } from '../lib/firebase';
import { collection, query, orderBy, getDocs, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';

export default function UsersScreen({ navigation }) {
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newRole, setNewRole] = useState('staff'); // 'staff' = Kasir, 'owner' = Asisten Owner
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState(null);

  // Modal Add User
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Modal Permissions
  const [showPermModal, setShowPermModal] = useState(false);
  const [selectedUserForPerm, setSelectedUserForPerm] = useState(null);
  const [tempPerms, setTempPerms] = useState([]);

  useEffect(() => {
    fetchUsers();
    fetchCurrentUserRole();
  }, []);

  const fetchCurrentUserRole = async () => {
    const user = auth.currentUser;
    if (user) {
      if (user.email === 'chris@tambayong.com') {
        setCurrentUserRole('master');
        return;
      }
      const docSnap = await getDoc(doc(db, 'profiles', user.uid));
      if (docSnap.exists()) {
        setCurrentUserRole(docSnap.data().role);
      }
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'profiles'), orderBy('created_at', 'desc'));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const filteredData = data.filter(u => u.role !== 'master');
      setUsers(filteredData);
    } catch (err) {
      console.log('Exception fetch users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!newName || !newEmail || !newPassword) {
      Alert.alert('Error', 'Semua kolom harus diisi!');
      return;
    }
    
    setIsSaving(true);
    try {
      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        Alert.alert('Offline', 'Pendaftaran pengguna baru membutuhkan koneksi internet.');
        setIsSaving(false);
        return;
      }

      // Note: in client-side Firebase, creating a user signs them in.
      // To avoid signing out the admin, normally a cloud function is used.
      // For this migration, we will just create the user, which will sign out the master.
      // After that, we insert the profile.
      const userCredential = await createUserWithEmailAndPassword(auth, newEmail, newPassword);
      
      await setDoc(doc(db, 'profiles', userCredential.user.uid), {
        full_name: newName,
        role: newRole,
        created_at: new Date().toISOString()
      });

      setShowModal(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('staff');
      Alert.alert('Sukses', 'Pengguna berhasil didaftarkan.');
      fetchUsers();

    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = (user) => {
    if (user.email === 'chris@tambayong.com' || user.role === 'master') {
      Alert.alert('Gagal', 'Akun master tidak dapat dihapus!');
      return;
    }

    Alert.alert(
      'Konfirmasi Hapus Akun',
      `Tindakan ini tidak dapat dibatalkan. Apakah Anda yakin ingin menghapus akun ${user.full_name || 'Kasir'}? Mereka tidak akan bisa login lagi.`,
      [
        { text: 'Batal', style: 'cancel' },
        { 
          text: 'Hapus', 
          style: 'destructive',
          onPress: async () => {
            try {
              // We can only delete the profile document from client side. 
              // Actual auth deletion requires Admin SDK or Cloud Functions.
              await deleteDoc(doc(db, 'profiles', user.id));
              Alert.alert('Sukses', 'Profil pengguna dihapus. (Auth masih aktif di server)');
              fetchUsers();
            } catch (error) {
              Alert.alert('Gagal', error.message);
            }
          }
        }
      ]
    );
  };

  const handleSavePermissions = async () => {
    if (!selectedUserForPerm) return;
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'profiles', selectedUserForPerm.id), { permissions: tempPerms }, { merge: true });
      Alert.alert('Sukses', 'Hak akses berhasil diperbarui!');
      setShowPermModal(false);
      fetchUsers();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const togglePerm = (perm) => {
    setTempPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]);
  };

  const filteredUsers = users.filter(u => {
    const n = u.full_name || '';
    return n.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>List Pengguna</Text>
        <TouchableOpacity>
          <Ionicons name="cart-outline" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color="#6B7280" style={styles.searchIcon} />
            <TextInput 
              placeholder="Nama" 
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
            <Ionicons name="add" size={32} color="#1D4ED8" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#F97316" style={{marginTop: 40}} />
        ) : (
          <FlatList
            data={filteredUsers}
            keyExtractor={item => item.id}
            renderItem={({item}) => (
              <View style={styles.userCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{item.full_name || 'Kasir'}</Text>
                  <Text style={styles.userRole}>Role: {item.role === 'owner' ? 'Owner' : item.role === 'asisten' ? 'Asisten Owner' : item.role === 'master' ? 'Master' : 'Kasir Biasa'}</Text>
                </View>
                <View style={{ flexDirection: 'row' }}>
                  {item.role === 'asisten' && (currentUserRole === 'owner' || currentUserRole === 'master') && (
                    <TouchableOpacity 
                      style={{ padding: 8, marginRight: 8, backgroundColor: '#E0E7FF', borderRadius: 8 }}
                      onPress={() => {
                        setSelectedUserForPerm(item);
                        setTempPerms(item.permissions || []);
                        setShowPermModal(true);
                      }}
                    >
                      <Ionicons name="key-outline" size={20} color="#4338CA" />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity 
                    style={{ padding: 8 }}
                    onPress={() => handleDeleteUser(item)}
                  >
                    <Ionicons name="trash-outline" size={24} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <Text style={{textAlign: 'center', marginTop: 40, color: '#6B7280'}}>
                Tidak ada kasir yang terdaftar.
              </Text>
            }
          />
        )}
      </View>

      {/* Modal Tambah Pengguna */}
      <Modal visible={showModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAwareScrollView 
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} 
            keyboardShouldPersistTaps="handled"
            enableOnAndroid={true}
            extraScrollHeight={50}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Tambah Kasir Baru</Text>
            
            <Text style={styles.modalLabel}>Nama Lengkap</Text>
            <TextInput 
              style={styles.modalInput} 
              placeholder="Nama Kasir" 
              value={newName} 
              onChangeText={setNewName} 
            />

            <Text style={styles.modalLabel}>Email</Text>
            <TextInput 
              style={styles.modalInput} 
              placeholder="Email valid" 
              keyboardType="email-address"
              autoCapitalize="none"
              value={newEmail} 
              onChangeText={setNewEmail} 
            />

            <Text style={styles.modalLabel}>Kata Sandi Sementara</Text>
            <TextInput 
              style={styles.modalInput} 
              placeholder="Minimal 6 karakter" 
              secureTextEntry
              value={newPassword} 
              onChangeText={setNewPassword} 
            />

            <Text style={styles.modalLabel}>Pilih Akses / Jabatan</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              <TouchableOpacity 
                style={[styles.roleSelectBtn, newRole === 'staff' && styles.roleSelectBtnActive]} 
                onPress={() => setNewRole('staff')}
              >
                <Ionicons name="cart" size={16} color={newRole === 'staff' ? '#FFF' : '#6B7280'} />
                <Text style={[styles.roleSelectText, newRole === 'staff' && styles.roleSelectTextActive, { fontSize: 12 }]}>Kasir Biasa</Text>
              </TouchableOpacity>
              
              {(currentUserRole === 'master' || currentUserRole === 'owner') && (
                <TouchableOpacity 
                  style={[styles.roleSelectBtn, newRole === 'asisten' && styles.roleSelectBtnActive]} 
                  onPress={() => setNewRole('asisten')}
                >
                  <Ionicons name="shield-checkmark" size={16} color={newRole === 'asisten' ? '#FFF' : '#6B7280'} />
                  <Text style={[styles.roleSelectText, newRole === 'asisten' && styles.roleSelectTextActive, { fontSize: 12 }]}>Asisten Owner</Text>
                </TouchableOpacity>
              )}

              {currentUserRole === 'master' && (
                <TouchableOpacity 
                  style={[styles.roleSelectBtn, newRole === 'owner' && styles.roleSelectBtnActive]} 
                  onPress={() => setNewRole('owner')}
                >
                  <Ionicons name="business" size={16} color={newRole === 'owner' ? '#FFF' : '#6B7280'} />
                  <Text style={[styles.roleSelectText, newRole === 'owner' && styles.roleSelectTextActive, { fontSize: 12 }]}>Owner Toko</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.modalCancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={handleAddUser} disabled={isSaving}>
                {isSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalConfirmText}>Daftarkan Pengguna</Text>}
              </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareScrollView>
        </View>
      </Modal>

      {/* Modal Kelola Hak Akses */}
      <Modal visible={showPermModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Kelola Akses Asisten</Text>
            <Text style={{ color: '#6B7280', marginBottom: 16 }}>{selectedUserForPerm?.full_name}</Text>
            
            <TouchableOpacity 
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}
              onPress={() => togglePerm('menu_stok')}
            >
              <Ionicons name={tempPerms.includes('menu_stok') ? 'checkbox' : 'square-outline'} size={24} color={tempPerms.includes('menu_stok') ? '#1D4ED8' : '#9CA3AF'} />
              <Text style={{ marginLeft: 8, fontSize: 16, color: '#374151' }}>Akses Menu Manajemen Stok</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}
              onPress={() => togglePerm('menu_users')}
            >
              <Ionicons name={tempPerms.includes('menu_users') ? 'checkbox' : 'square-outline'} size={24} color={tempPerms.includes('menu_users') ? '#1D4ED8' : '#9CA3AF'} />
              <Text style={{ marginLeft: 8, fontSize: 16, color: '#374151' }}>Akses Menu List Pengguna</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}
              onPress={() => togglePerm('menu_history')}
            >
              <Ionicons name={tempPerms.includes('menu_history') ? 'checkbox' : 'square-outline'} size={24} color={tempPerms.includes('menu_history') ? '#1D4ED8' : '#9CA3AF'} />
              <Text style={{ marginLeft: 8, fontSize: 16, color: '#374151' }}>Akses Riwayat Transaksi</Text>
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowPermModal(false)}>
                <Text style={styles.modalCancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={handleSavePermissions} disabled={isSaving}>
                {isSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalConfirmText}>Simpan Akses</Text>}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 60, backgroundColor: '#F97316' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFF' },
  content: { flex: 1, padding: 16 },
  
  searchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 12, height: 48 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 16, color: '#111827' },
  addBtn: { marginLeft: 16, padding: 4 },
  
  userCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF', padding: 16, borderRadius: 8, marginBottom: 8, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.1, elevation: 2 },
  userName: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  userRole: { fontSize: 12, color: '#166534', fontWeight: 'bold', textTransform: 'uppercase' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginBottom: 20 },
  modalLabel: { fontSize: 14, color: '#374151', fontWeight: 'bold', marginBottom: 8 },
  modalInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 12, height: 48, marginBottom: 16, color: '#111827' },
  
  roleSelectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6', paddingVertical: 12, borderRadius: 8, marginHorizontal: 4, borderWidth: 1, borderColor: '#E5E7EB' },
  roleSelectBtnActive: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  roleSelectText: { marginLeft: 8, fontSize: 14, color: '#6B7280', fontWeight: 'bold' },
  roleSelectTextActive: { color: '#FFF' },

  modalActions: { flexDirection: 'row', marginTop: 8 },
  modalCancelBtn: { flex: 1, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 8, marginRight: 8 },
  modalCancelText: { color: '#4B5563', fontWeight: 'bold', fontSize: 16 },
  modalConfirmBtn: { flex: 1, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1D4ED8', borderRadius: 8, marginLeft: 8 },
  modalConfirmText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
});
