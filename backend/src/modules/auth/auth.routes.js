import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { emptyBody } from '../../lib/schemas.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import * as controller from './auth.controller.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schemas.js';

/**
 * Every route here touches credentials, so the whole router sits behind the
 * tighter authLimiter (checklist 0.9) as well as the global one.
 */
export const authRouter = Router();

authRouter.use(authLimiter);

authRouter.post('/register', validate({ body: registerSchema }), controller.register);
authRouter.post('/login', validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
authRouter.post('/logout', requireAuth, validate({ body: emptyBody }), controller.logout);
authRouter.post('/forgot-password', validate({ body: forgotPasswordSchema }), controller.forgotPassword);
authRouter.post('/reset-password', validate({ body: resetPasswordSchema }), controller.resetPassword);
