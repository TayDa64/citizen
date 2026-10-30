import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from './App';
import { SAMPLE_TRIGGERS } from './triggers';
import { applyTurnCommand, createGameState } from './turnEngine';
import {
  TURN_RETRY_HINT,
  TURN_SAVE_FAILED_MESSAGE,
} from './components/TurnSaveAlert';

// A server-backed campaign whose commit fails must not be re-run locally.
// See .cursor/skills/citizen-turn-dispatch (rule ViewIsServerOrMarked).

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * In-memory Citizen service: companies + triggers read model and one campaign
 * that applies commits with the same turn engine the server uses.
 * `failCommits` > 0 rejects that many commits (nothing written);
 * `loseReplies` > 0 writes the commit and then answers 503 (lost reply).
 */
function fakeService() {
  const service = {
    campaign: null,
    seq: 0,
    failCommits: 0,
    loseReplies: 0,
    commitCalls: 0,
    campaignReads: 0,
  };
  const payload = () => ({ id: 'camp-1', turn: service.campaign.turn, state: service.campaign });
  service.fetch = vi.fn(async (url, options = {}) => {
    const path = String(url);
    const method = options.method || 'GET';
    if (path.endsWith('/api/companies')) {
      return jsonResponse([{
        id: 'company-1',
        name: 'Northwind',
        cash: 1,
        burnRate: 9,
        hype: 0.3,
        talentCost: 4480,
        baselines: { hype: 0.3, talentCost: 4000 },
      }]);
    }
    if (path.endsWith('/api/triggers') && method === 'GET') return jsonResponse([policy]);
    if (path.endsWith('/api/campaigns') && method === 'POST') {
      const body = JSON.parse(options.body);
      service.campaign = { ...createGameState({ ...body.state, seed: body.seed }), campaignId: 'camp-1' };
      return jsonResponse(payload(), 201);
    }
    if (path.endsWith('/api/campaigns/camp-1/turns') && method === 'POST') {
      service.commitCalls += 1;
      if (service.failCommits > 0) {
        service.failCommits -= 1;
        return jsonResponse({ error: 'Campaign store unavailable' }, 503);
      }
      const command = JSON.parse(options.body);
      const before = service.campaign;
      const result = applyTurnCommand(before, command);
      service.campaign = { ...result.state, campaignId: 'camp-1' };
      service.seq += 1;
      if (service.loseReplies > 0) {
        service.loseReplies -= 1;
        return jsonResponse({ error: 'Gateway timeout' }, 503);
      }
      return jsonResponse({
        ...payload(),
        commit: {
          seq: service.seq,
          turnBefore: before.turn,
          turnAfter: service.campaign.turn,
          command,
          before: {},
          after: {},
          deltas: {},
          appliedEffects: [],
          explanations: [],
        },
      }, 201);
    }
    if (/\/api\/campaigns\/camp-1\/turns/.test(path)) return jsonResponse([]);
    if (path.endsWith('/api/campaigns/camp-1')) {
      service.campaignReads += 1;
      return jsonResponse(payload());
    }
    return jsonResponse({ error: 'Not found' }, 404);
  });
  return service;
}

async function renderConnected(service) {
  vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
  vi.stubGlobal('fetch', service.fetch);
  render(<App initialPlayerRole="campaign" />);
  await screen.findByRole('status', { name: /citizen service/i });
  await waitFor(() => expect(service.campaign).not.toBeNull());
  // ensureCampaign → refreshLedgerFromApi finishes after the campaign POST.
  await waitFor(() => expect(service.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/campaigns/camp-1/turns?limit=50'),
    expect.anything(),
  ));
}

function cashText() {
  return screen.getByTestId('cash-value').textContent;
}

function activeEventsRegion() {
  return screen.getByRole('region', { name: 'World event effect' });
}

describe('server-backed turn commit fails', () => {
  test('keeps the last saved month and world events on screen (no local re-run)', async () => {
    const service = fakeService();
    await renderConnected(service);
    const user = userEvent.setup();

    const cashBefore = cashText();
    const burnBefore = screen.getByTestId('burn-value').textContent;
    const eventsBefore = activeEventsRegion().textContent;
    expect(cashBefore).toBe('Cash: $15000');
    expect(burnBefore).toBe('Burn/mo: $2,464');

    service.failCommits = 1;
    await user.click(screen.getByRole('button', { name: /advance month/i }));
    // Let the rejected commit settle before reading the screen.
    await waitFor(() => expect(service.commitCalls).toBe(1));
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    // (a) Month not billed on screen, events unchanged, server still at turn 0.
    expect(cashText()).toBe(cashBefore);
    expect(screen.getByTestId('burn-value').textContent).toBe(burnBefore);
    expect(activeEventsRegion().textContent).toBe(eventsBefore);
    expect(service.campaign.turn).toBe(0);
    expect(service.campaign.company.cash).toBe(15000);
  });

  test('announces the failure with role=alert and an accessible Retry button', async () => {
    const service = fakeService();
    await renderConnected(service);
    const user = userEvent.setup();

    service.failCommits = 1;
    await user.click(screen.getByRole('button', { name: /advance month/i }));

    // (b) Existing alert pattern (.data-source--alert, role="alert").
    const panel = await screen.findByTestId('turn-save-alert');
    const alert = within(panel).getByRole('alert');
    expect(alert).toHaveTextContent(`${TURN_SAVE_FAILED_MESSAGE} ${TURN_RETRY_HINT}`);
    const retry = within(panel).getByRole('button', { name: 'Retry saving turn' });
    expect(retry).toBeEnabled();
    expect(panel).toHaveClass('data-source', 'data-source--alert');
  });

  test('Retry re-reads the campaign, then saves the turn once (keyboard)', async () => {
    const service = fakeService();
    await renderConnected(service);
    const user = userEvent.setup();

    service.failCommits = 1;
    await user.click(screen.getByRole('button', { name: /advance month/i }));
    const retry = await screen.findByRole('button', { name: 'Retry saving turn' });
    const readsBefore = service.campaignReads;

    // (c) Keyboard-operable retry recovers to the server state.
    retry.focus();
    expect(retry).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByTestId('turn-save-alert')).not.toBeInTheDocument());
    expect(service.campaignReads).toBe(readsBefore + 1);
    expect(service.campaign.turn).toBe(1);
    expect(cashText()).toBe(`Cash: $${service.campaign.company.cash.toFixed(0)}`);
    expect(cashText()).not.toBe('Cash: $15000');
  });

  test('a lost reply on advance_turn is not billed twice on Retry', async () => {
    const service = fakeService();
    await renderConnected(service);
    const user = userEvent.setup();

    // restack (clear + apply) succeeds; advance_turn lands, reply lost.
    service.loseReplies = 0;
    const realFetch = service.fetch.getMockImplementation();
    service.fetch.mockImplementation(async (url, options = {}) => {
      if (String(url).endsWith('/turns') && options.method === 'POST'
        && JSON.parse(options.body).type === 'advance_turn' && service.campaign.turn === 0) {
        service.loseReplies = 1;
      }
      return realFetch(url, options);
    });

    await user.click(screen.getByRole('button', { name: /advance month/i }));
    await screen.findByTestId('turn-save-alert');
    expect(service.campaign.turn).toBe(1);
    expect(cashText()).toBe('Cash: $15000');

    await user.click(screen.getByRole('button', { name: 'Retry saving turn' }));
    await waitFor(() => expect(screen.queryByTestId('turn-save-alert')).not.toBeInTheDocument());
    expect(service.campaign.turn).toBe(1);
    expect(cashText()).toBe(`Cash: $${service.campaign.company.cash.toFixed(0)}`);
  });

  test('another turn waits while a failed one is unsaved', async () => {
    const service = fakeService();
    await renderConnected(service);
    const user = userEvent.setup();

    service.failCommits = 1;
    await user.click(screen.getByRole('button', { name: /advance month/i }));
    await screen.findByTestId('turn-save-alert');
    const calls = service.commitCalls;

    await user.click(screen.getByRole('button', { name: /advance month/i }));
    expect(service.commitCalls).toBe(calls);
    expect(screen.getByRole('alert', { name: '' })).toHaveTextContent(/not saved yet\. Retry it/);
    expect(cashText()).toBe('Cash: $15000');
  });
});

describe('local-only play (no server campaign)', () => {
  test('Advance Month still advances on the local engine', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '');
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const user = userEvent.setup();
    render(<App initialPlayerRole="campaign" />);
    await screen.findByRole('status', { name: /sample data/i });

    // (d) 15000 − 2200/12 on the local engine, no network, no alert.
    await user.click(screen.getByRole('button', { name: /advance month/i }));
    expect(cashText()).toBe('Cash: $14817');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.queryByTestId('turn-save-alert')).not.toBeInTheDocument();
  });
});
