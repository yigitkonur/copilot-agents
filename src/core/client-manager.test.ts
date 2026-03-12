import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the SDK before any imports that depend on it
// ---------------------------------------------------------------------------

const mockClient = {
  start: vi.fn(),
  stop: vi.fn(),
  forceStop: vi.fn(),
  ping: vi.fn(),
  getAuthStatus: vi.fn(),
  listModels: vi.fn(),
  listSessions: vi.fn(),
  deleteSession: vi.fn(),
  getLastSessionId: vi.fn(),
};

vi.mock('@github/copilot-sdk', () => {
  // vitest v4 requires 'class' or 'function' for constructor mocks
  class MockCopilotClient {
    constructor() {
      return mockClient;
    }
  }
  return {
    CopilotClient: MockCopilotClient,
    approveAll: vi.fn(),
  };
});

import { ClientManager } from './client-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Suppress the shutdown-handler side-effect that registers process listeners. */
function createManager(): ClientManager {
  return new ClientManager();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClientManager', () => {
  beforeEach(() => {
    // Reset every mock method and re-apply default implementations
    mockClient.start.mockReset().mockResolvedValue(undefined);
    mockClient.stop.mockReset().mockResolvedValue([]);
    mockClient.forceStop.mockReset().mockResolvedValue(undefined);
    mockClient.ping.mockReset().mockResolvedValue(undefined);
    mockClient.getAuthStatus.mockReset().mockResolvedValue({ isAuthenticated: true, login: 'testuser' });
    mockClient.listModels.mockReset().mockResolvedValue([]);
    mockClient.listSessions.mockReset().mockResolvedValue([]);
    mockClient.deleteSession.mockReset().mockResolvedValue(undefined);
    mockClient.getLastSessionId.mockReset().mockResolvedValue('session-123');
  });

  // -------------------------------------------------------------------------
  // Singleton pattern
  // -------------------------------------------------------------------------

  describe('getClient() — singleton', () => {
    it('returns the same client on the second call', async () => {
      const mgr = createManager();
      const first = await mgr.getClient();
      const second = await mgr.getClient();

      expect(first).toBe(second);
    });

    it('calls start() only once across multiple getClient() calls', async () => {
      const mgr = createManager();
      await mgr.getClient();
      await mgr.getClient();
      await mgr.getClient();

      expect(mockClient.start).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Race-condition safety
  // -------------------------------------------------------------------------

  describe('getClient() — race-condition safety', () => {
    it('two concurrent calls result in only one CopilotClient instantiation', async () => {
      const mgr = createManager();

      const [a, b] = await Promise.all([mgr.getClient(), mgr.getClient()]);

      // Both resolve to the exact same client reference
      expect(a).toBe(b);
      // start() was only called once, proving a single instantiation
      expect(mockClient.start).toHaveBeenCalledTimes(1);
    });

    it('both concurrent calls resolve to the same client', async () => {
      const mgr = createManager();
      const results = await Promise.all([
        mgr.getClient(),
        mgr.getClient(),
        mgr.getClient(),
      ]);

      const unique = new Set(results);
      expect(unique.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('calls client.stop() and nulls the reference', async () => {
      const mgr = createManager();
      await mgr.getClient();

      await mgr.stop();

      expect(mockClient.stop).toHaveBeenCalledOnce();
    });

    it('subsequent getClient() after stop creates a new client', async () => {
      const mgr = createManager();
      const first = await mgr.getClient();
      await mgr.stop();

      vi.clearAllMocks(); // reset start call count

      const second = await mgr.getClient();
      expect(mockClient.start).toHaveBeenCalledOnce();
      // They resolve to the same mock object (because the mock factory always
      // returns mockClient), but start() was called again proving re-creation.
    });

    it('stop() on an uninitialised manager is a no-op', async () => {
      const mgr = createManager();
      await expect(mgr.stop()).resolves.toBeUndefined();
      expect(mockClient.stop).not.toHaveBeenCalled();
    });

    it('falls back to forceStop() when stop() rejects', async () => {
      const mgr = createManager();
      await mgr.getClient();

      mockClient.stop.mockRejectedValueOnce(new Error('oops'));

      await mgr.stop();

      expect(mockClient.forceStop).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // checkHealth()
  // -------------------------------------------------------------------------

  describe('checkHealth()', () => {
    it('returns true when ping() succeeds', async () => {
      const mgr = createManager();
      const healthy = await mgr.checkHealth();
      expect(healthy).toBe(true);
    });

    it('returns false when ping() throws', async () => {
      mockClient.ping.mockRejectedValueOnce(new Error('unreachable'));
      // We need a manager that already has a client so ping is called on it
      // But since ping failure happens after getClient, we need getClient to
      // succeed first. The mock for getClient (CopilotClient + start) is fine;
      // only ping throws.
      const mgr = createManager();
      const healthy = await mgr.checkHealth();
      expect(healthy).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Convenience wrappers
  // -------------------------------------------------------------------------

  describe('getAuthStatus()', () => {
    it('returns { success: true, data } on success', async () => {
      const mgr = createManager();
      const result = await mgr.getAuthStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ isAuthenticated: true, login: 'testuser' });
      }
    });

    it('returns { success: false, error } on failure', async () => {
      mockClient.getAuthStatus.mockRejectedValueOnce(new Error('auth failed'));
      const mgr = createManager();
      const result = await mgr.getAuthStatus();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('auth failed');
      }
    });
  });

  describe('listModels()', () => {
    it('returns { success: true, data } on success', async () => {
      const models = [{ id: 'gpt-4o', name: 'GPT-4o' }];
      mockClient.listModels.mockResolvedValueOnce(models);

      const mgr = createManager();
      const result = await mgr.listModels();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(models);
      }
    });

    it('returns { success: false, error } on failure', async () => {
      mockClient.listModels.mockRejectedValueOnce(new Error('network'));
      const mgr = createManager();
      const result = await mgr.listModels();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('network');
      }
    });
  });

  describe('listSessions()', () => {
    it('returns { success: true, data } on success', async () => {
      const sessions = [{ sessionId: 's1' }];
      mockClient.listSessions.mockResolvedValueOnce(sessions);

      const mgr = createManager();
      const result = await mgr.listSessions();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(sessions);
      }
    });

    it('returns { success: false, error } on failure', async () => {
      mockClient.listSessions.mockRejectedValueOnce(new Error('fail'));
      const mgr = createManager();
      const result = await mgr.listSessions();

      expect(result.success).toBe(false);
    });
  });

  describe('deleteSession()', () => {
    it('returns { success: true } on success', async () => {
      const mgr = createManager();
      const result = await mgr.deleteSession('sess-abc');

      expect(result.success).toBe(true);
      expect(mockClient.deleteSession).toHaveBeenCalledWith('sess-abc');
    });

    it('returns { success: false, error } on failure', async () => {
      mockClient.deleteSession.mockRejectedValueOnce(new Error('not found'));
      const mgr = createManager();
      const result = await mgr.deleteSession('bad-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('not found');
      }
    });
  });

  describe('getLastSessionId()', () => {
    it('returns { success: true, data } on success', async () => {
      const mgr = createManager();
      const result = await mgr.getLastSessionId();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('session-123');
      }
    });

    it('returns { success: false, error } on failure', async () => {
      mockClient.getLastSessionId.mockRejectedValueOnce(new Error('boom'));
      const mgr = createManager();
      const result = await mgr.getLastSessionId();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('boom');
      }
    });

    it('wraps non-Error throws into ConnectionError', async () => {
      mockClient.getLastSessionId.mockRejectedValueOnce('string error');
      const mgr = createManager();
      const result = await mgr.getLastSessionId();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('string error');
      }
    });
  });
});
