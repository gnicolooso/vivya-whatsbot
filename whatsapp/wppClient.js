// whatsapp/wppClient.js

const wppconnect = require('@wppconnect-team/wppconnect');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const {
    CLIENT_ID,
    SESSION_DIR,
    QR_SERVICE_URL,
    N8N_WEBHOOK_URL,
    N8N_HUMAN_TAKEOVER_WEBHOOK_URL,
    PUBLIC_URL,
    MEDIA_DIR
} = require('../config');

let client = null;
let isInitializing = false;
let isConnected = false;

function getClient() {
    return client;
}

function isBotConnected() {
    return isConnected;
}

async function startWppClient() {
    if (isInitializing) return;
    isInitializing = true;

    client = await wppconnect.create({
        session: CLIENT_ID,
        folderNameToken: SESSION_DIR,
        headless: true,
        useChrome: false,
        autoClose: 0,
        disableWelcome: true,
        catchQR: async (base64Qr) => {
            const qr = base64Qr.split(',')[1];

            try {
                await axios.post(`${QR_SERVICE_URL}/api/qr`, { qr: base64Qr });
            } catch (err) {
                console.error('Erro ao enviar QR:', err.message);
            }
        },
        statusFind: (status) => {
            if (status === 'inChat') {
                isConnected = true;
                isInitializing = false;
                console.log('✅ WPPConnect conectado.');
            }
        }
    });

    registerEvents();
}

function registerEvents() {
    client.onMessage(async (message) => {

        if (message.isGroupMsg) return;
        if (message.type === 'e2e_notification') return;

        try {
            const payload = buildPayload(message);

            if (message.fromMe) {
                await axios.post(N8N_HUMAN_TAKEOVER_WEBHOOK_URL, payload);
            } else {
                await axios.post(N8N_WEBHOOK_URL, payload);
            }

        } catch (err) {
            console.error('Erro processamento mensagem:', err.message);
        }
    });

    client.onStateChange((state) => {
        if (state === 'CONFLICT' || state === 'UNPAIRED') {
            client.useHere();
        }
    });
}

async function buildPayload(message) {
    const payload = {
        phone_number_id: message.to?.replace('@c.us', ''),
        from: message.from?.replace('@c.us', ''),
        from_me: message.fromMe,
        message_id: message.id,
        timestamp: message.timestamp,
        message_type: message.type,
        text: {},
        image: {},
        video: {},
        audio: {},
        document: {}
    };

    if (message.type === 'chat') {
        payload.text.body = message.body;
    }

    if (message.isMedia || message.type === 'image' || message.type === 'video' || message.type === 'document' || message.type === 'audio') {
        const buffer = await client.decryptFile(message);
        const extension = message.mimetype.split('/')[1] || 'bin';
        const filename = `${Date.now()}-${uuidv4()}.${extension}`;
        const filePath = path.join(MEDIA_DIR, filename);

        await fs.writeFile(filePath, buffer);

        const mediaUrl = `${PUBLIC_URL}/media/${filename}`;

        payload[message.type] = {
            mime_type: message.mimetype,
            url: mediaUrl,
            filename
        };
    }

    return payload;
}

async function resetSession() {
    if (client) {
        await client.close();
        client = null;
        isConnected = false;
    }
}

module.exports = {
    startWppClient,
    getClient,
    isBotConnected,
    resetSession
};