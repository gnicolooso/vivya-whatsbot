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

        // 🔥 ESSENCIAL PARA RAILWAY / DOCKER
        puppeteerOptions: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        },

        catchQR: async (base64Qr) => {
            const qr = base64Qr.split(',')[1];

            try {
                await axios.post(`${QR_SERVICE_URL}/api/qr`, { qr: base64Qr });
                console.log('📲 QR enviado para o microserviço.');
            } catch (err) {
                console.error('Erro ao enviar QR:', err.response?.data || err.message);
            }
        },

        statusFind: (status) => {
            console.log('🔎 Status do WPP:', status);

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

    // 🔔 MENSAGENS
    client.onMessage(async (message) => {
        try {

            // Filtros básicos
            if (!message) return;
            if (message.isGroupMsg) return;
            if (message.type === 'e2e_notification') return;

            console.log('📩 Nova mensagem recebida:', {
                from: message.from,
                fromMe: message.fromMe,
                type: message.type,
                body: message.body
            });

            const payload = buildPayload(message);

            // 🔥 Proteção contra payload vazio
            if (!payload || Object.keys(payload).length === 0) {
                console.warn('⚠️ Payload vazio. Não enviado ao n8n.');
                return;
            }

            if (message.fromMe) {
                await axios.post(N8N_HUMAN_TAKEOVER_WEBHOOK_URL, payload);
                console.log('🤖 Mensagem enviada para HUMAN TAKEOVER');
            } else {
                await axios.post(N8N_WEBHOOK_URL, payload);
                console.log('🚀 Mensagem enviada para N8N');
            }

        } catch (err) {
            console.error('❌ Erro processamento mensagem:', err.response?.data || err.message);
        }
    });


    // 🔄 STATE CHANGE
    client.onStateChange((state) => {
        console.log('🔄 State change:', state);

        if (state === 'CONFLICT' || state === 'UNPAIRED') {
            client.useHere();
        }

        // 🔥 TRATAMENTO CRÍTICO
        if (state === 'CLOSED' || state === 'browserClose') {
            console.warn('⚠️ Browser fechado. Reiniciando cliente...');
            setTimeout(() => {
                startWppClient();
            }, 5000);
        }
    });
}


async function buildPayload(message) {

    if (!message) return null;

    const payload = {
        phone_number_id: message.to?.replace('@c.us', '') || null,
        from: message.from?.replace('@c.us', '') || null,
        from_me: message.fromMe || false,
        message_id: message.id?._serialized || message.id || null,
        timestamp: message.timestamp || Date.now(),
        message_type: message.type || 'unknown'
    };

    // ========================
    // TEXTO
    // ========================
    if (message.type === 'chat' && message.body) {
        payload.text = {
            body: message.body
        };
    }

    // ========================
    // MÍDIA
    // ========================
    const isMedia =
        message.isMedia ||
        ['image', 'video', 'document', 'audio'].includes(message.type);

    if (isMedia) {
        try {

            const buffer = await client.decryptFile(message);

            const extension =
                message.mimetype?.split('/')[1]?.split(';')[0] || 'bin';

            const filename = `${Date.now()}-${uuidv4()}.${extension}`;
            const filePath = path.join(MEDIA_DIR, filename);

            await fs.writeFile(filePath, buffer);

            const mediaUrl = `${PUBLIC_URL}/media/${filename}`;

            payload.media = {
                type: message.type,
                mime_type: message.mimetype,
                url: mediaUrl,
                filename
            };

        } catch (err) {
            console.error('❌ Erro ao processar mídia:', err.message);
            payload.media_error = true;
        }
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