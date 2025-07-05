// src/controllers/apodController.ts
import { Request, Response } from 'express';

interface APODData {
  url: string;
  title: string;
  explanation: string;
  media_type: string;
  hdurl?: string;
  date: string;
}

/**
 * Get NASA Astronomy Picture of the Day
 */
export const getAPOD = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query;
    
    // Use environment variable for NASA API key, fallback to DEMO_KEY
    const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
    
    // Build the NASA API URL
    let nasaApiUrl = `https://api.nasa.gov/planetary/apod?api_key=${apiKey}`;
    
    // If a specific date is requested, add it to the URL
    if (date && typeof date === 'string') {
      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        res.status(400).json({ 
          error: 'Invalid date format. Use YYYY-MM-DD format.' 
        });
        return;
      }
      nasaApiUrl += `&date=${date}`;
    }

    // Fetch data from NASA API
    const response = await fetch(nasaApiUrl);
    
    if (!response.ok) {
      throw new Error(`NASA API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as APODData;
    
    // If the current APOD is a video, try to get an image from recent days
    if (data.media_type !== 'image') {
      console.log('Current APOD is a video, trying to find a recent image...');
      
      // Try the last 7 days to find an image
      for (let i = 1; i <= 7; i++) {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - i);
        const dateString = pastDate.toISOString().split('T')[0];
        
        const fallbackUrl = `https://api.nasa.gov/planetary/apod?api_key=${apiKey}&date=${dateString}`;
        const fallbackResponse = await fetch(fallbackUrl);
        
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json() as APODData;
          if (fallbackData.media_type === 'image') {
            console.log(`Found image APOD from ${dateString}`);
            res.json({
              success: true,
              data: fallbackData,
              message: `Current APOD is a video. Showing image from ${dateString}.`
            });
            return;
          }
        }
      }
      
      // If no images found in the past week, return error
      res.status(404).json({
        error: 'No image APOD found in recent days. Only video content available.',
        data: data // Still return the video data for reference
      });
      return;
    }
    
    // Return the image APOD
    res.json({
      success: true,
      data: data,
      message: 'APOD retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching APOD:', error);
    
    // Return appropriate error response
    if (error instanceof Error) {
      res.status(500).json({ 
        error: 'Failed to fetch APOD data',
        details: error.message 
      });
    } else {
      res.status(500).json({ 
        error: 'Unknown error occurred while fetching APOD data' 
      });
    }
  }
};

/**
 * Get random APOD from the past month
 */
export const getRandomAPOD = async (req: Request, res: Response): Promise<void> => {
  try {
    const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
    
    // Generate a random date from the past 30 days
    const daysBack = Math.floor(Math.random() * 30) + 1;
    const randomDate = new Date();
    randomDate.setDate(randomDate.getDate() - daysBack);
    const dateString = randomDate.toISOString().split('T')[0];
    
    const nasaApiUrl = `https://api.nasa.gov/planetary/apod?api_key=${apiKey}&date=${dateString}`;
    
    const response = await fetch(nasaApiUrl);
    
    if (!response.ok) {
      throw new Error(`NASA API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as APODData;
    
    // If it's a video, try another random date
    if (data.media_type !== 'image') {
      // Recursive call to try again (with a limit to prevent infinite recursion)
      const retryCount = parseInt(req.headers['x-retry-count'] as string) || 0;
      if (retryCount < 5) {
        req.headers['x-retry-count'] = (retryCount + 1).toString();
        await getRandomAPOD(req, res);
        return;
      } else {
        res.status(404).json({
          error: 'Unable to find a random image APOD after multiple attempts'
        });
        return;
      }
    }
    
    res.json({
      success: true,
      data: data,
      message: `Random APOD from ${dateString} retrieved successfully`
    });
    
  } catch (error) {
    console.error('Error fetching random APOD:', error);
    
    if (error instanceof Error) {
      res.status(500).json({ 
        error: 'Failed to fetch random APOD data',
        details: error.message 
      });
    } else {
      res.status(500).json({ 
        error: 'Unknown error occurred while fetching random APOD data' 
      });
    }
  }
};
