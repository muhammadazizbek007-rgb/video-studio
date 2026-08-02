import mongoose from 'mongoose';
import { logger } from '../logger.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri: string): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    autoIndex: true,
  });

  mongoose.connection.on('error', (error) => {
    logger.error({ err: error }, 'mongo connection error');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('mongo disconnected');
  });
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
