// src/controllers/taskController.ts
import { Response } from 'express';
import { Client } from '@neondatabase/serverless';
import { AuthenticatedRequest } from '../types';
import { getDbConnection } from '../utils/database';
import { parseTimeString } from '../utils/ai';

// Import clear tasks function and re-export it
import { clearTasks as _clearTasks } from './taskController.archiveTasks';
export const clearTasks = _clearTasks;

export async function createTask(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Ensure the user exists in the users table before creating tasks
    try {
      await sql.query(
        `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [userId]
      );
    } catch (err) {
      console.error("Failed to create user record:", err);
      // Continue anyway, the user might already exist
    }
    
    const { title, duration, importance, status, scheduledTime } = req.body;
    
    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: "Title is required and must be a non-empty string" });
    }
    
    if (!duration || typeof duration !== 'number' || duration <= 0) {
      return res.status(400).json({ error: "Duration is required and must be a positive number" });
    }
    
    if (!importance || typeof importance !== 'string') {
      return res.status(400).json({ error: "Importance is required and must be a string" });
    }

    // Validate status if provided (should be one of the kanban_status enum values)
    if (status && !['backlog', 'todo', 'doing', 'done'].includes(status)) {
      return res.status(400).json({ error: "Status must be one of: backlog, todo, doing, done" });
    }

    // Validate scheduled time format if provided (HH:MM)
    if (scheduledTime && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(scheduledTime)) {
      return res.status(400).json({ error: "Scheduled time must be in HH:MM format" });
    }
    
    await sql.query(
      `INSERT INTO tasks (user_id, title, duration_minutes, importance, status, scheduled_time, task_date)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)`,
      [userId, title.trim(), duration, importance, status || 'todo', scheduledTime || null]
    );
    
    res.json({ ok: true, message: "Task created successfully" });
  } catch (err: any) {
    console.error("Database error creating task:", err);
    res.status(500).json({ error: "Failed to create task: " + err.message });
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

export async function getTasks(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    const { rows } = await sql.query(
      `SELECT id, title, duration_minutes, importance, status, scheduled_time, task_date 
       FROM tasks 
       WHERE user_id = $1 AND task_date = CURRENT_DATE 
       ORDER BY scheduled_time NULLS LAST, id DESC`,
      [userId]
    );
    
    // Map database fields to frontend expectations
    const tasks = rows.map(task => ({
      id: task.id.toString(),
      title: task.title,
      duration: task.duration_minutes,
      importance: task.importance,
      status: task.status || 'todo',
      scheduledTime: task.scheduled_time // HH:MM format or null
    }));
    
    res.json({ tasks });
  } catch (err: any) {
    console.error("Database error getting tasks:", err);
    res.status(500).json({ error: "Failed to retrieve tasks: " + err.message });
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

export async function updateTask(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const taskId = req.params.id;
  const { title, duration, importance, status, scheduledTime } = req.body;
  let sql: Client | null = null;
  
  if (!taskId) {
    return res.status(400).json({ error: "Task ID is required" });
  }

  // Validate scheduled time format if provided (HH:MM)
  if (scheduledTime && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(scheduledTime)) {
    return res.status(400).json({ error: "Scheduled time must be in HH:MM format" });
  }
  
  try {
    sql = await getDbConnection();
    
    // Validate task ownership and existence
    const taskResult = await sql.query(
      `SELECT id FROM tasks WHERE id = $1 AND user_id = $2`,
      [taskId, userId]
    );
    
    if (taskResult.rowCount === 0) {
      return res.status(404).json({ error: "Task not found or not authorized to update" });
    }
    
    // Update task details
    await sql.query(
      `UPDATE tasks SET 
         title = COALESCE($1, title),
         duration_minutes = COALESCE($2, duration_minutes),
         importance = COALESCE($3, importance),
         status = COALESCE($4, status),
         scheduled_time = COALESCE($5, scheduled_time),
         updated_at = now()
       WHERE id = $6`,
      [title?.trim(), duration, importance, status, scheduledTime, taskId]
    );
    
    res.json({ ok: true, message: "Task updated successfully" });
  } catch (err: any) {
    console.error("Database error updating task:", err);
    res.status(500).json({ error: "Failed to update task: " + err.message });
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

export async function deleteTask(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const taskId = req.params.id;
  let sql: Client | null = null;
  
  if (!taskId) {
    return res.status(400).json({ error: "Task ID is required" });
  }
  
  try {
    sql = await getDbConnection();
    
    const result = await sql.query(
      `DELETE FROM tasks WHERE id = $1 AND user_id = $2`,
      [taskId, userId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Task not found or not authorized to delete" });
    }
    
    res.json({ ok: true, message: "Task deleted successfully" });
  } catch (err: any) {
    console.error("Database error deleting task:", err);
    res.status(500).json({ error: "Failed to delete task: " + err.message });
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
