// src/controllers/planController.ts
import { Response } from 'express';
import { Client } from '@neondatabase/serverless';
import { AuthenticatedRequest } from '../types';
import { getDbConnection } from '../utils/database';
import { env } from '../config/env';
import { callOptimalAI } from '../utils/ai';
import { buildPrompt } from '../utils/prompts';

export async function getPlan(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    const { rows } = await sql.query(
      `SELECT plan_json FROM plans WHERE user_id = $1 AND plan_date = CURRENT_DATE`,
      [userId]
    );
    
    if (!rows.length) {
      return res.json({ plan: null, message: "No plan found for today" });
    }
    
    res.json({ plan: rows[0].plan_json });
  } catch (err: any) {
    console.error("Database error getting plan:", err);
    res.status(500).json({ error: "Failed to retrieve plan: " + err.message });
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

export async function generatePlan(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Extract custom prompts from request body
    const { customPrompts = [] } = req.body || {};
    
    // Ensure the user exists in the users table before generating plan
    try {
      await sql.query(
        `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [userId]
      );
    } catch (err) {
      console.error("Failed to create user record:", err);
      // Continue anyway, the user might already exist
    }
    
    // fetch prefs, tasks, events, weather, apod in parallel
    const [{ rows: prefsRows }, { rows: taskRows }] = await Promise.all([
      sql.query(`SELECT * FROM preferences WHERE user_id = $1`, [userId]),
      sql.query(`SELECT * FROM tasks WHERE user_id = $1 AND task_date = CURRENT_DATE ORDER BY 
        CASE status 
          WHEN 'todo' THEN 1 
          WHEN 'doing' THEN 2 
          WHEN 'backlog' THEN 3 
          WHEN 'done' THEN 4 
        END`, [userId]),
    ]);
    
    const prefs = prefsRows[0];
    const tasks = taskRows;

    // Check if user has preferences
    if (!prefs) {
      return res.status(400).json({ error: "User preferences not found. Please set up your preferences first." });
    }

    // Check if user has tasks
    if (!tasks || tasks.length === 0) {
      return res.status(400).json({ error: "No tasks found for today. Please add some tasks first." });
    }

    let weather = null;
    let apod = null;

    try {
      // Weather (with error handling)
      if (prefs.city) {
        const weatherRes = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=${prefs.city}&units=metric&appid=${env.OPENWEATHER_KEY}`
        );
        if (weatherRes.ok) {
          weather = await weatherRes.json();
        }
      } else {
        console.warn("No city specified in user preferences");
      }
    } catch (err) {
      console.error("Weather fetch error:", err);
      weather = { weather: [{ description: "unknown" }], main: { temp: 20 } };
    }

    try {
      // NASA APOD (optional, with error handling)
      const apodRes = await fetch(
        `https://api.nasa.gov/planetary/apod?api_key=${env.NASA_KEY}`
      );
      if (apodRes.ok) {
        apod = await apodRes.json();
      }
    } catch (err) {
      console.error("NASA APOD fetch error:", err);
      // Continue without APOD data
    }

    // Build prompt with custom prompts
    const prompt = buildPrompt({ prefs, tasks, weather, customPrompts });

    let plan = null;
    let debugInfo = {};
    try {
      // Call optimal AI model for schedule planning
      const { response: aiData, modelUsed, attemptCount } = await callOptimalAI([
        {
          role: "system",
          content: "You are an expert schedule optimizer. Create precise, weather-aware schedules. Follow all user-specified times exactly. Return only valid JSON."
        },
        {
          role: "user", 
          content: prompt
        }
      ], 'schedule-planning', {
        temperature: 0.2,
        maxTokens: 2500,
        topP: 0.95,
        urgency: 'medium'
      });
      
      if (!aiData.choices || !aiData.choices[0] || !aiData.choices[0].message) {
        throw new Error("Invalid AI response structure");
      }

      try {
        // Extract JSON from AI response
        const content = aiData.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("No JSON found in AI response");
        }
        plan = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        try {
          // Try using Codestral for JSON repair
          const { response: repairData } = await callOptimalAI([
            {
              role: "system",
              content: "You are a JSON repair specialist. Fix malformed JSON and return only valid JSON."
            },
            {
              role: "user",
              content: `Fix this malformed JSON: ${aiData.choices[0].message.content}`
            }
          ], 'json-parsing', {
            temperature: 0.1,
            maxTokens: 2000
          });
          
          const repairedContent = repairData.choices[0].message.content;
          const repairedMatch = repairedContent.match(/\{[\s\S]*\}/);
          if (repairedMatch) {
            plan = JSON.parse(repairedMatch[0]);
          } else {
            throw new Error("JSON repair failed");
          }
        } catch (repairErr) {
          throw new Error("Failed to parse and repair AI schedule response");
        }
      }
    } catch (err: any) {
      console.error("AI schedule planning error:", err);
      return res.status(500).json({ error: "Failed to generate plan: " + err.message });
    }

    try {
      // Persist the plan
      await sql.query(
        `INSERT INTO plans (user_id, plan_date, plan_json)
         VALUES ($1, CURRENT_DATE, $2)
         ON CONFLICT (user_id, plan_date) DO UPDATE SET plan_json = EXCLUDED.plan_json`,
        [userId, plan]
      );
    } catch (err) {
      console.error("Failed to save plan:", err);
      // Still return the plan even if saving fails
    }

    res.json({ 
      plan, 
      apod, 
      weather,
      // Debug information for development
      debug: debugInfo
    });
  } catch (err: any) {
    console.error("Error generating plan:", err);
    res.status(500).json({ error: "Failed to generate plan: " + err.message });
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
