import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// The real socket module connects on import. Components under test only need it to exist;
// `call` never answers, so things like the AI dealer's info lookup stay in their "off" state.
vi.mock('../lib/socket', () => {
  const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), volatile: { emit: vi.fn() }, id: 'test-socket' };
  return {
    socket,
    call: vi.fn(() => new Promise(() => {})),
    tokens: { get: () => null, set: () => {} },
    prefs: { get: (_name: string, fallback = '') => fallback, set: () => {} },
  };
});

afterEach(() => cleanup());
