// src/database.ts
import { Client } from "@neondatabase/serverless";
import fs from 'fs';
import path from 'path';

export class DatabaseManager {
  private client: Client;

  constructor(connectionString: string) {
    this.client = new Client(connectionString);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.end();
  }

  async initializeSchema(): Promise<void> {
    try {
      console.log("🔧 Initializing database schema...");
      
      const schemaPath = path.join(__dirname, '..', 'schema.sql');
      const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
      
      // Split the schema into individual statements
      const statements = schemaSQL
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('/*') && !stmt.startsWith('--'));

      for (const statement of statements) {
        try {
          await this.client.query(statement);
        } catch (error: any) {
          // Ignore "already exists" errors
          if (!error.message.includes('already exists') && 
              !error.message.includes('duplicate key')) {
            console.error(`Error executing statement: ${statement.substring(0, 100)}...`);
            throw error;
          }
        }
      }
      
      console.log("✅ Database schema initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize database schema:", error);
      throw error;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.client.query('SELECT 1');
      return true;
    } catch (error) {
      console.error("Database connection check failed:", error);
      return false;
    }
  }

  async getTableInfo(): Promise<any[]> {
    try {
      const { rows } = await this.client.query(`
        SELECT 
          table_name,
          table_type
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);
      return rows;
    } catch (error) {
      console.error("Failed to get table info:", error);
      return [];
    }
  }

  // Utility method to get a connected client for one-off operations
  static async getConnection(connectionString: string): Promise<Client> {
    const client = new Client(connectionString);
    await client.connect();
    return client;
  }
}
