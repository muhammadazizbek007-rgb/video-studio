import { getFunctions } from 'firebase/functions';
import { app } from './firebaseApp';

export const functions = getFunctions(app);
export const functionsAsiaSouth1 = getFunctions(app, 'asia-south1');
