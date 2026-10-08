import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()'
};

export default defineConfig({
  base: '/jobs/',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 3002, headers: securityHeaders },
  preview: { host: '127.0.0.1', port: 4175, headers: securityHeaders }
});
