const EventEmitter = require('events');
const mqtt = require('mqtt');

const localEvents = new EventEmitter();
const handlers = new Map();
let client = null;

const prefix = (process.env.MQTT_TOPIC_PREFIX || 'smart-parking').replace(/^\/+|\/+$/g, '');

const topics = {
    events: {
        entryRequest: `${prefix}/events/gate/entry/request`,
        exitRequest: `${prefix}/events/gate/exit/request`,
        gateState: `${prefix}/events/gate/state`,
        spotState: `${prefix}/events/parking/spot/state`,
        fireSnapshot: `${prefix}/events/fire/snapshot`,
        commandAck: `${prefix}/events/command/ack`,
        heartbeat: `${prefix}/events/device/heartbeat`,
    },
    command: (group, deviceCode) => `${prefix}/commands/${group}/${deviceCode}`,
    state: (name) => `${prefix}/state/${name}`,
};

function registerHandler(topic, handler) {
    handlers.set(topic, handler);
}

function handleIncoming(topic, rawPayload) {
    const handler = handlers.get(topic);
    if (!handler) {
        return;
    }

    let payload;
    try {
        payload = JSON.parse(rawPayload.toString('utf8'));
    } catch (error) {
        console.error(`[MQTT] Invalid JSON on ${topic}:`, error.message);
        return;
    }

    Promise.resolve(handler(payload, { topic }))
        .catch((error) => console.error(`[MQTT] Handler failed for ${topic}:`, error));
}

function start() {
    const brokerUrl = process.env.MQTT_BROKER_URL;
    if (!brokerUrl) {
        console.warn('[MQTT] MQTT_BROKER_URL is not configured; device messages are available through REST only.');
        return null;
    }

    if (client) {
        return client;
    }

    client = mqtt.connect(brokerUrl, {
        clientId: process.env.MQTT_CLIENT_ID || `smart-parking-backend-${process.pid}`,
        username: process.env.MQTT_USERNAME || undefined,
        password: process.env.MQTT_PASSWORD || undefined,
        clean: false,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
    });

    client.on('connect', () => {
        const subscriptions = [...handlers.keys()];
        if (subscriptions.length > 0) {
            client.subscribe(subscriptions, { qos: 1 }, (error) => {
                if (error) {
                    console.error('[MQTT] Subscribe failed:', error.message);
                    return;
                }
                console.log(`[MQTT] Connected and subscribed to ${subscriptions.length} topics.`);
            });
        }
    });

    client.on('message', handleIncoming);
    client.on('error', (error) => console.error('[MQTT] Connection error:', error.message));
    client.on('reconnect', () => console.warn('[MQTT] Reconnecting...'));

    return client;
}

async function publish(topic, payload, options = {}) {
    const message = JSON.stringify(payload);
    const publishOptions = {
        qos: options.qos ?? 1,
        retain: options.retain ?? false,
    };

    localEvents.emit('published', { topic, payload, options: publishOptions });

    if (!client?.connected) {
        return false;
    }

    await new Promise((resolve, reject) => {
        client.publish(topic, message, publishOptions, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });

    return true;
}

async function stop() {
    if (!client) {
        return;
    }

    const activeClient = client;
    client = null;
    await new Promise((resolve) => activeClient.end(false, {}, resolve));
}

function isConnected() {
    return Boolean(client?.connected);
}

module.exports = {
    topics,
    localEvents,
    registerHandler,
    start,
    stop,
    publish,
    isConnected,
};
