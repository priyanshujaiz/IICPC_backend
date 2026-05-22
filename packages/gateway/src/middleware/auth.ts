import jwt from 'jsonwebtoken';
import { Request,Response,NextFunction } from 'express';
import { getEnv } from '@iicpc/shared';

//Extend Express Request so downstream handlers can read req.user
declare global{
    namespace Express{
        interface Request{
            user?:{ 
                sub:string;
                role:string;
            };
        }
    }
}


export function requireAuth(req:Request, res:Response, next: NextFunction) {
    const header=req.headers.authorization;


    if(!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({
            error:"Missing or malfunctioned Authorization header"
        });
    }

    const token=header.split(' ')[1];

    try {
    const JWT_SECRET = getEnv('JWT_SECRET');
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string };
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
