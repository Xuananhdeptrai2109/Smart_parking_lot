const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const localPath = path.join(root, '.env');
const templatePath = path.join(root, '.env.production.example');
const outputPath = path.join(root, '.env.production');

if (!fs.existsSync(localPath)) {
    throw new Error('Missing local .env file.');
}

const local = dotenv.parse(fs.readFileSync(localPath));
const template = dotenv.parse(fs.readFileSync(templatePath));

if (!local.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing from local .env.');
}

const values = {
    ...template,
    ...local,
    DATABASE_URL: local.DATABASE_URL,
    PORT: '3000',
    CORS_ORIGIN: '*',
    MQTT_BROKER_URL: 'mqtt://mqtt:1883',
    MQTT_CLIENT_ID: 'smart-parking-backend-aws',
    MQTT_USERNAME: 'smart_parking_device',
    MQTT_PASSWORD: crypto.randomBytes(32).toString('base64url'),
    MQTT_TOPIC_PREFIX: 'smart-parking',
    PRISMA_TRANSACTION_MAX_WAIT_MS: '10000',
    PRISMA_TRANSACTION_TIMEOUT_MS: '20000',
};

const quote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const content = Object.entries(values)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join('\n') + '\n';

fs.writeFileSync(outputPath, content, { mode: 0o600 });
console.log('Created .env.production with a generated MQTT credential.');
