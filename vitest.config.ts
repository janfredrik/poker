import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests for the client (Dock, Seat …) in jsdom. The engine is covered by server/selftest.ts,
// and e2e/ holds the Playwright smoke test against a real server.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['client/src/**/*.test.tsx'],
    setupFiles: ['client/src/test/setup.ts'],
    restoreMocks: true,
  },
});
