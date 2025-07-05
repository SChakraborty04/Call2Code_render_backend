// src/config/env.ts
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface Env {
  NEON_DATABASE_URL: string;
  CLERK_SECRET_KEY: string;
  OPENWEATHER_KEY: string;
  NASA_KEY: string;
  MISTRAL_API_KEY: string;
}

// Environment validation
const requiredEnvVars = [
  'NEON_DATABASE_URL',
  'CLERK_SECRET_KEY',
  'OPENWEATHER_KEY',
  'NASA_KEY',
  'MISTRAL_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

export const env: Env = {
  NEON_DATABASE_URL: process.env.NEON_DATABASE_URL!,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY!,
  OPENWEATHER_KEY: process.env.OPENWEATHER_KEY!,
  NASA_KEY: process.env.NASA_KEY!,
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY!
};
