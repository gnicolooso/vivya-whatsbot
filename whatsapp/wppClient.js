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

        if (state === 'CONFLICT') {
            console.log('⚠️ Conflito detectado. Forçando takeover...');
            client.useHere();
        }

        if (state === 'UNPAIRED') {
            console.log('❌ Sessão desconectada (UNPAIRED). Aguardando novo QR...');
            isConnected = false;
        }
    });
}


async function buildPayload(message) {
    const isFromMe = message.fromMe;

    const from = message.from?.replace('@c.us', '') || null;
    const to = message.to?.replace('@c.us', '') || null;

    const payload = {
        phone_number_id: isFromMe ? from : to || from,
        from: from,
        from_me: isFromMe,
        message_id: message.id?.id || message.id || null,
        timestamp: message.timestamp,
        message_type: message.type,
        text: {},
        image: {},
        video: {},
        audio: {},
        document: {}
    };

    if (message.type === 'chat' && message.body) {
        payload.text = {
            body: message.body
        };
    }

    if (message.isMedia) {
        const buffer = await client.decryptFile(message);
        const extension = message.mimetype?.split('/')[1] || 'bin';
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