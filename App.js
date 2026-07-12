import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, Alert, StatusBar, Dimensions } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from './src/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

// Screens
import './src/lib/backgroundBackup';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import PosScreen from './src/screens/PosScreen';
import AddProductScreen from './src/screens/AddProductScreen';
import ProductScreen from './src/screens/ProductScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StockScreen from './src/screens/StockScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import UsersScreen from './src/screens/UsersScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import MasterPanelScreen from './src/screens/MasterPanelScreen';
import PrinterSettingsScreen from './src/screens/PrinterSettingsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

export const RoleContext = React.createContext({ role: 'kasir', permissions: [] });

// Bottom Tab Navigator
function MainTabs() {
  const { role, permissions } = React.useContext(RoleContext);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'Dashboard') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'POS') {
            iconName = focused ? 'bag-handle' : 'bag-handle-outline';
          } else if (route.name === 'Produk') {
            iconName = focused ? 'cube' : 'cube-outline';
          } else if (route.name === 'Stok') {
            iconName = focused ? 'layers' : 'layers-outline';
          } else if (route.name === 'Lainnya') {
            iconName = focused ? 'menu' : 'menu-outline';
          }

          return <Ionicons name={iconName} size={24} color={color} />;
        },
        tabBarActiveTintColor: '#166534',
        tabBarInactiveTintColor: 'gray',
        headerShown: false,
        tabBarStyle: {
          paddingBottom: 5,
          paddingTop: 5,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500'
        }
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="POS" component={PosScreen} />
      {(role === 'master' || role === 'owner' || permissions.includes('menu_produk')) && <Tab.Screen name="Produk" component={ProductScreen} />}
      {(role === 'master' || role === 'owner' || permissions.includes('menu_stok')) && <Tab.Screen name="Stok" component={StockScreen} />}
      <Tab.Screen name="Lainnya" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

const { width, height } = Dimensions.get('window');
const isTablet = Math.min(width, height) >= 600;

export default function App() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState('kasir');
  const [permissions, setPermissions] = useState([]);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await checkRole(user);
        setSession({ user });
      } else {
        setSession(null);
        setRole('kasir');
        setPermissions([]);
      }
      setIsInitializing(false);
    });

    return () => unsubscribe();
  }, []);

  const checkRole = async (user) => {
    if (user) {
      if (user.email === 'chris@tambayong.com') {
        setRole('master');
        setPermissions(['menu_stok', 'menu_users', 'menu_history']);
        return;
      }

      try {
        const docRef = doc(db, 'profiles', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setRole(data.role || 'kasir');
          setPermissions(data.permissions || []);
        } else {
          Alert.alert('Akses Ditolak', 'Akun Anda tidak aktif atau telah dihapus.');
          await signOut(auth);
        }
      } catch (error) {
        console.error('Error fetching role:', error);
      }
    }
  };

  if (isInitializing) {
    return (
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <RoleContext.Provider value={{ role, permissions }}>
      <StatusBar hidden={isTablet} />
      <NavigationContainer>
        <Stack.Navigator>
          {session && session.user ? (
            // User is signed in
            <>
              <Stack.Screen 
                name="Main" 
                component={MainTabs} 
                options={{ headerShown: false }} 
              />
            <Stack.Screen 
              name="AddProduct" 
              component={AddProductScreen} 
              options={{ title: 'Tambah Produk' }} 
            />
            <Stack.Screen 
              name="Users" 
              component={UsersScreen} 
              options={{ headerShown: false }} 
            />
            <Stack.Screen 
              name="MasterPanel" 
              component={MasterPanelScreen} 
              options={{ headerShown: false }} 
            />
            <Stack.Screen 
              name="History" 
              component={HistoryScreen} 
              options={{ headerShown: false }} 
            />
            <Stack.Screen 
              name="PrinterSettings" 
              component={PrinterSettingsScreen} 
              options={{ headerShown: false }} 
            />
          </>
        ) : (
          // User is not signed in
          <>
            <Stack.Screen 
              name="Login" 
              component={LoginScreen} 
              options={{ headerShown: false }} 
            />
            <Stack.Screen 
              name="Register" 
              component={RegisterScreen} 
              options={{ headerShown: false }} 
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
    </RoleContext.Provider>
  );
}
