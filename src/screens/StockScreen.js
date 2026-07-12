import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, TextInput, SafeAreaView, Platform, StatusBar, ActivityIndicator, Alert, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { db } from '../lib/firebase';
import { collection, query, orderBy, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getCachedData, cacheData, addOfflineAction, processSyncQueue } from '../lib/syncEngine';
import { useIsFocused } from '@react-navigation/native';

export default function StockScreen() {
  const isFocused = useIsFocused();
  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    if (isFocused) {
      fetchStock();
      processSyncQueue();
    }
  }, [isFocused]);

  const fetchStock = async () => {
    setLoading(true);
    try {
      const cached = await getCachedData('PRODUCTS');
      if (cached) {
        const sorted = [...cached].sort((a, b) => parseInt(a.current_stock || 0) - parseInt(b.current_stock || 0));
        setProducts(sorted);
      }

      const q = query(collection(db, 'products'), orderBy('current_stock', 'asc'));
      const querySnapshot = await getDocs(q);
      
      const data = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });

      setProducts(data);
      cacheData('PRODUCTS', data);
    } catch (err) {
      console.log('Error fetching stock:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateStock = async (id, currentStock, delta) => {
    const newStock = Math.max(0, parseInt(currentStock || 0) + delta);
    setUpdatingId(id);
    
    // Update UI immediately (Optimistic UI)
    const updatedProducts = products.map(p => p.id === id ? { ...p, current_stock: newStock } : p);
    setProducts(updatedProducts);
    cacheData('PRODUCTS', updatedProducts);
    
    try {
      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        console.log('Offline: mengantrekan edit produk');
        await addOfflineAction('EDIT_PRODUCT', { id: id, updates: { current_stock: newStock } });
      } else {
        const productRef = doc(db, 'products', id);
        await updateDoc(productRef, { current_stock: newStock });
      }
    } catch (err) {
      console.error(err);
      fetchStock();
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredProducts = products.filter(p => {
    const name = p.name || '';
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Manajemen Stok</Text>
        <Text style={styles.headerSubtitle}>Pantau dan sesuaikan stok barang (diurutkan dari terendah)</Text>
      </View>

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

        {loading ? (
          <ActivityIndicator size="large" color="#166534" style={{marginTop: 40}} />
        ) : (
          <FlatList
            data={filteredProducts}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={{ paddingBottom: 100 }}
            renderItem={({ item }) => {
              const name = item.name || 'Produk';
              const stock = parseInt(item.current_stock || 0);
              const imageUrl = item.image_url || 'https://via.placeholder.com/100x100?text=IMG';
              
              const isLowStock = stock < 3;

              return (
                <View style={[styles.listItem, isLowStock && styles.listItemWarning]}>
                  <Image source={{uri: imageUrl}} style={styles.listImage} />
                  
                  <View style={styles.listInfo}>
                    <Text style={styles.listName} numberOfLines={2}>{name}</Text>
                    {isLowStock ? (
                      <View style={styles.warningBadge}>
                        <Ionicons name="warning" size={12} color="#EF4444" />
                        <Text style={styles.warningText}>Stok Kritis</Text>
                      </View>
                    ) : (
                      <Text style={{fontSize: 12, color: '#166534', fontWeight: '500'}}>Stok Aman</Text>
                    )}
                  </View>
                  
                  <View style={styles.stockControl}>
                    <TouchableOpacity 
                      style={styles.stockBtn} 
                      onPress={() => updateStock(item.id, stock, -1)}
                      disabled={updatingId === item.id}
                    >
                      <Ionicons name="remove" size={20} color="#4B5563" />
                    </TouchableOpacity>
                    
                    <View style={styles.stockValueContainer}>
                      {updatingId === item.id ? (
                        <ActivityIndicator size="small" color="#166534" />
                      ) : (
                        <Text style={[styles.stockValue, isLowStock && {color: '#EF4444'}]}>{stock}</Text>
                      )}
                    </View>
                    
                    <TouchableOpacity 
                      style={styles.stockBtn} 
                      onPress={() => updateStock(item.id, stock, 1)}
                      disabled={updatingId === item.id}
                    >
                      <Ionicons name="add" size={20} color="#4B5563" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={<Text style={styles.emptyText}>Tidak ada produk ditemukan.</Text>}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const isTablet = Math.min(screenWidth, screenHeight) >= 600;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F9FAFB', paddingTop: (Platform.OS === 'android' && !isTablet) ? StatusBar.currentHeight : 0 },
  header: { padding: 24, paddingBottom: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#111827' },
  headerSubtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  
  content: { flex: 1, padding: 16 },
  
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 8, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 16 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },

  listItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 12, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  listItemWarning: { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  
  listImage: { width: 50, height: 50, borderRadius: 8, marginRight: 12, resizeMode: 'contain' },
  listInfo: { flex: 1, justifyContent: 'center' },
  listName: { fontSize: 14, fontWeight: 'bold', color: '#111827', marginBottom: 6 },
  
  warningBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, gap: 4 },
  warningText: { fontSize: 10, color: '#EF4444', fontWeight: 'bold' },

  stockControl: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  stockBtn: { padding: 8 },
  stockValueContainer: { width: 40, alignItems: 'center', justifyContent: 'center' },
  stockValue: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
  
  emptyText: { textAlign: 'center', color: '#6B7280', marginTop: 40 },
});
