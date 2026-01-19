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

/** * Middleware para verificar se o bot está conectado antes de processar requisições que dependem dele.
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
 * Endpoint para enviar mensagens de WhatsApp (texto ou mídia) - VERSÃO BLINDADA
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
    const client = getWhatsAppClient();

    // Validação básica de entrada
    if (!to) {
        return res.status(400).json({ error: 'Parâmetro "to" é obrigatório.' });
    }
    if (!message && (!mediaType || !mediaUrl)) {
        return res.status(400).json({ error: 'Nenhuma mensagem de texto ou mídia fornecida para enviar.' });
    }

    try {
        console.log(`📨 [API] Tentando enviar mensagem para: ${to}`);

        // --- 1. SANITIZAÇÃO E NORMALIZAÇÃO DE NÚMERO ---
        // Remove caracteres não numéricos para evitar erros de formatação
        let cleanNumber = to.replace(/\D/g, '');
        // Adiciona o sufixo @c.us se não houver @ (assume envio pessoal, não grupo)
        // Se o usuário mandou um ID de grupo (termina em @g.us), mantemos como está.
        let finalId = to.includes('@') ? to : `${cleanNumber}@c.us`;

        // --- 2. VALIDAÇÃO DE REGISTRO (CRUCIAL PARA CORRIGIR ERRO 'markedUnread') ---
        // O erro ocorre porque o objeto Chat não está hidratado na memória.
        // getNumberId força uma consulta ao servidor, o que ajuda a sincronizar o contato.
        try {
            // Só validamos se não for grupo (grupos precisam do ID exato)
            if (!finalId.includes('@g.us')) {
                const verifiedUser = await client.getNumberId(finalId);
                if (verifiedUser) {
                    finalId = verifiedUser._serialized; // Usa o ID oficial retornado pelo WhatsApp
                    console.log(`✅ [API] Número verificado e normalizado: ${finalId}`);
                } else {
                    console.warn(`⚠️ [API] Número não registrado no WhatsApp: ${finalId}. Tentando envio forçado...`);
                }
            }
        } catch (err) {
            console.warn('⚠️ [API] Falha ao verificar registro do número (prosseguindo sem verificação):', err.message);
        }

        // --- 3. PREPARAÇÃO DO CONTEÚDO (MÍDIA OU TEXTO) ---
        let content;
        let options = {};

        // Se houver legenda ou nome de arquivo, adiciona nas opções
        if (caption) options.caption = caption;
        if (filename) options.filename = filename;

        if (mediaType && mediaUrl) {
            // Validação de segurança da URL
            if (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')) {
                return res.status(400).json({ error: 'URL de mídia inválida. Deve começar com http:// ou https://' });
            }

            try {
                console.log(`📥 [API] Baixando mídia de: ${mediaUrl}`);
                const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
                content = media; // O conteúdo principal será o objeto de mídia

                // Ajustes específicos por tipo de mídia
                if (mediaType === 'audio' || mediaType === 'ptt') {
                    options.sendAudioAsVoice = true; // Envia como nota de voz (PTT)
                }
            } catch (mediaError) {
                console.error('❌ [API] Erro ao baixar mídia:', mediaError.message);
                return res.status(400).json({ error: 'Falha ao processar a URL de mídia.', details: mediaError.message });
            }
        } else {
            // Se não for mídia, é texto puro
            content = message;
        }

        // --- 4. ENVIO ROBUSTO (TRY-CATCH DUPLO) ---
        let sentMessage;
        try {
            // TENTATIVA A: Envio Direto (Padrão)
            sentMessage = await client.sendMessage(finalId, content, options);
        } catch (sendError) {
            console.warn(`⚠️ [API] Erro no envio padrão (${sendError.message}). Tentando método alternativo via Chat Object...`);
            
            // TENTATIVA B: Envio via Objeto Chat (Bypass para erro 'markedUnread' e 'undefined')
            // Isso força a biblioteca a instanciar o chat explicitamente antes de enviar.
            const chat = await client.getChatById(finalId);
            sentMessage = await chat.sendMessage(content, options);
        }

        console.log(`🚀 [API] Mensagem enviada com sucesso! ID: ${sentMessage.id.id}`);

        // Resposta de sucesso completa
        return res.status(200).json({
            success: true,
            message: 'Mensagem enviada com sucesso.',
            sentMessage: sentMessage // Retorna o objeto completo para o n8n
        });

    } catch (error) {
        console.error(`❌ [API] ERRO CRÍTICO AO ENVIAR PARA ${to}:`, error.message);
        
        // Tratamento de erros específicos para feedback melhor
        if (error.message && error.message.includes('No chat found')) {
            return res.status(404).json({ success: false, error: 'Chat de destino não encontrado ou inválido.', details: error.message });
        }

        return res.status(500).json({
            success: false,
            error: 'Falha crítica ao enviar mensagem.',
            details: error.message || String(error)
        });
    }
});

module.exports = router;