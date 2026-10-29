import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import App from './App';
import {
  PLAYER_ROLE_CAMPAIGN,
  PLAYER_ROLE_COMPANY_OPS,
  writeStoredPlayerRole,
} from './playerRole';

describe('role select gate (CIT-113)', () => {
  test('shows role select when no role is set', () => {
    writeStoredPlayerRole(null);
    render(<App initialPlayerRole={null} />);

    expect(screen.getByTestId('role-select')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /choose your role/i })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: /tax rate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'World events' })).not.toBeInTheDocument();
  });

  test('choosing company ops opens ops desk and hides world-events panel', async () => {
    const user = userEvent.setup();
    writeStoredPlayerRole(null);
    render(<App initialPlayerRole={null} />);

    await user.click(screen.getByTestId('role-company-ops'));

    expect(screen.getByTestId('active-role-label')).toHaveTextContent(/company ops/i);
    expect(screen.getByTestId('company-ops-forms')).toBeInTheDocument();
    expect(screen.getByTestId('ops-campaign-hint')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'World events' })).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-authority-note')).toBeInTheDocument();
    expect(screen.getByTestId('employee-roster')).toBeInTheDocument();
  });

  test('choosing campaign opens triggers and causal registry view', async () => {
    const user = userEvent.setup();
    writeStoredPlayerRole(null);
    render(<App initialPlayerRole={null} />);

    await user.click(screen.getByTestId('role-campaign'));

    expect(screen.getByTestId('active-role-label')).toHaveTextContent(/campaign/i);
    expect(screen.getByRole('region', { name: 'World events' })).toBeInTheDocument();
    expect(screen.getByTestId('causal-rules-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('company-ops-forms')).not.toBeInTheDocument();
  });

  test('island switcher moves between company ops and campaign without remounting sim cash', async () => {
    const user = userEvent.setup();
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);

    expect(screen.getByTestId('cash-value')).toHaveTextContent(/Cash: \$15000/);
    await user.click(screen.getByTestId('island-campaign'));
    expect(screen.getByTestId('active-role-label')).toHaveTextContent(/campaign/i);
    expect(screen.getByTestId('cash-value')).toHaveTextContent(/Cash: \$15000/);
    expect(screen.getByRole('region', { name: 'World events' })).toBeInTheDocument();

    await user.click(screen.getByTestId('island-company-ops'));
    expect(screen.getByTestId('company-ops-forms')).toBeInTheDocument();
  });
});

describe('company ops forms drive TurnCommands', () => {
  test('ops hire form updates roster and talent multiplier', async () => {
    const user = userEvent.setup();
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);

    expect(screen.getByTestId('employee-roster-empty')).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('ops-hire-department'), 'marketing');
    await user.clear(screen.getByTestId('ops-hire-skill'));
    await user.type(screen.getByTestId('ops-hire-skill'), '1');
    await user.click(screen.getByTestId('ops-hire-submit'));

    const roster = screen.getByTestId('employee-roster');
    expect(within(roster).getByText('marketing')).toBeInTheDocument();
    expect(screen.queryByTestId('employee-roster-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('talent-multiplier-value').textContent).not.toMatch(/1\.0000/);
  });

  test('ops tax form applies set_tax path and updates burn readout', async () => {
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);

    const slider = screen.getByTestId('ops-tax-rate');
    fireEvent.change(slider, { target: { value: '0' } });
    fireEvent.submit(screen.getByTestId('ops-tax-form'));

    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $2,000');
    expect(screen.getByTestId('base-burn-value')).toHaveTextContent('Base burn: $2,000');
  });

  test('diagram hire on node 3 still works from company ops island', async () => {
    const user = userEvent.setup();
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);

    await user.click(screen.getByRole('button', { name: /hire tech employee/i }));
    expect(within(screen.getByTestId('employee-roster')).getByText('tech')).toBeInTheDocument();
  });
});

describe('campaign island clarity', () => {
  test('campaign role shows causal rules list from CAUSAL_RULES', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_CAMPAIGN} />);
    expect(screen.getByTestId('causal-rules-panel')).toBeInTheDocument();
    expect(screen.getByText(/rule\.tax→company\.burnRate/)).toBeInTheDocument();
  });
});
