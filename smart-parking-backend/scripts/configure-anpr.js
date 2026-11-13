const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(backendRoot, '..');
const productionEnvPath = path.join(backendRoot, '.env.production');

if (!fs.existsSync(productionEnvPath)) {
    throw new Error('Missing .env.production. Run prepare-production-env.js first.');
}

const values = dotenv.parse(fs.readFileSync(productionEnvPath));
const publicHost = process.argv[2] || values.PUBLIC_HOST || '3-105-215-46.sslip.io';
const deviceKey = values.ANPR_DEVICE_KEY
    && !values.ANPR_DEVICE_KEY.startsWith('REPLACE_')
    ? values.ANPR_DEVICE_KEY
    : crypto.randomBytes(32).toString('base64url');
const previewKey = values.CAMERA_PREVIEW_TOKEN
    && !values.CAMERA_PREVIEW_TOKEN.startsWith('REPLACE_')
    ? values.CAMERA_PREVIEW_TOKEN
    : crypto.randomBytes(24).toString('base64url');

Object.assign(values, {
    PUBLIC_HOST: publicHost,
    PUBLIC_BASE_URL: `https://${publicHost}`,
    ANPR_DEVICE_KEY: deviceKey,
    CAMERA_PREVIEW_TOKEN: previewKey,
    ANPR_REGION: values.ANPR_REGION || 'vn',
    ANPR_MIN_SCORE: values.ANPR_MIN_SCORE || '0.55',
    ANPR_TIMEOUT_MS: values.ANPR_TIMEOUT_MS || '20000',
});

const quote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const envContent = Object.entries(values)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join('\n') + '\n';
fs.writeFileSync(productionEnvPath, envContent, { mode: 0o600 });

const headerContent = [
    '#pragma once',
    '',
    '// Generated locally. This file is ignored by Git; do not publish it.',
    `const char *ANPR_DEVICE_KEY = ${JSON.stringify(deviceKey)};`,
    `const char *CAMERA_PREVIEW_TOKEN = ${JSON.stringify(previewKey)};`,
    '',
].join('\n');
const headerPath = path.join(projectRoot, 'firmware', 'esp32_cam', 'anpr_credentials.h');
fs.writeFileSync(headerPath, headerContent, { mode: 0o600 });

const frontendEnvPath = path.join(projectRoot, 'smart-parking-frontend', '.env.local');
const frontendValues = fs.existsSync(frontendEnvPath)
    ? dotenv.parse(fs.readFileSync(frontendEnvPath))
    : {};
frontendValues.VITE_CAMERA_PREVIEW_TOKEN = previewKey;
const frontendContent = Object.entries(frontendValues)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join('\n') + '\n';
fs.writeFileSync(frontendEnvPath, frontendContent, { mode: 0o600 });

console.log(`Configured ANPR HTTPS host ${publicHost} and dedicated camera/preview keys.`);
