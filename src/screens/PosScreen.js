import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ScrollView, TextInput, SafeAreaView, Platform, StatusBar, Alert, ActivityIndicator, Modal, useWindowDimensions, Animated, PanResponder, Dimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { BluetoothEscposPrinter } from 'react-native-thermal-receipt-printer-image-qr';
import { db, auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc } from 'firebase/firestore';
import { cacheData, getCachedData, addOfflineAction, processSyncQueue } from '../lib/syncEngine';
import { triggerSilentLocalBackup } from '../lib/backupEngine';
import { useIsFocused } from '@react-navigation/native';

export default function PosScreen({ navigation }) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isTablet = width >= 600; // Deteksi tablet (portrait width ≥ 600dp)
  const isFocused = useIsFocused();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([{ id: '1', name: 'Semua', icon: 'apps' }]);
  const [cart, setCart] = useState([]);
  const [activeCategory, setActiveCategory] = useState('1');
  const [loading, setLoading] = useState(true);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [userRoleLabel, setUserRoleLabel] = useState('Kasir');
  const [userEmail, setUserEmail] = useState('');
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [stats, setStats] = useState({ totalRevenue: 0, totalTransactions: 0, averageTransaction: 0, itemsSold: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [isNotificationVisible, setIsNotificationVisible] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Animasi Bottom Sheet
  const CART_MAX_HEIGHT = height * 0.7; // 70% layar
  const COLLAPSED_Y = CART_MAX_HEIGHT - 60; // Sisa 60px untuk header
  const panY = useRef(new Animated.Value(COLLAPSED_Y)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5,
      onPanResponderGrant: () => {
        panY.setOffset(panY._value);
        panY.setValue(0);
      },
      onPanResponderMove: Animated.event([null, { dy: panY }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gestureState) => {
        panY.flattenOffset();
        
        let targetY = COLLAPSED_Y;
        if (gestureState.dy < -50 || gestureState.vy < -0.5) {
          targetY = 0; // Buka
        } else if (gestureState.dy > 50 || gestureState.vy > 0.5) {
          targetY = COLLAPSED_Y; // Tutup
        } else {
          targetY = panY._value < (CART_MAX_HEIGHT / 2) ? 0 : COLLAPSED_Y; // Snap terdekat
        }

        Animated.spring(panY, {
          toValue: targetY,
          useNativeDriver: false,
          bounciness: 4,
        }).start(() => setIsCartOpen(targetY === 0));
      }
    })
  ).current;

  const toggleCart = () => {
    const targetY = isCartOpen ? COLLAPSED_Y : 0;
    Animated.spring(panY, {
      toValue: targetY,
      useNativeDriver: false,
      bounciness: 4,
    }).start(() => setIsCartOpen(!isCartOpen));
  };

  const getSearchResults = () => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return products.filter(p => {
      const name = (p.name || '').toLowerCase();
      return name.includes(query);
    }).slice(0, 5);
  };

  const onSelectSearchResult = (item) => {
    addToCart(item);
    setSearchQuery('');
  };

  // Modal States
  const [showCashModal, setShowCashModal] = useState(false);
  const [amountPaid, setAmountPaid] = useState('');
  const [showQRModal, setShowQRModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  useEffect(() => {
    if (isFocused) {
      fetchData();
      processSyncQueue(); // Coba sinkronisasi saat layar aktif
    }
  }, [isFocused]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 0. Load Cache Pertama Kali (Instan Load)
      const cachedProducts = await getCachedData('PRODUCTS');
      if (cachedProducts) setProducts(cachedProducts);
      
      const cachedCats = await getCachedData('CATEGORIES');
      if (cachedCats) setCategories(cachedCats);

      // 1. Fetch Products
      const prodSnap = await getDocs(collection(db, 'products'));
      const prodData = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setProducts(prodData);
      cacheData('PRODUCTS', prodData);

      // 2. Fetch Categories
      const catSnap = await getDocs(collection(db, 'categories'));
      const catData = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (catData && catData.length > 0) {
        const cats = [{ id: '1', name: 'Semua', icon: 'apps' }, ...catData];
        setCategories(cats);
        cacheData('CATEGORIES', cats);
      }

      // 3. Fetch Stats
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();
      const q = query(collection(db, 'transactions'), where('created_at', '>=', todayISO));
      const trxSnap = await getDocs(q);
      const trxData = trxSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      let totalRev = 0, totalCount = 0, average = 0, totalItems = 0;
      if (trxData && trxData.length > 0) {
        totalCount = trxData.length;
        totalRev = trxData.reduce((sum, t) => sum + (t.total_harga || 0), 0);
        average = totalRev / totalCount;
        
        const trxIds = trxData.map(t => t.id);
        const itemsSnap = await getDocs(collection(db, 'transaction_items'));
        const allItems = itemsSnap.docs.map(d => d.data());
        const todayItems = allItems.filter(item => trxIds.includes(item.transaction_id));
        totalItems = todayItems.reduce((sum, item) => sum + (item.jumlah || 0), 0);
      }
      setStats({ totalRevenue: totalRev, totalTransactions: totalCount, averageTransaction: average, itemsSold: totalItems });

      // 4. Determine User Role Label
      const user = auth.currentUser;
      if (user) {
        setUserEmail(user.email || '');
        if (user.email === 'chris@tambayong.com') {
          setUserRoleLabel('Master App');
        } else {
          const docRef = doc(db, 'profiles', user.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const role = docSnap.data().role;
            if (role === 'master' || role === 'owner') setUserRoleLabel('Owner');
            else setUserRoleLabel('Kasir');
          } else {
            setUserRoleLabel('Kasir');
          }
        }
      }

    } catch (err) {
      console.log('Exception fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const updateQty = (id, delta) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.qty + delta);
        return { ...item, qty: newQty };
      }
      return item;
    }));
  };

  const removeFromCart = (id) => {
    setCart((prev) => prev.filter(item => item.id !== id));
  };

  const clearCart = () => setCart([]);

  const totalCart = cart.reduce((sum, item) => sum + ((item.selling_price || 0) * item.qty), 0);

  const lowStockProducts = products.filter(p => {
    const stock = parseInt(p.current_stock || 0);
    return stock < 3;
  });

  const handleCheckoutClick = (method) => {
    if (cart.length === 0) {
      Alert.alert('Kosong', 'Keranjang belanja masih kosong!');
      return;
    }
    
    if (method === 'TUNAI') {
      setAmountPaid('');
      setShowCashModal(true);
    } else if (method === 'QRIS') {
      setShowQRModal(true);
    }
  };

  const processTransaction = async (method) => {
    setIsCheckingOut(true);
    try {
      const netInfo = await NetInfo.fetch();
      const isOffline = !netInfo.isConnected;

      const user = auth.currentUser;
      const kasirId = user?.uid || 'offline-user';
      const invoiceNumber = `INV-${Date.now()}`;

      if (isOffline) {
        console.log('Mode offline, transaksi masuk antrean.');
        // Siapkan data offline
        const trxData = { total_harga: totalCart, kasir_id: kasirId, invoice_number: invoiceNumber, created_at: new Date().toISOString() };
        const itemsToInsert = cart.map(item => ({
          product_id: item.id,
          product_name: item.name || 'Produk',
          jumlah: item.qty,
          harga_satuan: item.selling_price || 0
        }));

        await addOfflineAction('NEW_TRANSACTION', { trxData, items: itemsToInsert });

        // Kurangi stok di local state/cache sementara
        const updatedProducts = products.map(p => {
          const cartItem = cart.find(c => c.id === p.id);
          if (cartItem) {
            return { ...p, current_stock: Math.max(0, parseInt(p.current_stock) - cartItem.qty) };
          }
          return p;
        });
        setProducts(updatedProducts);
        cacheData('PRODUCTS', updatedProducts);

      } else {
        const trxRef = await addDoc(collection(db, 'transactions'), {
          total_harga: totalCart,
          kasir_id: kasirId,
          invoice_number: invoiceNumber,
          created_at: new Date().toISOString()
        });

        for (const item of cart) {
          await addDoc(collection(db, 'transaction_items'), {
            transaction_id: trxRef.id,
            product_name: item.name || 'Produk',
            jumlah: item.qty,
            harga_satuan: item.selling_price || 0
          });

          const currentStock = parseInt(item.current_stock || 0);
          const newStock = Math.max(0, currentStock - item.qty);
          await updateDoc(doc(db, 'products', item.id), { current_stock: newStock });
        }
      }

      setShowCashModal(false);
      setShowQRModal(false);
      
      // Siapkan data struk
      setReceiptData({
        invoice: invoiceNumber,
        date: new Date().toLocaleString('id-ID'),
        method: method,
        items: cart,
        total: totalCart,
        paid: method === 'TUNAI' ? parseInt(amountPaid || '0') : totalCart,
        change: method === 'TUNAI' ? (parseInt(amountPaid || '0') - totalCart) : 0
      });
      setShowReceiptModal(true);

      clearCart();
      fetchData();
      triggerSilentLocalBackup(); // Trigger silent auto-backup locally
    } catch (err) {
      Alert.alert('Error', 'Gagal memproses transaksi. Pastikan struktur tabel transactions sudah benar.\\n' + err.message);
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handlePrintReceipt = async () => {
    if (!receiptData) return;
    
    try {
      await BluetoothEscposPrinter.printerInit();
      await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
      await BluetoothEscposPrinter.printText("TOKO QUEENSHA\n\r", {
        encoding: 'GBK',
        codepage: 0,
        widthtimes: 1,
        heigthtimes: 1,
        fonttype: 1
      });
      await BluetoothEscposPrinter.printText("Jl. Contoh Alamat No. 123\n\r", {});
      await BluetoothEscposPrinter.printText("--------------------------------\n\r", {});
      
      await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.LEFT);
      await BluetoothEscposPrinter.printText(`Tgl: ${receiptData.date}\n\r`, {});
      await BluetoothEscposPrinter.printText(`No : ${receiptData.invoice}\n\r`, {});
      await BluetoothEscposPrinter.printText(`Metode: ${receiptData.method}\n\r`, {});
      await BluetoothEscposPrinter.printText("--------------------------------\n\r", {});

      for (const item of receiptData.items) {
        await BluetoothEscposPrinter.printText(`${item.name}\n\r`, {});
        const qtyPrice = `${item.qty} x ${item.selling_price}`;
        const totalStr = `${item.qty * item.selling_price}`;
        
        let spaces = 32 - qtyPrice.length - totalStr.length;
        if (spaces < 1) spaces = 1;
        await BluetoothEscposPrinter.printText(qtyPrice + ' '.repeat(spaces) + totalStr + "\n\r", {});
      }

      await BluetoothEscposPrinter.printText("--------------------------------\n\r", {});
      
      const formatLine = (label, value) => {
        let spaces = 32 - label.length - value.toString().length;
        if (spaces < 1) spaces = 1;
        return label + ' '.repeat(spaces) + value + "\n\r";
      };

      await BluetoothEscposPrinter.printText(formatLine("TOTAL", receiptData.total), {});
      await BluetoothEscposPrinter.printText(formatLine("TUNAI", receiptData.paid), {});
      await BluetoothEscposPrinter.printText(formatLine("KEMBALI", receiptData.change), {});
      
      await BluetoothEscposPrinter.printText("--------------------------------\n\r", {});
      await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
      await BluetoothEscposPrinter.printText("Terima Kasih\n\r", {});
      await BluetoothEscposPrinter.printText("\n\r\n\r\n\r", {});
    } catch (err) {
      console.log(err);
      Alert.alert('Print Error', 'Gagal mencetak struk: ' + err.message + '. Pastikan printer bluetooth terhubung.');
    }
  };

  const paidAmountNumber = parseInt(amountPaid || '0');
  const change = paidAmountNumber - totalCart;

  // Filter produk berdasarkan kategori yang aktif
  const displayedProducts = activeCategory === '1' 
    ? products 
    : products.filter(p => p.kategori_id === activeCategory || p.category_id === activeCategory);

  // Lebar kartu produk untuk 2 kolom di HP: (lebar layar - 32px padding - 12px gap) / 2
  // Untuk tablet, biarkan lebar tetap 160 seperti aslinya
  const productCardWidth = isTablet ? 160 : Math.floor((width - 44) / 2);

  const renderProduct = ({ item }) => {
    const cat = categories.find(c => c.id === item.category_id);
    const catIcon = cat ? cat.icon : 'cube-outline';

    return (
      <TouchableOpacity style={[styles.productCard, !isTablet && { width: productCardWidth }, isLandscape && styles.productCardLandscape]} onPress={() => addToCart(item)}>
        <View style={styles.productIconContainer}>
          {catIcon === 'custom-soda-cup' ? (
            <Image source={require('../../assets/soda_cup_transparent.png')} style={{ width: 48, height: 48, resizeMode: 'contain', tintColor: '#166534' }} />
          ) : catIcon?.startsWith('mci-') ? (
            <MaterialCommunityIcons name={catIcon.replace('mci-', '')} size={48} color="#166534" />
          ) : catIcon?.startsWith('mi-') ? (
            <MaterialIcons name={catIcon.replace('mi-', '')} size={48} color="#166534" />
          ) : (
            <Ionicons name={catIcon || 'cube-outline'} size={48} color="#166534" />
          )}
        </View>
        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.productPrice}>Rp {(item.selling_price || 0).toLocaleString('id-ID')}</Text>
        </View>
        <View style={styles.addBtn}>
          <Ionicons name="add" size={20} color="#FFF" />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.container, isLandscape && { flexDirection: 'row' }]}>
        
        {/* Floating Fixed Header Section */}
        <View style={[styles.floatingHeader, isTablet && styles.floatingHeaderTablet]}>
          <Image source={require('../../assets/logo.png')} style={[styles.headerLogo, isTablet && styles.headerLogoTablet]} resizeMode="contain" />
          
          {/* Search Bar dengan teks hitam */}
          <View style={[styles.searchBar, isTablet && styles.searchBarTablet]}>
            <Ionicons name="search-outline" size={isTablet ? 20 : 16} color="#374151" style={styles.searchIcon} />
            <TextInput 
              placeholder="Cari produk..." 
              placeholderTextColor="#111827"
              style={[styles.searchInput, isTablet && styles.searchInputTablet]} 
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={isTablet ? 20 : 16} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.headerIcons}>
            <TouchableOpacity 
              style={styles.bellIconBtn}
              onPress={() => {
                if (lowStockProducts.length > 0) {
                  setIsNotificationVisible(true);
                }
              }}
            >
              <Ionicons name="notifications-outline" size={isTablet ? 28 : 24} color="#374151" />
              {lowStockProducts.length > 0 && (
                <View style={styles.badge}><Text style={styles.badgeText}>{lowStockProducts.length}</Text></View>
              )}
            </TouchableOpacity>
            
            {/* ProfileBtn: hitSlop memastikan area klik lebih besar di tablet */}
            <TouchableOpacity 
              style={[styles.profileBtn, isTablet && styles.profileBtnTablet]}
              onPress={() => setShowProfileDrawer(true)}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Image 
                source={
                  userRoleLabel === 'Master App' 
                    ? require('../../assets/master.jpg') 
                    : userRoleLabel === 'Owner'
                      ? require('../../assets/owner.jpg')
                      : require('../../assets/kasir.jpg')
                } 
                style={[styles.profileImage, isTablet && styles.profileImageTablet]} 
              />
              <View style={styles.profileTextContainer}>
                <Text style={[styles.profileText, isTablet && styles.profileTextTablet]}>{userRoleLabel}</Text>
                <Ionicons name="chevron-down" size={isTablet ? 18 : 14} color="#374151" />
              </View>
            </TouchableOpacity>
          </View>

          {/* Search Results Dropdown relative to floatingHeader */}
          {searchQuery.length > 0 && (
            <View style={{
              position: 'absolute',
              top: isTablet ? 54 : 60,
              left: 12,
              right: 12,
              backgroundColor: '#FFF',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#E5E7EB',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.1,
              shadowRadius: 6,
              elevation: 10,
              zIndex: 999,
              maxHeight: 300
            }}>
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {getSearchResults().length > 0 ? (
                  getSearchResults().map(item => (
                    <TouchableOpacity 
                      key={item.id} 
                      style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}
                      onPress={() => onSelectSearchResult(item)}
                    >
                      {(() => {
                        const cat = categories.find(c => c.id === item.category_id);
                        const catIcon = cat ? cat.icon : 'cube-outline';
                        return (
                          <View style={[{width: 40, height: 40, borderRadius: 6, marginRight: 16}, { backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' }]}>
                            {catIcon === 'custom-soda-cup' ? (
                              <Image source={require('../../assets/soda_cup_transparent.png')} style={{ width: 24, height: 24, resizeMode: 'contain', tintColor: '#166534' }} />
                            ) : catIcon?.startsWith('mci-') ? (
                              <MaterialCommunityIcons name={catIcon.replace('mci-', '')} size={24} color="#166534" />
                            ) : catIcon?.startsWith('mi-') ? (
                              <MaterialIcons name={catIcon.replace('mi-', '')} size={24} color="#166534" />
                            ) : (
                              <Ionicons name={catIcon || 'cube-outline'} size={24} color="#166534" />
                            )}
                          </View>
                        );
                      })()}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }} numberOfLines={1}>{item.name}</Text>
                        <Text style={{ fontSize: 14, color: '#166534', fontWeight: 'bold' }}>Rp {(item.selling_price || 0).toLocaleString('id-ID')}</Text>
                      </View>
                      <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }}>
                        <Text style={{ fontSize: 12, color: '#166534', fontWeight: 'bold' }}>+ Cart</Text>
                      </View>
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={{ padding: 20, alignItems: 'center' }}>
                    <Text style={{ color: '#6B7280', fontSize: 14 }}>Tidak ada produk yang cocok</Text>
                  </View>
                )}
              </ScrollView>
            </View>
          )}
        </View>

        <ScrollView style={[styles.mainScroll, { paddingTop: isTablet ? 96 : 90 }]} contentContainerStyle={{ paddingBottom: 220 }} showsVerticalScrollIndicator={false}>


          {/* Stats Cards - Dinamis dari DB */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsContainer}>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}><Ionicons name="calendar-outline" size={16} color="#166534" /></View>
              <Text style={styles.statTitle}>Total Penjualan Hari Ini</Text>
              <Text style={styles.statValue}>Rp {stats.totalRevenue.toLocaleString('id-ID')}</Text>
              <Text style={styles.statSub}><Text style={{color: '#6B7280'}}>-</Text> dari kemarin</Text>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statIconContainerOrange}><Ionicons name="bag-handle-outline" size={16} color="#D97706" /></View>
              <Text style={styles.statTitle}>Transaksi Hari Ini</Text>
              <Text style={styles.statValue}>{stats.totalTransactions}</Text>
              <Text style={styles.statSub}><Text style={{color: '#6B7280'}}>-</Text> transaksi</Text>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statIconContainerYellow}><Ionicons name="wallet-outline" size={16} color="#EAB308" /></View>
              <Text style={styles.statTitle}>Rata-rata Transaksi</Text>
              <Text style={styles.statValue}>Rp {Math.round(stats.averageTransaction).toLocaleString('id-ID')}</Text>
              <Text style={styles.statSub}><Text style={{color: '#6B7280'}}>-</Text> dari kemarin</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIconContainer, {backgroundColor: '#DBEAFE'}]}><Ionicons name="cube-outline" size={16} color="#2563EB" /></View>
              <Text style={styles.statTitle}>Item Terjual</Text>
              <Text style={styles.statValue}>{stats.itemsSold}</Text>
              <Text style={styles.statSub}><Text style={{color: '#6B7280'}}>-</Text> item</Text>
            </View>
          </ScrollView>

          {/* Categories */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Kategori Produk</Text>
            <TouchableOpacity><Text style={styles.seeAll}>Lihat Semua</Text></TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesContainer}>
            {categories.map(cat => (
              <TouchableOpacity 
                key={cat.id} 
                style={[styles.categoryItem, activeCategory === cat.id && styles.categoryItemActive]}
                onPress={() => setActiveCategory(cat.id)}
              >
                <View style={[styles.categoryIconBg, activeCategory === cat.id && styles.categoryIconBgActive]}>
                  {cat.icon === 'custom-soda-cup' ? (
                    <Image source={require('../../assets/soda_cup_transparent.png')} style={{ width: 34, height: 34, resizeMode: 'contain', tintColor: activeCategory === cat.id ? '#FFFFFF' : '#166534' }} />
                  ) : cat.icon?.startsWith('mci-') ? (
                    <MaterialCommunityIcons name={cat.icon.replace('mci-', '')} size={32} color={activeCategory === cat.id ? '#FFFFFF' : '#166534'} />
                  ) : cat.icon?.startsWith('mi-') ? (
                    <MaterialIcons name={cat.icon.replace('mi-', '')} size={32} color={activeCategory === cat.id ? '#FFFFFF' : '#166534'} />
                  ) : (
                    <Ionicons name={cat.icon || 'list-outline'} size={32} color={activeCategory === cat.id ? '#FFFFFF' : '#166534'} />
                  )}
                </View>
                <Text style={[styles.categoryText, activeCategory === cat.id && styles.categoryTextActive]}>{cat.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Popular Products */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Katalog Produk</Text>
            <TouchableOpacity onPress={() => fetchData()}><Text style={styles.seeAll}>Refresh</Text></TouchableOpacity>
          </View>
          
          {loading ? (
             <ActivityIndicator size="large" color="#166534" style={{ marginVertical: 20 }} />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {displayedProducts.map(item => (
                <View key={item.id.toString()}>
                  {renderProduct({ item })}
                </View>
              ))}
            </View>
          )}

          {/* Low Stock Warning */}
          {lowStockProducts.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <View style={{flexDirection:'row', alignItems:'center'}}>
                  <Ionicons name="warning" size={20} color="#D97706" style={{marginRight: 6}} />
                  <Text style={styles.sectionTitle}>Peringatan Stok Rendah</Text>
                </View>
                <TouchableOpacity><Text style={styles.seeAll}>Lihat Semua</Text></TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.lowStockContainer}>
                {lowStockProducts.map(item => {
                  const name = item.name || 'Produk';
                  const stock = item.current_stock || 0;
                  const cat = categories.find(c => c.id === item.category_id);
                  const catIcon = cat ? cat.icon : 'cube-outline';

                  return (
                    <View key={item.id} style={styles.lowStockCard}>
                      <View style={[styles.lowStockImage, { backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' }]}>
                        {catIcon === 'custom-soda-cup' ? (
                          <Image source={require('../../assets/soda_cup_transparent.png')} style={{ width: 24, height: 24, resizeMode: 'contain', tintColor: '#166534' }} />
                        ) : catIcon?.startsWith('mci-') ? (
                          <MaterialCommunityIcons name={catIcon.replace('mci-', '')} size={24} color="#166534" />
                        ) : catIcon?.startsWith('mi-') ? (
                          <MaterialIcons name={catIcon.replace('mi-', '')} size={24} color="#166534" />
                        ) : (
                          <Ionicons name={catIcon || 'cube-outline'} size={24} color="#166534" />
                        )}
                      </View>
                      <View style={styles.lowStockInfo}>
                        <Text style={styles.lowStockName} numberOfLines={1}>{name}</Text>
                        <Text style={styles.lowStockText}>Stok tinggal {stock}</Text>
                      </View>
                      <Ionicons name="warning-outline" size={20} color="#EF4444" />
                    </View>
                  );
                })}
              </ScrollView>
            </>
          )}
          
          <View style={{ height: 20 }} />
        </ScrollView>

        {/* Floating Cart Section */}
        <Animated.View 
          style={[
          styles.cartWrapper, 
          isLandscape ? styles.cartWrapperLandscape : {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: CART_MAX_HEIGHT,
            padding: 0,
            paddingHorizontal: 0,
            overflow: 'hidden',
            transform: [{ translateY: panY }]
          }
        ]}>
          <Animated.View {...(isLandscape ? {} : panResponder.panHandlers)}>
            <View 
              style={[
                styles.cartHeader, 
                !isLandscape && { marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, height: 60 }
              ]} 
            >
              <TouchableOpacity 
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: '100%', paddingRight: 12 }}
                onPress={isLandscape ? null : toggleCart}
                disabled={isLandscape}
                activeOpacity={isLandscape ? 1 : 0.8}
              >
                <Text style={styles.cartTitle}>Keranjang Belanja ({cart.length})</Text>
                {!isLandscape && (
                  <Ionicons 
                    name={isCartOpen ? "chevron-down" : "chevron-up"} 
                    size={20} 
                    color="#FFF" 
                    style={{ marginRight: isCartOpen ? 16 : 0 }} 
                  />
                )}
              </TouchableOpacity>

              {(isCartOpen || isLandscape) && (
                <TouchableOpacity onPress={clearCart} style={{ padding: 8 }}>
                  <Ionicons name="trash-outline" size={20} color="#FFF" />
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>

          <View style={{ flex: 1, padding: 16 }}>
            <FlatList
              style={styles.cartList}
              data={cart}
                keyExtractor={(item) => item.id.toString()}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const cat = categories.find(c => c.id === item.category_id);
                  const catIcon = cat ? cat.icon : 'cube-outline';
                  return (
                    <View style={styles.cartItem}>
                      <View style={[styles.cartItemImage, { backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' }]}>
                        {catIcon === 'custom-soda-cup' ? (
                          <Image source={require('../../assets/soda_cup_transparent.png')} style={{ width: 24, height: 24, resizeMode: 'contain', tintColor: '#166534' }} />
                        ) : catIcon?.startsWith('mci-') ? (
                          <MaterialCommunityIcons name={catIcon.replace('mci-', '')} size={24} color="#166534" />
                        ) : catIcon?.startsWith('mi-') ? (
                          <MaterialIcons name={catIcon.replace('mi-', '')} size={24} color="#166534" />
                        ) : (
                          <Ionicons name={catIcon || 'cube-outline'} size={24} color="#166534" />
                        )}
                      </View>
                      <View style={styles.cartItemInfo}>
                      <Text style={styles.cartItemName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.cartItemPrice}>Rp {(item.selling_price || 0).toLocaleString('id-ID')}</Text>
                    </View>
                    <View style={styles.qtyControl}>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.id, -1)}>
                        <Text style={styles.qtyBtnText}>-</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyValue}>{item.qty}</Text>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.id, 1)}>
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.cartItemTotal}>
                      <Text style={styles.cartItemTotalPrice}>Rp {((item.selling_price || 0) * item.qty).toLocaleString('id-ID')}</Text>
                      <TouchableOpacity onPress={() => removeFromCart(item.id)}>
                        <Ionicons name="close" size={20} color="#6B7280" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={{textAlign: 'center', marginVertical: 20, color: '#9CA3AF'}}>Keranjang masih kosong</Text>}
            />

              <View style={styles.cartFooter}>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total</Text>
                  <View style={{flexDirection:'row', alignItems:'center'}}>
                    <Text style={styles.totalAmount}>Rp {totalCart.toLocaleString('id-ID')}</Text>
                  </View>
                </View>

                <View style={styles.checkoutButtons}>
                  <TouchableOpacity 
                    style={[styles.checkoutBtn, { backgroundColor: '#166534' }]} 
                    onPress={() => handleCheckoutClick('TUNAI')}
                  >
                    <Ionicons name="cash-outline" size={24} color="#FFF" />
                    <Text style={styles.checkoutBtnText}>TUNAI</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.checkoutBtn, { backgroundColor: '#F97316' }]} 
                    onPress={() => handleCheckoutClick('QRIS')}
                  >
                    <Ionicons name="qr-code-outline" size={24} color="#FFF" />
                    <Text style={styles.checkoutBtnText}>QRIS</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
        </Animated.View>

      </View>

      {/* MODAL PEMBAYARAN TUNAI */}
      <Modal visible={showCashModal} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAwareScrollView 
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} 
            keyboardShouldPersistTaps="handled"
            enableOnAndroid={true}
            extraScrollHeight={50}
          >
            <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Pembayaran Tunai</Text>
            
            <View style={styles.modalTotalBox}>
              <Text style={styles.modalTotalLabel}>Total Tagihan:</Text>
              <Text style={styles.modalTotalValue}>Rp {totalCart.toLocaleString('id-ID')}</Text>
            </View>

            <Text style={styles.modalInputLabel}>Uang Diterima (Rp):</Text>
            <TextInput 
              style={styles.modalInput}
              keyboardType="numeric"
              placeholder="Contoh: 200000"
              value={amountPaid}
              onChangeText={setAmountPaid}
              autoFocus
            />

            <View style={styles.modalChangeBox}>
              <Text style={styles.modalChangeLabel}>Kembalian:</Text>
              <Text style={[styles.modalChangeValue, { color: change >= 0 ? '#166534' : '#EF4444' }]}>
                {change >= 0 ? `Rp ${change.toLocaleString('id-ID')}` : 'Uang Kurang!'}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowCashModal(false)}>
                <Text style={styles.modalCancelText}>Batal</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalConfirmBtn, { opacity: (change >= 0 && !isCheckingOut) ? 1 : 0.5 }]} 
                onPress={() => processTransaction('TUNAI')}
                disabled={change < 0 || isCheckingOut}
              >
                {isCheckingOut ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalConfirmText}>Simpan Transaksi</Text>}
              </TouchableOpacity>
            </View>
            </View>
          </KeyboardAwareScrollView>
        </View>
      </Modal>

      {/* MODAL PEMBAYARAN QRIS */}
      <Modal visible={showQRModal} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { alignItems: 'center' }]}>
            <Text style={styles.modalTitle}>Pembayaran QRIS</Text>
            <Text style={{color: '#6B7280', marginBottom: 16}}>Minta pelanggan scan QR Code di bawah</Text>
            
            <View style={styles.qrCodeContainer}>
              <Image 
                source={require('../../assets/qris.png')} 
                style={{width: 200, height: 200}} 
              />
            </View>

            <Text style={styles.modalTotalValue}>Rp {totalCart.toLocaleString('id-ID')}</Text>
            
            <View style={[styles.modalActions, { marginTop: 24, width: '100%' }]}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowQRModal(false)}>
                <Text style={styles.modalCancelText}>Batal</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalConfirmBtn, { backgroundColor: '#F97316' }]} 
                onPress={() => processTransaction('QRIS')}
                disabled={isCheckingOut}
              >
                {isCheckingOut ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalConfirmText}>Konfirmasi Pembayaran</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL STRUK */}
      <Modal visible={showReceiptModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.receiptContent}>
            <View style={{ alignItems: 'center', marginBottom: 8 }}>
              <Image source={require('../../assets/logo.png')} style={{ width: 80, height: 80 }} resizeMode="contain" />
            </View>
            <Text style={styles.receiptStoreName}>Toko Queensha</Text>
            <Text style={styles.receiptAddress}>Jl. Contoh Alamat No. 123</Text>
            <Text style={styles.receiptDivider}>--------------------------------</Text>
            
            {receiptData && (
              <>
                <View style={styles.receiptHeaderRow}>
                  <Text style={styles.receiptText}>{receiptData.date}</Text>
                  <Text style={styles.receiptText}>{receiptData.invoice}</Text>
                </View>
                <Text style={styles.receiptText}>Metode: {receiptData.method}</Text>
                <Text style={styles.receiptDivider}>--------------------------------</Text>
                
                <ScrollView style={{maxHeight: 200, marginVertical: 8}}>
                  {receiptData.items.map((item, idx) => {
                    const price = item.selling_price || 0;
                    const name = item.name || 'Produk';
                    return (
                      <View key={idx} style={{marginBottom: 4}}>
                        <Text style={styles.receiptItemName}>{name}</Text>
                        <View style={styles.receiptItemRow}>
                          <Text style={styles.receiptText}>{item.qty} x Rp {price.toLocaleString('id-ID')}</Text>
                          <Text style={styles.receiptText}>Rp {(item.qty * price).toLocaleString('id-ID')}</Text>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
                
                <Text style={styles.receiptDivider}>--------------------------------</Text>
                <View style={styles.receiptTotalRow}>
                  <Text style={styles.receiptTotalText}>Total</Text>
                  <Text style={styles.receiptTotalText}>Rp {receiptData.total.toLocaleString('id-ID')}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptText}>Tunai</Text>
                  <Text style={styles.receiptText}>Rp {receiptData.paid.toLocaleString('id-ID')}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptText}>Kembali</Text>
                  <Text style={styles.receiptText}>Rp {receiptData.change.toLocaleString('id-ID')}</Text>
                </View>
              </>
            )}

            <Text style={styles.receiptFooter}>Terima Kasih Atas Kunjungan Anda</Text>

            <View style={[styles.modalActions, { marginTop: 24 }]}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowReceiptModal(false)}>
                <Text style={styles.modalCancelText}>Tutup</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalConfirmBtn, { backgroundColor: '#2563EB', flexDirection: 'row', justifyContent: 'center' }]} onPress={handlePrintReceipt}>
                <Ionicons name="print" size={20} color="#FFF" style={{marginRight: 8}} />
                <Text style={styles.modalConfirmText}>Print Struk</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL PROFILE DRAWER */}
      <Modal visible={showProfileDrawer} transparent={true} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowProfileDrawer(false)}>
          <View 
            style={[
            styles.profileDrawer,
            isTablet ? styles.profileDrawerTablet : styles.profileDrawerPhone,
          ]}>
            <View style={styles.profileDrawerHeader}>
              <Image 
                source={
                  userRoleLabel === 'Master App' 
                    ? require('../../assets/master.jpg') 
                    : userRoleLabel === 'Owner'
                      ? require('../../assets/owner.jpg')
                      : require('../../assets/kasir.jpg')
                } 
                style={styles.profileDrawerAvatar} 
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.profileDrawerName}>Halo, {userRoleLabel}</Text>
                <Text style={styles.profileDrawerEmail} numberOfLines={1}>{userEmail}</Text>
              </View>
            </View>
            <View style={styles.profileDrawerDivider} />
            <TouchableOpacity 
              style={styles.profileDrawerLogout}
              onPress={async () => { setShowProfileDrawer(false); await signOut(auth); }}
            >
              <Ionicons name="log-out-outline" size={18} color="#EF4444" />
              <Text style={styles.profileDrawerLogoutText}>Keluar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MODAL NOTIFIKASI STOK RENDAH */}
      <Modal visible={isNotificationVisible} transparent={true} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsNotificationVisible(false)}>
          <View style={[styles.profileDrawer, isTablet ? styles.profileDrawerTablet : styles.profileDrawerPhone, { padding: 0, overflow: 'hidden' }]}>
            <View style={{ backgroundColor: '#FEF3C7', padding: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#FDE68A' }}>
              <Ionicons name="warning" size={24} color="#D97706" style={{ marginRight: 8 }} />
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#92400E' }}>Peringatan Stok Habis!</Text>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {lowStockProducts.map(item => (
                <TouchableOpacity 
                  key={item.id} 
                  style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                  onPress={() => {
                    setIsNotificationVisible(false);
                    if (userRoleLabel === 'Owner' || userRoleLabel === 'Master App') {
                      navigation.navigate('Stok');
                    } else {
                      Alert.alert('Akses Ditolak', 'Harap lapor ke Owner untuk restock barang ini.');
                    }
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827' }} numberOfLines={1}>{item.name}</Text>
                    <Text style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>Sisa stok: {item.current_stock}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>


    </SafeAreaView>
  );
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const isTabletStyle = Math.min(screenWidth, screenHeight) >= 600;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F9FAFB', paddingTop: (Platform.OS === 'android' && !isTabletStyle) ? StatusBar.currentHeight : 0 },
  container: { flex: 1 },
  mainScroll: { flex: 1, paddingHorizontal: 16 },

  // --- FLOATING HEADER ---
  floatingHeader: { position: 'absolute', top: 16, left: 16, right: 16, backgroundColor: '#FFF', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', zIndex: 50, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6, borderWidth: 1, borderColor: '#E5E7EB' },
  floatingHeaderTablet: { top: 8, left: 24, right: 24, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 18 },

  headerLogo: { position: 'absolute', left: -8, top: -2, width: 90, height: 75, backgroundColor: 'transparent', zIndex: 10 },
  headerLogoTablet: { left: 8, top: 4, width: 75, height: 52 },

  // --- SEARCH BAR (Lebih panjang, teks tidak akan terpotong) ---
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 10, paddingHorizontal: 10, height: 42, marginLeft: 70, marginRight: 8, zIndex: 1, elevation: 0 },
  searchBarTablet: { height: 36, borderRadius: 12, marginLeft: 92, marginRight: 12 },
  searchIcon: { marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13, height: '100%', color: '#111827', fontWeight: '500' },
  searchInputTablet: { fontSize: 16 },

  // --- HEADER ICONS ---
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  bellIconBtn: { position: 'relative' },
  badge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#F97316', borderRadius: 10, width: 16, height: 16, zIndex: 1, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },

  // --- PROFILE BUTTON ---
  profileBtn: { alignItems: 'center', padding: 2 },
  profileBtnTablet: { padding: 8 },
  profileImage: { width: 32, height: 32, borderRadius: 16, marginBottom: 2 },
  profileImageTablet: { width: 34, height: 34, borderRadius: 17, marginBottom: 2 },
  profileTextContainer: { flexDirection: 'row', alignItems: 'center' },
  profileText: { fontSize: 10, fontWeight: '600', color: '#374151', marginRight: 2 },
  profileTextTablet: { fontSize: 13, marginRight: 4 },

  // --- PROFILE DRAWER ---
  profileDrawer: { position: 'absolute', backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 16, padding: 16, zIndex: 100, elevation: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', overflow: 'hidden' },
  profileDrawerPhone: { top: 75, right: 16, width: 220 },
  profileDrawerTablet: { top: 68, right: 24, width: 280 },
  profileDrawerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  profileDrawerAvatar: { width: 44, height: 44, borderRadius: 22 },
  profileDrawerName: { fontSize: 14, fontWeight: 'bold', color: '#111827', marginBottom: 2 },
  profileDrawerEmail: { fontSize: 12, color: '#6B7280' },
  profileDrawerDivider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  profileDrawerLogout: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  profileDrawerLogoutText: { fontSize: 14, fontWeight: '600', color: '#EF4444' },
  statsContainer: { paddingBottom: 8, gap: 12 },
  statCard: { backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', width: 150 },
  statIconContainer: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#DCFCE7', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statIconContainerOrange: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#FFEDD5', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statIconContainerYellow: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#FEF08A', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statTitle: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  statValue: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  statSub: { fontSize: 10, color: '#6B7280' },
  statUp: { color: '#166534', fontWeight: 'bold' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
  seeAll: { fontSize: 12, color: '#166534', fontWeight: '600' },
  categoriesContainer: { gap: 16, paddingBottom: 8 },
  categoryItem: { alignItems: 'center' },
  categoryIconBg: { width: 60, height: 60, borderRadius: 16, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  categoryIconBgActive: { backgroundColor: '#166534', borderColor: '#166534' },
  categoryText: { fontSize: 12, color: '#4B5563', fontWeight: '500' },
  categoryTextActive: { color: '#111827', fontWeight: 'bold' },
  popularContainer: { gap: 16, paddingBottom: 8 },
  productCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 12, width: 160, borderWidth: 1, borderColor: '#E5E7EB', position: 'relative' },
  productImage: { width: '100%', height: 100, borderRadius: 8, marginBottom: 12, resizeMode: 'contain' },
  productIconContainer: { width: '100%', height: 100, borderRadius: 8, marginBottom: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  addBtn: { position: 'absolute', right: 12, top: 100, backgroundColor: '#166534', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2 },
  productName: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 4, height: 40 },
  productPrice: { fontSize: 14, fontWeight: 'bold', color: '#166534', marginBottom: 4 },
  productStock: { fontSize: 12, color: '#166534' },
  lowStockContainer: { gap: 12, paddingBottom: 16 },
  lowStockCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', width: 250 },
  lowStockImage: { width: 40, height: 40, borderRadius: 6, marginRight: 12, resizeMode: 'contain' },
  lowStockInfo: { flex: 1 },
  lowStockName: { fontSize: 12, fontWeight: '600', color: '#111827', marginBottom: 2 },
  lowStockText: { fontSize: 12, color: '#EF4444', fontWeight: '500' },
  cartWrapper: { backgroundColor: 'rgba(255, 255, 255, 0.9)', borderTopLeftRadius: 20, borderTopRightRadius: 20, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, elevation: 10, padding: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderBottomWidth: 0 },
  cartWrapperLandscape: { flex: 4, maxHeight: '100%', borderTopLeftRadius: 0, borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.4)', elevation: 0, shadowOpacity: 0, shadowColor: 'transparent' },
  cartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#166534', padding: 12, borderRadius: 10, marginBottom: 12 },
  cartTitle: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  cartList: { flexShrink: 1, marginBottom: 12 },
  cartItem: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingVertical: 12 },
  cartItemImage: { width: 40, height: 40, borderRadius: 6, marginRight: 12, resizeMode: 'contain' },
  cartItemInfo: { flex: 1 },
  cartItemName: { fontSize: 12, fontWeight: '600', color: '#111827', marginBottom: 4 },
  cartItemPrice: { fontSize: 12, color: '#6B7280' },
  qtyControl: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 6, marginRight: 12 },
  qtyBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  qtyBtnText: { fontSize: 16, color: '#6B7280', fontWeight: 'bold' },
  qtyValue: { fontSize: 14, fontWeight: 'bold', color: '#111827', paddingHorizontal: 8 },
  cartItemTotal: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 },
  cartItemTotalPrice: { fontSize: 14, fontWeight: 'bold', color: '#111827' },
  cartFooter: { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  totalLabel: { fontSize: 18, fontWeight: 'bold', color: '#111827' },
  totalAmount: { fontSize: 20, fontWeight: 'bold', color: '#166534' },
  checkoutButtons: { flexDirection: 'row', gap: 12 },
  checkoutBtn: { flex: 1, height: 50, borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  checkoutBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: '#FFF', borderRadius: 16, padding: 24, width: '100%', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginBottom: 16, textAlign: 'center' },
  modalTotalBox: { backgroundColor: '#F3F4F6', padding: 16, borderRadius: 8, marginBottom: 16, alignItems: 'center' },
  modalTotalLabel: { fontSize: 14, color: '#6B7280', marginBottom: 4 },
  modalTotalValue: { fontSize: 24, fontWeight: 'bold', color: '#166534' },
  modalInputLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 16, fontSize: 20, fontWeight: 'bold', color: '#111827', marginBottom: 16 },
  modalChangeBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB', marginBottom: 24 },
  modalChangeLabel: { fontSize: 16, fontWeight: 'bold', color: '#374151' },
  modalChangeValue: { fontSize: 20, fontWeight: 'bold' },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, backgroundColor: '#E5E7EB', alignItems: 'center' },
  modalCancelText: { color: '#4B5563', fontWeight: 'bold', fontSize: 16 },
  modalConfirmBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, backgroundColor: '#166534', alignItems: 'center' },
  modalConfirmText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  qrCodeContainer: { backgroundColor: '#FFF', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 16 },
  
  receiptContent: { backgroundColor: '#FFF', borderRadius: 8, padding: 24, width: 320, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  receiptStoreName: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', color: '#111827', marginBottom: 4 },
  receiptAddress: { fontSize: 12, textAlign: 'center', color: '#6B7280', marginBottom: 12 },
  receiptDivider: { fontSize: 14, textAlign: 'center', color: '#9CA3AF', marginVertical: 8, letterSpacing: 2 },
  receiptHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  receiptText: { fontSize: 12, color: '#374151', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  receiptItemName: { fontSize: 12, color: '#111827', fontWeight: 'bold', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  receiptItemRow: { flexDirection: 'row', justifyContent: 'space-between' },
  receiptTotalRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8 },
  receiptTotalText: { fontSize: 14, fontWeight: 'bold', color: '#111827', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  receiptFooter: { fontSize: 12, textAlign: 'center', color: '#6B7280', marginTop: 16, fontStyle: 'italic' },
});
