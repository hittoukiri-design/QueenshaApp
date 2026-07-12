import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { db } from './firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc, getDoc, setDoc, getDocs } from 'firebase/firestore';

const QUEUE_KEY = 'OFFLINE_SYNC_QUEUE';

export const fetchCollectionData = async (collectionName, customQuery = null) => {
  try {
    const netInfo = await NetInfo.fetch();
    if (!netInfo.isConnected) {
      console.log(`[Offline] Loading ${collectionName} from cache`);
      return (await getCachedData(collectionName.toUpperCase())) || [];
    }
    
    const q = customQuery || collection(db, collectionName);
    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await cacheData(collectionName.toUpperCase(), data);
    return data;
  } catch (error) {
    console.log(`[Error] Fetching ${collectionName}, falling back to cache.`, error);
    return (await getCachedData(collectionName.toUpperCase())) || [];
  }
};

export const cacheData = async (key, data) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error(`Error caching ${key}:`, error);
  }
};

export const getCachedData = async (key) => {
  try {
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`Error getting cached ${key}:`, error);
    return null;
  }
};

export const addOfflineAction = async (type, payload) => {
  try {
    const currentQueueStr = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = currentQueueStr ? JSON.parse(currentQueueStr) : [];
    
    queue.push({
      id: Date.now().toString(),
      type,
      payload,
      timestamp: new Date().toISOString()
    });
    
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    console.log(`[SyncEngine] Action ${type} added to offline queue.`);
  } catch (error) {
    console.error('[SyncEngine] Error adding to offline queue:', error);
  }
};

export const processSyncQueue = async () => {
  try {
    const netInfo = await NetInfo.fetch();
    if (!netInfo.isConnected) {
      console.log('[SyncEngine] Internet offline, skipping sync.');
      return;
    }

    const currentQueueStr = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = currentQueueStr ? JSON.parse(currentQueueStr) : [];
    
    if (queue.length === 0) return;

    console.log(`[SyncEngine] Processing ${queue.length} offline actions...`);
    
    const remainingQueue = [];

    for (const action of queue) {
      try {
        if (action.type === 'NEW_TRANSACTION') {
          const { trxData, items } = action.payload;
          
          const trxRef = await addDoc(collection(db, 'transactions'), trxData);

          if (items && items.length > 0) {
            for (const item of items) {
              const itemToInsert = {
                ...item,
                transaction_id: trxRef.id
              };
              await addDoc(collection(db, 'transaction_items'), itemToInsert);
              
              if (item.product_id) {
                const prodRef = doc(db, 'products', item.product_id);
                const prodSnap = await getDoc(prodRef);
                if (prodSnap.exists()) {
                  const currentStock = parseInt(prodSnap.data().current_stock || 0);
                  const newStock = Math.max(0, currentStock - item.jumlah);
                  await updateDoc(prodRef, { current_stock: newStock });
                }
              }
            }
          }
        } else if (action.type === 'ADD_PRODUCT') {
          // If we want to assign a specific ID, use setDoc. Since payload doesn't specify an ID, use addDoc
          if (action.payload.id) {
             await setDoc(doc(db, 'products', action.payload.id), action.payload);
          } else {
             await addDoc(collection(db, 'products'), action.payload);
          }
        } else if (action.type === 'EDIT_PRODUCT') {
          await updateDoc(doc(db, 'products', action.payload.id), action.payload.updates);
        } else if (action.type === 'DELETE_PRODUCT') {
          await deleteDoc(doc(db, 'products', action.payload.id));
        } else if (action.type === 'ADD_USER') {
          await setDoc(doc(db, 'profiles', action.payload.id), action.payload);
        } else if (action.type === 'ADD_CATEGORY') {
          if (action.payload.id) {
            await setDoc(doc(db, 'categories', action.payload.id), action.payload);
          } else {
            await addDoc(collection(db, 'categories'), action.payload);
          }
        } else if (action.type === 'EDIT_CATEGORY') {
          await updateDoc(doc(db, 'categories', action.payload.id), action.payload.updates);
        } else if (action.type === 'DELETE_CATEGORY') {
          await deleteDoc(doc(db, 'categories', action.payload.id));
        }
        
        console.log(`[SyncEngine] Action ${action.type} synced successfully.`);
      } catch (err) {
        console.error(`[SyncEngine] Failed to sync action ${action.type}:`, err);
        remainingQueue.push(action);
      }
    }

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remainingQueue));
    console.log('[SyncEngine] Sync completed.');

  } catch (error) {
    console.error('[SyncEngine] Error in processSyncQueue:', error);
  }
};
