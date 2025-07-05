// src/routes/test-cors.ts
import { Router } from 'express';

const router = Router();

// Simple endpoint to test CORS
router.get('/test-cors', (req, res) => {
  res.json({ message: 'CORS is working correctly!' });
});

export default router;
