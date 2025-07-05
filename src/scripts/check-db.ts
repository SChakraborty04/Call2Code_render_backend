#!/usr/bin/env tsx
// src/scripts/check-db.ts
import dotenv from 'dotenv';
import { DatabaseManager } from '../database';

dotenv.config();

async function main() {
  try {
    const dbUrl = process.env.NEON_DATABASE_URL;
    if (!dbUrl) {
      throw new Error('NEON_DATABASE_URL environment variable is required');
    }

    console.log('🔍 Checking database status...');
    
    const dbManager = new DatabaseManager(dbUrl);
    await dbManager.connect();
    
    const isConnected = await dbManager.checkConnection();
    console.log(`📡 Connection status: ${isConnected ? '✅ Connected' : '❌ Disconnected'}`);
    
    if (isConnected) {
      const tables = await dbManager.getTableInfo();
      console.log('\n📊 Database tables:');
      if (tables.length === 0) {
        console.log('  ⚠️  No tables found. Run `npm run db:init` to initialize the schema.');
      } else {
        tables.forEach(table => {
          console.log(`  • ${table.table_name} (${table.table_type})`);
        });
      }
    }
    
    await dbManager.disconnect();
    console.log('\n✅ Database check complete!');
  } catch (error) {
    console.error('❌ Database check failed:', error);
    process.exit(1);
  }
}

main();
