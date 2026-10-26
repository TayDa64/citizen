import { describe, expect, test, vi } from 'vitest';
import { SAMPLE_TRIGGERS } from './triggers';
import {
  CONNECTED_NOTE,
  SAMPLE_DATA_NOTE,
  createCitizenApi,
  loadCitizenWorld,
  readCitizenApiBase,
  selectCompany,
  toTriggerPayload,
} from './citizenApi';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const company = {
  id: '6b1d1c2e-0000-4000-8000-000000000001',
  name: 'Northwind',
  cash: 15000,
  burnRate: 2000,
  hype: 0.3,
  talentCost: 4000,
  baselines: { hype: 0.3, talentCost: 4000 },
};

describe('toTriggerPayload', () => {
  test('strips appliedAtIndex and other client-only keys and normalizes text', () => {
    expect(
      toTriggerPayload({
        ...policy,
        appliedAtIndex: 4,
        chartNote: 'client only',
        label: '  Policy change  ',
        source: ' mock:local ',
        timestamp: '2026-04-02T15:00:00Z',
        effect: { talentCost: 0.12 },
      })
    ).toEqual({
      id: 'evt-policy-wage-ordinance',
      type: 'policy_change',
      label: 'Policy change',
      source: 'mock:local',
      timestamp: '2026-04-02T15:00:00.000Z',
      effect: { talentCost: 0.12 },
    });
  });

  test('refuses an effect key the API would reject', () => {
    expect(() =>
      toTriggerPayload({
        ...policy,
        effect: { talentCost: 0.12, burnRate: 1 },
      })
    ).toThrow(/burnRate/);
  });
});

describe('readCitizenApiBase', () => {
  test('is unset when the Vite flag is missing or blank', () => {
    expect(readCitizenApiBase({})).toBeNull();
    expect(readCitizenApiBase({ VITE_CITIZEN_API: '   ' })).toBeNull();
    expect(readCitizenApiBase({ VITE_CITIZEN_API: '/api/' })).toBe('/api');
  });
});

describe('createCitizenApi', () => {
  test('posts a stripped trigger and does not call fetch when validation fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(policy, 201));
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787/' });

    await api.createTrigger({ ...policy, appliedAtIndex: 2, effect: { talentCost: 0.12 } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/api/triggers');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      id: policy.id,
      type: 'policy_change',
      label: 'Policy change',
      source: 'mock:local',
      timestamp: '2026-04-02T15:00:00.000Z',
      effect: { talentCost: 0.12 },
    });
    expect(options.body).not.toContain('appliedAtIndex');

    fetchImpl.mockClear();
    await expect(api.createTrigger({ ...policy, effect: { hype: 5 } })).rejects.toThrow(TypeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('posts a mock scenario unchanged', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(policy, 201));
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787' });

    await api.createMock('policy_change');

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/api/triggers/mock');
    expect(JSON.parse(options.body)).toEqual({ scenario: 'policy_change' });
  });

  test('always sends scenario and does not call fetch when it is omitted', async () => {
    const fetchImpl = vi.fn();
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787' });

    await expect(api.createMock()).rejects.toThrow(/scenario/);
    await expect(api.createMock(undefined)).rejects.toThrow(/scenario/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('keeps company baselines separate from the current talent cost', async () => {
    const priced = { ...company, hype: 0.4, talentCost: 4480, baselines: { hype: 0.3, talentCost: 4000 } };
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/api/companies')) return jsonResponse([priced]);
      return jsonResponse([policy]);
    });
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787' });
    const snapshot = await api.loadWorld();

    expect(snapshot.company.talentCost).toBe(4480);
    expect(snapshot.company.baselines).toEqual({ hype: 0.3, talentCost: 4000 });
    expect(snapshot.triggers).toEqual([policy]);
  });

  test('uses the first company and can select another by id', () => {
    const later = { ...company, id: 'company-b', name: 'Later' };
    expect(selectCompany([later, company])?.id).toBe('company-b');
    expect(selectCompany([later, company], company.id)?.name).toBe('Northwind');
    expect(selectCompany([], company.id)).toBeNull();
    expect(selectCompany([])).toBeNull();
  });

  test('requests /api through a relative base without doubling the prefix', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/api/companies')) return jsonResponse([company]);
      return jsonResponse([]);
    });
    const api = createCitizenApi({ fetchImpl, baseUrl: '/api' });

    await api.listCompanies();

    expect(fetchImpl.mock.calls[0][0]).toBe('/api/companies');
  });

  test('deletes one trigger by id and clears every trigger', async () => {
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (options.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
      }
      return jsonResponse([]);
    });
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787' });

    await api.deleteTrigger('evt-policy-wage-ordinance');
    await api.deleteTriggers();

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8787/api/triggers/evt-policy-wage-ordinance'
    );
    expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
    expect(fetchImpl.mock.calls[1][0]).toBe('http://127.0.0.1:8787/api/triggers');
    expect(fetchImpl.mock.calls[1][1].method).toBe('DELETE');
  });

  test('a 404 for one id is already removed, and a repeated clear is an empty 204', async () => {
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (options.method === 'DELETE' && String(url).endsWith(`/api/triggers/${policy.id}`)) {
        return jsonResponse({ error: 'Trigger not found', issues: [] }, 404);
      }
      if (options.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => { throw new Error('empty 204 must not be parsed'); } };
      }
      return jsonResponse([]);
    });
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787' });

    await expect(api.deleteTrigger(policy.id)).resolves.toEqual({ alreadyRemoved: true });
    await expect(api.deleteTriggers()).resolves.toBeNull();
    await expect(api.deleteTriggers()).resolves.toBeNull();
  });

  test('url-encodes the id and rejects ids outside 1–200 characters', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('empty 204 must not be parsed');
      },
    }));
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787' });
    const id = 'evt/policy wage';

    await api.deleteTrigger(id);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `http://127.0.0.1:8787/api/triggers/${encodeURIComponent(id)}`
    );

    fetchImpl.mockClear();
    await expect(api.deleteTrigger('')).rejects.toThrow(/1–200/);
    await expect(api.deleteTrigger('a'.repeat(201))).rejects.toThrow(/1–200/);
    expect(fetchImpl).not.toHaveBeenCalled();

    await api.deleteTrigger('a'.repeat(200));
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `http://127.0.0.1:8787/api/triggers/${'a'.repeat(200)}`
    );
  });

  test('413 and a collection 404 reject instead of counting as removed', async () => {
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (options.method === 'DELETE' && String(url).endsWith('/api/triggers')) {
        return jsonResponse({ error: 'Not found', issues: [] }, 404);
      }
      return jsonResponse({ error: 'Payload too large', issues: [] }, 413);
    });
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787' });

    await expect(api.deleteTrigger(policy.id)).rejects.toMatchObject({ status: 413 });
    await expect(api.deleteTriggers()).rejects.toMatchObject({ status: 404 });
  });

  test('405 from delete still rejects', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'Method not allowed', issues: [] }, 405)
    );
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787' });
    await expect(api.deleteTrigger(policy.id)).rejects.toMatchObject({ status: 405 });
    await expect(api.deleteTriggers()).rejects.toMatchObject({ status: 405 });
  });

  test('surfaces a 400 issue list', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: 'Invalid trigger payload',
          issues: [{ path: 'effect.hype', code: 'out_of_range', message: 'effect.hype must be between -1 and 1' }],
        },
        400
      )
    );
    const api = createCitizenApi({ fetchImpl, baseUrl: 'http://127.0.0.1:8787' });
    await expect(api.createMock('news_spike')).rejects.toThrow(/between -1 and 1/);
  });
});

describe('loadCitizenWorld', () => {
  test('does not fetch when the Vite flag is unset', async () => {
    const fetchImpl = vi.fn();
    const result = await loadCitizenWorld({ env: {}, fetchImpl });
    expect(result).toMatchObject({ mode: 'local', note: SAMPLE_DATA_NOTE, alert: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('an empty company list falls back to sample data with a status note', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/api/companies')) return jsonResponse([]);
      return jsonResponse([policy]);
    });
    const result = await loadCitizenWorld({
      env: { VITE_CITIZEN_API: '/api' },
      fetchImpl,
    });
    expect(result.mode).toBe('local');
    expect(result.snapshot).toBeNull();
    expect(result.alert).toBeNull();
    expect(result.note).toMatch(/no company was returned/i);
    expect(result.note).toMatch(/sample data/i);
    expect(result.note.toLowerCase()).not.toContain('error');
    expect(result.note.toLowerCase()).not.toContain('fail');
  });

  test('a 403 falls back to sample data and explains the local /api address', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Forbidden', issues: [] }, 403));
    const result = await loadCitizenWorld({
      env: { VITE_CITIZEN_API: 'http://example.test' },
      fetchImpl,
    });
    expect(result.mode).toBe('local');
    expect(result.snapshot).toBeNull();
    expect(result.note).toBe(SAMPLE_DATA_NOTE);
    expect(result.alert).toMatch(/403/);
    expect(result.alert).toMatch(/\/api/);
  });

  test('falls back to sample data when the service cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await loadCitizenWorld({
      env: { VITE_CITIZEN_API: 'http://127.0.0.1:8787' },
      fetchImpl,
    });
    expect(result.mode).toBe('local');
    expect(result.note).toBe(SAMPLE_DATA_NOTE);
    expect(result.alert).toBeNull();
    expect(result.note.toLowerCase()).not.toContain('error');
    expect(result.note.toLowerCase()).not.toContain('fail');
  });

  test('returns the API snapshot when both reads succeed', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/api/companies')) return jsonResponse([company]);
      return jsonResponse([]);
    });
    const result = await loadCitizenWorld({
      env: { VITE_CITIZEN_API: 'http://127.0.0.1:8787' },
      fetchImpl,
    });
    expect(result.mode).toBe('api');
    expect(result.note).toBe(CONNECTED_NOTE);
    expect(result.snapshot.company.baselines.talentCost).toBe(4000);
  });
});
