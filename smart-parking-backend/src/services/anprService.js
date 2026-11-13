const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const AppError = require('../utils/AppError');

const DEFAULT_STORAGE_DIR = path.resolve(process.cwd(), 'storage', 'anpr');

function normalizeRawPlate(value) {
    return typeof value === 'string'
        ? value.toUpperCase().replace(/[^A-Z0-9]/g, '')
        : '';
}

function formatVietnamPlate(value) {
    const normalized = normalizeRawPlate(value);
    // Motorcycle plates normally include a series digit (for example 29X1),
    // while car plates use a three-character prefix (for example 30A).
    const match = normalized.match(/^(\d{2}[A-Z]\d)(\d{5})$/)
        || normalized.match(/^(\d{2}[A-Z])(\d{4,5})$/);
    if (!match) return normalized;

    const [, prefix, serial] = match;
    if (serial.length === 5) {
        return `${prefix}-${serial.slice(0, 3)}.${serial.slice(3)}`;
    }
    return `${prefix}-${serial}`;
}

function selectLaneResult(results, direction, imageWidth) {
    if (!Array.isArray(results) || results.length === 0) return null;

    const width = Number(imageWidth);
    const candidates = Number.isFinite(width) && width > 0
        ? results.filter((result) => {
            const box = result?.box;
            if (!box || !Number.isFinite(Number(box.xmin)) || !Number.isFinite(Number(box.xmax))) {
                return false;
            }
            const centerX = (Number(box.xmin) + Number(box.xmax)) / 2;
            return direction === 'ENTRY' ? centerX >= width / 2 : centerX < width / 2;
        })
        : results;

    // A single detected plate is accepted even when it falls close to the center line.
    const laneResults = candidates.length ? candidates : (results.length === 1 ? results : []);
    return laneResults.reduce((best, current) => (
        !best || Number(current?.score || 0) > Number(best?.score || 0) ? current : best
    ), null);
}

function safeEventId(value) {
    const normalized = typeof value === 'string'
        ? value.trim().replace(/[^A-Za-z0-9_-]/g, '-')
        : '';
    return normalized.slice(0, 80) || `capture-${Date.now()}`;
}

function publicImageUrl(filename, requestBaseUrl) {
    const base = (process.env.PUBLIC_BASE_URL || requestBaseUrl || 'http://localhost:3000')
        .replace(/\/$/, '');
    return `${base}/uploads/anpr/${encodeURIComponent(filename)}`;
}

async function saveImage(buffer, eventId, requestBaseUrl) {
    const directory = process.env.ANPR_STORAGE_DIR || DEFAULT_STORAGE_DIR;
    await fs.mkdir(directory, { recursive: true });
    const filename = `${safeEventId(eventId)}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    await fs.writeFile(path.join(directory, filename), buffer, { flag: 'wx' });
    return { filename, imageUrl: publicImageUrl(filename, requestBaseUrl) };
}

async function callPlateRecognizer(buffer, eventId) {
    const token = process.env.PLATE_RECOGNIZER_TOKEN;
    if (!token) {
        throw new AppError('ANPR is not configured: PLATE_RECOGNIZER_TOKEN is missing.', 503);
    }

    const form = new FormData();
    form.append('upload', new Blob([buffer], { type: 'image/jpeg' }), `${safeEventId(eventId)}.jpg`);
    form.append('regions', process.env.ANPR_REGION || 'vn');
    form.append('camera_id', process.env.CAMERA_DEVICE_CODE || 'CAMERA_MAIN');
    form.append('config', JSON.stringify({
        threshold_d: 0.2,
        threshold_o: Number(process.env.ANPR_MIN_SCORE || 0.55),
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.ANPR_TIMEOUT_MS || 20000));
    try {
        const response = await fetch('https://api.platerecognizer.com/v1/plate-reader/', {
            method: 'POST',
            headers: { Authorization: `Token ${token}` },
            body: form,
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = payload.detail || payload.message || `HTTP ${response.status}`;
            throw new AppError(
                `ANPR provider rejected the request: ${message}`,
                response.status === 429 ? 429 : 502,
            );
        }
        return payload;
    } catch (error) {
        if (error.name === 'AbortError') throw new AppError('ANPR provider timed out.', 504);
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function recognize({ buffer, eventId, direction, imageWidth, imageHeight, requestBaseUrl }) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4
        || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw new AppError('The uploaded payload is not a valid JPEG image.', 400);
    }
    if (!['ENTRY', 'EXIT'].includes(direction)) {
        throw new AppError('X-Direction must be ENTRY or EXIT.', 400);
    }

    const saved = await saveImage(buffer, eventId, requestBaseUrl);
    let provider;
    try {
        provider = await callPlateRecognizer(buffer, eventId);
    } catch (error) {
        error.details = { ...(error.details || {}), imageUrl: saved.imageUrl };
        throw error;
    }

    const selected = selectLaneResult(provider.results, direction, imageWidth);
    const score = Number(selected?.score || 0);
    const plate = formatVietnamPlate(selected?.plate);
    const minScore = Number(process.env.ANPR_MIN_SCORE || 0.55);
    if (!plate || score < minScore) {
        throw new AppError(
            'No sufficiently reliable plate was found in the expected image half.',
            422,
            { imageUrl: saved.imageUrl, direction, score },
        );
    }

    return {
        eventId,
        direction,
        imageUrl: saved.imageUrl,
        leftPlate: direction === 'EXIT' ? plate : '',
        rightPlate: direction === 'ENTRY' ? plate : '',
        recognizedPlate: plate,
        confidence: score,
        box: selected.box || null,
        imageWidth: Number(imageWidth) || null,
        imageHeight: Number(imageHeight) || null,
    };
}

module.exports = {
    formatVietnamPlate,
    selectLaneResult,
    recognize,
};
