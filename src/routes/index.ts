// src/routes/index.ts
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createTask, getTasks, updateTask, deleteTask, clearTasks } from '../controllers/taskController';
import { savePreferences, getPreferences } from '../controllers/preferencesController';
import { generatePlan, getPlan } from '../controllers/planController';
import { 
  generateAITasks, 
  alignTasksWithAIPlan, 
  extractTasksFromVoice, 
  dictateKanbanTasks, 
  askKanbanAI, 
  getPerformanceInsights,
  getWeather
} from '../controllers/aiController';
import {
  saveGameHighScore,
  getGameHighScore,
  getUserHighScore
} from '../controllers/gameController';
import testCorsRoutes from './test-cors';
import apodRoutes from './apodRoutes';

const router = Router();

// Include test CORS route
router.use(testCorsRoutes);

// APOD routes (NASA Astronomy Picture of the Day)
router.use('/api/apod', apodRoutes);

// Health check routes
router.get('/health', (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.get('/', (req, res) => {
  res.json({ 
    status: "Server Running", 
    message: "Can't access backend directly.", 
    timestamp: new Date().toISOString() 
  });
});

// Task routes
router.post('/api/tasks', authMiddleware, createTask);
router.get('/api/tasks', authMiddleware, getTasks);
router.put('/api/tasks/:id', authMiddleware, updateTask);
router.delete('/api/tasks/:id', authMiddleware, deleteTask);
router.post('/api/clear-tasks', authMiddleware, clearTasks);

// Preferences routes
router.post('/api/preferences', authMiddleware, savePreferences);
router.get('/api/preferences', authMiddleware, getPreferences);

// Plan routes
router.post('/api/plan', authMiddleware, generatePlan);
router.get('/api/plan', authMiddleware, getPlan);

// AI routes
router.post('/api/generate-tasks', authMiddleware, generateAITasks);
router.post('/api/align-tasks-with-plan', authMiddleware, alignTasksWithAIPlan);
router.post('/api/extract-tasks', authMiddleware, extractTasksFromVoice);
router.post('/api/kanban-ai/dictate', authMiddleware, dictateKanbanTasks);
router.post('/api/kanban-ai/ask', authMiddleware, askKanbanAI);
router.get('/api/performance-insights', authMiddleware, getPerformanceInsights);
router.get('/api/weather', authMiddleware, getWeather);

// Game score routes
router.post('/api/game-score', authMiddleware, saveGameHighScore);
router.get('/api/game-score', authMiddleware, getGameHighScore);
router.get('/api/userhighscore', authMiddleware, getUserHighScore);

// 404 handler
router.use('*', (req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default router;
