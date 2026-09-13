import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the database module before importing route handlers
vi.mock('@/lib/db', () => ({
  db: {
    patient: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    alert: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: 'test-alert', acknowledged: true }),
    },
    vitalsReading: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    incident: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: 'test-incident', status: 'closed' }),
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { GET as dashboardGET } from './dashboard/route';
import { GET as alertsGET, PATCH as alertsPATCH } from './alerts/route';
import { GET as incidentsGET, PATCH as incidentsPATCH } from './incidents/route';
import { GET as auditGET } from './audit/route';

/**
 * Security regression tests for pentest finding:
 * "Unauthenticated clinical and security-operations APIs expose and mutate database records"
 *
 * These tests verify that the dashboard, alerts, incidents, and audit endpoints
 * now require bearer-token authentication via requirePatientAuth, and that
 * unauthenticated or incorrectly authenticated requests are rejected.
 */

describe('API Authentication Security — Dashboard, Alerts, Incidents, Audit', () => {
  const VALID_TOKEN = 'test-patient-api-token-12345';
  const INVALID_TOKEN = 'wrong-token';
  
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original env and set a valid token for most tests
    originalEnv = process.env.PATIENT_API_TOKEN;
    process.env.PATIENT_API_TOKEN = VALID_TOKEN;
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.PATIENT_API_TOKEN;
    } else {
      process.env.PATIENT_API_TOKEN = originalEnv;
    }
  });

  /**
   * Helper to create a Request with optional Authorization header
   */
  function makeRequest(url: string, options: { token?: string; method?: string; body?: unknown } = {}): Request {
    const headers: Record<string, string> = {};
    if (options.token !== undefined) {
      headers['authorization'] = `Bearer ${options.token}`;
    }
    
    const init: RequestInit = {
      method: options.method || 'GET',
      headers,
    };
    
    if (options.body) {
      init.body = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }
    
    return new Request(url, init);
  }

  /**
   * Helper to parse response and check status
   */
  async function expectUnauthorized(response: Response, expectedStatus: 401 | 503 = 401) {
    expect(response.status).toBe(expectedStatus);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    return body;
  }

  describe('Dashboard GET /api/dashboard', () => {
    it('rejects request with no Authorization header (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/dashboard');
      const res = await dashboardGET(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects request with incorrect bearer token (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/dashboard', { token: INVALID_TOKEN });
      const res = await dashboardGET(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects request with malformed Authorization header (401)', async () => {
      const req = new Request('http://localhost:3000/api/dashboard', {
        headers: { authorization: 'NotBearer token' },
      });
      const res = await dashboardGET(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects request when PATIENT_API_TOKEN is unset (503 fail-closed)', async () => {
      delete process.env.PATIENT_API_TOKEN;
      const req = makeRequest('http://localhost:3000/api/dashboard', { token: VALID_TOKEN });
      const res = await dashboardGET(req);
      await expectUnauthorized(res, 503);
    });

    it('allows request with correct bearer token', async () => {
      const req = makeRequest('http://localhost:3000/api/dashboard', { token: VALID_TOKEN });
      const res = await dashboardGET(req);
      // Should not be 401 or 503; actual response depends on DB state
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });
  });

  describe('Alerts GET /api/alerts', () => {
    it('rejects unauthenticated request (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/alerts');
      const res = await alertsGET(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects request with incorrect token (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/alerts', { token: INVALID_TOKEN });
      const res = await alertsGET(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects request when PATIENT_API_TOKEN is unset (503)', async () => {
      delete process.env.PATIENT_API_TOKEN;
      const req = makeRequest('http://localhost:3000/api/alerts', { token: VALID_TOKEN });
      const res = await alertsGET(req);
      await expectUnauthorized(res, 503);
    });

    it('allows authenticated request with correct token', async () => {
      const req = makeRequest('http://localhost:3000/api/alerts', { token: VALID_TOKEN });
      const res = await alertsGET(req);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });

    it('allows authenticated request with query parameters', async () => {
      const req = makeRequest('http://localhost:3000/api/alerts?type=critical&acknowledged=false', {
        token: VALID_TOKEN,
      });
      const res = await alertsGET(req);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });
  });

  describe('Alerts PATCH /api/alerts — Mutation endpoint', () => {
    it('rejects unauthenticated mutation attempt (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/alerts', {
        method: 'PATCH',
        body: { id: 'alert-123', acknowledged: true },
      });
      const res = await alertsPATCH(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects mutation with incorrect token (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/alerts', {
        method: 'PATCH',
        token: INVALID_TOKEN,
        body: { id: 'alert-123', acknowledged: true },
      });
      const res = await alertsPATCH(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects mutation when PATIENT_API_TOKEN is unset (503)', async () => {
      delete process.env.PATIENT_API_TOKEN;
      const req = makeRequest('http://localhost:3000/api/alerts', {
        method: 'PATCH',
        token: VALID_TOKEN,
        body: { id: 'alert-123', acknowledged: true },
      });
      const res = await alertsPATCH(req);
      await expectUnauthorized(res, 503);
    });

    it('allows authenticated mutation with correct token', async () => {
      const req = makeRequest('http://localhost:3000/api/alerts', {
        method: 'PATCH',
        token: VALID_TOKEN,
        body: { id: 'alert-123', acknowledged: true },
      });
      const res = await alertsPATCH(req);
      // Should not be 401 or 503; may be 400/500 if ID doesn't exist, but auth passed
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });
  });

  describe('Incidents GET /api/incidents', () => {
    it('rejects unauthenticated request (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/incidents');
      const res = await incidentsGET(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects request with incorrect token (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/incidents', { token: INVALID_TOKEN });
      const res = await incidentsGET(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects request when PATIENT_API_TOKEN is unset (503)', async () => {
      delete process.env.PATIENT_API_TOKEN;
      const req = makeRequest('http://localhost:3000/api/incidents', { token: VALID_TOKEN });
      const res = await incidentsGET(req);
      await expectUnauthorized(res, 503);
    });

    it('allows authenticated request with correct token', async () => {
      const req = makeRequest('http://localhost:3000/api/incidents', { token: VALID_TOKEN });
      const res = await incidentsGET(req);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });
  });

  describe('Incidents PATCH /api/incidents — Mutation endpoint', () => {
    it('rejects unauthenticated mutation attempt (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/incidents', {
        method: 'PATCH',
        body: { id: 'incident-456', status: 'resolved' },
      });
      const res = await incidentsPATCH(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects mutation with incorrect token (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/incidents', {
        method: 'PATCH',
        token: INVALID_TOKEN,
        body: { id: 'incident-456', status: 'resolved' },
      });
      const res = await incidentsPATCH(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects mutation when PATIENT_API_TOKEN is unset (503)', async () => {
      delete process.env.PATIENT_API_TOKEN;
      const req = makeRequest('http://localhost:3000/api/incidents', {
        method: 'PATCH',
        token: VALID_TOKEN,
        body: { id: 'incident-456', status: 'resolved' },
      });
      const res = await incidentsPATCH(req);
      await expectUnauthorized(res, 503);
    });

    it('allows authenticated mutation with correct token', async () => {
      const req = makeRequest('http://localhost:3000/api/incidents', {
        method: 'PATCH',
        token: VALID_TOKEN,
        body: { id: 'incident-456', status: 'resolved' },
      });
      const res = await incidentsPATCH(req);
      // Should not be 401 or 503; may be 400/500 if ID doesn't exist, but auth passed
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });

    it('prevents arbitrary status mutation without authentication', async () => {
      // Pentest scenario: attacker tries to set arbitrary status without auth
      const req = makeRequest('http://localhost:3000/api/incidents', {
        method: 'PATCH',
        body: { id: 'any-incident-id', status: 'attacker-controlled-status' },
      });
      const res = await incidentsPATCH(req);
      const body = await expectUnauthorized(res, 401);
      expect(body.error).toBeTruthy();
    });
  });

  describe('Audit GET /api/audit', () => {
    it('rejects unauthenticated request (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/audit');
      const res = await auditGET(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects request with incorrect token (401)', async () => {
      const req = makeRequest('http://localhost:3000/api/audit', { token: INVALID_TOKEN });
      const res = await auditGET(req);
      await expectUnauthorized(res, 401);
    });

    it('rejects request when PATIENT_API_TOKEN is unset (503)', async () => {
      delete process.env.PATIENT_API_TOKEN;
      const req = makeRequest('http://localhost:3000/api/audit', { token: VALID_TOKEN });
      const res = await auditGET(req);
      await expectUnauthorized(res, 503);
    });

    it('allows authenticated request with correct token', async () => {
      const req = makeRequest('http://localhost:3000/api/audit', { token: VALID_TOKEN });
      const res = await auditGET(req);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });

    it('allows authenticated request with role filter query parameter', async () => {
      const req = makeRequest('http://localhost:3000/api/audit?role=admin&limit=100', {
        token: VALID_TOKEN,
      });
      const res = await auditGET(req);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });

    it('prevents disclosure of audit logs without authentication', async () => {
      // Pentest scenario: attacker tries to access security telemetry
      const req = makeRequest('http://localhost:3000/api/audit?limit=1000');
      const res = await auditGET(req);
      const body = await expectUnauthorized(res, 401);
      expect(body.error).toBeTruthy();
    });
  });

  describe('Cross-endpoint authentication consistency', () => {
    it('all four endpoints use the same authentication mechanism', async () => {
      const endpoints = [
        { name: 'dashboard', handler: dashboardGET, url: 'http://localhost:3000/api/dashboard' },
        { name: 'alerts', handler: alertsGET, url: 'http://localhost:3000/api/alerts' },
        { name: 'incidents', handler: incidentsGET, url: 'http://localhost:3000/api/incidents' },
        { name: 'audit', handler: auditGET, url: 'http://localhost:3000/api/audit' },
      ];

      for (const endpoint of endpoints) {
        // Without auth: should be 401
        const unauthReq = makeRequest(endpoint.url);
        const unauthRes = await endpoint.handler(unauthReq);
        expect(unauthRes.status, `${endpoint.name} should reject unauthenticated`).toBe(401);

        // With correct auth: should not be 401/503
        const authReq = makeRequest(endpoint.url, { token: VALID_TOKEN });
        const authRes = await endpoint.handler(authReq);
        expect(authRes.status, `${endpoint.name} should allow authenticated`).not.toBe(401);
        expect(authRes.status, `${endpoint.name} should allow authenticated`).not.toBe(503);
      }
    });

    it('mutation endpoints (PATCH) also require authentication', async () => {
      const mutations = [
        {
          name: 'alerts PATCH',
          handler: alertsPATCH,
          url: 'http://localhost:3000/api/alerts',
          body: { id: 'test-id', acknowledged: true },
        },
        {
          name: 'incidents PATCH',
          handler: incidentsPATCH,
          url: 'http://localhost:3000/api/incidents',
          body: { id: 'test-id', status: 'closed' },
        },
      ];

      for (const mutation of mutations) {
        // Without auth: should be 401
        const unauthReq = makeRequest(mutation.url, { method: 'PATCH', body: mutation.body });
        const unauthRes = await mutation.handler(unauthReq);
        expect(unauthRes.status, `${mutation.name} should reject unauthenticated mutation`).toBe(401);

        // With correct auth: should not be 401/503
        const authReq = makeRequest(mutation.url, {
          method: 'PATCH',
          token: VALID_TOKEN,
          body: mutation.body,
        });
        const authRes = await mutation.handler(authReq);
        expect(authRes.status, `${mutation.name} should allow authenticated mutation`).not.toBe(401);
        expect(authRes.status, `${mutation.name} should allow authenticated mutation`).not.toBe(503);
      }
    });
  });

  describe('Fail-closed behavior', () => {
    it('all endpoints fail closed when PATIENT_API_TOKEN is unset', async () => {
      delete process.env.PATIENT_API_TOKEN;

      const endpoints = [
        { name: 'dashboard', handler: dashboardGET, url: 'http://localhost:3000/api/dashboard' },
        { name: 'alerts', handler: alertsGET, url: 'http://localhost:3000/api/alerts' },
        { name: 'incidents', handler: incidentsGET, url: 'http://localhost:3000/api/incidents' },
        { name: 'audit', handler: auditGET, url: 'http://localhost:3000/api/audit' },
      ];

      for (const endpoint of endpoints) {
        const req = makeRequest(endpoint.url, { token: 'any-token' });
        const res = await endpoint.handler(req);
        expect(res.status, `${endpoint.name} should fail closed with 503`).toBe(503);
        const body = await res.json();
        expect(body.error).toContain('misconfigured');
      }
    });

    it('mutation endpoints fail closed when PATIENT_API_TOKEN is unset', async () => {
      delete process.env.PATIENT_API_TOKEN;

      const mutations = [
        {
          name: 'alerts PATCH',
          handler: alertsPATCH,
          url: 'http://localhost:3000/api/alerts',
          body: { id: 'test', acknowledged: true },
        },
        {
          name: 'incidents PATCH',
          handler: incidentsPATCH,
          url: 'http://localhost:3000/api/incidents',
          body: { id: 'test', status: 'closed' },
        },
      ];

      for (const mutation of mutations) {
        const req = makeRequest(mutation.url, {
          method: 'PATCH',
          token: 'any-token',
          body: mutation.body,
        });
        const res = await mutation.handler(req);
        expect(res.status, `${mutation.name} should fail closed with 503`).toBe(503);
        const body = await res.json();
        expect(body.error).toContain('misconfigured');
      }
    });
  });

  describe('Pentest reproduction scenarios', () => {
    it('prevents unauthenticated disclosure of patient-linked dashboard data', async () => {
      // Pentest Step 2: Dashboard GET exposes patient IDs and names
      const req = makeRequest('http://localhost:3000/api/dashboard');
      const res = await dashboardGET(req);
      
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).not.toHaveProperty('totalPatients');
      expect(body).not.toHaveProperty('latestVitals');
      expect(body).toHaveProperty('error');
    });

    it('prevents unauthenticated alert acknowledgment mutation', async () => {
      // Pentest Step 3: PATCH updates caller-selected alert ID without checks
      const req = makeRequest('http://localhost:3000/api/alerts', {
        method: 'PATCH',
        body: { id: 'arbitrary-alert-id', acknowledged: true },
      });
      const res = await alertsPATCH(req);
      
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });

    it('prevents unauthenticated incident status mutation', async () => {
      // Pentest Step 4: PATCH writes caller-controlled ID and status without auth
      const req = makeRequest('http://localhost:3000/api/incidents', {
        method: 'PATCH',
        body: { id: 'arbitrary-incident-id', status: 'attacker-status' },
      });
      const res = await incidentsPATCH(req);
      
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });

    it('prevents unauthenticated access to security audit logs', async () => {
      // Pentest Step 5: Audit records can be listed without authentication
      const req = makeRequest('http://localhost:3000/api/audit?limit=1000');
      const res = await auditGET(req);
      
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).not.toBeInstanceOf(Array);
      expect(body).toHaveProperty('error');
    });

    it('prevents unauthenticated access to incident rawEvent telemetry', async () => {
      // Pentest Step 7: Incident model contains sensitive rawEvent data
      const req = makeRequest('http://localhost:3000/api/incidents');
      const res = await incidentsGET(req);
      
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).not.toBeInstanceOf(Array);
      expect(body).toHaveProperty('error');
    });
  });
});
