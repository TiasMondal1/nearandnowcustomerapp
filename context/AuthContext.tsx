import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  getCurrentUserFromSession,
  sendOTP,
  updateCustomerProfile,
  verifyOTP,
  type AppUser,
  type Customer,
} from '../lib/authService';

interface AuthContextType {
  user: AppUser | null;
  customer: Customer | null;
  userId: string | null;
  userToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sendOTPCode: (phone: string) => Promise<void>;
  verifyOTPCode: (phone: string, otp: string, name?: string) => Promise<void>;
  logoutUser: () => Promise<void>;
  updateUserProfile: (data: Parameters<typeof updateCustomerProfile>[1]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    restoreSession();
  }, []);

  const restoreSession = async () => {
    try {
      setIsLoading(true);
      const [storedUserId, storedToken] = await Promise.all([
        AsyncStorage.getItem('userId'),
        AsyncStorage.getItem('userToken'),
      ]);

      if (storedUserId && storedToken) {
        const fresh = await getCurrentUserFromSession(storedUserId);
        if (fresh) {
          setUser(fresh.user);
          setCustomer(fresh.customer || null);
          setUserId(storedUserId);
          setUserToken(storedToken);
          setIsAuthenticated(true);
          await Promise.all([
            AsyncStorage.setItem('userData', JSON.stringify(fresh.user)),
            AsyncStorage.setItem(
              'customerData',
              fresh.customer ? JSON.stringify(fresh.customer) : '',
            ),
          ]);
        } else {
          await clearStoredSession();
        }
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const clearStoredSession = async () => {
    await Promise.all([
      AsyncStorage.removeItem('userId'),
      AsyncStorage.removeItem('userToken'),
      AsyncStorage.removeItem('userData'),
      AsyncStorage.removeItem('customerData'),
    ]);
    setUser(null);
    setCustomer(null);
    setUserId(null);
    setUserToken(null);
    setIsAuthenticated(false);
  };

  const sendOTPCode = async (phone: string) => {
    await sendOTP(phone);
  };

  const verifyOTPCode = async (phone: string, otp: string, name = 'Customer') => {
    const response = await verifyOTP(phone, otp, name);

    setUser(response.user);
    setCustomer(response.customer || null);
    setUserId(response.user.id);
    setUserToken(response.token);
    setIsAuthenticated(true);

    await Promise.all([
      AsyncStorage.setItem('userId', response.user.id),
      AsyncStorage.setItem('userToken', response.token),
      AsyncStorage.setItem('userData', JSON.stringify(response.user)),
      AsyncStorage.setItem(
        'customerData',
        response.customer ? JSON.stringify(response.customer) : '',
      ),
    ]);
  };

  const logoutUser = async () => {
    await clearStoredSession();
  };

  const updateUserProfile = async (data: Parameters<typeof updateCustomerProfile>[1]) => {
    if (!user) throw new Error('No user logged in');

    await updateCustomerProfile(user.id, data);

    const refreshed = await getCurrentUserFromSession(user.id);
    if (refreshed) {
      setUser(refreshed.user);
      setCustomer(refreshed.customer || null);
      await Promise.all([
        AsyncStorage.setItem('userData', JSON.stringify(refreshed.user)),
        AsyncStorage.setItem(
          'customerData',
          refreshed.customer ? JSON.stringify(refreshed.customer) : '',
        ),
      ]);
    } else {
      const updatedUser = {
        ...user,
        ...(data.name && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
      };
      setUser(updatedUser);
      await AsyncStorage.setItem('userData', JSON.stringify(updatedUser));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        customer,
        userId,
        userToken,
        isLoading,
        isAuthenticated,
        sendOTPCode,
        verifyOTPCode,
        logoutUser,
        updateUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
