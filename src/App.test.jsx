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
    expect(screen.getByText(/Burn\/mo: \$2000/)).toBeInTheDocument();
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
    expect(screen.getByText(/Burn\/mo: \$2240/)).toBeInTheDocument();
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

    expect(within(events).getByRole('status')).toHaveTextContent('Policy change: talent cost +12%');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(/▲/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/talent cost \+12%/i).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-id="civic-infra"]').textContent).toContain('talent cost +12%');

    const effect = screen.getByRole('region', { name: 'World event effect' });
    expect(within(effect).getByText('Hype before')).toBeInTheDocument();
    expect(within(effect).getByText('Talent cost before')).toBeInTheDocument();
    expect(within(effect).getByText('Talent cost after')).toBeInTheDocument();
    const talent = screen.getByRole('region', { name: 'Talent and burn' });
    expect(talent).toHaveTextContent('×1.00 talent');
    expect(talent).toHaveTextContent(/base burn \$2,200/i);
    expect(screen.queryByText(/\$2,464/)).not.toBeInTheDocument();
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
    expect(screen.getByText(/Burn\/mo: \$2000/)).toBeInTheDocument();
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

    expect(screen.getByText(/Burn\/mo: \$2200/)).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /tax rate/i })).toHaveValue('0.25');
  });
});
