import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, test } from 'vitest';
import PoliticsMeter from './PoliticsMeter';

// SC 4.1.2 Name, Role, Value: the role="meter" element needs its own accessible
// name. The wrapper section's aria-labelledby does not name the meter, so axe
// reports aria-meter-name (serious) until the meter itself is labelled.
// See e2e/a11y.spec.js for the full-page WCAG 2.2 AA scan.

const SLICE_ONE_STATE = { taxRate: 0.25, company: { hype: 0.3 } };

describe('PoliticsMeter', () => {
  test('voter support meter has an accessible name from its visible label', () => {
    render(<PoliticsMeter state={SLICE_ONE_STATE} />);

    const meter = screen.getByTestId('politics-voter-support-meter');
    expect(meter).toHaveAccessibleName('Voter support');
    expect(screen.getByRole('meter', { name: 'Voter support' })).toBe(meter);

    // The name comes from the same visible text, so nothing is screen-reader-only.
    const labelId = meter.getAttribute('aria-labelledby');
    expect(labelId).toBe('politics-voter-support-label');
    expect(document.getElementById(labelId)).toHaveTextContent('Voter support');
  });

  test('meter keeps its value semantics under the floor', () => {
    render(
      <PoliticsMeter
        state={{
          taxRate: 1,
          politics: { voterSupport: 0.1, survivalFloor: 0.25, survivalStatus: 'ousted' },
        }}
      />,
    );

    const meter = screen.getByTestId('politics-voter-support-meter');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuenow', '10');
    expect(meter).toHaveAttribute('aria-valuetext', '10%, ousted');
    expect(meter).toHaveAccessibleName('Voter support');
  });

  test('axe reports no aria-meter-name violation', async () => {
    const { container } = render(<PoliticsMeter state={SLICE_ONE_STATE} />);

    const results = await axe.run(container, {
      runOnly: { type: 'rule', values: ['aria-meter-name'] },
    });
    expect(results.violations).toEqual([]);
  });
});
