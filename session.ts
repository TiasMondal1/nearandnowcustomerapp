import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppUser, Customer } from './lib/authService';

export type UserSession = {
  userId: string;
  userToken: string;
  userData: AppUser;
  customerData?: Customer | null;
};

export async function saveSession(session: UserSession): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem('userId', session.userId),
    AsyncStorage.setItem('userToken', session.userToken),
    AsyncStorage.setItem('userData', JSON.stringify(session.userData)),
    AsyncStorage.setItem(
      'customerData',
      session.customerData ? JSON.stringify(session.customerData) : '',
    ),
  ]);
}

export async function getSession(): Promise<UserSession | null> {
  try {
    const [userId, userToken, userData, customerData] = await Promise.all([
      AsyncStorage.getItem('userId'),
      AsyncStorage.getItem('userToken'),
      AsyncStorage.getItem('userData'),
      AsyncStorage.getItem('customerData'),
    ]);

    if (!userId || !userToken || !userData) return null;

    return {
      userId,
      userToken,
      userData: JSON.parse(userData) as AppUser,
      customerData: customerData ? (JSON.parse(customerData) as Customer) : null,
    };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem('userId'),
    AsyncStorage.removeItem('userToken'),
    AsyncStorage.removeItem('userData'),
    AsyncStorage.removeItem('customerData'),
  ]);
}
