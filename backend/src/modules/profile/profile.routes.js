import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { updateProfileSchema } from '../auth/auth.schemas.js';
import * as controller from './profile.controller.js';

export const profileRouter = Router();

profileRouter.use(requireAuth);

profileRouter.get('/', controller.getMe);
profileRouter.patch('/', validate({ body: updateProfileSchema }), controller.updateMe);
