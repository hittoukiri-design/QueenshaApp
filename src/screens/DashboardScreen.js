import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Platform, StatusBar, ActivityIndicator, Dimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { useIsFocused } from '@react-navigation/native';
import { fetchCollectionData } from '../lib/syncEngine';

export default function DashboardScreen() {
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalTransactions: 0,
    averageTransaction: 0,
    itemsSold: 0
  });

  const [recentTransactions, setRecentTransactions] = useState([]);

  useEffect(() => {
    if (isFocused) {
      fetchDashboardData();
    }
  }, [isFocused]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const q = query(collection(db, 'transactions'), where('created_at', '>=', todayISO));
      const transactions = await fetchCollectionData('transactions', q);

      // Sort descending by created_at
      transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const totalRev = transactions.reduce((sum, t) => sum + (t.total_harga || 0), 0);
      const totalCount = transactions.length;
      const average = totalCount > 0 ? (totalRev / totalCount) : 0;

      let totalItems = 0;
      if (totalCount > 0) {
        const trxIds = transactions.map(t => t.id);
        // Firestore doesn't have an exact 'in' query for large arrays, but we can query all items for today's transactions
        // For simplicity, we just fetch all transaction_items and filter in memory since it's a client app
        const allItems = await fetchCollectionData('transaction_items');
        const todayItems = allItems.filter(item => trxIds.includes(item.transaction_id));
        totalItems = todayItems.reduce((sum, item) => sum + (item.jumlah || 0), 0);
      }

      setStats({
        totalRevenue: totalRev,
        totalTransactions: totalCount,
        averageTransaction: average,
        itemsSold: totalItems
      });

      setRecentTransactions(transactions.slice(0, 5));

    } catch (err) {
      console.log('Error fetching dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <View>
          <Text style={styles.headerTitle}>Dashboard Laporan</Text>
          <Text style={styles.headerSubtitle}>Statistik Penjualan Hari Ini</Text>
        </View>
        <Image 
          source={require('../../assets/logo.png')} 
          style={{ width: 60, height: 60 }} 
          resizeMode="contain" 
        />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#166534" style={{marginTop: 40}} />
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          
          <View style={styles.mainCard}>
            <Text style={styles.mainCardLabel}>Total Pendapatan</Text>
            <Text style={styles.mainCardValue}>Rp {stats.totalRevenue.toLocaleString('id-ID')}</Text>
            <View style={styles.mainCardBadge}>
              <Ionicons name="trending-up" size={16} color="#DCFCE7" />
              <Text style={styles.mainCardBadgeText}>Hari ini</Text>
            </View>
          </View>

          <View style={styles.gridContainer}>
            <View style={styles.gridCard}>
              <View style={[styles.iconBg, {backgroundColor: '#FFEDD5'}]}>
                <Ionicons name="receipt" size={24} color="#D97706" />
              </View>
              <Text style={styles.gridValue}>{stats.totalTransactions}</Text>
              <Text style={styles.gridLabel}>Transaksi</Text>
            </View>

            <View style={styles.gridCard}>
              <View style={[styles.iconBg, {backgroundColor: '#FEF08A'}]}>
                <Ionicons name="wallet" size={24} color="#CA8A04" />
              </View>
              <Text style={styles.gridValue}>Rp {Math.round(stats.averageTransaction).toLocaleString('id-ID')}</Text>
              <Text style={styles.gridLabel}>Rata-rata</Text>
            </View>

            <View style={styles.gridCard}>
              <View style={[styles.iconBg, {backgroundColor: '#DBEAFE'}]}>
                <Ionicons name="cube" size={24} color="#2563EB" />
              </View>
              <Text style={styles.gridValue}>{stats.itemsSold}</Text>
              <Text style={styles.gridLabel}>Item Terjual</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Transaksi Terakhir</Text>
          {recentTransactions.length === 0 ? (
            <Text style={styles.emptyText}>Belum ada transaksi hari ini.</Text>
          ) : (
            recentTransactions.map((trx, index) => {
              const date = new Date(trx.created_at);
              const timeString = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
              
              return (
                <View key={trx.id || index} style={styles.historyCard}>
                  <View style={styles.historyIcon}>
                    <Ionicons name="checkmark-circle" size={24} color="#166534" />
                  </View>
                  <View style={styles.historyInfo}>
                    <Text style={styles.historyId}>TRX-{trx.id?.toString().padStart(4, '0') || '0000'}</Text>
                    <Text style={styles.historyTime}>{timeString} WIB</Text>
                  </View>
                  <Text style={styles.historyTotal}>Rp {trx.total_harga?.toLocaleString('id-ID')}</Text>
                </View>
              );
            })
          )}

          <View style={{height: 40}} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const isTablet = Math.min(screenWidth, screenHeight) >= 600;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F9FAFB', paddingTop: (Platform.OS === 'android' && !isTablet) ? StatusBar.currentHeight : 0 },
  header: { padding: 24, paddingBottom: 16 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#111827' },
  headerSubtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  content: { flex: 1, paddingHorizontal: 16 },
  
  mainCard: { backgroundColor: '#166534', borderRadius: 16, padding: 24, marginBottom: 16, position: 'relative', overflow: 'hidden' },
  mainCardLabel: { color: '#D1FAE5', fontSize: 14, fontWeight: '500', marginBottom: 8 },
  mainCardValue: { color: '#FFF', fontSize: 32, fontWeight: 'bold', marginBottom: 16 },
  mainCardBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 4 },
  mainCardBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '600' },

  gridContainer: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  gridCard: { flex: 1, backgroundColor: '#FFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center' },
  iconBg: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  gridValue: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  gridLabel: { fontSize: 12, color: '#6B7280' },

  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827', marginBottom: 16 },
  emptyText: { color: '#6B7280', textAlign: 'center', marginVertical: 20 },
  
  historyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  historyIcon: { marginRight: 12 },
  historyInfo: { flex: 1 },
  historyId: { fontSize: 14, fontWeight: 'bold', color: '#111827', marginBottom: 2 },
  historyTime: { fontSize: 12, color: '#6B7280' },
  historyTotal: { fontSize: 16, fontWeight: 'bold', color: '#166534' },
});
