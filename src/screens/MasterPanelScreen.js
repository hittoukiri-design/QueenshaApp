import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, TextInput, Modal } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons } from '@expo/vector-icons';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';

export default function MasterPanelScreen({ navigation }) {
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchOwners();
  }, []);

  const handleAddOwner = async () => {
    if (!newName || !newEmail || !newPassword) {
      Alert.alert('Error', 'Semua kolom wajib diisi.');
      return;
    }
    setIsSaving(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, newEmail, newPassword);
      await setDoc(doc(db, 'profiles', userCredential.user.uid), {
        full_name: newName,
        role: 'owner',
        created_at: new Date().toISOString()
      });

      Alert.alert('Sukses', 'Akun Owner berhasil dibuat.');
      setShowAddModal(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      fetchOwners();
    } catch (err) {
      Alert.alert('Gagal', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const fetchOwners = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'profiles'), where('role', '==', 'owner'));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setOwners(data);
    } catch (err) {
      Alert.alert('Error', 'Gagal memuat daftar Owner: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOwner = (owner) => {
    Alert.alert(
      'Hapus Owner',
      `Tindakan ini tidak dapat dibatalkan. Yakin hapus ${owner.full_name}?`,
      [
        { text: 'Batal', style: 'cancel' },
        { 
          text: 'Hapus', 
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'profiles', owner.id));
              Alert.alert('Sukses', 'Profil Owner dihapus. (Auth tetap di server)');
              fetchOwners();
            } catch (error) {
              Alert.alert('Gagal', error.message);
            }
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Master Panel</Text>
        <TouchableOpacity onPress={fetchOwners} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.subtitle}>Daftar Pemilik Toko (Owner)</Text>
        
        {loading ? (
          <ActivityIndicator size="large" color="#166534" style={{marginTop: 50}} />
        ) : (
          <FlatList
            data={owners}
            keyExtractor={item => item.id}
            ListEmptyComponent={<Text style={styles.emptyText}>Belum ada Owner terdaftar.</Text>}
            renderItem={({ item }) => (
              <View style={styles.ownerCard}>
                <View style={styles.ownerInfo}>
                  <Text style={styles.ownerName}>{item.full_name}</Text>
                  <Text style={styles.ownerEmail}>{item.email}</Text>
                </View>
                <TouchableOpacity onPress={() => handleDeleteOwner(item)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)}>
        <Ionicons name="add" size={30} color="#FFF" />
      </TouchableOpacity>

      {/* MODAL TAMBAH OWNER */}
      <Modal visible={showAddModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAwareScrollView 
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} 
            keyboardShouldPersistTaps="handled"
            enableOnAndroid={true}
            extraScrollHeight={50}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Tambah Owner Baru</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Nama Lengkap</Text>
              <TextInput style={styles.input} placeholder="Contoh: Budi Santoso" value={newName} onChangeText={setNewName} />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput style={styles.input} placeholder="Contoh: budi@owner.com" keyboardType="email-address" autoCapitalize="none" value={newEmail} onChangeText={setNewEmail} />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <TextInput style={styles.input} placeholder="Minimal 6 karakter" secureTextEntry value={newPassword} onChangeText={setNewPassword} />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowAddModal(false)}>
                <Text style={styles.modalCancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={handleAddOwner} disabled={isSaving}>
                {isSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalConfirmText}>Simpan</Text>}
              </TouchableOpacity>
            </View>
            </View>
          </KeyboardAwareScrollView>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  header: { 
    backgroundColor: '#111827', // Black for Master
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingTop: 50, 
    paddingBottom: 20, 
    paddingHorizontal: 16 
  },
  backBtn: { marginRight: 16 },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: 'bold', flex: 1 },
  refreshBtn: { marginLeft: 16 },
  content: { padding: 16, flex: 1 },
  subtitle: { fontSize: 16, fontWeight: 'bold', color: '#374151', marginBottom: 16 },
  ownerCard: { 
    backgroundColor: '#FFF', 
    padding: 16, 
    borderRadius: 12, 
    marginBottom: 12, 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  ownerInfo: { flex: 1 },
  ownerName: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
  ownerEmail: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  deleteBtn: { padding: 8 },
  emptyText: { textAlign: 'center', color: '#9CA3AF', marginTop: 40 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 60, height: 60, borderRadius: 30, backgroundColor: '#166534', justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: '#FFF', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginBottom: 20 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 16, height: 48, fontSize: 16, color: '#111827' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  modalCancelBtn: { flex: 1, height: 48, borderRadius: 8, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  modalCancelText: { fontSize: 16, fontWeight: 'bold', color: '#4B5563' },
  modalConfirmBtn: { flex: 1, height: 48, borderRadius: 8, backgroundColor: '#166534', justifyContent: 'center', alignItems: 'center' },
  modalConfirmText: { fontSize: 16, fontWeight: 'bold', color: '#FFF' }
});
