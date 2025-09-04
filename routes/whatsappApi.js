// routes/whatsappApi.js

const express = require('express');
const { MessageMedia } = require('whatsapp-web.js'); // Necessário para MessageMedia.fromUrl
const { getWhatsAppClient, isConnected, startWhatsAppClient, resetWhatsAppSession } = require('../whatsapp/client');
const { QR_SERVICE_URL } = require('../config');

/**
 * @file Define os endpoints da API para interação com o bot do WhatsApp.
 * Gerencia o envio de mensagens, controle de estado do chat e ações de sessão.
 */

const router = express.Router();

/** 
 * Middleware para verificar se o bot está conectado antes de processar requisições que dependem dele.
 * @param {object} req - Objeto de requisição do Express.
 * @param {object} res - Objeto de resposta do Express.
 * @param {function} next - Função para passar para o próximo middleware.
 */
function checkBotConnection(req, res, next) {
    if (!isConnected()) {
        console.warn(`⚠️ Tentativa de ${req.path}, mas o bot não está conectado.`);
        return res.status(500).json({ error: 'Bot não está conectado ao WhatsApp. Tente novamente mais tarde.' });
    }
    next(); // Procede para o próximo handler se conectado
}

// --- Endpoints HTTP do Bot ---

/**
 * Endpoint para reset manual da sessão.
 * Este endpoint irá destruir a sessão atual e apagar seus arquivos,
 * forçando o bot a gerar um novo QR Code na próxima inicialização.
 * POST /reset-session
 */
router.post('/reset-session', async (req, res) => {
    console.log('🔄 Requisição de reset de sessão recebida no bot.');
    try {
        await resetWhatsAppSession(); // Chama a função que resetará a sessão

        // 4. Enviar a resposta de sucesso
        res.status(200).json({ message: 'Sessão do bot resetada e arquivos removidos. O bot tentará se reconectar e gerará um novo QR Code.' });
        console.log('✅ Resposta de reset enviada.');

        // 5. Iniciar o cliente NOVAMENTE para forçar um novo QR Code.
        // Pequeno atraso para garantir que a resposta HTTP foi enviada
        setTimeout(() => {
            console.log('🚀 Iniciando novamente o cliente WhatsApp Web para gerar novo QR.');
            startWhatsAppClient(); // Chama a função que inicializa o client
        }, 1000);

    } catch (err) {
        console.error('❌ Erro inesperado ao resetar sessão manualmente:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro interno ao tentar resetar sessão.', details: err.message });
        }
    }
});

/**
 * Endpoint para o microserviço solicitar um QR Code.
 * Útil para sincronização na inicialização ou após falhas.
 * POST /api/request-qr
 */
router.post('/api/request-qr', async (req, res) => {
    console.log('🔄 Solicitação de QR code recebida do microserviço.');
    const client = getWhatsAppClient(); // Obtém a instância do cliente
    // Se o cliente não estiver conectado ou estiver inicializando, force uma nova inicialização
    if (!client || !client.info || client.info.status !== 'CONNECTED') {
        console.log('Bot não conectado ou inicializado. Forçando inicialização para gerar QR.');
        startWhatsAppClient(); // Tenta iniciar/re-inicializar o cliente
        res.status(200).send('Bot instruído a iniciar/gerar QR.');
    } else {
        console.log('Bot já conectado, não é necessário gerar QR.');
        res.status(200).send('Bot já conectado.');
    }
});

// --- Endpoints para Controle de Estado do Chat (Digitando/Gravando/Limpar) ---

/**
 * Endpoint para definir o estado de "digitando" para um contato/chat.
 * POST /api/set-typing-state
 * @param {string} to - O ID do chat (ex: '55119XXXXXXXX@c.us').
 */
router.post('/api/set-typing-state', checkBotConnection, async (req, res) => {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Parâmetro "to" é obrigatório.' });

    const client = getWhatsAppClient();
    try {
        const chat = await client.getChatById(to);
        if (chat) {
            await chat.sendStateTyping();
            console.log(`💬 Definido estado 'digitando' para: ${to}`);
            res.status(200).json({ success: true, message: 'Estado de digitação definido.' });
        } else {
            console.warn(`⚠️ Chat não encontrado para o ID: ${to}. Não foi possível definir o estado de digitação.`);
            res.status(404).json({ success: false, error: 'Chat não encontrado.' });
        }
    } catch (error) {
        console.error(`❌ Erro ao definir estado 'digitando' para ${to}:`, error.message);
        res.status(500).json({ success: false, error: 'Falha ao definir estado de digitação.', details: error.message });
    }
});

/**
 * Endpoint para definir o estado de "gravando áudio" para um contato/chat.
 * POST /api/set-recording-state
 * @param {string} to - O ID do chat (ex: '55119XXXXXXXX@c.us').
 */
router.post('/api/set-recording-state', checkBotConnection, async (req, res) => {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Parâmetro "to" é obrigatório.' });

    const client = getWhatsAppClient();
    try {
        const chat = await client.getChatById(to);
        if (chat) {
            await chat.sendStateRecording();
            console.log(`🎤 Definido estado 'gravando' para: ${to}`);
            res.status(200).json({ success: true, message: 'Estado de gravação definido.' });
        } else {
            console.warn(`⚠️ Chat não encontrado para o ID: ${to}. Não foi possível definir o estado de gravação.`);
            res.status(404).json({ success: false, error: 'Chat não encontrado.' });
        }
    } catch (error) {
        console.error(`❌ Erro ao definir estado 'gravando' para ${to}:`, error.message);
        res.status(500).json({ success: false, error: 'Falha ao definir estado de gravação.', details: error.message });
    }
});

/**
 * Endpoint para limpar o estado de "digitando" ou "gravando" para um contato/chat.
 * POST /api/clear-chat-state
 * @param {string} to - O ID do chat (ex: '55119XXXXXXXX@c.us').
 */
router.post('/api/clear-chat-state', checkBotConnection, async (req, res) => {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Parâmetro "to" é obrigatório.' });

    const client = getWhatsAppClient();
    try {
        const chat = await client.getChatById(to);
        if (chat) {
            await chat.clearState();
            console.log(`❌ Estado de chat limpo para: ${to}`);
            res.status(200).json({ success: true, message: 'Estado de chat limpo.' });
        } else {
            console.warn(`⚠️ Chat não encontrado para o ID: ${to}. Não foi possível limpar o estado do chat.`);
            res.status(404).json({ success: false, error: 'Chat não encontrado.' });
        }
    } catch (error) {
        console.error(`❌ Erro ao limpar estado de chat para ${to}:`, error.message);
        res.status(500).json({ success: false, error: 'Falha ao limpar estado de chat.', details: error.message });
    }
});

/**
 * Endpoint para enviar mensagens de WhatsApp (texto ou mídia).
 * POST /api/send-whatsapp-message
 * @param {string} to - O número de destino (ex: '55119XXXXXXXX@c.us').
 * @param {string} [message] - O texto da mensagem (obrigatório se não houver mídia).
 * @param {string} [mediaType] - Tipo da mídia (image, video, document, audio, ptt).
 * @param {string} [mediaUrl] - URL da mídia a ser enviada (obrigatório se houver mídia).
 * @param {string} [caption] - Legenda para a mídia.
 * @param {string} [filename] - Nome do arquivo para documentos.
 */
router.post('/api/send-whatsapp-message', checkBotConnection, async (req, res) => {
    const { to, message, mediaType, mediaUrl, caption, filename } = req.body;

    if (!to) {
        return res.status(400).json({ error: 'Parâmetro "to" é obrigatório.' });
    }
    // Verifica se pelo menos uma mensagem de texto ou mídia foi fornecida
    if (!message && (!mediaType || !mediaUrl)) {
        return res.status(400).json({ error: 'Nenhuma mensagem de texto ou mídia fornecida para enviar.' });
    }

    const client = getWhatsAppClient();
    try {
        if (mediaType && mediaUrl) {
            // Validação básica da URL para mitigar SSRF (Server-Side Request Forgery)
            // Em um ambiente de produção, considere uma validação mais robusta e uma lista de permissões.
            if (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')) {
                return res.status(400).json({ error: 'URL de mídia inválida. Deve começar com http:// ou https://' });
            }

            const media = await MessageMedia.fromUrl(mediaUrl);
            let options = {};
            if (caption) options.caption = caption;
            if (filename) options.filename = filename;

            switch (mediaType) {
                case 'image':
                case 'video':
                case 'document':
                    await client.sendMessage(to, media, options);
                    console.log(`✅ ${mediaType} enviado para ${to} da URL: ${mediaUrl}`);
                    break;
                case 'audio':
                case 'ptt':
                    options.sendAudioAsVoice = true; // Envia áudio como gravação de voz
                    await client.sendMessage(to, media, options);
                    console.log(`✅ Áudio (PTT) enviado para ${to} da URL: ${mediaUrl}`);
                    break;
                default:
                    console.warn(`⚠️ Tipo de mídia desconhecido: ${mediaType}. Tentando enviar como mensagem de texto.`);
                    if (message) {
                        await client.sendMessage(to, message);
                        console.log(`✅ Mensagem de texto enviada para ${to}: ${message}`);
                    } else {
                        // Se o tipo de mídia é desconhecido e não há mensagem de texto, retorna erro.
                        return res.status(400).json({ error: 'Tipo de mídia não suportado e nenhuma mensagem de texto fornecida.' });
                    }
            }
        } else if (message) {
            // Envio de mensagem de texto simples
            await client.sendMessage(to, message);
            console.log(`✅ Mensagem de texto enviada para ${to}: ${message}`);
        }

        res.status(200).json({ success: true, message: 'Mensagem enviada com sucesso.' });
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem para ${to}:`, error.message);
        // Verifica se o erro é devido a um chat não encontrado ou ID inválido
        if (error.message.includes('No chat found')) {
            res.status(404).json({ success: false, error: 'Chat de destino não encontrado ou inválido.', details: error.message });
        } else {
            res.status(500).json({ success: false, error: 'Falha ao enviar mensagem.', details: error.message });
        }
    }
});

module.exports = router;
