const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(backendRoot, '..');
const productionEnvPath = path.join(backendRoot, '.env.production');

if (!fs.existsSync(productionEnvPath)) {
    throw new Error('Missing .env.production. Run prepare-production-env.js first.');
}

const production = dotenv.parse(fs.readFileSync(productionEnvPath));
const host = process.argv[2] || production.PUBLIC_MQTT_HOST;

if (!host || host === 'REPLACE_WITH_EC2_ELASTIC_IP') {
    throw new Error(
        'Missing public MQTT host. Usage: node scripts/sync-firmware-mqtt-credentials.js <EC2_ELASTIC_IP>',
    );
}

if (!production.MQTT_USERNAME || !production.MQTT_PASSWORD) {
    throw new Error('MQTT_USERNAME or MQTT_PASSWORD is missing from .env.production.');
}

const cppString = (value) => JSON.stringify(String(value));
const content = [
    '#pragma once',
    '',
    '// Generated locally. This file is ignored by Git; do not publish it.',
    `const char *MQTT_HOST = ${cppString(host)};`,
    `const char *MQTT_USERNAME = ${cppString(production.MQTT_USERNAME)};`,
    `const char *MQTT_PASSWORD = ${cppString(production.MQTT_PASSWORD)};`,
    '',
].join('\n');

const sketchFolders = [
    'esp32_main_controller',
    'esp32_cam',
    'esp32_fire_controller',
];

for (const folder of sketchFolders) {
    const outputPath = path.join(projectRoot, 'firmware', folder, 'mqtt_credentials.h');
    fs.writeFileSync(outputPath, content, { mode: 0o600 });
}

console.log(`Updated MQTT credentials for ${sketchFolders.length} ESP32 sketches.`);
