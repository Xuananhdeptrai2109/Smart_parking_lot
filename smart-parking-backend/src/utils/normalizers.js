function normalizeLicensePlate(value) {
    return typeof value === 'string'
        ? value.trim().toUpperCase().replace(/\s+/g, '')
        : '';
}

function normalizeRfid(value) {
    return typeof value === 'string'
        ? value.trim().toUpperCase().replace(/[:\-\s]/g, '')
        : '';
}

function parseOccurredAt(value) {
    if (!value) {
        return new Date();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = {
    normalizeLicensePlate,
    normalizeRfid,
    parseOccurredAt,
};
