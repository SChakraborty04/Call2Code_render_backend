// src/routes/apodRoutes.ts
import express from 'express';
import { getAPOD, getRandomAPOD } from '../controllers/apodController';

const router = express.Router();

// Get current or specific date APOD
// GET /apod
// GET /apod?date=YYYY-MM-DD
router.get('/', getAPOD);

// Get random APOD from the past month
// GET /apod/random
router.get('/random', getRandomAPOD);

export default router;
