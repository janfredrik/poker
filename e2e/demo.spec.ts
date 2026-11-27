import { expect, test } from '@playwright/test';

// Plays a few hands on a demo table against a server bot, through the real client.
// Catches the Dock/Seat wiring breaking: buttons missing for a legal state, or actions not reaching the server.

test('play a few hands against a bot', async ({ page }) => {
  // Watch the Socket.IO traffic: how many actions we sent and which hand the server says we're on.
  let actionsSent = 0;
  let handNumber = 0;
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => { if (/^42\d*\["action"/.test(String(payload))) actionsSent++; });
    ws.on('framereceived', ({ payload }) => {
      const m = /^42\["state",(.*)\]$/s.exec(String(payload));
      if (m) handNumber = Math.max(handNumber, JSON.parse(m[1])?.hand?.number ?? 0);
    });
  });

  await page.goto('/');
  await page.getByLabel('Ditt navn').fill('Testy');
  await page.getByRole('radio', { name: '1' }).click();
  await page.getByRole('button', { name: 'Spill mot 1 bot' }).click();
  await expect(page).toHaveURL(/\/t\/[A-Za-z0-9]+/);

  // both seats are on the table, ours marked as you
  await expect(page.getByText('(du)')).toBeVisible();
  await expect(page.locator('.seat__name', { hasText: 'Stian' })).toBeVisible();

  const dock = page.getByRole('region', { name: 'Din hånd og dine valg' });
  const fold = dock.getByRole('button', { name: /^Fold/ });
  const passive = dock.getByRole('button', { name: /^(Check|Call .+|All-in .+) C$/ });

  for (let turn = 1; turn <= 8; turn++) {
    await expect(fold).toBeEnabled({ timeout: 20_000 });
    await expect(passive).toBeEnabled();
    // it says what you can do now: a free check, or the amount to call
    await expect(dock.getByText(/^(Din tur|Beløp for call)/)).toBeVisible();
    await passive.click();
    await expect.poll(() => actionsSent).toBe(turn);
  }

  // checking and calling down every street takes several hands to get through 8 actions
  await expect.poll(() => handNumber).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
