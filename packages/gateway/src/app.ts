import 'dotenv/config';
import express,{type Express} from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { submitRouter } from './routes/submit.js';
import { runsRouter } from './routes/runs.js';

export function createApp():Express{
    const app=express();

    //Security header 
    app.use(helmet());


    //Rate limiting
    app.use(rateLimit({
        windowMs: 60 * 1000, // 1 minute window
        max: 100,             // 100 req/IP/min
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests.' },
    }));

    //Cors allowed from the frontend 
    app.use(cors({origin:process.env.FRONTEND_URL || 'http://localhost:3000'}))

    //Body Json parser
    app.use(express.json());

    // Routes
    app.use('/health', healthRouter);
    app.use('/auth', authRouter);
    app.use('/submit', submitRouter);
    app.use('/runs', runsRouter);


    //Global error handling
    app.use(
        (
            err:Error,
            _req:express.Request,
            res:express.Response,
            _next:express.NextFunction
        ) => {
            console.error('[gateway] unhandled error:', err.message);
            res.status(500).json({ error: 'Internal server error' });
        }
    );

    return app;
}