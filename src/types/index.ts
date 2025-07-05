// src/types/index.ts
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  body: any;
  params: any;
}

export interface WeatherData {
  description: string;
  main: string;
  icon: string;
}

export interface MainWeatherData {
  temp: number;
  feels_like: number;
  temp_min: number;
  temp_max: number;
  pressure: number;
  humidity: number;
}

export interface CurrentWeather {
  weather: WeatherData[];
  main: MainWeatherData;
  visibility: number;
  wind: {
    speed: number;
    deg: number;
  };
  clouds: {
    all: number;
  };
  name: string;
}

export interface Weather {
  current: CurrentWeather;
  forecast: any;
  summary: string;
}
