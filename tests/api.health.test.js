jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: jest.fn() } } }));
const { app } = require('../src/api/index.js');

test('/health responde 200 sin auth y no cuenta contra el rate limit de /api', async () => {
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let i = 0; i < 150; i++) {
      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(200);
    }
    expect((await (await fetch(`${base}/health`)).json()).status).toBe('ok');
  } finally {
    await new Promise(r => server.close(r));
  }
});
