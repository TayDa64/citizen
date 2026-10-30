import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

// Full-page WCAG 2.2 AA scan on the default page (campaign lens, seeded by
// fixtures.js). This caught `aria-meter-name` (serious) on the voter-support
// role="meter" element — SC 4.1.2 Name, Role, Value.
const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('voter support meter exposes an accessible name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('politics-meter')).toBeVisible();

  const meter = page.getByTestId('politics-voter-support-meter');
  await expect(meter).toHaveAttribute('role', 'meter');
  await expect(page.getByRole('meter', { name: 'Voter support' })).toHaveCount(1);
});

test('default page has no WCAG 2.2 AA violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('politics-meter')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Politics & survival' })).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS).analyze();

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
});
