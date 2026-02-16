// routes/whatsappApi.js     

const express = require('express');
const axios = require('axios');
const { getClient, isBotConnected, startWppClient, resetSession } = require('../whatsapp/wppClient');

const router = express.Router();

function checkBotConnection(req, res, next) {
    if (!isBotConnected()) {
        return res.status(500).json({ error: 'Bot não está conectado ao WhatsApp.' });
    }
    next();
}

/*
|--------------------------------------------------------------------------
| RESET SESSION
|--------------------------------------------------------------------------
*/

router.post('/reset-session', async (req, res) => {
    try {
        await resetSession();

        res.status(200).json({
            message: 'Sessão resetada. Novo QR será gerado.'
        });

        setTimeout(() => {
            startWppClient();
        }, 1500);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/*
|--------------------------------------------------------------------------
| REQUEST QR
|--------------------------------------------------------------------------
*/

router.post('/api/request-qr', async (req, res) => {
    if (!isBotConnected()) {
        startWppClient();
        return res.status(200).send('Inicializando para gerar QR.');
    }

    return res.status(200).send('Bot já conectado.');
});

/*
|--------------------------------------------------------------------------
| TYPING STATE
|--------------------------------------------------------------------------
*/

router.post('/api/set-typing-state', checkBotConnection, async (req, res) => {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: '"to" é obrigatório.' });

    const client = getClient();
    await client.startTyping(to);
    return res.json({ success: true });
});

router.post('/api/clear-chat-state', checkBotConnection, async (req, res) => {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: '"to" é obrigatório.' });

    const client = getClient();
    await client.stopTyping(to);
    return res.json({ success: true });
});

/*
|--------------------------------------------------------------------------
| SEND MESSAGE (VERSÃO LIMPA E ESTÁVEL)
|--------------------------------------------------------------------------
*/

router.post('/api/send-whatsapp-message', checkBotConnection, async (req, res) => {

    const { to, message, mediaType, mediaUrl, caption, filename } = req.body;
    const client = getClient();

    if (!to) {
        return res.status(400).json({ error: '"to" é obrigatório.' });
    }

    if (!message && (!mediaType || !mediaUrl)) {
        return res.status(400).json({ error: 'Nenhuma mensagem ou mídia fornecida.' });
    }

    try {

        let cleanNumber = to.replace(/\D/g, '');
        let finalId = to.includes('@') ? to : `${cleanNumber}@c.us`;

        /*
        |--------------------------------------------------------------------------
        | TEXTO
        |--------------------------------------------------------------------------
        */

        if (!mediaType) {
            await client.sendText(finalId, message);

            return res.json({
                success: true,
                message: 'Mensagem enviada com sucesso.'
            });
        }

        /*
        |--------------------------------------------------------------------------
        | MÍDIA
        |--------------------------------------------------------------------------
        */

        if (!mediaUrl.startsWith('http')) {
            return res.status(400).json({ error: 'mediaUrl inválida.' });
        }

        switch (mediaType) {

            case 'image':
                await client.sendImage(finalId, mediaUrl, filename || 'image.jpg', caption || '');
                break;

            case 'video':
                await client.sendFile(finalId, mediaUrl, filename || 'video.mp4', caption || '');
                break;

            case 'document':
                await client.sendFile(finalId, mediaUrl, filename || 'document.pdf', caption || '');
                break;

            case 'audio':
            case 'ptt':
                await client.sendPtt(finalId, mediaUrl);
                break;

            default:
                return res.status(400).json({ error: 'Tipo de mídia inválido.' });
        }

        return res.json({
            success: true,
            message: 'Mídia enviada com sucesso.'
        });

    } catch (error) {

        console.error('Erro envio:', error.message);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
