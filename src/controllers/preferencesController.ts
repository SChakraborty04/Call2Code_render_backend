// src/controllers/preferencesController.ts
import { Response } from 'express';
import { Client } from '@neondatabase/serverless';
import { AuthenticatedRequest } from '../types';
import { getDbConnection } from '../utils/database';

export async function savePreferences(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Ensure the user exists in the users table before saving preferences
    try {
      await sql.query(
        `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [userId]
      );
    } catch (err) {
      console.error("Failed to create user record:", err);
      // Continue anyway, the user might already exist
    }
    
    const { wakeTime, sleepTime, peakFocus, city, breakStyle, breakInterval, maxWorkHours, commuteMode } = req.body;
    
    // Validate required fields
    if (!wakeTime || !sleepTime || !peakFocus || !city || !breakStyle || breakInterval === undefined || maxWorkHours === undefined || !commuteMode) {
      return res.status(400).json({ error: "All preference fields are required" });
    }
    
    // Validate commute mode values (must match database check constraint)
    const validCommuteModes = ['none', 'walk', 'bike', 'public', 'car'];
    if (!validCommuteModes.includes(commuteMode)) {
      return res.status(400).json({ error: `Invalid commute mode. Must be one of: ${validCommuteModes.join(', ')}` });
    }
    
    // Validate peak focus values (must match database check constraint)
    const validPeakFocus = ['morning', 'afternoon', 'evening'];
    if (!validPeakFocus.includes(peakFocus)) {
      return res.status(400).json({ error: `Invalid peak focus. Must be one of: ${validPeakFocus.join(', ')}` });
    }
    
    // Validate time format (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(wakeTime)) {
      return res.status(400).json({ error: "Wake time must be in HH:MM format" });
    }
    if (!timeRegex.test(sleepTime)) {
      return res.status(400).json({ error: "Sleep time must be in HH:MM format" });
    }
    
    // Validate numeric values
    if (typeof breakInterval !== 'number' || breakInterval <= 0) {
      return res.status(400).json({ error: "Break interval must be a positive number" });
    }
    if (typeof maxWorkHours !== 'number' || maxWorkHours <= 0 || maxWorkHours > 24) {
      return res.status(400).json({ error: "Max work hours must be between 1 and 24" });
    }
    
    await sql.query(
      `INSERT INTO preferences (user_id, wake_time, sleep_time, peak_focus, city, break_style, break_interval_minutes, max_work_hours, commute_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO UPDATE SET 
         wake_time = EXCLUDED.wake_time,
         sleep_time = EXCLUDED.sleep_time,
         peak_focus = EXCLUDED.peak_focus,
         city = EXCLUDED.city,
         break_style = EXCLUDED.break_style,
         break_interval_minutes = EXCLUDED.break_interval_minutes,
         max_work_hours = EXCLUDED.max_work_hours,
         commute_mode = EXCLUDED.commute_mode`,
      [userId, wakeTime, sleepTime, peakFocus, city, breakStyle, breakInterval, maxWorkHours, commuteMode]
    );
    
    res.json({ ok: true, message: "Preferences saved successfully" });
  } catch (err: any) {
    console.error("Database error saving preferences:", err);
    res.status(500).json({ error: "Failed to save preferences: " + err.message });
  } finally {
    if (sql) {
      try {
        await sql.end();
      } catch (err) {
        console.error("Error closing database connection:", err);
      }
    }
  }
}

export async function getPreferences(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    const { rows } = await sql.query(
      `SELECT wake_time, sleep_time, peak_focus, city, break_style, break_interval_minutes, max_work_hours, commute_mode FROM preferences WHERE user_id = $1`,
      [userId]
    );
    
    if (!rows.length) {
      return res.json({ preferences: null, message: "No preferences found" });
    }
    
    // Map the database response to match frontend expectations
    const prefs = rows[0];
    res.json({ 
      preferences: {
        wakeTime: prefs.wake_time,
        sleepTime: prefs.sleep_time,
        peakFocus: prefs.peak_focus,
        city: prefs.city,
        breakStyle: prefs.break_style,
        breakInterval: prefs.break_interval_minutes,
        maxWorkHours: prefs.max_work_hours,
        commuteMode: prefs.commute_mode
      }
    });
  } catch (err: any) {
    console.error("Database error getting preferences:", err);
    res.status(500).json({ error: "Failed to retrieve preferences: " + err.message });
  } finally {
    if (sql) {
      try {
        await sql.end();
      } catch (err) {
        console.error("Error closing database connection:", err);
      }
    }
  }
}
