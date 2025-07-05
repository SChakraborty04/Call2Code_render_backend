// src/utils/ai.ts
import { env } from '../config/env';

// AI Model Configuration
interface ModelConfig {
  name: string;
  endpoint: string;
  strengths: string[];
  maxTokens: number;
  costTier: 'low' | 'medium' | 'high';
  reliability: 'high' | 'medium' | 'low';
  specialization?: string;
}

const AI_MODELS: { [key: string]: ModelConfig } = {
  // Frontier Models (Best Performance)
  'mistral-medium-2505': {
    name: 'Mistral Medium 3',
    endpoint: 'mistral-medium-2505',
    strengths: ['complex-reasoning', 'multimodal', 'frontier-tasks'],
    maxTokens: 128000,
    costTier: 'high',
    reliability: 'high',
    specialization: 'complex-planning'
  },
  'magistral-medium-2506': {
    name: 'Magistral Medium',
    endpoint: 'magistral-medium-2506',
    strengths: ['reasoning', 'logic', 'problem-solving'],
    maxTokens: 40000,
    costTier: 'high',
    reliability: 'high',
    specialization: 'voice-extraction'
  },
  
  // Large Models (High Performance)
  'mistral-large-2411': {
    name: 'Mistral Large 2.1',
    endpoint: 'mistral-large-2411',
    strengths: ['complex-tasks', 'high-quality', 'reliable'],
    maxTokens: 128000,
    costTier: 'high',
    reliability: 'high',
    specialization: 'schedule-planning'
  },
  
  // Small Models (Cost-Effective)
  'mistral-small-2506': {
    name: 'Mistral Small 3.2',
    endpoint: 'mistral-small-2506',
    strengths: ['general-tasks', 'cost-effective', 'fast'],
    maxTokens: 128000,
    costTier: 'low',
    reliability: 'high',
    specialization: 'task-generation'
  },
  'magistral-small-2506': {
    name: 'Magistral Small',
    endpoint: 'magistral-small-2506',
    strengths: ['reasoning', 'structured-output', 'reliable'],
    maxTokens: 40000,
    costTier: 'medium',
    reliability: 'high',
    specialization: 'voice-extraction-fallback'
  },
  
  // Specialized Models
  'codestral-2501': {
    name: 'Codestral 2',
    endpoint: 'codestral-2501',
    strengths: ['coding', 'structured-data', 'fill-in-middle'],
    maxTokens: 256000,
    costTier: 'medium',
    reliability: 'high',
    specialization: 'json-generation'
  },
  
  // Edge Models (Ultra Fast)
  'ministral-8b-2410': {
    name: 'Ministral 8B',
    endpoint: 'ministral-8b-2410',
    strengths: ['speed', 'efficiency', 'edge-computing'],
    maxTokens: 128000,
    costTier: 'low',
    reliability: 'medium',
    specialization: 'quick-tasks'
  },
  'ministral-3b-2410': {
    name: 'Ministral 3B',
    endpoint: 'ministral-3b-2410',
    strengths: ['ultra-fast', 'edge', 'simple-tasks'],
    maxTokens: 128000,
    costTier: 'low',
    reliability: 'medium',
    specialization: 'emergency-fallback'
  },
  'mistral-large-latest': {
    name: 'Mistral Large (Legacy)',
    endpoint: 'mistral-large-latest',
    strengths: ['complex-tasks', 'reliable'],
    maxTokens: 128000,
    costTier: 'high',
    reliability: 'medium',
    specialization: 'legacy-fallback'
  },
  'mistral-small-latest': {
    name: 'Mistral Small (Legacy)',
    endpoint: 'mistral-small-latest',
    strengths: ['general-tasks', 'cost-effective'],
    maxTokens: 32000,
    costTier: 'medium',
    reliability: 'medium',
    specialization: 'legacy-fallback'
  }
};

// Task-specific model assignments
const TASK_MODEL_PRIORITIES = {
  'voice-extraction': [
    'magistral-medium-2506',
    'magistral-small-2506',
    'mistral-large-2411',
    'mistral-small-2506',
    'ministral-8b-2410',
    'mistral-large-latest'
  ],
  'schedule-planning': [
    'mistral-medium-2505',
    'mistral-large-2411',
    'magistral-medium-2506',
    'mistral-small-2506',
    'magistral-small-2506',
    'mistral-small-latest'
  ],
  'task-generation': [
    'mistral-small-2506',
    'magistral-small-2506',
    'mistral-large-2411',
    'ministral-8b-2410',
    'ministral-3b-2410',
    'mistral-small-latest'
  ],
  'json-parsing': [
    'codestral-2501',
    'magistral-small-2506',
    'mistral-small-2506',
    'ministral-8b-2410',
    'ministral-3b-2410'
  ]
};

// Simple performance tracking
const modelPerformance = new Map<string, { successes: number; failures: number; avgResponseTime: number }>();

function trackModelPerformance(modelKey: string, success: boolean, responseTime: number) {
  const existing = modelPerformance.get(modelKey) || { successes: 0, failures: 0, avgResponseTime: 0 };
  
  if (success) {
    existing.successes++;
  } else {
    existing.failures++;
  }
  
  existing.avgResponseTime = (existing.avgResponseTime + responseTime) / 2;
  modelPerformance.set(modelKey, existing);
}

// Helper function to clean AI responses - remove debugging info and ensure proper formatting
export function cleanAIResponse(rawResponse: string): string {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return "I'd be happy to help with your question! Could you provide more details so I can give you better advice?";
  }
  
  let cleaned = rawResponse.trim();
  
  // Remove any <think> tags and their content
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  // Remove any other XML-like debugging tags
  cleaned = cleaned.replace(/<debug>[\s\S]*?<\/debug>/gi, '');
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  cleaned = cleaned.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '');
  
  // Remove any standalone debugging patterns
  cleaned = cleaned.replace(/^[Tt]hinking:[\s\S]*?\n\n/gm, '');
  cleaned = cleaned.replace(/^[Dd]ebug:[\s\S]*?\n\n/gm, '');
  cleaned = cleaned.replace(/^[Aa]nalysis:[\s\S]*?\n\n/gm, '');
  
  // Clean up markdown formatting
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove bold **text**
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1'); // Remove italic *text*
  cleaned = cleaned.replace(/__(.*?)__/g, '$1'); // Remove underline __text__
  cleaned = cleaned.replace(/`(.*?)`/g, '$1'); // Remove code `text`
  cleaned = cleaned.replace(/#{1,6}\s*/g, ''); // Remove headers ### 
  cleaned = cleaned.replace(/^\s*[-*+]\s*/gm, '• '); // Convert list items to bullets
  cleaned = cleaned.replace(/^\s*\d+\.\s*/gm, '• '); // Convert numbered lists to bullets
  
  // Clean up extra whitespace and newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/^\s+|\s+$/g, '');
  
  // Ensure we have a meaningful response
  if (!cleaned || cleaned.length < 10) {
    return "I'd be happy to help with your question! Could you provide more details so I can give you better advice?";
  }
  
  // Truncate if too long (safety check)
  if (cleaned.length > 1000) {
    const sentences = cleaned.split(/[.!?]+/);
    let result = '';
    for (const sentence of sentences) {
      if ((result + sentence).length > 800) break;
      result += sentence.trim() + '. ';
    }
    cleaned = result.trim();
  }
  
  return cleaned;
}

// Optimal AI model selection with smart fallback
export async function callOptimalAI(
  messages: any[],
  taskType: 'voice-extraction' | 'schedule-planning' | 'task-generation' | 'json-parsing' = 'task-generation',
  options: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    urgency?: 'low' | 'medium' | 'high';
  } = {}
): Promise<{ response: any; modelUsed: string; attemptCount: number }> {
  const priorityModels = TASK_MODEL_PRIORITIES[taskType] || TASK_MODEL_PRIORITIES['task-generation'];
  
  let lastError: Error | null = null;
  let attemptCount = 0;

  for (const modelKey of priorityModels) {
    attemptCount++;
    const model = AI_MODELS[modelKey];
    
    if (!model) {
      console.warn(`Model ${modelKey} not found in configuration`);
      continue;
    }

    try {
      const startTime = Date.now();
      
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: model.endpoint,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: Math.min(options.maxTokens || 1000, model.maxTokens),
          top_p: options.topP || 0.9,
          stream: false
        })
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      trackModelPerformance(modelKey, true, responseTime);
      
      return {
        response: data,
        modelUsed: `${model.name} (${model.endpoint})`,
        attemptCount
      };

    } catch (error: any) {
      lastError = error;
      const responseTime = Date.now();
      trackModelPerformance(modelKey, false, responseTime);
      
      console.warn(`Model ${model.name} failed (attempt ${attemptCount}):`, error.message);
      
      // If this was a rate limit or temporary error, try next model
      if (error.message.includes('rate limit') || error.message.includes('429') || 
          error.message.includes('503') || error.message.includes('502')) {
        continue;
      }
      
      // For other errors, also try the next model but log more details
      console.error(`Model ${model.name} error details:`, error);
    }
  }

  // If all models failed, throw the last error
  throw new Error(`All AI models failed after ${attemptCount} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
}

// Helper function to parse various time formats and convert to HH:MM
export function parseTimeString(timeStr: string): string | null {
  const cleaned = timeStr.toLowerCase().trim();
  
  // Handle "2 PM", "3:30 AM", etc.
  const timeWithAmPm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(cleaned);
  if (timeWithAmPm && timeWithAmPm[1] && timeWithAmPm[3]) {
    let hours = parseInt(timeWithAmPm[1]);
    const minutes = timeWithAmPm[2] ? parseInt(timeWithAmPm[2]) : 0;
    const ampm = timeWithAmPm[3].toLowerCase();
    
    if (ampm === 'pm' && hours !== 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  
  // Handle "14:30", "9:15", etc.
  const time24 = /^(\d{1,2}):(\d{2})$/.exec(cleaned);
  if (time24 && time24[1] && time24[2]) {
    const hours = parseInt(time24[1]);
    const minutes = parseInt(time24[2]);
    
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }
  
  // Handle "15", "3" (assume it's hour)
  const hourOnly = /^(\d{1,2})$/.exec(cleaned);
  if (hourOnly && hourOnly[1]) {
    const hours = parseInt(hourOnly[1]);
    if (hours >= 0 && hours <= 23) {
      return `${hours.toString().padStart(2, '0')}:00`;
    }
  }
  
  return null;
}

// Helper function to detect outdoor tasks
export function isOutdoorTask(taskTitle: string): boolean {
  const outdoorKeywords = [
    'walk', 'run', 'jog', 'bike', 'garden', 'outdoor', 'park', 'hike', 
    'beach', 'picnic', 'sports', 'exercise outside', 'yard work', 'shopping',
    'market', 'errands', 'drive', 'commute', 'meeting outside'
  ];
  
  const title = taskTitle.toLowerCase();
  return outdoorKeywords.some(keyword => title.includes(keyword));
}
