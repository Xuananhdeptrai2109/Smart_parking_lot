function readPositiveNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getPricingConfig() {
    return {
        firstTwoHours: readPositiveNumber('PARKING_PRICE_FIRST_2_HOURS', 10000),
        upToFiveHours: readPositiveNumber('PARKING_PRICE_UP_TO_5_HOURS', 20000),
        extraHour: readPositiveNumber('PARKING_PRICE_EXTRA_HOUR', 5000),
        qrExpiresMinutes: Math.max(1, readPositiveNumber('PARKING_QR_EXPIRES_MINUTES', 5)),
    };
}

module.exports = { getPricingConfig };
