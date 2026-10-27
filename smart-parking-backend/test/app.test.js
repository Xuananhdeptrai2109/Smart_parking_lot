const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const { server } = require('../src/app');

let baseUrl;

before(async () => {
    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            baseUrl = `http://127.0.0.1:${address.port}`;
            resolve();
        });
    });
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});

test('GET /health returns service status', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
        status: 'ok',
        service: 'smart-parking-backend',
        mqtt: 'disconnected',
    });
});

test('unknown route returns JSON 404', async () => {
    const response = await fetch(`${baseUrl}/not-found`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.message, 'Không tìm thấy API.');
});

test('malformed JSON returns 400 instead of exposing an internal error', async () => {
    const response = await fetch(`${baseUrl}/api/v1/sessions/entry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid-json',
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(typeof body.message, 'string');
});
