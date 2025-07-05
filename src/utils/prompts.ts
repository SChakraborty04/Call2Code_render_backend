// src/utils/prompts.ts
import { isOutdoorTask } from './ai';

export function buildTaskExtractionPrompt({ transcript, prefs }: any) {
  const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  return `You are a precision task extraction AI. Extract tasks from user speech, being flexible and helpful while maintaining accuracy.

CONTEXT:
- Current time: ${currentTime}
- Current date: ${currentDate}
- User preferences: ${JSON.stringify(prefs || {})}
- User transcript: "${transcript}"

EXTRACTION RULES (FOLLOW EXACTLY):
1. TASK IDENTIFICATION: Extract ANY actionable item mentioned, even if brief
   - "Complete the project" → Valid task
   - "Call mom" → Valid task  
   - "Workout" → Valid task
   - "Meeting with team" → Valid task

2. TIME PRECISION: If user mentions ANY time, extract EXACT time in 24-hour format
   - "at 9:00 AM" → "09:00"
   - "2 PM" → "14:00" 
   - "at 3" → "15:00"
   - "half past 1" → "13:30"

3. DURATION INTELLIGENCE: 
   - If mentioned explicitly ("2 hours" = 120, "30 minutes" = 30)
   - If not mentioned, estimate reasonable duration:
     * Simple tasks (call, email): 15-30 minutes
     * Work tasks (project, meeting): 60-120 minutes
     * Exercise/activities: 30-60 minutes

4. IMPORTANCE DETECTION:
   - HIGH: "urgent", "ASAP", "deadline", "important", "critical", "must do"
   - LOW: "maybe", "sometime", "if I have time", "eventually", "optional"
   - MEDIUM: Everything else (default)

5. TITLE ENHANCEMENT: Make titles actionable and clear
   - "project" → "Complete the project"
   - "workout" → "Exercise/workout session"
   - "call mom" → "Call mom"

RESPONSE FORMAT - VALID JSON ONLY:
[
  {
    "title": "Clear, actionable task name",
    "duration": [NUMBER_IN_MINUTES],
    "importance": "high|medium|low",
    "scheduledTime": "HH:MM" or null,
    "notes": "Additional context from speech" or null
  }
]

CRITICAL REQUIREMENTS: 
- ALWAYS return a JSON array, even for single tasks
- NEVER return empty array unless user explicitly says no tasks
- PRESERVE user's specified times EXACTLY
- Make reasonable assumptions for missing information
- Each task must be independently actionable
- NO markdown, NO explanations, NO comments outside JSON

EXAMPLE EXTRACTIONS:
- "Complete the project at 9:00 AM" → [{"title": "Complete the project", "duration": 120, "importance": "medium", "scheduledTime": "09:00", "notes": null}]
- "Call mom later" → [{"title": "Call mom", "duration": 15, "importance": "medium", "scheduledTime": null, "notes": "later"}]
- "Important meeting at 2 PM for 1 hour" → [{"title": "Important meeting", "duration": 60, "importance": "high", "scheduledTime": "14:00", "notes": null}]`;
}

export function buildTaskGenerationPrompt({ 
  prefs, 
  weather, 
  customPrompts = [], 
  existingPlan = null, 
  existingTasks = [], 
  alignWithSchedule = false 
}: any) {
  const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  let weatherDesc = "unknown weather conditions";
  let weatherAdvice = "";
  
  if (weather?.summary) {
    weatherDesc = weather.summary;
    if (weather.summary.includes("rain") || weather.summary.includes("storm")) {
      weatherAdvice = "INDOOR TASKS ONLY - Avoid outdoor activities due to rain/storms.";
    } else if (weather.summary.includes("sunny") || weather.summary.includes("clear")) {
      weatherAdvice = "Good weather for both indoor and outdoor tasks.";
    } else if (weather.summary.includes("cold") || weather.summary.includes("snow")) {
      weatherAdvice = "Prefer indoor tasks, limit outdoor exposure.";
    }
  } else if (weather?.current) {
    const temp = Math.round(weather.current.main.temp);
    const condition = weather.current.weather[0].description;
    weatherDesc = `${condition}, ${temp}°C`;
    
    if (condition.includes("rain") || condition.includes("storm")) {
      weatherAdvice = "INDOOR TASKS ONLY - Weather not suitable for outdoor activities.";
    } else if (temp > 25) {
      weatherAdvice = "Hot weather - prefer morning/evening outdoor tasks, midday indoor tasks.";
    } else if (temp < 5) {
      weatherAdvice = "Cold weather - minimize outdoor exposure, focus on indoor productivity.";
    } else {
      weatherAdvice = "Pleasant weather suitable for all types of tasks.";
    }
  }
  
  // Build schedule alignment section
  let scheduleAlignment = "";
  if (alignWithSchedule && existingPlan?.schedule) {
    const scheduleItems = existingPlan.schedule.map((item: any) => 
      `${item.time}: ${item.activity} (${item.duration}min)`
    ).join('\n');
    
    scheduleAlignment = `
EXISTING SCHEDULE (CRITICAL - ALIGN NEW TASKS):
${scheduleItems}

ALIGNMENT REQUIREMENTS:
- NEW TASKS must fit into available time slots in the existing schedule
- DO NOT conflict with existing scheduled activities
- Consider break times and transitions
- Respect the flow and logic of the existing schedule`;
  }
  
  // Build existing tasks context
  let existingTasksContext = "";
  if (existingTasks.length > 0) {
    const taskList = existingTasks.map((task: any) => 
      `ID: "${task.id}" - "${task.title}" [${task.duration_minutes}min] [${task.importance}] [Status: ${task.status}]`
    ).join('\n');
    
    existingTasksContext = `
EXISTING TASKS TO CONSIDER:
${taskList}

- CRITICAL: For any task you want to modify or delete, you MUST include its exact UUID/ID shown above
- UUIDs look like: "123e4567-e89b-12d3-a456-426614174000" - they are strings with dashes
- NEVER attempt to modify or delete a task using only its title - the UUID is REQUIRED
- Generate tasks that complement existing ones
- Avoid duplicating similar tasks
- Consider the workload balance`;
  }
  
  // Build custom prompts section
  let customInstructions = "";
  if (customPrompts && customPrompts.length > 0) {
    const validPrompts = customPrompts.filter((p: string) => p && p.trim().length > 0);
    if (validPrompts.length > 0) {
      customInstructions = `
CUSTOM USER INSTRUCTIONS (CRITICAL - FOLLOW EXACTLY):
${validPrompts.map((prompt: string, index: number) => `${index + 1}. ${prompt.trim()}`).join('\n')}

These instructions must be prioritized when generating tasks.`;
    }
  }
  
  return `You are a PRECISION AI task generator. Generate EXACTLY 3-5 highly relevant, actionable tasks.

CONTEXT ANALYSIS:
- Current time: ${currentTime}
- Date: ${currentDate}
- User preferences: ${JSON.stringify(prefs || {})}
- Weather: ${weatherDesc}
- Weather guidance: ${weatherAdvice}
${scheduleAlignment}
${existingTasksContext}
${customInstructions}

GENERATION RULES:
1. WEATHER INTEGRATION: Tasks MUST align with weather conditions
2. PEAK FOCUS OPTIMIZATION: Schedule demanding tasks during user's peak focus time (${prefs?.peak_focus || 'morning'})
3. DURATION REALISM: 15-120 minutes, vary based on task complexity
4. TIME INTELLIGENCE: Suggest optimal times based on:
   - User's wake time: ${prefs?.wake_time || '09:00'}
   - User's sleep time: ${prefs?.sleep_time || '23:00'}
   - Peak focus period: ${prefs?.peak_focus || 'morning'}
   - Weather conditions
   - Time of day appropriateness
   ${alignWithSchedule ? '- Existing schedule constraints and available time slots' : ''}
5. CUSTOM INSTRUCTIONS: Follow all user custom instructions exactly
6. SCHEDULE HARMONY: ${alignWithSchedule ? 'Ensure perfect alignment with existing schedule' : 'Generate standalone tasks'}

TASK CATEGORIES TO CONSIDER:
- Weather-appropriate activities (indoor/outdoor)
- Professional/work tasks during peak hours
- Personal development during focused times
- Maintenance tasks during non-peak hours
- Health/fitness appropriate to weather

RESPONSE FORMAT - VALID JSON ONLY:
[
  {
    "title": "Specific actionable task",
    "duration": [MINUTES_NUMBER],
    "importance": "high|medium|low",
    "scheduledTime": "HH:MM"
    // No "action" field needed for new tasks, no ID needed
  },
  {
    "id": "EXACT-UUID-FROM-LIST-ABOVE",
    "action": "delete",
    "title": "Task to be deleted"
    // Must include exact UUID to delete
  },
  {
    "id": "EXACT-UUID-FROM-LIST-ABOVE",
    "action": "modify",
    "title": "Updated task title",
    "duration": [UPDATED_MINUTES],
    "importance": "updated-importance",
    "scheduledTime": "updated-time"
    // Must include exact UUID to modify
  }
]

CRITICAL REQUIREMENTS:
- NO markdown, NO explanations, NO extra text
- Tasks must be WEATHER-APPROPRIATE
- Times must fit within wake/sleep schedule
- ${alignWithSchedule ? 'Times must NOT conflict with existing schedule' : 'High-importance tasks during peak focus'}
- Follow all custom user instructions exactly
- Realistic and immediately actionable
- EXACT JSON format only
- NEVER attempt to delete or modify a task without its EXACT UUID/ID
- For new tasks, do NOT include an ID field (the system will generate one)`;
}

export function buildPrompt({ prefs, tasks, weather, customPrompts = [] }: any) {
  if (!tasks || tasks.length === 0) {
    throw new Error("No tasks provided for planning");
  }
  
  const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  // Enhanced task analysis
  const taskAnalysis = tasks.map((t: any) => {
    const hasScheduledTime = t.scheduled_time !== null;
    const priority = t.importance === 'high' ? 'CRITICAL' : t.importance === 'medium' ? 'IMPORTANT' : 'NORMAL';
    const status = t.status || 'todo';
    
    return {
      title: t.title || 'Untitled',
      duration: t.duration_minutes || 30,
      priority,
      status,
      scheduledTime: t.scheduled_time,
      isTimeFixed: hasScheduledTime,
      weatherDependent: isOutdoorTask(t.title)
    };
  });
  
  // Weather impact analysis
  let weatherInfo = "unknown weather conditions";
  let weatherConstraints = "";
  
  if (weather?.summary) {
    weatherInfo = weather.summary;
  } else if (weather?.weather && weather?.main) {
    weatherInfo = `${weather.weather[0].description}, ${weather.main.temp}°C`;
  }
  
  if (weatherInfo.toLowerCase().includes("rain") || weatherInfo.toLowerCase().includes("storm")) {
    weatherConstraints = "CRITICAL: Reschedule outdoor tasks to indoor alternatives or postpone due to rain/storms.";
  } else if (weatherInfo.toLowerCase().includes("snow") || weatherInfo.toLowerCase().includes("cold")) {
    weatherConstraints = "WARNING: Minimize outdoor tasks, prioritize indoor activities.";
  } else if (weatherInfo.toLowerCase().includes("hot") || weatherInfo.toLowerCase().includes("sunny")) {
    weatherConstraints = "OPTIMIZE: Schedule outdoor tasks during cooler hours (early morning/evening).";
  }
  
  const taskLines = taskAnalysis
    .map((t: any) => `"${t.title}" [${t.duration}min] [${t.priority}] [Status: ${t.status}] [Time: ${t.scheduledTime || 'FLEXIBLE'}] [Weather-dependent: ${t.weatherDependent ? 'YES' : 'NO'}]`)
    .join("\n");
  
  // Build custom prompts section
  let customInstructions = "";
  if (customPrompts && customPrompts.length > 0) {
    const validPrompts = customPrompts.filter((p: string) => p && p.trim().length > 0);
    if (validPrompts.length > 0) {
      customInstructions = `
CUSTOM USER INSTRUCTIONS (CRITICAL - FOLLOW EXACTLY):
${validPrompts.map((prompt: string, index: number) => `${index + 1}. ${prompt.trim()}`).join('\n')}

These instructions override default scheduling rules when conflicts arise.`;
    }
  }
  
  return `You are an EXPERT SCHEDULE OPTIMIZER. Create a PRECISE, WEATHER-AWARE daily schedule.

CURRENT CONTEXT:
- Time: ${currentTime}
- Date: ${currentDate}
- Weather: ${weatherInfo}
- Weather constraints: ${weatherConstraints}

USER PROFILE:
- Wake time: ${prefs?.wake_time || '09:00'}
- Sleep time: ${prefs?.sleep_time || '23:00'}
- Peak focus: ${prefs?.peak_focus || 'morning'}
- Break style: ${prefs?.break_style || 'short'}
- Break interval: ${prefs?.break_interval_minutes || 30} minutes
- Max work hours: ${prefs?.max_work_hours || 8}
${customInstructions}

TASKS TO SCHEDULE:
${taskLines}

SCHEDULING RULES (FOLLOW EXACTLY):
1. FIXED TIMES: Tasks with specific times are UNMOVABLE - schedule exactly as specified
2. WEATHER PRIORITY: Outdoor tasks MUST be weather-appropriate or rescheduled
3. PEAK FOCUS: High-priority tasks during user's peak focus period
4. BREAK MANAGEMENT: Insert breaks every ${prefs?.break_interval_minutes || 30} minutes
5. ENERGY OPTIMIZATION: Heavy tasks during high-energy periods, light tasks during low-energy
6. REALISTIC TIMING: Account for transition time between tasks
7. WEATHER ADAPTATION: Modify outdoor tasks based on weather conditions
8. CUSTOM INSTRUCTIONS: Follow all user custom instructions exactly - they override default rules

RESPONSE FORMAT - EXACT JSON STRUCTURE:
{
  "schedule": [
    {
      "time": "HH:MM",
      "activity": "exact task or break name",
      "duration": "minutes_as_string",
      "type": "task|break|meal"
    }
  ],
  "summary": "Brief intelligent summary of schedule optimization decisions"
}

CRITICAL REQUIREMENTS:
- START at user's wake time: ${prefs?.wake_time || '09:00'}
- END before sleep time: ${prefs?.sleep_time || '23:00'}
- RESPECT all fixed times exactly
- ADAPT to weather conditions intelligently
- FOLLOW all custom user instructions exactly
- NO markdown, NO explanations outside JSON
- COMPLETE valid JSON with ALL closing brackets/braces
- Times in 24-hour format (HH:MM)`;
}
