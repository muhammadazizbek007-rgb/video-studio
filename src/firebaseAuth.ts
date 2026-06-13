import { browserLocalPersistence, getAuth, inMemoryPersistence, setPersistence } from 'firebase/auth';
import { app } from './firebaseApp';

export const auth = getAuth(app);

if (typeof window !== 'undefined') {
  void setPersistence(auth, browserLocalPersistence).catch(async (error) => {
    console.warn('Не удалось включить local auth persistence, переключаемся на in-memory:', error);
    try {
      await setPersistence(auth, inMemoryPersistence);
    } catch (fallbackError) {
      console.error('Не удалось настроить auth persistence:', fallbackError);
    }
  });
}
