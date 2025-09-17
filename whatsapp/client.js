// whatsapp/client.js

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs').promises; // Usando a versão de Promises do módulo 'fs'
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { CLIENT_ID, SESSION_DIR, CLIENT_SESSION_DIR, QR_SERVICE_URL, N8N_WEBHOOK_URL, N8N_HUMAN_TAKEOVER_WEBHOOK_URL, PUBLIC_URL, MEDIA_DIR } = require('../config');
const { pathExists } = require('../utils/fsUtils'); // Importa a função utilitária

/**
 * @file Gerencia a inicialização, eventos e estado do cliente WhatsApp-web.js. 
 * Centraliza toda a lógica de interação com a biblioteca do WhatsApp.
 */

let client; // Variável para a instância do cliente WhatsApp
let isBotInitializing = false; // Flag para evitar inicializações múltiplas
let isClientConnected = false; // Flag de status de conexão do bot

/**
 * Obtém a instância global do cliente WhatsApp.
 * @returns {Client|null} A instância do cliente WhatsApp ou null se não estiver inicializado.
 */
function getWhatsAppClient() {
    return client;
}

/**
 * Retorna o status de conexão atual do bot.
 * @returns {boolean} Verdadeiro se o bot estiver conectado ao WhatsApp, falso caso contrário.
 */
function isConnected() {
    return isClientConnected;
}

/**
 * Inicializa o cliente WhatsApp Web JS.
 * Esta função deve ser chamada apenas uma vez ou após um `client.destroy()`.
 * Lida com a criação do cliente, configuração do Puppeteer e registro de eventos.
 * @async
 * @function startWhatsAppClient
 * @returns {Promise<void>} Uma promessa que resolve quando a inicialização é iniciada.
 */
async function startWhatsAppClient() {
    // Evita inicializações múltiplas se já estiver inicializando
    if (isBotInitializing) {
        console.log('🟡 Bot já está em processo de inicialização. Ignorando nova chamada.');
        return;
    }

    isBotInitializing = true;
    isClientConnected = false; // Resetar o status ao iniciar

    console.log('🟢 Inicializando cliente WhatsApp Web...');
    client = new Client({
        // Usa LocalAuth com o CLIENT_ID fixo e o dataPath apontando para a raiz do volume
        authStrategy: new LocalAuth({ clientId: CLIENT_ID, dataPath: SESSION_DIR }),

        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },

        puppeteer: {
            headless: true, // Modo headless (sem interface gráfica)
            args: [
                '--no-sandbox', // Essencial para ambientes Docker
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Útil em ambientes Docker com memória limitada
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process' // Útil para economia de recursos
            ],
            // userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
            // Opcional: Especificar o caminho do userDataDir explicitamente pode ajudar
            // Isso força o Puppeteer a usar a pasta exata do CLIENT_SESSION_DIR
            userDataDir: CLIENT_SESSION_DIR
        }
    });

    // --- Configuração de Eventos do Cliente WhatsApp ---

    // Evento 'qr': Gerado quando um novo QR code é necessário para autenticação.
    client.on('qr', async (qr) => {
        qrcode.generate(qr, { small: true }); // Exibe o QR no terminal
        console.log('📱 QR code gerado. Escaneie com o WhatsApp.');
        isClientConnected = false; // Não conectado ainda

        try {
            // Envia o QR code para o microserviço de visualização
            await axios.post(`${QR_SERVICE_URL}/api/qr`, { qr });
            console.log('✅ QR code enviado ao microserviço.');
        } catch (error) {
            console.error('❌ Falha ao enviar QR code ao microserviço:', error.message);
        }
    });

    // Evento 'ready': Disparado quando o cliente está pronto e autenticado.
    client.on('ready', async () => {
        console.log('✅ Cliente conectado ao WhatsApp!');
        isBotInitializing = false; // Resetar flag após conexão bem-sucedida
        isClientConnected = true; // Definir como TRUE!

        try {
            // Notifica o microserviço sobre a conexão bem-sucedida
            await axios.post(`${QR_SERVICE_URL}/api/connected`);
            console.log(`✅ Status de conexão enviado ao microserviço. Status = ${client.info.status}`);
        } catch (error) {
            console.error('❌ Erro ao atualizar status de conexão no microserviço:', error.message);
        }
    });

    // Evento 'message_create': Disparado para QUALQUER nova mensagem (recebida ou enviada).

    client.on('message_create', async message => {

        // Mantido: Log de debug detalhado para cada mensagem processada
        console.log('--- NOVA MENSAGEM CRIADA (message_create) ---');
        console.log(JSON.stringify(message, null, 2));
        console.log('-------------------------------------------');

        // Mantido: Ignora mensagens de status e mensagens de grupo
        if (message.isStatus || message.isGroupMsg) return;

        try {
            const chat = await message.getChat();
            const contact = await message.getContact();
            const botInfo = client.info;

            // Mantido: Inicializa o payload com informações comuns, simulando a estrutura da API do WhatsApp Business
            console.log('DEBUG: Inicializa o payload para n8n...');
            const payload = {
                // Mantido: Informações do bot (simulando algumas variáveis da API do WhatsApp Business)
                phone_number_id: botInfo.wid.user, // O ID do número do bot
                display_phone_number: botInfo.pushname || botInfo.wid.user, // Nome do perfil do bot ou ID

                // Mantido: Informações do remetente
                from: message.from.split('@')[0], // Número de telefone do remetente. Remove o "@c.us" do final
                
                // Adicionado: Informação do destinatário, crucial para mensagens 'fromMe'
                to: message.to.split('@')[0], 
                
                contacts: {
                    profile: {
                        name: contact.pushname || contact.name // Nome do contato no WhatsApp
                    }
                },
                is_group: chat.isGroup,

                // Adicionado: Campo 'from_me' explícito para facilitar a lógica no n8n
                from_me: message.fromMe, 

                // Mantido: Informações da mensagem
                message_id: message.id.id, // ID único da mensagem
                timestamp: message.timestamp, // Carimbo de data/hora da mensagem
                message_type: message.type, // Tipo da mensagem (text, image, video, audio, document, sticker, location, etc.)

                // Mantido: Objetos para conteúdo específico, inicializados vazios
                text: {},
                audio: {},
                video: {},
                image: {},
                document: {},
            };

            // Mantido: Processamento da mídia (lógica 100% preservada)
            if (message.hasMedia) {
                const media = await message.downloadMedia();

                if (media) {
                    const extension = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
                    const filename = `${Date.now()}-${uuidv4()}.${extension}`;
                    const fullPath = path.join(MEDIA_DIR, filename);
                    await fs.writeFile(fullPath, Buffer.from(media.data, 'base64'));
                    console.log(`💾 Mídia salva localmente: ${fullPath}`);
                    const mediaUrl = `${PUBLIC_URL}/media/${filename}`;

                    switch (message.type) {
                        case 'audio':
                        case 'ptt':
                            payload.audio = { mime_type: media.mimetype, filename: message._data?.filename || filename, url: mediaUrl };
                            break;
                        case 'image':
                            payload.image = { mime_type: media.mimetype, filename: message.caption || message._data?.filename || filename, url: mediaUrl };
                            break;
                        case 'video':
                            payload.video = { mime_type: media.mimetype, filename: message.caption || message._data?.filename || filename, url: mediaUrl };
                            break;
                        case 'document':
                            payload.document = { mime_type: media.mimetype, filename: message.filename || message._data?.filename || filename, url: mediaUrl };
                            break;
                        default:
                            payload.other_media = { mime_type: media.mimetype, filename: message._data?.filename || filename, url: mediaUrl };
                            console.log(`⚠️ Tipo de mídia não tratado especificamente: ${message.type}`);
                            break;
                    }
                }
            } else if (message.type === 'text' || message.type === 'chat') { // Mantido: Lógica corrigida para texto
                payload.text.body = message.body;
            } else {
                // Mantido: Para tipos de mensagem não reconhecidos ou sem mídia
                payload.unknown_message_data = message;
                console.log(`⚠️ Tipo de mensagem não tratado: ${message.type}`);
            }

            // Mantido: Lógica de roteamento para o webhook correto
            if (message.fromMe) {
                // Se a mensagem veio do nosso número (agente humano), chame o webhook de controle
                try {
                    console.log('DEBUG: Mensagem de agente humano detectada. Enviando para o webhook de controle...');
                    await axios.post(N8N_HUMAN_TAKEOVER_WEBHOOK_URL, payload);
                    console.log('DEBUG: Payload de agente humano enviado para n8n com sucesso.');
                } catch (error) {
                    console.error('DEBUG: Erro ao enviar payload de agente humano para n8n:', error.message);
                }
            } else {
                // Se a mensagem veio de um lead, chame o webhook principal
                try {
                    console.log('DEBUG: Mensagem de lead detectada. Enviando para o webhook principal...');
                    await axios.post(N8N_WEBHOOK_URL, payload);
                    console.log('DEBUG: Payload de lead enviado para n8n com sucesso.');
                } catch (error) {
                    console.error('DEBUG: Erro ao enviar payload de lead para n8n:', error.message);
                }
            }

        } catch (error) {
            // Mantido: Tratamento de erro geral
            console.error('❌ Erro no processamento de "message_create":', error.message);
        }
    });



    // Evento 'auth_failure': Disparado quando a autenticação falha.
    client.on('auth_failure', async (msg) => {
        console.error('🔐 Falha de autenticação:', msg);
        console.error('Reinicializando sessão após falha de autenticação...');
        isBotInitializing = false; // Permitir nova inicialização
        isClientConnected = false; // Não conectado
        
        // Destrói o cliente atual para limpar o estado interno
        if (client && client.pupBrowser) {
            await client.destroy();
            console.log('✅ Cliente destruído após falha de autenticação.');
        } else {
            console.log('ℹ️ Cliente já estava fechado ou não tinha navegador para destruir após falha de autenticação.');
        }

        // Tenta iniciar novamente, possivelmente gerando novo QR
        startWhatsAppClient();
    });

    // Evento 'disconnected': Disparado quando o cliente é desconectado.
    client.on('disconnected', async (reason) => {
        console.warn(`⚠️ Cliente desconectado: ${reason}`);
        isBotInitializing = false; // Permitir nova inicialização
        isClientConnected = false; // Não conectado

        // Destrói o cliente para garantir que todos os recursos sejam liberados
        if (client && client.pupBrowser) {
            await client.destroy();
            console.log('✅ Cliente destruído após desconexão.');
        } else {
            console.log('ℹ️ Cliente já estava fechado ou não tinha navegador para destruir.');
        }
        
        // Tenta iniciar novamente para reconectar
        startWhatsAppClient();
    });

    // Evento 'change_state': Disparado quando o estado interno do cliente muda.
    client.on('change_state', state => {
        console.log('🔄 Estado do cliente WhatsApp-web.js mudou para:', state);
        // Atualiza a flag de conexão com base nos estados relevantes
        isClientConnected = (state === 'CONNECTED');
    });

    // Inicia o processo de inicialização do cliente
    client.initialize();
}

/**
 * Destrói a sessão atual do cliente WhatsApp e remove os arquivos de sessão.
 * @async
 * @function resetWhatsAppSession
 * @returns {Promise<void>}
 */
async function resetWhatsAppSession() {
    console.log('🔄 Resetando sessão do bot...');
    try {
        // 1. Destruir o cliente WhatsApp Web JS se ele estiver ativo
        if (client && client.pupBrowser) {
            console.log('🔌 Tentando destruir o cliente WhatsApp Web.');
            await client.destroy();
            console.log('✅ Cliente WhatsApp Web destruído.');
        } else {
            console.log('ℹ️ Cliente WhatsApp Web não estava ativo para destruir.');
        }

        // 2. Apagar os arquivos da sessão persistida para forçar um novo QR Code
        if (await pathExists(CLIENT_SESSION_DIR)) {
            console.log(`🧹 Removendo arquivos de sessão de: ${CLIENT_SESSION_DIR}`);
            await fs.rm(CLIENT_SESSION_DIR, { recursive: true, force: true });
            console.log('✅ Arquivos de sessão removidos.');
        } else {
            console.log('ℹ️ Diretório de sessão não encontrado para remover.');
        }

        // 3. Resetar a flag de inicialização para permitir um novo start
        isBotInitializing = false;
        isClientConnected = false;

        console.log('✅ Sessão do bot resetada e arquivos removidos.');

    } catch (err) {
        console.error('❌ Erro inesperado ao resetar sessão:', err);
        throw err; // Re-lança o erro para ser tratado pelo chamador
    }
}

module.exports = {
    startWhatsAppClient,
    getWhatsAppClient,
    isConnected,
    resetWhatsAppSession
};
