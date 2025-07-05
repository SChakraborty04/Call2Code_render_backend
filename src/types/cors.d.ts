// Type declarations for cors module
// This ensures TypeScript can find CORS types during build

declare module 'cors' {
  import { Request, Response, NextFunction } from 'express';

  interface CorsOptions {
    origin?: boolean | string | RegExp | (string | RegExp)[] | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);
    methods?: string | string[];
    allowedHeaders?: string | string[];
    exposedHeaders?: string | string[];
    credentials?: boolean;
    maxAge?: number;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
  }

  interface CorsRequest extends Request {
    method?: string;
    headers: any;
  }

  interface CorsRequestHandler {
    (req: CorsRequest, res: Response, next: NextFunction): void;
  }

  function cors(options?: CorsOptions): CorsRequestHandler;
  export = cors;
}
