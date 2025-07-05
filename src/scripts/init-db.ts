#!/usr/bin/env tsx
// src/scripts/init-db.ts
import dotenv from 'dotenv';
import { DatabaseManager } from '../database';

dotenv.config();

async function main() {
  try {
    const dbUrl = process.env.NEON_DATABASE_URL;
    if (!dbUrl) {
      throw new Error('NEON_DATABASE_URL environment variable is required');
    }

    console.log('🔧 Initializing database schema...');
    
    const dbManager = new DatabaseManager(dbUrl);
    await dbManager.connect();
    await dbManager.initializeSchema();
    await dbManager.disconnect();
    
    console.log('✅ Database initialization complete!');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

main();
