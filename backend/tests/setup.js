// Runs before every test file.
// Placeholder Supabase credentials keep the suite runnable without a live project;
// config/env.js only accepts these defaults when NODE_ENV is 'test'.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
// Never call a real vision model from the suite, whatever backend/.env says
// (dotenv does not override variables already set). Tests that need one
// script it with setVisionProviderForTests().
process.env.AI_PROVIDER = 'none';
process.env.WHATSAPP_PROVIDER = 'none';
process.env.WHATSAPP_APP_SECRET = 'test-whatsapp-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-whatsapp-verify-token';
process.env.WHATSAPP_BUSINESS_NUMBER = '919000000001';
process.env.GEMINI_API_KEY = 'test-gemini-key-unused';
