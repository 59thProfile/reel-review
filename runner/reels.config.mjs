// What Reel Review tests. This one points at the example app in ../example;
// change baseURL, screens and flows to point it at yours.
export default {
  app: 'Errands (example)',
  baseURL: 'http://localhost:4321',
  viewport: { width: 1280, height: 800 },

  // Optional: runs once before the screens are shot, e.g. to sign in.
  // async setup(page) {
  //   await page.goto('/login');
  //   await page.fill('#email', process.env.REEL_EMAIL);
  //   await page.fill('#password', process.env.REEL_PASSWORD);
  //   await page.click('button[type=submit]');
  // },

  // A screen is blank if this selector holds fewer than 20 characters of text.
  contentSelector: 'main',

  // Screens are screenshotted and compared with their approved baseline.
  // `prepare` puts the page in the state you want shot; `mask` hides parts that change on
  // every run (clocks, avatars, "4 minutes ago").
  screens: [
    { id: 'home', name: 'Errands, empty', path: '/' },
    {
      id: 'home-filled', name: 'Errands, with items', path: '/',
      async prepare(page) {
        for (const text of ['Buy milk', 'Post the parcel', 'Call the dentist']) {
          await page.fill('#new', text);
          await page.press('#new', 'Enter');
        }
        await page.getByLabel('Done: Buy milk').check();
        await page.getByLabel('Done: Post the parcel').check();
      },
    },
    { id: 'about', name: 'About', path: '/about' },
  ],

  // Flows click through the app. Each t.step is an action (a failure stops the flow);
  // each t.expect is a check that returns { ok, expected, actual }.
  // The optional last argument names the element the step is about, so the card can point at it.
  flows: [
    {
      id: 'add-item',
      title: 'Add an errand',
      intent: 'Typing an errand and pressing Add puts it on the list and updates the counter.',
      async run(t) {
        await t.step('Open the app', (p) => p.goto('/'));
        await t.step('Type "Buy milk"', (p) => p.fill('#new', 'Buy milk'), (p) => p.locator('#new'));
        await t.step('Click Add', (p) => p.getByRole('button', { name: 'Add' }).click(), (p) => p.getByRole('button', { name: 'Add' }));
        await t.expect('The list shows "Buy milk"', async (p) => {
          const items = await p.locator('#list li').allInnerTexts();
          return { ok: items.includes('Buy milk'), expected: 'Buy milk', actual: items.join(', ') || '(empty list)' };
        }, (p) => p.locator('#list'));
        await t.expect('The counter reads "1 item left"', async (p) => {
          const text = (await p.locator('#count').innerText()).trim();
          return { ok: text === '1 item left', expected: '1 item left', actual: text };
        }, (p) => p.locator('#count'));
      },
    },
    {
      id: 'complete-item',
      title: 'Tick an errand off',
      intent: 'Ticking an errand strikes it through and drops it from the count.',
      async run(t) {
        await t.step('Open the app', (p) => p.goto('/'));
        await t.step('Add two errands', async (p) => {
          for (const text of ['Buy milk', 'Call the dentist']) {
            await p.fill('#new', text);
            await p.press('#new', 'Enter');
          }
        }, (p) => p.locator('#add'));
        await t.step('Tick "Buy milk"', (p) => p.getByLabel('Done: Buy milk').check(), (p) => p.getByLabel('Done: Buy milk'));
        await t.expect('"Buy milk" is struck through', async (p) => {
          const cls = await p.locator('#list li').first().getAttribute('class');
          return { ok: cls === 'done', expected: 'struck through', actual: cls === 'done' ? 'struck through' : 'not struck through' };
        }, (p) => p.locator('#list li').first());
        await t.expect('The counter reads "1 item left"', async (p) => {
          const text = (await p.locator('#count').innerText()).trim();
          return { ok: text === '1 item left', expected: '1 item left', actual: text };
        }, (p) => p.locator('#count'));
      },
    },
    {
      id: 'about',
      title: 'About page opens',
      intent: 'The About link in the nav goes to the About page.',
      async run(t) {
        await t.step('Open the app', (p) => p.goto('/'));
        await t.step('Click About', (p) => p.getByRole('link', { name: 'About' }).click(), (p) => p.getByRole('link', { name: 'About' }));
        await t.expect('Lands on /about', (p) => {
          const at = new URL(p.url()).pathname;
          return { ok: at === '/about', expected: '/about', actual: at };
        });
      },
    },
  ],
};
