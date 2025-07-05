// Add the fresh start endpoint to the task controller
import { Response } from 'express';
import { Client } from '@neondatabase/serverless';
import { AuthenticatedRequest } from '../types';
import { getDbConnection } from '../utils/database';

export async function clearTasks(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    console.log("clearTasks called for user:", userId);
    const { keepIncomplete = false } = req.body;
    sql = await getDbConnection();
    
    if (keepIncomplete) {
      // Only delete completed tasks
      console.log("Deleting only completed tasks for user:", userId);
      const result = await sql.query(`
        DELETE FROM tasks 
        WHERE user_id = $1 AND status = 'done'
        RETURNING id
      `, [userId]);
      
      console.log(`Deleted ${result.rowCount} completed tasks`);
      
      return res.status(200).json({ 
        message: "Completed tasks deleted successfully",
        deletedTasks: "completed only",
        count: result.rowCount
      });
    } else {
      // Delete all tasks for this user
      console.log("Deleting ALL tasks for user:", userId);
      const result = await sql.query(`
        DELETE FROM tasks 
        WHERE user_id = $1
        RETURNING id
      `, [userId]);
      
      console.log(`Deleted ${result.rowCount} tasks total`);
      
      return res.status(200).json({ 
        message: "All tasks deleted successfully",
        deletedTasks: "all",
        count: result.rowCount
      });
    }
    
  } catch (err: any) {
    console.error("Error in clearTasks:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (sql) {
      await sql.end();
    }
  }
}
