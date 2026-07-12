import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, TextInput, SafeAreaView, Platform, StatusBar, Alert, ActivityIndicator, Modal, ScrollView, Dimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { db } from '../lib/firebase';
import { collection, query, orderBy, getDocs, doc, updateDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { useIsFocused } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import { fetchCollectionData, addOfflineAction, cacheData, getCachedData } from '../lib/syncEngine';

export default function ProductScreen({ navigation }) {
  const isFocused = useIsFocused();
  const [activeTab, setActiveTab] = useState('produk'); // 'produk' or 'kategori'
  
  // States
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);

  // Modal Category
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editCatId, setEditCatId] = useState(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('apps');
  const [isSavingCat, setIsSavingCat] = useState(false);

  // Modal Edit Product
  const [showEditModal, setShowEditModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editStock, setEditStock] = useState('');
  const [editCategoryId, setEditCategoryId] = useState(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const openEdit = (item) => {
    setEditId(item.id);
    setEditName(item.name || '');
    setEditPrice((item.selling_price || 0).toString());
    setEditStock((item.current_stock || 0).toString());
    setEditCategoryId(item.category_id || null);
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    if (!editName || !editPrice || !editStock) {
      Alert.alert('Error', 'Semua kolom harus diisi');
      return;
    }
    setIsSavingEdit(true);
    try {
      const updates = {
        name: editName,
        selling_price: parseInt(editPrice),
        current_stock: parseInt(editStock),
        category_id: editCategoryId
      };
      
      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        await addOfflineAction('EDIT_PRODUCT', { id: editId, updates });
        const newProds = products.map(p => p.id === editId ? { ...p, ...updates } : p);
        setProducts(newProds);
        await cacheData('PRODUCTS', newProds);
      } else {
        const productRef = doc(db, 'products', editId);
        await updateDoc(productRef, updates);
        await fetchData();
      }
      setIsSavingEdit(false);
      setShowEditModal(false);
    } catch (error) {
      setIsSavingEdit(false);
      Alert.alert('Error', 'Gagal update: ' + error.message);
    }
  };

  useEffect(() => {
    if (isFocused) {
      fetchData();
    }
  }, [isFocused, activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const catData = await fetchCollectionData('categories');
      setCategories(catData);

      if (activeTab === 'produk') {
        const prodData = await fetchCollectionData('products');
        setProducts([...prodData].reverse());
      }

    } catch (err) {
      console.log('Error fetching:', err);
    } finally {
      setLoading(false);
    }
  };

  const deleteProduct = async (id) => {
    Alert.alert('Hapus Produk', 'Yakin ingin menghapus produk ini?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Hapus', style: 'destructive', onPress: async () => {
        const originalProds = [...products];
        const newProds = products.filter(p => p.id !== id);
        setProducts(newProds);
        await cacheData('PRODUCTS', newProds);

        try {
          const netInfo = await NetInfo.fetch();
          if (!netInfo.isConnected) {
            await addOfflineAction('DELETE_PRODUCT', { id });
          } else {
            deleteDoc(doc(db, 'products', id)).catch(err => {
              console.error('Failed to delete product:', err);
              setProducts(originalProds);
              cacheData('PRODUCTS', originalProds);
              Alert.alert('Gagal', 'Gagal menghapus produk dari server: ' + err.message);
            });
          }
        } catch (error) {
          console.error(error);
        }
      }}
    ]);
  };

  const deleteCategory = async (id) => {
    Alert.alert('Hapus Kategori', 'Yakin ingin menghapus kategori ini?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Hapus', style: 'destructive', onPress: async () => {
        const originalCats = [...categories];
        const newCats = categories.filter(c => c.id !== id);
        setCategories(newCats);
        await cacheData('CATEGORIES', newCats);

        try {
          const netInfo = await NetInfo.fetch();
          if (!netInfo.isConnected) {
            await addOfflineAction('DELETE_CATEGORY', { id });
          } else {
            deleteDoc(doc(db, 'categories', id)).catch(err => {
              console.error('Failed to delete category:', err);
              setCategories(originalCats);
              cacheData('CATEGORIES', originalCats);
              Alert.alert('Gagal', 'Gagal menghapus kategori dari server: ' + err.message);
            });
          }
        } catch (error) {
          console.error(error);
        }
      }}
    ]);
  };

  const handleSaveCategory = async () => {
    if (!newCatName) {
      Alert.alert('Error', 'Nama kategori tidak boleh kosong');
      return;
    }
    setIsSavingCat(true);
    try {
      const netInfo = await NetInfo.fetch();
      const catData = { name: newCatName, icon: newCatIcon };
      
      if (!netInfo.isConnected) {
        if (editCatId) {
          await addOfflineAction('EDIT_CATEGORY', { id: editCatId, updates: catData });
          const newCats = categories.map(c => c.id === editCatId ? { ...c, ...catData } : c);
          setCategories(newCats);
          await cacheData('CATEGORIES', newCats);
        } else {
          const newId = Date.now().toString();
          const newCat = { id: newId, ...catData };
          await addOfflineAction('ADD_CATEGORY', newCat);
          const newCats = [...categories, newCat];
          setCategories(newCats);
          await cacheData('CATEGORIES', newCats);
        }
      } else {
        if (editCatId) {
          await updateDoc(doc(db, 'categories', editCatId), catData);
        } else {
          await addDoc(collection(db, 'categories'), catData);
        }
        await fetchData();
      }
      setIsSavingCat(false);
      setShowCategoryModal(false);
      setNewCatName('');
      setEditCatId(null);
    } catch (error) {
      setIsSavingCat(false);
      Alert.alert('Error', 'Gagal menyimpan: ' + error.message);
    }
  };

  const filteredProducts = products.filter(p => {
    const name = p.name || '';
    const matchSearch = name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCategory = selectedCategoryId ? p.category_id === selectedCategoryId : true;
    return matchSearch && matchCategory;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Manajemen Katalog</Text>
      </View>

      {/* Custom Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'produk' && styles.tabButtonActive]} 
          onPress={() => setActiveTab('produk')}
        >
          <Ionicons name="cube" size={20} color={activeTab === 'produk' ? '#166534' : '#6B7280'} />
          <Text style={[styles.tabText, activeTab === 'produk' && styles.tabTextActive]}>Produk</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'kategori' && styles.tabButtonActive]} 
          onPress={() => setActiveTab('kategori')}
        >
          <Ionicons name="list" size={20} color={activeTab === 'kategori' ? '#166534' : '#6B7280'} />
          <Text style={[styles.tabText, activeTab === 'kategori' && styles.tabTextActive]}>Kategori</Text>
        </TouchableOpacity>
      </View>

      {/* PRODUK TAB */}
      {activeTab === 'produk' && (
        <View style={styles.content}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color="#6B7280" style={styles.searchIcon} />
            <TextInput 
              placeholder="Cari nama produk..." 
              style={styles.searchInput} 
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {selectedCategoryId && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7', padding: 8, marginHorizontal: 16, marginBottom: 12, borderRadius: 8 }}>
              <Ionicons name="filter" size={16} color="#166534" style={{marginRight: 8}} />
              <Text style={{ flex: 1, color: '#166534', fontWeight: 'bold' }}>Sedang difilter berdasarkan kategori</Text>
              <TouchableOpacity onPress={() => setSelectedCategoryId(null)}>
                <Ionicons name="close-circle" size={24} color="#166534" />
              </TouchableOpacity>
            </View>
          )}

          {loading ? (
            <ActivityIndicator size="large" color="#166534" style={{marginTop: 40}} />
          ) : (
            <FlatList
              data={filteredProducts}
              keyExtractor={(item) => item.id.toString()}
              contentContainerStyle={{ paddingBottom: 100 }}
              renderItem={({ item }) => {
                const name = item.name || 'Produk';
                const price = item.selling_price || 0;
                const stock = item.current_stock || 0;
                const cat = categories.find(c => c.id === item.category_id);
                const catIcon = cat ? cat.icon : 'cube-outline';

                return (
                  <View style={styles.listItem}>
                    <View style={[styles.listImage, { backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' }]}>
                      {catIcon === 'custom-soda-cup' ? (
                        <Image source={require('../../assets/soda_cup_transparent.png')} style={{ width: 32, height: 32, resizeMode: 'contain', tintColor: '#166534' }} />
                      ) : catIcon?.startsWith('mci-') ? (
                        <MaterialCommunityIcons name={catIcon.replace('mci-', '')} size={32} color="#166534" />
                      ) : catIcon?.startsWith('mi-') ? (
                        <MaterialIcons name={catIcon.replace('mi-', '')} size={32} color="#166534" />
                      ) : (
                        <Ionicons name={catIcon || 'cube-outline'} size={32} color="#166534" />
                      )}
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{name}</Text>
                      <Text style={styles.listPrice}>Rp {price.toLocaleString('id-ID')}</Text>
                      <Text style={styles.listStock}>Stok: {stock}</Text>
                    </View>
                    <View style={styles.listActions}>
                      <TouchableOpacity style={styles.actionBtnEdit} onPress={() => openEdit(item)}>
                        <Ionicons name="pencil" size={18} color="#FFF" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtnDelete} onPress={() => deleteProduct(item.id)}>
                        <Ionicons name="trash" size={18} color="#FFF" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>Tidak ada produk ditemukan.</Text>}
            />
          )}

          {/* Floating Action Button */}
          <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('AddProduct')}>
            <Ionicons name="add" size={30} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* KATEGORI TAB */}
      {activeTab === 'kategori' && (
        <View style={styles.content}>
          <TouchableOpacity style={styles.addCategoryBtn} onPress={() => setShowCategoryModal(true)}>
            <Ionicons name="add-circle" size={24} color="#FFF" />
            <Text style={styles.addCategoryBtnText}>Tambah Kategori Baru</Text>
          </TouchableOpacity>

          {loading ? (
            <ActivityIndicator size="large" color="#166534" style={{marginTop: 40}} />
          ) : (
            <FlatList
              data={categories}
              keyExtractor={(item) => item.id.toString()}
              contentContainerStyle={{ paddingBottom: 40, paddingTop: 16 }}
              renderItem={({ item }) => (
                <View style={styles.catItem}>
                  <TouchableOpacity 
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                    onPress={() => {
                      setSelectedCategoryId(item.id);
                      setActiveTab('produk');
                    }}
                  >
                    <View style={styles.catIconBg}>
                      {item.icon === 'custom-soda-cup' ? (
                        <Image source={require('../../assets/soda_cup_transparent.png')} style={{ width: 28, height: 28, resizeMode: 'contain', tintColor: '#166534' }} />
                      ) : item.icon?.startsWith('mci-') ? (
                        <MaterialCommunityIcons name={item.icon.replace('mci-', '')} size={28} color="#166534" />
                      ) : item.icon?.startsWith('mi-') ? (
                        <MaterialIcons name={item.icon.replace('mi-', '')} size={28} color="#166534" />
                      ) : (
                        <Ionicons name={item.icon || 'list'} size={28} color="#166534" />
                      )}
                    </View>
                    <Text style={styles.catName}>{item.name}</Text>
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity 
                      style={[styles.actionBtnEdit, { backgroundColor: '#F59E0B' }]} 
                      onPress={() => {
                        setEditCatId(item.id);
                        setNewCatName(item.name);
                        setNewCatIcon(item.icon || 'apps');
                        setShowCategoryModal(true);
                      }}
                    >
                      <Ionicons name="pencil" size={18} color="#FFF" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtnDelete} onPress={() => deleteCategory(item.id)}>
                      <Ionicons name="trash" size={18} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>Belum ada data kategori tersimpan di database.</Text>}
            />
          )}
        </View>
      )}

      {/* MODAL TAMBAH/EDIT KATEGORI */}
      <Modal visible={showCategoryModal} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAwareScrollView 
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} 
            keyboardShouldPersistTaps="handled"
            enableOnAndroid={true}
            extraScrollHeight={50}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{editCatId ? 'Edit Kategori' : 'Tambah Kategori'}</Text>
              
              <Text style={styles.modalLabel}>Nama Kategori</Text>
              <TextInput 
                style={styles.modalInput}
                placeholder="Contoh: Sembako"
                value={newCatName}
                onChangeText={setNewCatName}
              />

            <Text style={styles.modalLabel}>Pilih Ikon</Text>
            <View style={styles.iconPickerRow}>
              {['apps', 'cafe-outline', 'pint-outline', 'bag-outline', 'custom-soda-cup', 'fast-food-outline', 'mci-bottle-soda-outline', 'mci-bottle-tonic-outline', 'mci-bottle-soda-classic-outline', 'mci-cigar'].map(iconName => {
                if (iconName === 'custom-soda-cup') {
                  return (
                    <TouchableOpacity 
                      key={iconName} 
                      style={[styles.iconPickerBtn, newCatIcon === iconName && styles.iconPickerBtnActive]}
                      onPress={() => setNewCatIcon(iconName)}
                    >
                      <Image source={require('../../assets/soda_cup_transparent.png')} style={{ width: 32, height: 32, resizeMode: 'contain', tintColor: newCatIcon === iconName ? '#166534' : '#6B7280' }} />
                    </TouchableOpacity>
                  );
                }
                const isMci = iconName.startsWith('mci-');
                const isMi = iconName.startsWith('mi-');
                const IconFamily = isMci ? MaterialCommunityIcons : (isMi ? MaterialIcons : Ionicons);
                const actualName = isMci ? iconName.replace('mci-', '') : (isMi ? iconName.replace('mi-', '') : iconName);
                return (
                  <TouchableOpacity 
                    key={iconName} 
                    style={[styles.iconPickerBtn, newCatIcon === iconName && styles.iconPickerBtnActive]}
                    onPress={() => setNewCatIcon(iconName)}
                  >
                    <IconFamily name={actualName} size={26} color={newCatIcon === iconName ? '#166534' : '#6B7280'} />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowCategoryModal(false)}>
                <Text style={styles.modalCancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalConfirmBtn} 
                onPress={handleSaveCategory}
                disabled={isSavingCat}
              >
                {isSavingCat ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalConfirmText}>Simpan</Text>}
              </TouchableOpacity>
            </View>
            </View>
          </KeyboardAwareScrollView>
        </View>
      </Modal>

      {/* MODAL EDIT PRODUK */}
      <Modal visible={showEditModal} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAwareScrollView 
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} 
            keyboardShouldPersistTaps="handled"
            enableOnAndroid={true}
            extraScrollHeight={50}
          >
            <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Produk</Text>
            
            <Text style={styles.modalLabel}>Nama Produk</Text>
            <TextInput 
              style={styles.modalInput}
              value={editName}
              onChangeText={setEditName}
            />

            <Text style={styles.modalLabel}>Harga (Rp)</Text>
            <TextInput 
              style={styles.modalInput}
              value={editPrice}
              onChangeText={setEditPrice}
              keyboardType="numeric"
            />

            <Text style={styles.modalLabel}>Stok Tersedia</Text>
            <TextInput 
              style={styles.modalInput}
              value={editStock}
              onChangeText={setEditStock}
              keyboardType="numeric"
            />

            <Text style={styles.modalLabel}>Kategori</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
              {categories.map(cat => {
                if (cat.icon === 'custom-soda-cup') {
                  return (
                    <TouchableOpacity 
                      key={cat.id} 
                      style={[styles.categoryChip, editCategoryId === cat.id && styles.categoryChipActive]}
                      onPress={() => setEditCategoryId(cat.id)}
                    >
                      <Image source={require('../../assets/soda_cup_transparent.png')} style={{ width: 18, height: 18, resizeMode: 'contain', tintColor: editCategoryId === cat.id ? '#FFF' : '#6B7280' }} />
                      <Text style={[styles.categoryChipText, editCategoryId === cat.id && styles.categoryChipTextActive, { marginLeft: 6 }]}>{cat.name}</Text>
                    </TouchableOpacity>
                  );
                }
                const isMci = cat.icon?.startsWith('mci-');
                const isMi = cat.icon?.startsWith('mi-');
                const IconFamily = isMci ? MaterialCommunityIcons : (isMi ? MaterialIcons : Ionicons);
                const iconName = isMci ? cat.icon.replace('mci-', '') : (isMi ? cat.icon.replace('mi-', '') : (cat.icon || 'list'));
                return (
                  <TouchableOpacity 
                    key={cat.id} 
                    style={[styles.categoryChip, editCategoryId === cat.id && styles.categoryChipActive]}
                    onPress={() => setEditCategoryId(cat.id)}
                  >
                    <IconFamily name={iconName} size={16} color={editCategoryId === cat.id ? '#FFF' : '#6B7280'} />
                    <Text style={[styles.categoryChipText, editCategoryId === cat.id && styles.categoryChipTextActive]}>{cat.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowEditModal(false)}>
                <Text style={styles.modalCancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalConfirmBtn} 
                onPress={saveEdit}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalConfirmText}>Update Produk</Text>}
              </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareScrollView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const isTablet = Math.min(screenWidth, screenHeight) >= 600;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F9FAFB', paddingTop: (Platform.OS === 'android' && !isTablet) ? StatusBar.currentHeight : 0 },
  header: { padding: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
  
  tabContainer: { flexDirection: 'row', backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  tabButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 8 },
  tabButtonActive: { borderBottomWidth: 2, borderBottomColor: '#166534' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  tabTextActive: { color: '#166534' },

  content: { flex: 1, padding: 16 },
  
  // Search
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 8, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 16 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },

  // List Item (Product)
  listItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 12, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  listImage: { width: 60, height: 60, borderRadius: 8, marginRight: 12, resizeMode: 'contain' },
  listInfo: { flex: 1 },
  listName: { fontSize: 14, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  listPrice: { fontSize: 14, fontWeight: 'bold', color: '#166534', marginBottom: 4 },
  listStock: { fontSize: 12, color: '#6B7280' },
  listActions: { flexDirection: 'row', gap: 8 },
  actionBtnEdit: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#F59E0B', justifyContent: 'center', alignItems: 'center' },
  actionBtnDelete: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center' },

  emptyText: { textAlign: 'center', color: '#6B7280', marginTop: 40 },

  // FAB
  fab: { position: 'absolute', right: 20, bottom: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: '#166534', justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: {width: 0, height: 2} },

  // Category Tab
  addCategoryBtn: { flexDirection: 'row', backgroundColor: '#166534', padding: 16, borderRadius: 12, justifyContent: 'center', alignItems: 'center', gap: 8 },
  addCategoryBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  catItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  catIconBg: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#DCFCE7', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  catName: { flex: 1, fontSize: 16, fontWeight: 'bold', color: '#111827' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginBottom: 20 },
  modalLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, color: '#111827', marginBottom: 20 },
  iconPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 32 },
  iconPickerBtn: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  iconPickerBtnActive: { borderColor: '#166534', backgroundColor: '#DCFCE7', borderWidth: 2 },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, backgroundColor: '#E5E7EB', alignItems: 'center' },
  modalCancelText: { color: '#4B5563', fontWeight: 'bold', fontSize: 16 },
  modalConfirmBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, backgroundColor: '#166534', alignItems: 'center' },
  modalConfirmText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  categoryScroll: { flexDirection: 'row', marginBottom: 16 },
  categoryChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  categoryChipActive: { backgroundColor: '#10B981', borderColor: '#10B981' },
  categoryChipText: { fontSize: 14, color: '#4B5563', marginLeft: 6, fontWeight: '500' },
  categoryChipTextActive: { color: '#FFF' },
});
