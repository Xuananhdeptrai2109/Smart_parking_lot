const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeSpots } = require('../src/services/parkingService');
const { parseAccessInput } = require('../src/services/accessService');
const { PARKING_SPOT_NAMES } = require('../src/config/parking');

test('uses only the four physical parking spots', () => {
    assert.deepEqual(PARKING_SPOT_NAMES, ['A1', 'A2', 'A3', 'A4']);
});

test('summarizes the four parking spots and detects full state', () => {
    const spots = Array.from({ length: 4 }, (_, index) => ({
        id: index + 1,
        spotName: `A${index + 1}`,
        status: 'OCCUPIED',
    }));
    const result = summarizeSpots(spots);

    assert.equal(result.capacity, 4);
    assert.equal(result.available, 0);
    assert.equal(result.occupied, 4);
    assert.equal(result.isFull, true);
});

test('entry reads the right half plate and normalizes RFID', () => {
    const result = parseAccessInput({
        eventId: 'entry-001',
        rfidUid: 'aa-bb-01',
        rightPlate: ' 30a-123.45 ',
        imageUrl: 'https://example.com/camera.jpg',
        vehicleType: 'car',
    }, 'ENTRY');

    assert.equal(result.rfidUid, 'AABB01');
    assert.equal(result.recognizedPlate, '30A-123.45');
    assert.equal(result.vehicleType, 'CAR');
});

test('exit reads only the left half plate', () => {
    const result = parseAccessInput({
        eventId: 'exit-001',
        rfidUid: 'CARD001',
        leftPlate: '30A-123.45',
        rightPlate: 'WRONG-PLATE',
        imageUrl: 'https://example.com/camera.jpg',
    }, 'EXIT');

    assert.equal(result.recognizedPlate, '30A-123.45');
});
