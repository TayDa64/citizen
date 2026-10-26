import { expect, test } from '@playwright/test';

test('policy sample from the API shows $4,480 without raising burn', async ({ page }) => {
  test.skip(
    !process.env.CITIZEN_API_E2E,
    'Optional. Set CITIZEN_API_E2E=1 and VITE_CITIZEN_API while building, with PR #2 listening on 127.0.0.1:8787. Not required for CI.'
  );

  await page.goto('/');
  await expect(page.getByRole('status', { name: /citizen service/i })).toBeVisible();
  const policy = page.getByRole('button', { name: /^Policy change / });
  await expect(policy).toContainText('$4,480');
  await expect(policy).toContainText('+12%');
  await policy.click();
  await expect(page.getByRole('region', { name: 'World event effect' })).toContainText('$4,480');
  await expect(page.getByText(/Burn\/mo: \$2000/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear world events' }).click();
  await expect(page.getByRole('region', { name: 'World event effect' })).toHaveCount(0);
});
