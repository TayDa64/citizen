import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from './App';
import Dashboard from './components/Dashboard';
import TriggerPanel from './components/TriggerPanel';
import { applyTrigger, hydrateFromApi, initialState, previewBurnRate } from './simulation';
import { talentCostFactorClampedOf, talentCostFactorOf } from './talentMultiplier';
import { SAMPLE_TRIGGERS } from './triggers';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const apiCompany = {
  id: 'company-1',
  name: 'Northwind',
  cash: 15000,
  burnRate: 2000,
  hype: 0.3,
  talentCost: 4000,
  baselines: { hype: 0.3, talentCost: 4000 },
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('authority boundary (API mode)', () => {
  test('hydrate ignores payload cash/burn; apply and clear leave client cash unchanged', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    const calls = [];
    let triggers = [];
    let talentCost = 4000;
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      calls.push({ path, method, body: options.body });
      if (method === 'POST' && path.endsWith('/api/triggers/mock')) {
        triggers = [policy];
        talentCost = 4480;
        return jsonResponse(policy, 201);
      }
      if (method === 'DELETE' && path.endsWith('/api/triggers')) {
        triggers = [];
        talentCost = 4000;
        return { ok: true, status: 204, json: async () => null };
      }
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{
          ...apiCompany,
          cash: 1,
          burnRate: 9,
          talentCost,
          baselines: { hype: 0.3, talentCost: 4000 },
        }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse(triggers);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('status', { name: /citizen service/i });
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,200/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Policy change / }));
    await screen.findByRole('region', { name: 'World event effect' });
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear world events' }));
    expect(within(screen.getByRole('region', { name: 'World events' })).getByRole('status')).toHaveTextContent(
      'World events cleared. Hype and talent cost returned to baseline.'
    );
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,200/)).toBeInTheDocument();

    const mutating = calls.filter((call) => call.method !== 'GET');
    expect(mutating.every((call) => String(call.path).includes('/api/triggers'))).toBe(true);
    expect(mutating.some((call) => /cash|burn/i.test(String(call.body ?? '')))).toBe(false);
  });

  test('Advance Month drains local cash and never POSTs cash or companies', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      calls.push({ path, method, body: options.body });
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{ ...apiCompany, cash: 1, burnRate: 9 }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('status', { name: /citizen service/i });
    const beforeCount = calls.length;
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /advance month/i }));
    expect(screen.getByText(/Cash: \$14817/)).toBeInTheDocument();
    expect(calls.slice(beforeCount)).toEqual([]);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(calls.some((call) => call.method === 'POST' && String(call.path).endsWith('/api/companies'))).toBe(false);
  });
});

describe('API talent cost display', () => {
  test('shows the policy sample as $4,480 and a +12% delta from the company baseline', () => {
    const state = hydrateFromApi(initialState, { company: apiCompany, triggers: [] });
    render(
      <TriggerPanel
        state={state}
        announcement=""
        onToggleTrigger={() => {}}
        onClearTriggers={() => {}}
      />
    );

    const button = screen.getByRole('button', { name: /^Policy change / });
    expect(button).toHaveAccessibleName(/talent cost \+12%/);
    expect(button).toHaveAccessibleName(/\$4,480/);
    expect(button).toHaveAccessibleName(/Up/);
  });

  test('the effect readout uses API dollars and the talent-cost burn', () => {
    const loaded = hydrateFromApi(
      {
        ...initialState,
        company: { ...apiCompany, productQuality: 0.4 },
      },
      {
        company: { ...apiCompany, hype: 0.3, talentCost: 4480 },
        triggers: [policy],
      }
    );
    render(<Dashboard state={loaded} />);

    const effect = screen.getByRole('region', { name: 'World event effect' });
    expect(within(effect).getByText('$4,000')).toBeInTheDocument();
    expect(within(effect).getByText('$4,480 (up +12%)')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Talent and burn' })).toHaveTextContent(
      'Burn $2,464 (base $2,200 · talent ×1.0000 · talent cost ×1.12)'
    );
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
    expect(within(effect).queryByText(/1\.12×/)).not.toBeInTheDocument();
  });
});

describe('sample data fallback', () => {
  test('an unset API flag shows sample data and keeps the local burn coupling', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '');
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const user = userEvent.setup();
    render(<App />);

    const note = screen.getByRole('status', { name: /using sample data on this device/i });
    expect(note).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();

    const policyButton = screen.getByRole('button', { name: /^Policy change / });
    expect(policyButton).not.toHaveAccessibleName(/\$4,480/);
    await user.click(policyButton);

    expect(screen.getByRole('region', { name: 'Talent and burn' })).toHaveTextContent(
      'Burn $2,464 (base $2,200 · talent ×1.0000 · talent cost ×1.12)'
    );
    expect(screen.getByText(/1\.12×/)).toBeInTheDocument();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('shows a loading status with no alert while the service has not answered', () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<App />);

    const note = screen.getByRole('status', { name: /loading company and world events/i });
    expect(note).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Policy change / })).toBeDisabled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('an unreachable API falls back without an alert and still applies a local sample', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:9');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const user = userEvent.setup();
    render(<App />);

    const note = await screen.findByRole('status', { name: /using sample data on this device/i });
    expect(note).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Policy change / }));
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
    expect(screen.getByText(/1\.12×/)).toBeInTheDocument();
    expect(screen.queryByText('$4,480')).not.toBeInTheDocument();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('a reachable API shows dollar talent cost and the talent-cost burn', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      calls.push({ path, options });
      if (path.endsWith('/api/triggers/mock')) {
        return jsonResponse(policy, 201);
      }
      if (path.endsWith('/api/companies')) {
        const applied = calls.some((call) => call.path.endsWith('/api/triggers/mock'));
        return jsonResponse([
          applied
            ? { ...apiCompany, talentCost: 4480, baselines: { hype: 0.3, talentCost: 4000 } }
            : apiCompany,
        ]);
      }
      if (path.endsWith('/api/triggers')) {
        const applied = calls.some((call) => call.path.endsWith('/api/triggers/mock'));
        return jsonResponse(applied ? [policy] : []);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);

    const connected = await screen.findByRole('status', { name: /citizen service/i });
    expect(connected).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const policyButton = await screen.findByRole('button', { name: /\$4,480/ });
    expect(policyButton).toHaveAccessibleName(/\+12%/);
    await user.click(policyButton);

    const effect = await screen.findByRole('region', { name: 'World event effect' });
    expect(within(effect).getByText('$4,480 (up +12%)')).toBeInTheDocument();
    expect(within(effect).getByText('$4,000')).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'World events' })).getByRole('status')).toHaveTextContent(
      'Policy change: talent cost +12%, burn $2,464'
    );

    const mockCall = calls.find((call) => call.path.endsWith('/api/triggers/mock'));
    expect(JSON.parse(mockCall.options.body)).toEqual({ scenario: 'policy_change' });
    const companyReads = calls.filter((call) => String(call.path).endsWith('/api/companies'));
    expect(companyReads.length).toBeGreaterThanOrEqual(2);
    expect(calls.findIndex((call) => String(call.path).endsWith('/api/triggers/mock')))
      .toBeLessThan(calls.findLastIndex((call) => String(call.path).endsWith('/api/companies')));
    expect(mockCall.options.body).not.toContain('appliedAtIndex');

    await user.click(screen.getByRole('button', { name: /advance month/i }));
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /tax rate/i })).toHaveValue('0.25');

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('a failed save is an alert and does not change the sample numbers', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/api/companies')) return jsonResponse([apiCompany]);
      if (path.endsWith('/api/triggers/mock')) {
        return jsonResponse(
          {
            error: 'Invalid trigger payload',
            issues: [{ path: 'scenario', code: 'invalid_value', message: 'scenario must be one of: news_spike, policy_change, market_shift' }],
          },
          400
        );
      }
      return jsonResponse([]);
    }));

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('status', { name: /citizen service/i });
    await user.click(screen.getByRole('button', { name: /^Policy change / }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not save/i);
    expect(alert).toHaveTextContent(/scenario must be one of/i);
    expect(screen.queryByRole('region', { name: 'World event effect' })).not.toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,200/)).toBeInTheDocument();
  });

  test('toggling off and clearing call DELETE and restore the API baselines', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    const calls = [];
    let triggers = [policy];
    let talentCost = 4480;
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      calls.push({ path, method, body: options.body });
      if (method === 'POST' && path.endsWith('/api/triggers/mock')) {
        triggers = [policy];
        talentCost = 4480;
        return jsonResponse(policy, 201);
      }
      if (method === 'DELETE' && path.endsWith('/api/triggers')) {
        triggers = [];
        talentCost = 4000;
        return { ok: true, status: 204, json: async () => null };
      }
      if (method === 'DELETE') {
        triggers = triggers.filter((trigger) => !path.endsWith(encodeURIComponent(trigger.id)));
        if (triggers.length === 0) talentCost = 4000;
        return { ok: true, status: 204, json: async () => null };
      }
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{ ...apiCompany, talentCost, baselines: { hype: 0.3, talentCost: 4000 } }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse(triggers);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    const policyButton = await screen.findByRole('button', { name: /^Policy change /, pressed: true });
    expect(policyButton).toHaveAttribute('aria-pressed', 'true');
    await user.click(policyButton);

    expect(calls.some((call) => call.method === 'DELETE' && call.path.endsWith(`/api/triggers/${policy.id}`))).toBe(true);
    expect(within(screen.getByRole('region', { name: 'World events' })).getByRole('status')).toHaveTextContent(
      /Policy change removed/
    );
    expect(screen.queryByRole('region', { name: 'World event effect' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: /^Policy change / }));
    await screen.findByRole('region', { name: 'World event effect' });
    const cashBeforeClear = screen.getByText(/Cash: \$/).textContent;
    await user.click(screen.getByRole('button', { name: /advance month/i }));
    const cashAfterTick = screen.getByText(/Cash: \$/).textContent;
    expect(cashAfterTick).not.toBe(cashBeforeClear);
    await user.click(screen.getByRole('button', { name: 'Clear world events' }));

    expect(calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/api/triggers') && !call.path.endsWith(policy.id))).toBe(true);
    expect(within(screen.getByRole('region', { name: 'World events' })).getByRole('status')).toHaveTextContent(
      'World events cleared. Hype and talent cost returned to baseline.'
    );
    expect(screen.getByRole('heading', { name: 'World events' })).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'World event effect' })).not.toBeInTheDocument();
    const metrics = screen.getByTestId('cash-value').textContent;
    expect(metrics.match(/Cash: \$\d+/)[0]).toBe(cashAfterTick.match(/Cash: \$\d+/)[0]);
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $2,200');
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Cash & Burn Rate' }));
  });

  test('a 405 delete keeps the dollar talent cost and explains that nothing changed', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      if (method === 'DELETE') return jsonResponse({ error: 'Method not allowed', issues: [] }, 405);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{ ...apiCompany, talentCost: 4480, baselines: { hype: 0.3, talentCost: 4000 } }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Policy change /, pressed: true }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/has not enabled that action yet \(405\)/i);
    expect(alert).toHaveTextContent(/nothing on this screen was changed/i);
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'World event effect' })).toHaveTextContent('$4,480');
    expect(screen.queryByRole('alert')).toHaveTextContent(/Could not remove/);
  });

  test('a 404 for an unknown id re-syncs baselines and drops the event', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    let removed = false;
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      if (method === 'DELETE' && path.endsWith(`/api/triggers/${policy.id}`)) {
        removed = true;
        return jsonResponse({ error: 'Trigger not found', issues: [] }, 404);
      }
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{
          ...apiCompany,
          hype: 0.3,
          talentCost: removed ? 4000 : 4480,
          baselines: { hype: 0.3, talentCost: 4000 },
        }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse(removed ? [] : [policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Policy change /, pressed: true }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'World events' })).getByRole('status')).toHaveTextContent(
      /Policy change removed/
    );
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: 'World event effect' })).not.toBeInTheDocument();
  });

  test('a 404 clear keeps the active event on screen', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      if (method === 'DELETE') return jsonResponse({ error: 'Not found', issues: [] }, 404);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{ ...apiCompany, talentCost: 4480, baselines: { hype: 0.3, talentCost: 4000 } }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Clear world events' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/404/);
    expect(alert).toHaveTextContent(/nothing on this screen was changed/i);
    expect(screen.getByRole('region', { name: 'World event effect' })).toHaveTextContent('$4,480');
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a 413 delete keeps the current numbers and does not re-sync', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      calls.push({ path, method });
      if (method === 'DELETE') return jsonResponse({ error: 'Payload too large', issues: [] }, 413);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{ ...apiCompany, cash: 1, burnRate: 9, talentCost: 4480, baselines: { hype: 0.3, talentCost: 4000 } }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /^Policy change /, pressed: true }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/413/);
    expect(alert).toHaveTextContent(/nothing on this screen was changed/i);
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'World event effect' })).toHaveTextContent('$4,480');
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'GET' && call.path.endsWith('/api/triggers'))).toHaveLength(1);
  });

  test('an empty company list falls back to sample data', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '/api');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/api/companies')) return jsonResponse([]);
      return jsonResponse([policy]);
    }));
    const user = userEvent.setup();
    render(<App />);

    const note = await screen.findByRole('status', { name: /no company was returned/i });
    expect(note).toHaveTextContent(/sample data/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Policy change / }));
    expect(screen.getByText(/1\.12×/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
  });

  test('a missing Host shows an alert and keeps the sample numbers', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Host required' }, 400)));
    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/400/);
    expect(alert).toHaveTextContent(/Host required/);
    expect(alert).toHaveTextContent(/nothing on this screen was changed/i);
    expect(screen.getByRole('status', { name: /using sample data on this device/i })).toBeInTheDocument();
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,200/)).toBeInTheDocument();
  });

  test('a duplicate Host on delete keeps the current numbers', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '/api');
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      if (method === 'DELETE') return jsonResponse({ error: 'Duplicate host' }, 400);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{ ...apiCompany, talentCost: 4480, baselines: { hype: 0.3, talentCost: 4000 } }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Policy change /, pressed: true }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Duplicate host/);
    expect(alert).toHaveTextContent(/nothing on this screen was changed/i);
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'World event effect' })).toHaveTextContent('$4,480');
  });

  test('a 403 shows an alert and stays on sample data', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://example.test');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Forbidden', issues: [] }, 403)));
    const user = userEvent.setup();
    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/403/);
    expect(alert).toHaveTextContent(/\/api/);
    expect(screen.getByRole('status', { name: /using sample data on this device/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Policy change / }));
    expect(screen.getByText(/1\.12×/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
  });

  test('a 403 delete keeps the current numbers', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '/api');
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      if (method === 'DELETE') return jsonResponse({ error: 'Forbidden', issues: [] }, 403);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{ ...apiCompany, talentCost: 4480, baselines: { hype: 0.3, talentCost: 4000 } }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Policy change /, pressed: true }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/403/);
    expect(alert).toHaveTextContent(/nothing on this screen was changed/i);
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'World event effect' })).toHaveTextContent('$4,480');
  });
});

describe('API talent multiplier', () => {
  test('uses the supplied multiplier for burn and shows the mix', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '/api');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{
          ...apiCompany,
          cash: 1,
          burnRate: 9,
          talentCost: 4480,
          talentMultiplier: 1.28,
          talentMix: [{ department: 'tech', headcount: 1, avgSkill: 0.53, weight: 1.25, contribution: 1.28 }],
        }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    render(<App />);
    expect(await screen.findByText(/×1\.2800 talent/)).toBeInTheDocument();
    const talent = screen.getByRole('region', { name: 'Talent and burn' });
    expect(talent).toHaveTextContent(
      'Burn $3,154 (base $2,200 · talent ×1.2800 · talent cost ×1.12)'
    );
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$3,154/)).toBeInTheDocument();
    const table = within(talent).getByRole('table', { name: 'Talent mix' });
    expect(within(table).getByRole('columnheader', { name: 'Department' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'tech' })).toBeInTheDocument();
    expect(screen.queryByText(/\$2,464/)).not.toBeInTheDocument();
  });

  test('keeps a loaded 1.75 multiplier when the month advances and the tax slider moves', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_CITIZEN_API', '/api');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{
          ...apiCompany,
          cash: 1,
          burnRate: 4900,
          baseBurnRate: 2800,
          talentMultiplier: 1.75,
          talentMix: [{ department: 'tech', headcount: 4, avgSkill: 1, weight: 1.25, contribution: 1.75 }],
          employees: [
            { id: 'e1', department: 'tech', skillTech: 1 },
            { id: 'e2', department: 'tech', skillTech: 1 },
            { id: 'e3', department: 'tech', skillTech: 1 },
            { id: 'e4', department: 'marketing', skillMarketing: 0.5 },
          ],
        }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    render(<App />);
    const talent = await screen.findByRole('region', { name: 'Talent and burn' });
    expect(talent).toHaveTextContent(
      'Burn $3,850 (base $2,200 · talent ×1.7500 · talent cost ×1.00)'
    );
    expect(within(talent).getByRole('cell', { name: 'tech' })).toBeInTheDocument();
    expect(within(talent).getByRole('cell', { name: '4' })).toBeInTheDocument();
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$3,850/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /advance month \(apply effects\)/i }));
    expect(talent).toHaveTextContent('talent ×1.7500');
    expect(screen.getByText(/Burn\/mo: \$3,850/)).toBeInTheDocument();
    expect(screen.queryByText(/Burn\/mo: \$2,200/)).not.toBeInTheDocument();
    expect(within(talent).getByRole('cell', { name: 'tech' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: /tax rate/i }), { target: { value: '1' } });
    expect(screen.getByText(/Tax: 100%/)).toBeInTheDocument();
    expect(talent).toHaveTextContent(
      'Burn $4,900 (base $2,800 · talent ×1.7500 · talent cost ×1.00)'
    );
    expect(screen.getByText(/Burn\/mo: \$4,900/)).toBeInTheDocument();
    expect(within(talent).getByRole('cell', { name: '4' })).toBeInTheDocument();
    expect(document.querySelector('[data-id="3"]').textContent).toContain('Talent ×1.7500');
    expect(document.querySelector('[data-id="3"]').textContent).toContain('tech 4');
  });
});

describe('out-of-contract API payloads', () => {
  function installApi(handler) {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    vi.stubGlobal('fetch', vi.fn(handler));
  }

  function companiesAndTriggers(company, triggers) {
    return async (url) => {
      const path = String(url);
      if (path.endsWith('/api/companies')) return jsonResponse([company]);
      if (path.endsWith('/api/triggers')) return jsonResponse(triggers);
      return jsonResponse({ error: 'Not found' }, 404);
    };
  }

  test('an unknown trigger type is skipped with an alert and the page stays up', async () => {
    installApi(companiesAndTriggers(apiCompany, [
      {
        id: 'evt-not-a-type',
        type: 'employees',
        label: 'Mystery',
        source: 'mock:local',
        timestamp: '2026-04-02T15:00:00.000Z',
        effect: { hype: 0.1 },
      },
      policy,
    ]));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Citizen' })).toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/skipped 1 world event/i);
    expect(alert).toHaveTextContent(/unexpected shape/i);
    expect(screen.getByRole('status', { name: /citizen service/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Mystery/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'World event effect' })).toHaveTextContent('$4,000');
  });

  test('an extra effect key is skipped with an alert and the page stays up', async () => {
    installApi(companiesAndTriggers(apiCompany, [{
      id: 'evt-extra-employees',
      type: 'policy_change',
      label: 'Policy change',
      source: 'mock:local',
      timestamp: '2026-04-02T15:00:00.000Z',
      effect: { talentCost: 0.12, employees: 4 },
    }]));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Citizen' })).toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/skipped 1 world event/i);
    expect(screen.getByRole('status', { name: /citizen service/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: 'World event effect' })).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  test('a malformed company falls back to sample data with a status', async () => {
    installApi(companiesAndTriggers(
      { id: 'company-1', name: 'Northwind', hype: null, talentCost: null, baselines: { hype: null, talentCost: 4000 } },
      [policy]
    ));
    const user = userEvent.setup();
    render(<App />);

    const note = await screen.findByRole('status', { name: /company payload could not be read/i });
    expect(note).toHaveTextContent(/using sample data on this device/i);
    expect(screen.getByRole('heading', { name: 'Citizen' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Policy change / }));
    expect(screen.getByText(/1\.12×/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
  });

  test('null hype and talent cost use the baselines and say they were missing', async () => {
    installApi(companiesAndTriggers(
      { ...apiCompany, hype: null, talentCost: null },
      [policy]
    ));
    render(<App />);

    const note = await screen.findByRole('status', { name: /hype was missing, so the baseline is shown/i });
    expect(note).toHaveTextContent(/talent cost was missing, so the baseline is shown/i);
    expect(note).toHaveTextContent(/citizen service/i);
    const effect = await screen.findByRole('region', { name: 'World event effect' });
    expect(within(effect).getByText('Hype after').parentElement).toHaveTextContent('30% (unchanged)');
    expect(within(effect).getByText('Talent cost after').parentElement).toHaveTextContent('$4,000 (unchanged)');
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/-100%/)).not.toBeInTheDocument();
  });

  test('non-finite hype is treated as missing', async () => {
    installApi(companiesAndTriggers(
      { ...apiCompany, hype: Number.NaN, talentCost: 4480 },
      [policy]
    ));
    render(<App />);

    const note = await screen.findByRole('status', { name: /hype was missing, so the baseline is shown/i });
    expect(note).not.toHaveTextContent(/talent cost was missing/i);
    const effect = await screen.findByRole('region', { name: 'World event effect' });
    expect(within(effect).getByText('Hype after').parentElement).toHaveTextContent('30% (unchanged)');
    expect(within(effect).getByText('Talent cost after').parentElement).toHaveTextContent('$4,480');
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  test('a 404 delete that still lists the trigger does not announce removal', async () => {
    vi.stubEnv('VITE_CITIZEN_API', 'http://127.0.0.1:8787');
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      if (method === 'DELETE') {
        return jsonResponse({ error: 'Trigger not found', issues: [] }, 404);
      }
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{ ...apiCompany, hype: 0.3, talentCost: 4480 }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Policy change /, pressed: true }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/still listed/i);
    const live = within(screen.getByRole('region', { name: 'World events' })).getByRole('status');
    expect(live).not.toHaveTextContent(/removed/i);
    expect(live).toHaveTextContent('Policy change: talent cost +12%, burn $2,464');
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'World event effect' })).toHaveTextContent('$4,480');
  });
});

describe('local diagram still uses the multiplier baseline', () => {
  test('api hydration does not treat the current dollar talent cost as the baseline', () => {
    const state = applyTrigger(
      hydrateFromApi(initialState, {
        company: { ...apiCompany, hype: 0.4, talentCost: 4480 },
        triggers: [policy],
      }),
      SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'news_spike')
    );
    expect(state.baselines.talentCost).toBe(4000);
    expect(state.company.talentCost).toBeCloseTo(4480, 5);
    expect(state.company.hype).toBeCloseTo(0.4, 5);
  });
});

describe('clamped API metrics', () => {
  test('the effect readout clamps a raw hype and talent cost', () => {
    render(
      <Dashboard
        state={{
          taxRate: 0.25,
          dataSource: 'api',
          employees: [],
          talentMix: [],
          company: { cash: 15000, burnRate: 2000, hype: -5, talentCost: -1, productQuality: 0.4 },
          baselines: { hype: 0.3, talentCost: 4000 },
          history: { cash: [15000], burnRate: [2000] },
          activeTriggers: [policy],
        }}
      />
    );

    expect(screen.queryByText('-500%')).not.toBeInTheDocument();
    expect(screen.queryByText('-$1')).not.toBeInTheDocument();
    const effect = screen.getByRole('region', { name: 'World event effect' });
    expect(within(effect).getByText('Hype after').parentElement).toHaveTextContent('0%');
    expect(within(effect).getByText('Talent cost after').parentElement).toHaveTextContent('$0');
  });

  test('shows a status when hype and talent cost are outside the contract', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '/api');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{
          ...apiCompany,
          hype: -5,
          talentCost: -1,
          baselines: { hype: -5, talentCost: 4000 },
        }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    render(<App />);
    const note = await screen.findByRole('status', { name: /hype was outside 0% to 100%/i });
    expect(note).toHaveTextContent(/talent cost was outside \$0 to \$9,999,999,999\.99/i);
    expect(screen.queryByText('-500%')).not.toBeInTheDocument();
    expect(screen.queryByText('-$1')).not.toBeInTheDocument();
    const effect = await screen.findByRole('region', { name: 'World event effect' });
    expect(within(effect).getByText('Hype after').parentElement).toHaveTextContent('0%');
    expect(within(effect).getByText('Talent cost after').parentElement).toHaveTextContent('$0');
  });

  test('caps a huge talent cost at the contract maximum', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '/api');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{ ...apiCompany, talentCost: 1e308 }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    render(<App />);
    const note = await screen.findByRole('status', { name: /talent cost was outside/i });
    expect(note).not.toHaveTextContent(/hype was outside/i);
    const effect = await screen.findByRole('region', { name: 'World event effect' });
    expect(within(effect).getByText('Talent cost after').parentElement).toHaveTextContent('$9,999,999,999.99');
  });
});

describe('0.5.0 and 0.6.0 company payloads', () => {
  test('a 0.5.0 company computes the talent-cost factor in the burn readout', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '/api');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{
          ...apiCompany,
          talentCost: 4480,
          talentMultiplier: 1,
        }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    render(<App />);
    const talent = await screen.findByRole('region', { name: 'Talent and burn' });
    expect(talent).toHaveTextContent(
      'Burn $2,464 (base $2,200 · talent ×1.0000 · talent cost ×1.12)'
    );
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
  });

  test('a 0.6.0 company prefers the server factor and effective burn', async () => {
    vi.stubEnv('VITE_CITIZEN_API', '/api');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/api/companies')) {
        return jsonResponse([{
          ...apiCompany,
          talentCost: 999,
          talentMultiplier: 1.75,
          talentCostFactor: 1.12,
          effectiveMultiplier: 1.96,
          talentMix: [{ department: 'tech', headcount: 4, avgSkill: 1, weight: 1.25, contribution: 1.75 }],
          employees: [{ id: 'm1', department: 'marketing', skillMarketing: 0.5 }],
        }]);
      }
      if (path.endsWith('/api/triggers')) return jsonResponse([policy]);
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    render(<App />);
    const talent = await screen.findByRole('region', { name: 'Talent and burn' });
    expect(talent).toHaveTextContent(
      'Burn $4,312 (base $2,200 · talent ×1.7500 · talent cost ×1.12)'
    );
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $4,312');
    expect(screen.getByTestId('base-burn-value')).toHaveTextContent('Base burn: $2,200');
    expect(screen.getByTestId('talent-multiplier-value')).toHaveTextContent('Talent multiplier: 1.7500');
    expect(screen.getByTestId('talent-cost-factor-value')).toHaveTextContent('Talent cost factor: 1.12');
    expect(screen.getByTestId('effective-multiplier-value')).toHaveTextContent('Effective multiplier: 1.96');
    expect(screen.getByRole('group', {
      name: 'Talent multiplier 1.75 times cost factor 1.12 equals 1.96',
    })).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$4,312/)).toBeInTheDocument();
    expect(within(talent).getByRole('cell', { name: 'tech' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: /tax rate/i }), { target: { value: '1' } });
    expect(talent).toHaveTextContent(
      'Burn $5,488 (base $2,800 · talent ×1.7500 · talent cost ×1.12)'
    );
    expect(screen.getByText(/Burn\/mo: \$5,488/)).toBeInTheDocument();
    expect(talent).not.toHaveTextContent('talent ×1.9600');
  });
});

describe('API talent-cost factor clamp', () => {
  function trigger(id, talentCost) {
    return {
      id,
      type: 'policy_change',
      label: 'Policy change',
      source: 'mock:local',
      timestamp: '2026-04-02T15:00:00.000Z',
      effect: { talentCost },
    };
  }

  test('a -100% talent-cost trigger floors the factor at 0.1 and burn stays at $220', () => {
    const loaded = hydrateFromApi(initialState, {
      company: {
        ...apiCompany,
        talentCost: 0,
        talentMultiplier: 1,
        talentCostFactor: 0,
        effectiveMultiplier: 0,
      },
      triggers: [trigger('wipe', -1)],
    });
    expect(loaded.company.talentCost).toBe(0);
    expect(talentCostFactorOf(loaded)).toBe(0.1);
    expect(previewBurnRate(loaded)).toBe(220);
    const computed = hydrateFromApi(initialState, {
      company: { ...apiCompany, talentCost: 0, talentMultiplier: 1 },
      triggers: [trigger('wipe', -1)],
    });
    expect(computed.talentCostFactor).toBeNull();
    expect(talentCostFactorOf(computed)).toBe(0.1);
    expect(previewBurnRate(computed)).toBe(220);
    render(<Dashboard state={loaded} />);
    expect(screen.getByTestId('talent-cost-factor-value')).toHaveTextContent('Talent cost factor: 0.10');
    expect(talentCostFactorClampedOf(loaded)).toBe(true);
    expect(screen.getByTestId('talent-cost-factor-clamp')).toHaveTextContent('floored at 0.1×');
    expect(screen.getByTestId('talent-cost-factor-value')).toHaveAccessibleName(
      'Talent cost factor 0.10, floored at 0.1×'
    );
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $220');
    expect(screen.getByTestId('effective-multiplier-value')).toHaveTextContent('Effective multiplier: 0.10');
    expect(screen.getByText('$0 (down -100%)')).toBeInTheDocument();
  });

  test('three stacked +100 triggers cap the factor at exactly 3', () => {
    const triggers = ['stack-a', 'stack-b', 'stack-c'].map((id) => trigger(id, 100));
    const rawCost = 4000 * (101 ** 3);
    const loaded = hydrateFromApi(initialState, {
      company: {
        ...apiCompany,
        talentCost: rawCost,
        talentMultiplier: 1,
        talentCostFactor: 101 ** 3,
        effectiveMultiplier: 101 ** 3,
      },
      triggers,
    });
    expect(loaded.company.talentCost).toBe(rawCost);
    expect(talentCostFactorOf(loaded)).toBe(3);
    expect(previewBurnRate(loaded)).toBe(6600);
    const computed = hydrateFromApi(initialState, {
      company: { ...apiCompany, talentCost: rawCost, talentMultiplier: 1 },
      triggers,
    });
    expect(computed.talentCostFactor).toBeNull();
    expect(talentCostFactorOf(computed)).toBe(3);
    expect(previewBurnRate(computed)).toBe(6600);
    render(<Dashboard state={loaded} />);
    expect(screen.getByTestId('talent-cost-factor-value')).toHaveTextContent('Talent cost factor: 3.00');
    expect(talentCostFactorClampedOf(loaded)).toBe(true);
    expect(screen.getByTestId('talent-cost-factor-clamp')).toHaveTextContent('capped at 3×');
    expect(screen.getByTestId('talent-cost-factor-value')).toHaveAccessibleName(
      'Talent cost factor 3.00, capped at 3×'
    );
    expect(screen.getByTestId('effective-multiplier-value')).toHaveTextContent('Effective multiplier: 3.00');
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $6,600');
    expect(screen.getByText(/\$4,121,204,000/)).toBeInTheDocument();
  });
});
