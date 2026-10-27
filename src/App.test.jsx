import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import App from './App';

describe('Slice 1 with no world event', () => {
  test('renders the tax lever, advance month, and baseline cash and burn', async () => {
    render(<App />);

    expect(screen.getByRole('slider', { name: /tax rate/i })).toHaveValue('0.25');
    expect(screen.getByRole('button', { name: /advance month \(apply effects\)/i })).toBeInTheDocument();
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,200/)).toBeInTheDocument();
    expect(screen.getByText(/Tax: 25%/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Cash & Burn Rate' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Cash & Burn Rate' }));
    expect(screen.getByRole('main')).toContainElement(document.getElementById('metrics-chart-description'));
    expect(screen.queryByRole('region', { name: 'World event effect' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'World events' })).getByRole('status')).toHaveTextContent('');
    for (const label of ['Policy change', 'News spike', 'Market shift']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${label} `) });
      expect(button).not.toHaveAttribute('aria-label');
      expect(button).toHaveAccessibleName(new RegExp(`^${label} `));
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
    expect(document.querySelector('[data-id="civic-infra"]').textContent).not.toContain('+12%');
  });

  test('the tax slider still ticks cash without announcing a world event', () => {
    render(<App />);

    const slider = screen.getByRole('slider', { name: /tax rate/i });
    slider.focus();
    expect(slider).toHaveFocus();
    // jsdom does not implement native range-input arrow keys. The control is a
    // real input[type=range], so browsers change it from the keyboard.
    fireEvent.change(slider, { target: { value: '0.3' } });

    expect(screen.getByText(/Cash: \$14813/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,240/)).toBeInTheDocument();
    expect(screen.getByText(/Tax: 30%/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'World events' })).getByRole('status')).toHaveTextContent('');
    expect(screen.queryByRole('region', { name: 'World event effect' })).not.toBeInTheDocument();
  });
});

describe('world event trigger', () => {
  test('keyboard applies the policy change and announces its effect', async () => {
    const user = userEvent.setup();
    render(<App />);

    const events = screen.getByRole('region', { name: 'World events' });
    const button = within(events).getByRole('button', {
      name: /^Policy change /,
    });
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(within(events).getByRole('status')).toHaveTextContent(
      'Policy change: talent cost +12%, burn $2,464'
    );
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(/▲/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/talent cost \+12%/i).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-id="civic-infra"]').textContent).toContain('talent cost +12%');

    const effect = screen.getByRole('region', { name: 'World event effect' });
    expect(within(effect).getByText('Hype before')).toBeInTheDocument();
    expect(within(effect).getByText('Talent cost before')).toBeInTheDocument();
    expect(within(effect).getByText('Talent cost after')).toBeInTheDocument();
    const talent = screen.getByRole('region', { name: 'Talent and burn' });
    expect(talent).toHaveTextContent(
      'Burn $2,464 (base $2,200 · talent ×1.0000 · talent cost ×1.12)'
    );
    expect(talent).toHaveTextContent('No employees. Talent multiplier is 1.0000.');
    expect(document.querySelector('[data-id="3"]').textContent).toContain('Talent ×1.0000');
    expect(document.querySelector('[data-id="7"]').textContent).toContain(
      'Burn $2,464 (base $2,200)'
    );
    expect(document.querySelector('[data-id="7"]').textContent).toContain(
      'Talent ×1.0000 × cost factor 1.12 = 1.12'
    );
    expect(document.querySelector('[data-id="7"]').textContent).toContain('Hype: 30%');
    expect(screen.getByRole('group', {
      name: 'Talent multiplier 1 times cost factor 1.12 equals 1.12',
    })).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
    expect(screen.getByText(/Active world event: Policy change: talent cost \+12%/)).toBeInTheDocument();
  });

  test('clearing the event restores the Slice 1 readout', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^Policy change / }));
    await user.click(screen.getByRole('button', { name: 'Clear world events' }));

    expect(screen.getByRole('heading', { name: 'World events' })).toHaveFocus();
    expect(within(screen.getByRole('region', { name: 'World events' })).getByRole('status')).toHaveTextContent(
      'World events cleared. Hype and talent cost returned to baseline.'
    );
    expect(screen.queryByRole('region', { name: 'World event effect' })).not.toBeInTheDocument();
    expect(screen.getByText(/Cash: \$15000/)).toBeInTheDocument();
    expect(screen.getByText(/Burn\/mo: \$2,200/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Policy change / })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(document.querySelector('[data-id="civic-infra"]').textContent).not.toContain('+12%');
  });

  test('advance month still records cash after a trigger', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^Policy change / }));
    await user.click(screen.getByRole('button', { name: /advance month/i }));

    expect(screen.getByText(/Burn\/mo: \$2,464/)).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /tax rate/i })).toHaveValue('0.25');
  });

  test('live region names both active events and clear restores baseline announce', async () => {
    const user = userEvent.setup();
    render(<App />);

    const events = screen.getByRole('region', { name: 'World events' });
    await user.click(within(events).getByRole('button', { name: /^Policy change / }));
    await user.click(within(events).getByRole('button', { name: /^News spike / }));

    const live = within(events).getByRole('status');
    expect(live).toHaveTextContent(/News spike:/);
    expect(live).toHaveTextContent(/2 world events active: Policy change; News spike/);
    expect(within(events).getByRole('button', { name: /^Policy change / })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(events).getByRole('button', { name: /^News spike / })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.click(within(events).getByRole('button', { name: 'Clear world events' }));
    expect(live).toHaveTextContent(
      'World events cleared. Hype and talent cost returned to baseline.'
    );
    expect(live).not.toHaveTextContent(/world events active/);
  });
});

describe('product header', () => {
  test('describes tax and world events without Slice-1-only copy', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Citizen' })).toBeInTheDocument();
    expect(screen.getByText(/tax policy and world events/i)).toBeInTheDocument();
    expect(screen.queryByText(/Slice 1/i)).not.toBeInTheDocument();
  });
});
