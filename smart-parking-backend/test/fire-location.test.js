const test = require('node:test');
const assert = require('node:assert/strict');

const { estimateFireLocation } = require('../src/services/fireService');

const config = {
    flameThreshold: 0.65,
    nozzleAngles: {
        NW: 49,
        NE: 131,
        SW: 15,
        SE: 165,
    },
};

test('estimates north-west fire at coordinate (0, 4)', () => {
    const result = estimateFireLocation({
        flameNW: 1,
        flameNE: 0,
        flameSW: 0,
        flameSE: 0,
    }, config);

    assert.equal(result.flameDetected, true);
    assert.equal(result.estimatedX, 0);
    assert.equal(result.estimatedY, 4);
    assert.equal(result.targetCorner, 'NW');
    assert.equal(result.horizontalAngle, 49);
    assert.equal(result.verticalAngle, null);
});

test('estimates balanced fire at center of 5x5 grid', () => {
    const result = estimateFireLocation({
        flameNW: 0.8,
        flameNE: 0.8,
        flameSW: 0.8,
        flameSE: 0.8,
    }, config);

    assert.equal(result.estimatedX, 2);
    assert.equal(result.estimatedY, 2);
    assert.equal(result.targetCorner, 'NW');
    assert.equal(result.horizontalAngle, 49);
    assert.equal(result.verticalAngle, null);
});

test('does not aim when all flame readings are below threshold', () => {
    const result = estimateFireLocation({
        flameNW: 0.2,
        flameNE: 0.1,
        flameSW: 0.3,
        flameSE: 0.1,
    }, config);

    assert.equal(result.flameDetected, false);
    assert.equal(result.estimatedX, null);
    assert.equal(result.horizontalAngle, null);
});
