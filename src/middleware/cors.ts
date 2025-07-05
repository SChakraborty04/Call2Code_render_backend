// src/middleware/cors.ts
import { Request, Response, NextFunction } from 'express';

/**
 * Custom CORS middleware that explicitly sets all required headers
 */
export const customCors = (req: Request, res: Response, next: NextFunction) => {
  const allowedOrigins = ['http://localhost:8080', 'http://localhost:3000'];
  const origin = req.headers.origin;
  
  // Set CORS headers
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
};
