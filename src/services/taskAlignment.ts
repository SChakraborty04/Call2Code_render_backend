// src/services/taskAlignment.ts
import { AuthenticatedRequest } from '../types';
import { getDbConnection } from '../utils/database';
import { callOptimalAI } from '../utils/ai';
import { Client } from '@neondatabase/serverless';

interface Task {
  id: number;
  title: string;
  duration: number;
  importance: number;
  status: string;
  scheduledTime?: string;
  created_at: string;
  updated_at: string;
}

interface Plan {
  id: number;
  content: string;
  created_at: string;
}

// Helper to validate UUID
function isValidUUID(id: any): boolean {
  if (!id) return false;
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function alignTasksWithPlan(
  sql: Client, 
  userId: string, 
  generatedTasks: any[], 
  existingTasks: any[], 
  currentPlan: any
): Promise<{
  insertedTasks: any[];
  modifiedTasks: any[];
  deletedTasks: any[];
  conflicts: any[];
}> {
  const results = {
    insertedTasks: [] as any[],
    modifiedTasks: [] as any[],
    deletedTasks: [] as any[],
    conflicts: [] as any[]
  };

  try {
    console.log('Starting task alignment...');
    console.log('Generated tasks:', generatedTasks.length);
    console.log('Existing tasks:', existingTasks.length);
    
    // IMPROVED ALIGNMENT STRATEGY:
    // 1. Process any tasks to add (these are new tasks from the AI)
    // 2. Process any tasks to modify/delete ONLY if they have valid UUIDs
    // 3. Log conflicts for any tasks that can't be handled
    
    // PROCESS NEW TASKS: Insert new tasks from the AI
    const tasksToAdd = generatedTasks.filter(task => 
      (!task.id && !task.action) || // No ID and no action means it's a new task
      (task.action === 'add') || // Explicit add action
      (task.action === 'create') // Alternate terminology
    );
    
    for (const task of tasksToAdd) {
      try {
        // Validate task data - must have title and duration
        if (!task.title || typeof task.title !== 'string' || !task.title.trim()) {
          console.log('Skipping task with invalid title:', task);
          results.conflicts.push({
            issue: `Invalid task title: "${JSON.stringify(task)}"`,
            suggestion: 'Tasks must have a valid title'
          });
          continue;
        }
        
        if (!task.duration || typeof task.duration !== 'number' || task.duration <= 0) {
          console.log('Skipping task with invalid duration:', task);
          results.conflicts.push({
            issue: `Invalid task duration: "${task.title}"`,
            suggestion: 'Tasks must have a valid duration in minutes'
          });
          continue;
        }
        
        // Check if a similar task already exists
        const existingTask = existingTasks.find(existing => 
          existing.title.toLowerCase().includes(task.title.toLowerCase().substring(0, 20)) ||
          task.title.toLowerCase().includes(existing.title.toLowerCase().substring(0, 20))
        );
        
        if (existingTask) {
          console.log('Similar task already exists, skipping:', task.title);
          results.conflicts.push({
            issue: `Similar task already exists: "${existingTask.title}"`,
            suggestion: `Consider updating existing task instead of creating: "${task.title}"`
          });
          continue;
        }
        
        // Insert the new task
        const insertResult = await sql.query(
          `INSERT INTO tasks (user_id, title, duration_minutes, importance, status, scheduled_time, task_date)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE) RETURNING id`,
          [
            userId, 
            task.title.trim(), 
            task.duration || 30, 
            task.importance || 'medium', 
            'todo', 
            task.scheduledTime || null
          ]
        );
        
        const newTask = {
          id: insertResult.rows[0].id,
          title: task.title.trim(),
          duration: task.duration || 30,
          importance: task.importance || 'medium',
          scheduledTime: task.scheduledTime || null,
          status: 'todo'
        };
        
        results.insertedTasks.push(newTask);
        console.log('Successfully inserted task:', newTask.title);
        
      } catch (insertError) {
        console.error('Failed to insert task:', task.title, insertError);
        results.conflicts.push({
          issue: `Failed to create task: "${task.title}"`,
          suggestion: 'Task creation failed due to database error'
        });
      }
    }

    // PROCESS TASKS TO DELETE: Only process if they have valid UUIDs
    const tasksToDelete = generatedTasks.filter(task => 
      task.action === 'delete' || 
      task.action === 'remove' || 
      task.action === 'completed'
    );
    
    console.log(`Found ${tasksToDelete.length} tasks to delete`);
    
    for (const task of tasksToDelete) {
      try {
        // CRITICAL: Only attempt to delete if we have a valid UUID
        if (!task.id) {
          console.log('Cannot delete task without ID:', JSON.stringify(task));
          results.conflicts.push({
            issue: `Cannot delete task without ID: "${task.title || JSON.stringify(task)}"`,
            suggestion: 'Skipping deletion due to missing ID'
          });
          continue;
        }
        
        // Validate the UUID format
        if (!isValidUUID(task.id)) {
          console.log('Invalid UUID format for deletion:', task.id, JSON.stringify(task));
          results.conflicts.push({
            issue: `Invalid UUID format for deletion: "${task.id}"`,
            suggestion: 'Skipping deletion due to invalid UUID format'
          });
          
          // Try to find the real task by title and delete it
          try {
            const matchingTask = existingTasks.find(t => 
              t.title.toLowerCase() === (task.title || '').toLowerCase()
            );
            
            if (matchingTask && isValidUUID(matchingTask.id)) {
              console.log('Found matching task by title, using its ID instead:', matchingTask.id);
              
              await sql.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [matchingTask.id, userId]);
              results.deletedTasks.push({...matchingTask, action: 'delete'});
              console.log('Successfully deleted task by title match:', matchingTask.title);
            }
          } catch (err) {
            console.error('Error trying to delete by title match:', err);
          }
          continue;
        }
        
        // Delete the task using its valid UUID
        const deleteResult = await sql.query(
          'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id, title', 
          [task.id, userId]
        );
        
        if (deleteResult.rowCount && deleteResult.rowCount > 0) {
          results.deletedTasks.push({
            id: task.id,
            title: deleteResult.rows[0]?.title || task.title || `Task ${task.id}`
          });
          console.log('Successfully deleted task:', task.id);
        } else {
          console.log('No task found with ID:', task.id);
          results.conflicts.push({
            issue: `No task found with ID: "${task.id}"`,
            suggestion: 'Task may have been already deleted or does not exist'
          });
        }
      } catch (deleteError) {
        console.error('Failed to delete task:', task.id, deleteError);
        results.conflicts.push({
          issue: `Failed to delete task with ID: "${task.id}"`,
          suggestion: 'Database error during deletion'
        });
      }
    }
    
    // PROCESS TASKS TO MODIFY: Only process if they have valid UUIDs
    const tasksToModify = generatedTasks.filter(task => 
      task.action === 'modify' || 
      task.action === 'update' || 
      task.action === 'change'
    );
    
    for (const task of tasksToModify) {
      try {
        // CRITICAL: Only attempt to modify if we have a valid UUID
        if (!task.id) {
          console.log('Cannot modify task without ID:', task.title || task);
          results.conflicts.push({
            issue: `Cannot modify task without ID: "${task.title || JSON.stringify(task)}"`,
            suggestion: 'Skipping modification due to missing ID'
          });
          continue;
        }
        
        // Validate the UUID format
        if (!isValidUUID(task.id)) {
          console.log('Invalid UUID format for modification:', task.id);
          results.conflicts.push({
            issue: `Invalid UUID format for modification: "${task.id}"`,
            suggestion: 'Skipping modification due to invalid UUID format'
          });
          
          // Try to find the real task by title and modify it
          try {
            const matchingTask = existingTasks.find(t => 
              t.title.toLowerCase() === (task.title || '').toLowerCase()
            );
            
            if (matchingTask && isValidUUID(matchingTask.id)) {
              console.log('Found matching task by title, using its ID instead:', matchingTask.id);
              
              // Update the task using its real ID
              await sql.query(
                `UPDATE tasks SET 
                  title = $1, 
                  duration_minutes = $2, 
                  importance = $3, 
                  status = $4, 
                  scheduled_time = $5 
                WHERE id = $6 AND user_id = $7`,
                [
                  task.title || matchingTask.title,
                  task.duration || matchingTask.duration_minutes,
                  task.importance || matchingTask.importance,
                  task.status || matchingTask.status,
                  task.scheduledTime || matchingTask.scheduled_time,
                  matchingTask.id,
                  userId
                ]
              );
              
              results.modifiedTasks.push({
                id: matchingTask.id,
                title: task.title || matchingTask.title,
                originalTitle: matchingTask.title
              });
              console.log('Successfully modified task by title match:', matchingTask.title);
            }
          } catch (err) {
            console.error('Error trying to modify by title match:', err);
          }
          continue;
        }
        
        // Modify the task using its valid UUID
        const updateResult = await sql.query(
          `UPDATE tasks SET 
            title = COALESCE($1, title), 
            duration_minutes = COALESCE($2, duration_minutes), 
            importance = COALESCE($3, importance), 
            status = COALESCE($4, status), 
            scheduled_time = $5 
          WHERE id = $6 AND user_id = $7 RETURNING id, title`,
          [
            task.title || null,
            task.duration || null,
            task.importance || null,
            task.status || null,
            task.scheduledTime || null,
            task.id,
            userId
          ]
        );
        
        if (updateResult.rowCount && updateResult.rowCount > 0) {
          results.modifiedTasks.push({
            id: task.id,
            title: task.title || updateResult.rows[0].title
          });
          console.log('Successfully modified task:', task.id);
        } else {
          console.log('No task found with ID for modification:', task.id);
          results.conflicts.push({
            issue: `No task found with ID: "${task.id}" for modification`,
            suggestion: 'Task may have been deleted or does not exist'
          });
        }
      } catch (modifyError) {
        console.error('Failed to modify task:', task.id, modifyError);
        results.conflicts.push({
          issue: `Failed to modify task with ID: "${task.id}"`,
          suggestion: 'Database error during modification'
        });
      }
    }

    console.log('Task alignment completed successfully');
    console.log('Results:', {
      inserted: results.insertedTasks.length,
      modified: results.modifiedTasks.length,
      deleted: results.deletedTasks.length,
      conflicts: results.conflicts.length
    });
    
    return results;
    
  } catch (error) {
    console.error('Error in alignTasksWithPlan:', error);
    
    // Return partial results even if there was an error
    return results;
  }
}

export async function getTasksAndPlanForUser(userId: string): Promise<{ tasks: Task[], plan: Plan | null }> {
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Get user's tasks
    const tasksResult = await sql.query(
      `SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    
    // Get user's most recent plan
    const planResult = await sql.query(
      `SELECT * FROM plans WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    
    return {
      tasks: tasksResult.rows,
      plan: planResult.rows[0] || null
    };
  } catch (error) {
    console.error('Error getting tasks and plan:', error);
    throw error;
  } finally {
    if (sql) {
      await sql.end();
    }
  }
}
