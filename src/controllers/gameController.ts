// src/controllers/gameController.ts
import { Response } from 'express';
import { Client } from '@neondatabase/serverless';
import { AuthenticatedRequest } from '../types';
import { getDbConnection } from '../utils/database';

export async function saveGameHighScore(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    const { score } = req.body;
    
    if (typeof score !== 'number' || isNaN(score) || score < 0) {
      return res.status(400).json({ error: "Score must be a valid positive number" });
    }

    sql = await getDbConnection();
    
    // Check if user already has a high score
    const { rows: existingScores } = await sql.query(
      `SELECT score FROM game_scores WHERE user_id = $1`, 
      [userId]
    );
    
    if (existingScores.length > 0) {
      // Only update if the new score is higher
      if (score > existingScores[0].score) {
        await sql.query(
          `UPDATE game_scores SET score = $1, updated_at = NOW() WHERE user_id = $2`,
          [score, userId]
        );
      }
    } else {
      // Insert new high score
      await sql.query(
        `INSERT INTO game_scores (user_id, score) VALUES ($1, $2)`,
        [userId, score]
      );
    }

    res.status(200).json({ 
      success: true, 
      message: "High score saved successfully",
      score
    });

  } catch (err: any) {
    console.error("Game score saving error:", err);
    res.status(500).json({ error: "Failed to save game score: " + err.message });
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

export async function getGameHighScore(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    const { rows } = await sql.query(
      `SELECT score FROM game_scores WHERE user_id = $1`, 
      [userId]
    );
    
    const highScore = rows.length > 0 ? rows[0].score : 0;

    res.status(200).json({ 
      highScore
    });

  } catch (err: any) {
    console.error("Game score retrieval error:", err);
    res.status(500).json({ error: "Failed to get game score: " + err.message });
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

export async function getUserHighScore(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  let sql: Client | null = null;
  
  try {
    sql = await getDbConnection();
    
    // Get user's high score
    const { rows: userScores } = await sql.query(
      `SELECT score FROM game_scores WHERE user_id = $1`, 
      [userId]
    );
    
    // Get all-time high score (highest score among all users)
    const { rows: allTimeHighScore } = await sql.query(
      `SELECT MAX(score) as all_time_high FROM game_scores`
    );
    
    const highScore = userScores.length > 0 ? userScores[0].score : 0;
    const allTimeHigh = allTimeHighScore.length > 0 ? allTimeHighScore[0].all_time_high : 0;

    res.status(200).json({ 
      highScore,
      hasScore: userScores.length > 0,
      allTimeHigh
    });

  } catch (err: any) {
    console.error("User high score retrieval error:", err);
    res.status(500).json({ error: "Failed to get user high score: " + err.message });
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
