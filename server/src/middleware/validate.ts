import { Request, Response, NextFunction } from 'express';
import { z, AnyZodObject, ZodError } from 'zod';
import logger from '../logger.ts';

// Step 2: Enforce Request Validation (Zod)
export const validateRequest = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ error: error.issues }, 'Request Validation Failed');
        return res.status(400).json({
          error: 'Bad Request',
          details: error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        });
      }
      next(error);
    }
  };
};
