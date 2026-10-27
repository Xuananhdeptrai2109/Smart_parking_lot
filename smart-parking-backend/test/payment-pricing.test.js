const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PARKING_PRICE_FIRST_2_HOURS = '10000';
process.env.PARKING_PRICE_UP_TO_5_HOURS = '20000';
process.env.PARKING_PRICE_EXTRA_HOUR = '5000';

const { calculateParkingFee } = require('../src/services/paymentService');

test('charges 10,000 VND for the first two hours', () => {
    const result = calculateParkingFee('2026-10-08T08:00:00.000Z', '2026-10-08T09:30:00.000Z');
    assert.equal(result.amount, 10000);
    assert.equal(result.durationMinutes, 90);
    assert.equal(result.tier, 'FIRST_2_HOURS');
});

test('charges 20,000 VND from over two hours through five hours', () => {
    const result = calculateParkingFee('2026-10-08T08:00:00.000Z', '2026-10-08T11:15:00.000Z');
    assert.equal(result.amount, 20000);
    assert.equal(result.durationMinutes, 195);
    assert.equal(result.tier, 'UP_TO_5_HOURS');
});

test('charges each started extra hour after five hours', () => {
    const result = calculateParkingFee('2026-10-08T08:00:00.000Z', '2026-10-08T14:01:00.000Z');
    assert.equal(result.amount, 30000);
    assert.equal(result.extraHours, 2);
    assert.equal(result.tier, 'OVER_5_HOURS');
});
