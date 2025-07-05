// src/controllers/aiController.ts
import { Response } from 'express';
import { Client } from '@neondatabase/serverless';
import { AuthenticatedRequest, CurrentWeather, Weather } from '../types';
import { getDbConnection } from '../utils/database';
import { env } from '../config/env';
import { callOptimalAI, cleanAIResponse, parseTimeString } from '../utils/ai';
import { buildTaskExtractionPrompt, buildTaskGenerationPrompt } from '../utils/prompts';
import { alignTasksWithPlan } from '../services/taskAlignment';

export async function extractTasksFromVoice(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    const { transcript } = req.body;
    
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      return res.status(400).json({ error: "Transcript is required and must be a non-empty string" });
    }

    sql = await getDbConnection();
    
    // Get user preferences for better context
    const { rows: prefsRows } = await sql.query(
      `SELECT * FROM preferences WHERE user_id = $1`, 
      [userId]
    );
    const prefs = prefsRows[0];

    // Create AI prompt for task extraction
    const extractionPrompt = buildTaskExtractionPrompt({ transcript, prefs });

    // Call optimal AI model for voice extraction
    const { response: aiData, modelUsed, attemptCount } = await callOptimalAI([
      {
        role: 'system',
        content: 'You are a precision task extraction AI optimized for speech understanding. Extract tasks from user speech exactly as requested. Always return valid JSON array, even for simple tasks. Use advanced reasoning to understand context and intent.'
      },
      {
        role: 'user',
        content: extractionPrompt
      }
    ], 'voice-extraction', {
      temperature: 0.2,
      maxTokens: 2000,
      topP: 0.9,
      urgency: 'high' // Voice tasks are usually urgent
    });

    const aiResponse = aiData.choices?.[0]?.message?.content;

    if (!aiResponse) {
      throw new Error(`No response from AI model: ${modelUsed}`);
    }

    // Parse AI response and extract tasks
    let extractedTasks;
    try {
      // Extract JSON from AI response
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('No JSON array found in AI response:', aiResponse);
        throw new Error('No valid JSON found in AI response');
      }
      extractedTasks = JSON.parse(jsonMatch[0]);
      console.log('Successfully parsed AI response:', extractedTasks);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      console.error('Parse error:', parseError);
        
      // Try using Codestral for JSON repair
      try {
        const { response: repairData } = await callOptimalAI([
          {
            role: 'system',
            content: 'You are a JSON repair specialist. Fix the malformed JSON and return only valid JSON array.'
          },
          {
            role: 'user',
            content: `Fix this malformed JSON and return only the valid array: ${aiResponse}`
          }
        ], 'json-parsing', {
          temperature: 0.1,
          maxTokens: 1000
        });
        
        const repairedResponse = repairData.choices?.[0]?.message?.content;
        const repairedMatch = repairedResponse?.match(/\[[\s\S]*\]/);
        if (repairedMatch) {
          extractedTasks = JSON.parse(repairedMatch[0]);
          console.log('Successfully repaired JSON with Codestral');
        } else {
          throw new Error('JSON repair failed');
        }
      } catch (repairError) {
        throw new Error('Failed to parse and repair AI task extraction');
      }
    }

    // Validate and clean up extracted tasks with enhanced precision
    const validTasks = extractedTasks.filter((task: any) => {
      const isValid = task.title && 
             typeof task.title === 'string' && 
             task.title.trim().length > 0 &&
             task.duration && 
             typeof task.duration === 'number' && 
             task.duration > 0;
      
      if (!isValid) {
        console.log('Invalid task filtered out:', task);
      }
      return isValid;
    }).map((task: any) => {
      // Enhanced time validation
      let scheduledTime = null;
      if (task.scheduledTime) {
        // Handle various time formats and convert to HH:MM
        const timeStr = task.scheduledTime.toString().trim();
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
        
        if (timeRegex.test(timeStr)) {
          scheduledTime = timeStr;
        } else {
          // Try to parse common time formats
          const parsedTime = parseTimeString(timeStr);
          if (parsedTime) {
            scheduledTime = parsedTime;
          }
        }
      }
      
      return {
        title: task.title.trim(),
        duration: Math.min(Math.max(task.duration, 5), 480), // Between 5 minutes and 8 hours
        importance: ['low', 'medium', 'high'].includes(task.importance) ? task.importance : 'medium',
        scheduledTime: scheduledTime,
        notes: task.notes ? task.notes.trim() : null
      };
    });

    res.json({ 
      ok: true, 
      tasks: validTasks,
      originalTranscript: transcript,
      extractedCount: validTasks.length,
      // Debug information for development
      debug: {
        modelUsed,
        attemptCount,
        processingSuccess: true,
        aiResponse: aiResponse.substring(0, 500) + (aiResponse.length > 500 ? '...' : ''),
        rawTasksCount: extractedTasks?.length || 0,
        validTasksCount: validTasks.length
      }
    });

  } catch (err: any) {
    console.error("Voice task extraction error:", err);
    res.status(500).json({ error: "Failed to extract tasks from voice: " + err.message });
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

export async function generateAITasks(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Extract options from request body - always enable plan alignment
    const { customPrompts = [], existingPlan = null, alignWithSchedule = true } = req.body || {};
    
    // Get existing plan if available
    let currentPlan = existingPlan;
    if (!currentPlan) {
      const { rows: planRows } = await sql.query(
        `SELECT plan_json FROM plans WHERE user_id = $1 AND plan_date = CURRENT_DATE`,
        [userId]
      );
      currentPlan = planRows[0]?.plan_json;
    }
    
    // Always align with schedule if plan exists
    const shouldAlignWithSchedule = !!currentPlan;
    
    // Ensure the user exists in the users table before generating tasks
    try {
      await sql.query(
        `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [userId]
      );
    } catch (err) {
      console.error("Failed to create user record:", err);
    }
    
    // Get user preferences
    const { rows: prefsRows } = await sql.query(
      `SELECT * FROM preferences WHERE user_id = $1`, 
      [userId]
    );
    const prefs = prefsRows[0];
    
    if (!prefs) {
      return res.status(400).json({ error: "User preferences not found. Please set up your preferences first." });
    }

    // Get existing tasks - always fetch to manage conflicts
    const { rows: taskRows } = await sql.query(
      `SELECT * FROM tasks WHERE user_id = $1 AND task_date = CURRENT_DATE`,
      [userId]
    );
    const existingTasks = taskRows;

    // Get weather data with forecast
    let weather = null;
    try {
      if (prefs.city) {
        const [weatherRes, forecastRes] = await Promise.all([
          fetch(`https://api.openweathermap.org/data/2.5/weather?q=${prefs.city}&units=metric&appid=${env.OPENWEATHER_KEY}`),
          fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${prefs.city}&units=metric&appid=${env.OPENWEATHER_KEY}`)
        ]);
        
        if (weatherRes.ok && forecastRes.ok) {
          const [currentWeather, forecast] = await Promise.all([
            weatherRes.json(),
            forecastRes.json()
          ]);
          const currentWeatherTyped = currentWeather as CurrentWeather;
          weather = {
            current: currentWeatherTyped,
            forecast: forecast,
            summary: `${currentWeatherTyped.weather?.[0]?.description || 'unknown'}, ${Math.round(currentWeatherTyped.main?.temp || 20)}°C`
          } as Weather;
        }
      }
    } catch (err) {
      console.error("Weather fetch error:", err);
    }

    // Create AI prompt for task generation with enhanced plan alignment
    const taskPrompt = buildTaskGenerationPrompt({ 
      prefs, 
      weather, 
      customPrompts,
      existingPlan: currentPlan,
      existingTasks,
      alignWithSchedule: shouldAlignWithSchedule 
    });

    // Call optimal AI model for intelligent task generation and alignment
    const { response: aiData, modelUsed, attemptCount } = await callOptimalAI(
      [
        {
          role: 'system',
          content: `You are a precision task generation and plan alignment AI. ${shouldAlignWithSchedule ? 
            'CRITICAL: Generate tasks that perfectly align with the existing schedule. Identify conflicting tasks and suggest modifications.' : 
            'Create weather-appropriate, realistically timed tasks.'} Follow user preferences exactly. Return only valid JSON with alignment recommendations.`
        },
        {
          role: 'user',
          content: taskPrompt
        }
      ],
      'task-generation',
      {
        maxTokens: shouldAlignWithSchedule ? 2000 : 1500,
        temperature: 0.3,
        topP: 0.9,
        urgency: 'medium'
      }
    );

    const aiResponse = aiData.choices?.[0]?.message?.content;

    if (!aiResponse) {
      throw new Error('No response from AI service');
    }

    // Parse AI response and create tasks
    let generatedTasks;
    try {
      // Extract JSON from AI response
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in AI response');
      }
      generatedTasks = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      
      // Try JSON repair using Codestral
      try {
        const { response: repairData } = await callOptimalAI([
          {
            role: "system",
            content: "You are a JSON repair specialist. Fix malformed JSON and return only valid JSON array."
          },
          {
            role: "user",
            content: `Fix this malformed JSON response and return a valid task array: ${aiResponse}`
          }
        ], 'json-parsing', {
          temperature: 0.1,
          maxTokens: 2000,
          urgency: 'high'
        });
        
        const repairedResponse = repairData.choices[0].message.content;
        const repairedJsonMatch = repairedResponse.match(/\[[\s\S]*\]/);
        if (repairedJsonMatch) {
          generatedTasks = JSON.parse(repairedJsonMatch[0]);
        } else {
          throw new Error('JSON repair failed');
        }
      } catch (repairErr) {
        console.error('JSON repair also failed:', repairErr);
        throw new Error('Failed to parse AI task suggestions even after repair attempt');
      }
    }

    // Process AI response with intelligent task alignment
    let alignmentResults: {
      insertedTasks: any[];
      modifiedTasks: any[];
      deletedTasks: any[];
      conflicts: any[];
    } = {
      insertedTasks: [],
      modifiedTasks: [],
      deletedTasks: [],
      conflicts: []
    };

    if (shouldAlignWithSchedule && currentPlan) {
      // Use AI-guided task alignment
      alignmentResults = await alignTasksWithPlan(sql, userId, generatedTasks, existingTasks, currentPlan);
    } else {
      // Standard task insertion without plan alignment
      for (const task of generatedTasks) {
        try {
          await sql.query(
            `INSERT INTO tasks (user_id, title, duration_minutes, importance, status, scheduled_time, task_date)
             VALUES ($1, $2, $3, $4, 'todo', $5, CURRENT_DATE)`,
            [userId, task.title, task.duration, task.importance, task.scheduledTime || null]
          );
          alignmentResults.insertedTasks.push(task);
        } catch (taskError) {
          console.error('Failed to insert task:', taskError);
        }
      }
    }

    res.json({ 
      ok: true, 
      message: `Successfully managed ${alignmentResults.insertedTasks.length + alignmentResults.modifiedTasks.length} tasks with plan alignment!`,
      tasks: alignmentResults.insertedTasks,
      alignment: {
        planAligned: shouldAlignWithSchedule,
        inserted: alignmentResults.insertedTasks.length,
        modified: alignmentResults.modifiedTasks.length,
        deleted: alignmentResults.deletedTasks.length,
        conflicts: alignmentResults.conflicts.length,
        modifiedTasks: alignmentResults.modifiedTasks,
        deletedTasks: alignmentResults.deletedTasks,
        conflictDetails: alignmentResults.conflicts
      },
      // Debug information for development
      debug: {
        modelUsed,
        attemptCount,
        totalGenerated: generatedTasks?.length || 0,
        totalProcessed: alignmentResults.insertedTasks.length + alignmentResults.modifiedTasks.length,
        processingSuccess: true,
        planAvailable: !!currentPlan
      }
    });

  } catch (err: any) {
    console.error("AI task generation error:", err);
    res.status(500).json({ error: "Failed to generate AI tasks: " + err.message });
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

export async function alignTasksWithAIPlan(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Get current plan
    const { rows: planRows } = await sql.query(
      `SELECT plan_json FROM plans WHERE user_id = $1 AND plan_date = CURRENT_DATE`,
      [userId]
    );
    const currentPlan = planRows[0]?.plan_json;
    
    if (!currentPlan) {
      return res.status(400).json({ 
        error: "No AI plan found for today. Please generate a plan first." 
      });
    }
    
    // Get existing tasks
    const { rows: taskRows } = await sql.query(
      `SELECT * FROM tasks WHERE user_id = $1 AND task_date = CURRENT_DATE`,
      [userId]
    );
    const existingTasks = taskRows;
    
    // Get user preferences for AI context
    const { rows: prefsRows } = await sql.query(
      `SELECT * FROM preferences WHERE user_id = $1`, 
      [userId]
    );
    const prefs = prefsRows[0];
    
    // Generate AI tasks specifically for plan alignment
    const taskPrompt = buildTaskGenerationPrompt({ 
      prefs, 
      weather: null, // Skip weather for quick alignment
      customPrompts: [],
      existingPlan: currentPlan,
      existingTasks,
      alignWithSchedule: true 
    });

    // Get AI suggestions for plan alignment
    const { response: aiData, modelUsed, attemptCount } = await callOptimalAI(
      [
        {
          role: 'system',
          content: `You are a task alignment AI. Generate MINIMAL tasks that perfectly fit the existing AI plan schedule. 
CRITICAL INSTRUCTIONS:
1. For NEW tasks: Generate tasks with title, duration, importance and scheduledTime (if applicable). Do NOT include an id field for new tasks.
2. For tasks to DELETE: You MUST include both the exact task ID (UUID) and an "action": "delete" field. Never attempt to delete a task without its UUID. UUIDs look like: "123e4567-e89b-12d3-a456-426614174000".
3. For tasks to MODIFY: You MUST include the exact task ID (UUID), the fields to change, and an "action": "modify" field.
4. ONLY suggest modifications or deletions when you have the exact UUID of the task.
5. NEVER use a task title instead of a UUID for deletions or modifications.
6. Focus on filling gaps and optimizing existing task flow.
7. If you're uncertain about a task's UUID, create a new task instead of trying to delete or modify.`
        },
        {
          role: 'user',
          content: taskPrompt
        }
      ],
      'task-generation',
      {
        maxTokens: 1000,
        temperature: 0.2,
        topP: 0.9,
        urgency: 'medium'
      }
    );

    const aiResponse = aiData.choices?.[0]?.message?.content;
    if (!aiResponse) {
      throw new Error('No response from AI service');
    }

    console.log("Full AI response for alignment:", aiResponse);

    // Parse AI suggestions
    let generatedTasks;
    try {
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        generatedTasks = [];
      } else {
        generatedTasks = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse AI alignment response:', aiResponse);
      generatedTasks = []; // Fallback to alignment only
    }

    // Perform intelligent task alignment
    const alignmentResults = await alignTasksWithPlan(
      sql, 
      userId, 
      generatedTasks, 
      existingTasks, 
      currentPlan
    );

    res.json({
      ok: true,
      message: `Successfully aligned tasks with AI plan!`,
      alignment: {
        inserted: alignmentResults.insertedTasks.length,
        modified: alignmentResults.modifiedTasks.length,
        deleted: alignmentResults.deletedTasks.length,
        conflicts: alignmentResults.conflicts.length,
        insertedTasks: alignmentResults.insertedTasks,
        modifiedTasks: alignmentResults.modifiedTasks,
        deletedTasks: alignmentResults.deletedTasks,
        conflictDetails: alignmentResults.conflicts
      },
      debug: {
        modelUsed,
        attemptCount,
        planFound: true,
        existingTaskCount: existingTasks.length,
        generatedTaskCount: generatedTasks.length
      }
    });

  } catch (err: any) {
    console.error("Task alignment error:", err);
    res.status(500).json({ error: "Failed to align tasks with plan: " + err.message });
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

export async function dictateKanbanTasks(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Get all tasks grouped by status
    const { rows: tasks } = await sql.query(
      `SELECT id, title, duration_minutes, importance, status, scheduled_time 
       FROM tasks 
       WHERE user_id = $1 AND task_date = CURRENT_DATE 
       ORDER BY 
         CASE status 
           WHEN 'backlog' THEN 1 
           WHEN 'todo' THEN 2 
           WHEN 'doing' THEN 3 
           WHEN 'done' THEN 4 
         END, 
         scheduled_time NULLS LAST, 
         id`,
      [userId]
    );

    if (!tasks.length) {
      return res.json({ 
        ok: true, 
        dictation: "You have no tasks for today. Consider adding some tasks to get started with your productivity journey!",
        taskCount: 0
      });
    }

    // Group tasks by status
    const tasksByStatus = {
      backlog: tasks.filter(t => t.status === 'backlog'),
      todo: tasks.filter(t => t.status === 'todo'),
      doing: tasks.filter(t => t.status === 'doing'),
      done: tasks.filter(t => t.status === 'done')
    };

    // Get user preferences and weather for context
    const [{ rows: prefsRows }] = await Promise.all([
      sql.query(`SELECT * FROM preferences WHERE user_id = $1`, [userId])
    ]);
    const prefs = prefsRows[0];

    // Get current weather if available
    let weather = null;
    try {
      if (prefs?.city) {
        const weatherRes = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=${prefs.city}&units=metric&appid=${env.OPENWEATHER_KEY}`
        );
        if (weatherRes.ok) {
          weather = await weatherRes.json();
        }
      }
    } catch (err) {
      console.error("Weather fetch error:", err);
    }

    // Create time context for AI
    const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const currentHour = new Date().getHours();
    const timeOfDay = currentHour < 6 ? 'late night' : 
                     currentHour < 12 ? 'morning' : 
                     currentHour < 17 ? 'afternoon' : 
                     currentHour < 21 ? 'evening' : 'night';
    const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;
    const isWorkingHours = currentHour >= 9 && currentHour < 17;
    const isBusinessDay = new Date().getDay() >= 1 && new Date().getDay() <= 5;

    // Generate time-aware dictation using AI
    const { response: aiData, modelUsed, attemptCount } = await callOptimalAI([
      {
        role: 'system',
        content: `You are a professional time-aware task dictation assistant. Create a clear, encouraging, and organized verbal summary of tasks that considers the current time context. Be natural and conversational while being informative. Use a motivational tone and provide time-appropriate suggestions.`
      },
      {
        role: 'user',
        content: `Create a time-aware verbal dictation for these Kanban board tasks. Consider the current time and context:

CURRENT CONTEXT:
- Time: ${currentTime} (${timeOfDay})
- Date: ${currentDate}
- Context: ${isWeekend ? 'Weekend' : isWorkingHours ? 'Working Hours' : isBusinessDay ? 'After Work Hours' : 'Business Day'}
- Weather: ${weather ? `${(weather as any).weather[0].description}, ${Math.round((weather as any).main.temp)}°C` : 'Not available'}

BACKLOG (${tasksByStatus.backlog.length} tasks):
${tasksByStatus.backlog.map(t => `- ${t.title} (${t.duration_minutes} min, ${t.importance} priority)`).join('\n')}

TO DO (${tasksByStatus.todo.length} tasks):
${tasksByStatus.todo.map(t => `- ${t.title} (${t.duration_minutes} min, ${t.importance} priority)${t.scheduled_time ? ` at ${t.scheduled_time}` : ''}`).join('\n')}

IN PROGRESS (${tasksByStatus.doing.length} tasks):
${tasksByStatus.doing.map(t => `- ${t.title} (${t.duration_minutes} min, ${t.importance} priority)`).join('\n')}

COMPLETED (${tasksByStatus.done.length} tasks):
${tasksByStatus.done.map(t => `- ${t.title}`).join('\n')}

TIME-AWARE GUIDELINES:
- Consider it's currently ${timeOfDay} on a ${isWeekend ? 'weekend' : 'weekday'}
- ${isWorkingHours ? 'Suggest focusing on professional tasks during working hours' : 
    isBusinessDay ? 'Good time for personal tasks and planning for tomorrow' : 
    isWeekend ? 'Weekend - perfect for personal projects and preparation' : 'Business day context'}
- Be encouraging and motivational with time-appropriate energy
- Highlight progress made (completed tasks)
- Suggest next priorities based on current time context
- Keep it conversational and natural
- Don't just list tasks, create a narrative flow that considers the time
- Provide time-specific motivation and suggestions
- Maximum 250 words`
      }
    ], 'task-generation', {
      temperature: 0.7,
      maxTokens: 500,
      urgency: 'low'
    });

    const dictation = cleanAIResponse(aiData.choices?.[0]?.message?.content) || 
      "Here's your task overview: You have tasks across different stages of completion. Check your Kanban board for details!";

    res.json({
      ok: true,
      dictation: dictation.trim(),
      taskCount: tasks.length,
      breakdown: {
        backlog: tasksByStatus.backlog.length,
        todo: tasksByStatus.todo.length,
        doing: tasksByStatus.doing.length,
        done: tasksByStatus.done.length
      },
      context: {
        currentTime,
        timeOfDay,
        dayOfWeek: currentDate,
        isWeekend,
        isWorkingHours,
        weatherAvailable: !!weather
      },
      debug: {
        modelUsed,
        attemptCount
      }
    });

  } catch (err: any) {
    console.error("Kanban dictation error:", err);
    res.status(500).json({ error: "Failed to generate task dictation: " + err.message });
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

export async function askKanbanAI(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    const { question } = req.body;
    
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: "Question is required and must be a non-empty string" });
    }

    sql = await getDbConnection();
    
    // Get comprehensive user context
    const [
      { rows: tasks },
      { rows: prefsRows },
      { rows: planRows }
    ] = await Promise.all([
      sql.query(
        `SELECT id, title, duration_minutes, importance, status, scheduled_time 
         FROM tasks 
         WHERE user_id = $1 AND task_date = CURRENT_DATE 
         ORDER BY scheduled_time NULLS LAST`,
        [userId]
      ),
      sql.query(`SELECT * FROM preferences WHERE user_id = $1`, [userId]),
      sql.query(
        `SELECT plan_json FROM plans WHERE user_id = $1 AND plan_date = CURRENT_DATE`,
        [userId]
      )
    ]);

    const prefs = prefsRows[0];
    const plan = planRows[0]?.plan_json;

    // Get current weather if available
    let weather = null;
    try {
      if (prefs?.city) {
        const weatherRes = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=${prefs.city}&units=metric&appid=${env.OPENWEATHER_KEY}`
        );
        if (weatherRes.ok) {
          weather = await weatherRes.json();
        }
      }
    } catch (err) {
      console.error("Weather fetch error:", err);
    }

    // Create context for AI
    const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const currentHour = new Date().getHours();
    const timeOfDay = currentHour < 6 ? 'late night' : 
                     currentHour < 12 ? 'morning' : 
                     currentHour < 17 ? 'afternoon' : 
                     currentHour < 21 ? 'evening' : 'night';
    const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;
    const isWorkingHours = currentHour >= 9 && currentHour < 17;
    const isBusinessDay = new Date().getDay() >= 1 && new Date().getDay() <= 5;
    
    const tasksByStatus = {
      backlog: tasks.filter((t: any) => t.status === 'backlog'),
      todo: tasks.filter((t: any) => t.status === 'todo'),
      doing: tasks.filter((t: any) => t.status === 'doing'),
      done: tasks.filter((t: any) => t.status === 'done')
    };

    const contextPrompt = `Answer the user's question directly and helpfully based on their current context. Be specific and actionable.

CURRENT CONTEXT:
- Time: ${currentTime} (${timeOfDay})
- Date: ${currentDate}
- Context: ${isWeekend ? 'Weekend' : isWorkingHours ? 'Working Hours' : isBusinessDay ? 'After Work Hours' : 'Business Day'}
- Weather: ${weather ? `${(weather as any).weather[0].description}, ${Math.round((weather as any).main.temp)}°C` : 'Not available'}

TASKS SUMMARY:
- Backlog: ${tasksByStatus.backlog.length} tasks
- To Do: ${tasksByStatus.todo.length} tasks (${tasksByStatus.todo.map((t: any) => t.title).slice(0, 3).join(', ')}${tasksByStatus.todo.length > 3 ? '...' : ''})
- In Progress: ${tasksByStatus.doing.length} tasks (${tasksByStatus.doing.map((t: any) => t.title).join(', ') || 'None'})
- Completed: ${tasksByStatus.done.length} tasks today

USER QUESTION: "${question}"

Provide a helpful response in 2-3 sentences max. Consider the current time and suggest time-appropriate activities. Be encouraging and specific.`;

    // Call AI for contextual response
    const { response: aiData, modelUsed, attemptCount } = await callOptimalAI([
      {
        role: 'system',
        content: 'You are a knowledgeable productivity assistant. Provide helpful, contextual advice based on the user\'s tasks, schedule, preferences, and current conditions. Be conversational and encouraging. Give direct, actionable responses without showing your thought process or debugging information. Do not use XML tags like <think>, <debug>, or <analysis>.'
      },
      {
        role: 'user',
        content: contextPrompt
      }
    ], 'voice-extraction', {
      temperature: 0.6,
      maxTokens: 300,
      urgency: 'medium'
    });

    let rawAnswer = aiData.choices?.[0]?.message?.content || 
      "I'd be happy to help with your question! Could you provide more details so I can give you better advice?";
    
    // Clean up AI response - remove debugging info and ensure clean output
    const answer = cleanAIResponse(rawAnswer);

    res.json({
      ok: true,
      question: question.trim(),
      answer: answer.trim(),
      context: {
        currentTime,
        taskCount: tasks.length,
        weatherAvailable: !!weather,
        planAvailable: !!plan
      },
      debug: {
        modelUsed,
        attemptCount
      }
    });

  } catch (err: any) {
    console.error("Kanban AI ask error:", err);
    res.status(500).json({ error: "Failed to process question: " + err.message });
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

export async function getPerformanceInsights(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Get comprehensive user data for analysis
    const [
      { rows: todayTasks },
      { rows: weekTasks },
      { rows: prefsRows },
      { rows: planRows }
    ] = await Promise.all([
      // Today's tasks
      sql.query(
        `SELECT id, title, duration_minutes, importance, status, scheduled_time, created_at, updated_at 
         FROM tasks 
         WHERE user_id = $1 AND task_date = CURRENT_DATE 
         ORDER BY created_at`,
        [userId]
      ),
      // This week's tasks for trend analysis
      sql.query(
        `SELECT task_date, status, COUNT(*) as count, SUM(duration_minutes) as total_duration
         FROM tasks 
         WHERE user_id = $1 AND task_date >= CURRENT_DATE - INTERVAL '7 days'
         GROUP BY task_date, status
         ORDER BY task_date`,
        [userId]
      ),
      sql.query(`SELECT * FROM preferences WHERE user_id = $1`, [userId]),
      sql.query(
        `SELECT plan_json FROM plans WHERE user_id = $1 AND plan_date = CURRENT_DATE`,
        [userId]
      )
    ]);

    const prefs = prefsRows[0];
    const currentPlan = planRows[0]?.plan_json;

    // Calculate performance statistics
    const tasksByStatus = {
      backlog: todayTasks.filter(t => t.status === 'backlog'),
      todo: todayTasks.filter(t => t.status === 'todo'),
      doing: todayTasks.filter(t => t.status === 'doing'),
      done: todayTasks.filter(t => t.status === 'done')
    };

    const totalTasks = todayTasks.length;
    const completedTasks = tasksByStatus.done.length;
    const inProgressTasks = tasksByStatus.doing.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const totalPlannedTime = todayTasks.reduce((sum, task) => sum + (task.duration_minutes || 0), 0);
    const completedTime = tasksByStatus.done.reduce((sum, task) => sum + (task.duration_minutes || 0), 0);
    const timeUtilization = totalPlannedTime > 0 ? Math.round((completedTime / totalPlannedTime) * 100) : 0;

    // Calculate priority distribution
    const priorityStats = {
      high: todayTasks.filter(t => t.importance === 'high').length,
      medium: todayTasks.filter(t => t.importance === 'medium').length,
      low: todayTasks.filter(t => t.importance === 'low').length
    };

    // Calculate weekly trends
    const weeklyTrends = weekTasks.reduce((acc: any, row) => {
      const date = row.task_date.toISOString().split('T')[0];
      if (!acc[date]) acc[date] = { completed: 0, total: 0, totalTime: 0 };
      if (row.status === 'done') acc[date].completed += row.count;
      acc[date].total += row.count;
      acc[date].totalTime += row.total_duration || 0;
      return acc;
    }, {});

    // Current time context
    const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const currentHour = new Date().getHours();
    const timeOfDay = currentHour < 6 ? 'late night' : 
                     currentHour < 12 ? 'morning' : 
                     currentHour < 17 ? 'afternoon' : 
                     currentHour < 21 ? 'evening' : 'night';
    const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;

    // Get AI-powered performance analysis
    const analysisPrompt = `Analyze this user's productivity performance and provide actionable insights:

CURRENT PERFORMANCE (TODAY):
- Total Tasks: ${totalTasks}
- Completed: ${completedTasks} (${completionRate}%)
- In Progress: ${inProgressTasks}
- Time Utilization: ${timeUtilization}% (${completedTime}/${totalPlannedTime} minutes)
- Priority Breakdown: ${priorityStats.high} high, ${priorityStats.medium} medium, ${priorityStats.low} low

CONTEXT:
- Time: ${currentTime} (${timeOfDay})
- Day Type: ${isWeekend ? 'Weekend' : 'Weekday'}
- Has AI Plan: ${!!currentPlan}
- User Peak Focus: ${prefs?.peak_focus || 'Not set'}

RECENT TASKS COMPLETED:
${tasksByStatus.done.map(t => `- ${t.title} (${t.duration_minutes}min, ${t.importance})`).join('\n') || 'None yet'}

TASKS IN PROGRESS:
${tasksByStatus.doing.map(t => `- ${t.title} (${t.duration_minutes}min, ${t.importance})`).join('\n') || 'None'}

PENDING TASKS:
${tasksByStatus.todo.slice(0, 5).map(t => `- ${t.title} (${t.duration_minutes}min, ${t.importance})`).join('\n') || 'None'}

WEEKLY TREND DATA:
${Object.entries(weeklyTrends).map(([date, data]: [string, any]) => 
  `${date}: ${data.completed}/${data.total} completed (${data.totalTime}min)`
).join('\n')}

Provide a comprehensive but concise analysis focusing on:
1. Performance assessment (celebrate wins, identify areas for improvement)
2. Time management insights
3. Priority optimization suggestions
4. Productivity patterns and trends
5. Actionable next steps for today
6. Motivational encouragement based on current context

Keep it personal, actionable, and encouraging. Maximum 300 words.`;

    const { response: aiData, modelUsed, attemptCount } = await callOptimalAI([
      {
        role: 'system',
        content: 'You are an expert productivity coach and performance analyst. Provide insightful, actionable feedback that motivates users while helping them optimize their workflow. Be encouraging but honest about areas for improvement.'
      },
      {
        role: 'user',
        content: analysisPrompt
      }
    ], 'task-generation', {
      temperature: 0.6,
      maxTokens: 500,
      urgency: 'medium'
    });

    const aiInsights = cleanAIResponse(aiData.choices?.[0]?.message?.content) || 
      "Your productivity journey is unique! Keep focusing on completing tasks and maintaining momentum.";

    // Prepare response data
    const insights = {
      summary: {
        totalTasks,
        completedTasks,
        inProgressTasks,
        completionRate,
        timeUtilization,
        totalPlannedTime,
        completedTime
      },
      priorities: priorityStats,
      breakdown: tasksByStatus,
      trends: weeklyTrends,
      aiAnalysis: aiInsights.trim(),
      context: {
        timeOfDay,
        isWeekend,
        hasPlan: !!currentPlan,
        peakFocus: prefs?.peak_focus
      },
      lastUpdated: new Date().toISOString()
    };

    res.json({
      ok: true,
      insights,
      debug: {
        modelUsed,
        attemptCount,
        tasksAnalyzed: totalTasks,
        weeklyDataPoints: Object.keys(weeklyTrends).length
      }
    });

  } catch (err: any) {
    console.error("Performance insights error:", err);
    res.status(500).json({ error: "Failed to generate performance insights: " + err.message });
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

export async function getWeather(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Get user's city from preferences
    const { rows } = await sql.query(
      `SELECT city FROM preferences WHERE user_id = $1`,
      [userId]
    );
    
    if (!rows.length || !rows[0].city) {
      return res.status(400).json({ error: "City not found in user preferences. Please set up your preferences first." });
    }
    
    const city = rows[0].city;
    
    try {
      // Get current weather and 5-day forecast
      const [weatherRes, forecastRes] = await Promise.all([
        fetch(`https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&appid=${env.OPENWEATHER_KEY}`),
        fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${city}&units=metric&appid=${env.OPENWEATHER_KEY}`)
      ]);
      
      if (!weatherRes.ok) {
        throw new Error(`Weather API error: ${weatherRes.status}`);
      }
      
      if (!forecastRes.ok) {
        throw new Error(`Forecast API error: ${forecastRes.status}`);
      }
      
      const weather = await weatherRes.json() as any;
      const forecast = await forecastRes.json() as any;
      
      // Process today's forecast (next 24 hours)
      const todaysForecast = forecast.list.slice(0, 8).map((item: any) => ({
        time: new Date(item.dt * 1000).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          hour12: true 
        }),
        temperature: Math.round(item.main.temp),
        condition: item.weather[0].description,
        icon: item.weather[0].icon,
        humidity: item.main.humidity,
        windSpeed: item.wind?.speed || 0
      }));
      
      // Process 5-day forecast (daily summary)
      const dailyForecast = [];
      for (let i = 0; i < forecast.list.length; i += 8) {
        const dayData = forecast.list[i];
        if (dayData) {
          dailyForecast.push({
            date: new Date(dayData.dt * 1000).toLocaleDateString('en-US', { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric' 
            }),
            temperature: {
              high: Math.round(dayData.main.temp_max),
              low: Math.round(dayData.main.temp_min)
            },
            condition: dayData.weather[0].description,
            icon: dayData.weather[0].icon
          });
        }
      }
      
      res.json({
        current: {
          temperature: `${Math.round(weather.main.temp)}°C`,
          condition: weather.weather[0].description,
          location: `${weather.name}, ${weather.sys.country}`,
          icon: weather.weather[0].icon,
          humidity: weather.main.humidity,
          windSpeed: weather.wind?.speed || 0
        },
        todaysForecast,
        dailyForecast: dailyForecast.slice(0, 5), // Limit to 5 days
        // For AI context
        forecastSummary: `Today: ${weather.weather[0].description}, ${Math.round(weather.main.temp)}°C. ${todaysForecast.length > 0 ? `Later: ${todaysForecast[todaysForecast.length - 1].condition}` : ''}`
      });
    } catch (err: any) {
      console.error("Weather API error:", err);
      res.status(500).json({ error: "Failed to fetch weather data: " + err.message });
    }
  } catch (err: any) {
    console.error("Database error getting weather:", err);
    res.status(500).json({ error: "Failed to get weather: " + err.message });
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

export async function getApod(req: any, res: Response) {
  try {
    const apodRes = await fetch(
      `https://api.nasa.gov/planetary/apod?api_key=${env.NASA_KEY}`
    );
    
    if (!apodRes.ok) {
      throw new Error(`NASA APOD API error: ${apodRes.status}`);
    }
    
    const apod = await apodRes.json() as any;
    
    res.json({
      title: apod.title,
      description: apod.explanation,
      imageUrl: apod.url,
      date: apod.date,
      mediaType: apod.media_type
    });
  } catch (err: any) {
    console.error("NASA APOD API error:", err);
    res.status(500).json({ error: "Failed to fetch NASA APOD data: " + err.message });
  }
}
