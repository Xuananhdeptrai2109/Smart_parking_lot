const test = require('node:test');
const assert = require('node:assert/strict');

const { formatVietnamPlate, selectLaneResult } = require('../src/services/anprService');

test('formats common Vietnamese car and motorcycle plate strings', () => {
    assert.equal(formatVietnamPlate('30a12345'), '30A-123.45');
    assert.equal(formatVietnamPlate('29x112345'), '29X1-123.45');
    assert.equal(formatVietnamPlate('51B1234'), '51B-1234');
});

test('selects right half for entry and left half for exit', () => {
    const results = [
        { plate: '30a11111', score: 0.95, box: { xmin: 100, xmax: 300 } },
        { plate: '30a22222', score: 0.90, box: { xmin: 1100, xmax: 1400 } },
    ];
    assert.equal(selectLaneResult(results, 'ENTRY', 1600).plate, '30a22222');
    assert.equal(selectLaneResult(results, 'EXIT', 1600).plate, '30a11111');
});
