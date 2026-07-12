import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons } from '@expo/vector-icons';
import { db } from '../lib/firebase';
import { collection, getDocs, addDoc, query, orderBy } from 'firebase/firestore';
import NetInfo from '@react-native-community/netinfo';
import { fetchCollectionData, addOfflineAction } from '../lib/syncEngine';

export default function AddProductScreen({ navigation }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    const data = await fetchCollectionData('categories');
    // sort locally by name just in case it came from cache
    data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    setCategories(data);
  };

  const handleSave = async () => {
    if (!name || !price || !stock) {
      Alert.alert('Error', 'Harap isi semua kolom');
      return;
    }

    setLoading(true);
    try {
      const netInfo = await NetInfo.fetch();
      const newProduct = {
        name,
        selling_price: parseInt(price),
        current_stock: parseInt(stock),
        category_id: selectedCategory,
        sku: `SKU-${Date.now()}`,
        is_active: true
      };

      if (!netInfo.isConnected) {
        // Mode offline
        const newId = Date.now().toString();
        await addOfflineAction('ADD_PRODUCT', { id: newId, ...newProduct });
        Alert.alert('Sukses Offline', 'Produk masuk antrean sinkronisasi!', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      } else {
        await addDoc(collection(db, 'products'), newProduct);
        Alert.alert('Sukses', 'Produk berhasil ditambahkan!', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      }
    } catch (error) {
      Alert.alert('Gagal', 'Gagal menyimpan produk: ' + error.message);
    }
    setLoading(false);
  };

  return (
    <KeyboardAwareScrollView 
      style={styles.container} 
      contentContainerStyle={{ paddingBottom: 40 }} 
      keyboardShouldPersistTaps="handled"
      enableOnAndroid={true}
      extraScrollHeight={50}
    >
      <Text style={styles.title}>Tambah Produk Baru</Text>

      <View style={styles.form}>
        <Text style={styles.label}>Nama Barang</Text>
        <TextInput
          style={styles.input}
          placeholder="Contoh: Baju Koko"
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Harga (Rp)</Text>
        <TextInput
          style={styles.input}
          placeholder="Contoh: 150000"
          value={price}
          onChangeText={setPrice}
          keyboardType="numeric"
        />

        <Text style={styles.label}>Kategori</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
          {categories.map(cat => (
            <TouchableOpacity 
              key={cat.id} 
              style={[styles.categoryChip, selectedCategory === cat.id && styles.categoryChipActive]}
              onPress={() => setSelectedCategory(cat.id)}
            >
              <Ionicons name={cat.icon || 'list'} size={16} color={selectedCategory === cat.id ? '#FFF' : '#6B7280'} />
              <Text style={[styles.categoryChipText, selectedCategory === cat.id && styles.categoryChipTextActive]}>{cat.name}</Text>
            </TouchableOpacity>
          ))}
          {categories.length === 0 && (
            <Text style={{color: '#9CA3AF', fontStyle: 'italic', paddingVertical: 8}}>Belum ada kategori tersedia.</Text>
          )}
        </ScrollView>

        <Text style={styles.label}>Stok Awal</Text>
        <TextInput
          style={styles.input}
          placeholder="Contoh: 50"
          value={stock}
          onChangeText={setStock}
          keyboardType="numeric"
        />

        {loading ? (
          <ActivityIndicator size="large" color="#10B981" style={{ marginTop: 20 }} />
        ) : (
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Simpan Produk</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    color: '#111827',
  },
  form: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    fontSize: 16,
    color: '#111827',
  },
  saveButton: {
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  categoryScroll: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  categoryChipActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  categoryChipText: {
    fontSize: 14,
    color: '#4B5563',
    marginLeft: 6,
    fontWeight: '500',
  },
  categoryChipTextActive: {
    color: '#FFF',
  },
});
