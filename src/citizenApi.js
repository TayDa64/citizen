import { TRIGGER_TYPES, assertValidTrigger } from './triggers';

const TRIGGER_FIELDS = ['id', 'type', 'label', 'source', 'timestamp', 'effect'];
const EFFECT_FIELDS = new Set(['hype', 'talentCost']);

export const SAMPLE_DATA_NOTE = 'Using sample data on this device.';
export const LOADING_NOTE = 'Loading company and world events.';
export const CONNECTED_NOTE = 'Connected to the Citizen service. Talent cost is shown in dollars.';

export function readCitizenApiBase(env = import.meta.env) {
  const value = env?.VITE_CITIZEN_API;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.replace(/\/$/, '');
}

export function toTriggerPayload(trigger) {
  if (trigger === null || typeof trigger !== 'object' || Array.isArray(trigger)) {
    throw new TypeError('Trigger must be an object');
  }

  const payload = {};
  for (const key of TRIGGER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(trigger, key)) {
      payload[key] = trigger[key];
    }
  }
  if (typeof payload.label === 'string') payload.label = payload.label.trim();
  if (typeof payload.source === 'string') payload.source = payload.source.trim();
  if (typeof payload.timestamp === 'string' && !Number.isNaN(Date.parse(payload.timestamp))) {
    payload.timestamp = new Date(payload.timestamp).toISOString();
  }
  if (payload.effect === null || typeof payload.effect !== 'object' || Array.isArray(payload.effect)) {
    return payload;
  }

  for (const key of Object.keys(payload.effect)) {
    if (!EFFECT_FIELDS.has(key)) {
      throw new TypeError(`Trigger.effect.${key} is not part of the contract`);
    }
  }
  const effect = {};
  if (Object.prototype.hasOwnProperty.call(payload.effect, 'hype')) effect.hype = payload.effect.hype;
  if (Object.prototype.hasOwnProperty.call(payload.effect, 'talentCost')) {
    effect.talentCost = payload.effect.talentCost;
  }
  payload.effect = effect;
  return payload;
}

function httpError(response, body) {
  const issueText = Array.isArray(body?.issues) && body.issues.length > 0
    ? body.issues.map((entry) => entry.message).filter(Boolean).join('; ')
    : '';
  const detail = issueText || body?.error;
  const message = response.status === 404 || response.status === 405
    ? detail || 'The service has not enabled that action yet.'
    : detail || 'The request failed';
  const error = new Error(message);
  error.status = response.status;
  error.issues = Array.isArray(body?.issues) ? body.issues : [];
  return error;
}

async function readResponse(response) {
  if (response.status === 204 || response.status === 205) return null;
  let body = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) return null;
    throw new Error('The service returned an unreadable response');
  }
  if (!response.ok) throw httpError(response, body);
  return body;
}

export function createCitizenApi({ fetchImpl = globalThis.fetch, baseUrl } = {}) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new TypeError('baseUrl is required');
  }
  const root = baseUrl.replace(/\/$/, '');

  async function send(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
    return readResponse(response);
  }

  async function loadWorld() {
    const [triggers, companies] = await Promise.all([
      send('/api/triggers'),
      send('/api/companies'),
    ]);
    if (!Array.isArray(companies) || companies.length === 0) {
      throw new Error('Company service returned no company');
    }
    if (!Array.isArray(triggers)) {
      throw new Error('Trigger service returned an unreadable response');
    }
    const company = companies[0];
    const baselines = company?.baselines;
    if (
      baselines == null ||
      !Number.isFinite(Number(baselines.hype)) ||
      !Number.isFinite(Number(baselines.talentCost))
    ) {
      throw new Error('Company service omitted baselines');
    }
    return { triggers, company };
  }

  return {
    listTriggers() {
      return send('/api/triggers');
    },
    listCompanies() {
      return send('/api/companies');
    },
    loadWorld,
    async createTrigger(trigger) {
      const payload = toTriggerPayload(trigger);
      assertValidTrigger(payload);
      return send('/api/triggers', { method: 'POST', body: JSON.stringify(payload) });
    },
    async createMock(scenario) {
      if (!TRIGGER_TYPES.includes(scenario)) {
        throw new TypeError(`scenario must be one of: ${TRIGGER_TYPES.join(', ')}`);
      }
      return send('/api/triggers/mock', {
        method: 'POST',
        body: JSON.stringify({ scenario }),
      });
    },
    async deleteTrigger(id) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new TypeError('Trigger id must be a non-empty string');
      }
      try {
        await send(`/api/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (error) {
        if (error?.status === 404) return { alreadyRemoved: true };
        throw error;
      }
      return { alreadyRemoved: false };
    },
    deleteTriggers() {
      return send('/api/triggers', { method: 'DELETE' });
    },
  };
}

export async function loadCitizenWorld({ env = import.meta.env, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = readCitizenApiBase(env);
  if (!baseUrl) {
    return { mode: 'local', note: SAMPLE_DATA_NOTE, alert: null, snapshot: null, baseUrl: null };
  }
  try {
    const snapshot = await createCitizenApi({ fetchImpl, baseUrl }).loadWorld();
    return { mode: 'api', note: CONNECTED_NOTE, alert: null, snapshot, baseUrl };
  } catch {
    return { mode: 'local', note: SAMPLE_DATA_NOTE, alert: null, snapshot: null, baseUrl: null };
  }
}
