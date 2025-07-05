// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@clerk/backend';
import { env } from '../config/env';
import { AuthenticatedRequest } from '../types';

// Clerk JWT verification (RS256)
export async function getUserId(req: Request): Promise<string> {
  try {
    const authHeader = req.get("Authorization") || "";
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Missing or invalid authorization header");
    }
    
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      throw new Error("Missing token");
    }
    
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
    });
    
    if (!payload.sub) {
      throw new Error("Invalid token payload");
    }
    
    return payload.sub as string;
  } catch (err: any) {
    console.error("Authentication error:", err);
    throw new Error("Authentication failed: " + err.message);
  }
}

// Authentication middleware
export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = await getUserId(req);
    req.userId = userId;
    next();
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
}
