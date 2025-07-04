// whatsapp/client.js

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs').promises; // Usando a versão de Promises do módulo 'fs'
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { CLIENT_ID, SESSION_DIR, CLIENT_SESSION_DIR, QR_SERVICE_URL, N8N_WEBHOOK_URL, PUBLIC_URL, MEDIA_DIR } = require('../config');
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

    // Evento 'message': Disparado ao receber uma nova mensagem.
    client.on('message', async message => {
        // Ignora mensagens enviadas pelo próprio bot, mensagens de status e mensagens de grupo
        if (message.fromMe || message.isStatus || message.isGroupMsg) return;

        try {
            const chat = await message.getChat();
            const contact = await message.getContact();
            const botInfo = client.info; // Informações do cliente/bot

            // Inicializa o payload com informações comuns, simulando a estrutura da API do WhatsApp Business
            console.log('DEBUG: Inicializa o payload para n8n...');
            const payload = {
                // Informações do bot (simulando algumas variáveis da API do WhatsApp Business)
                phone_number_id: botInfo.wid.user, // O ID do número do bot
                display_phone_number: botInfo.pushname || botInfo.wid.user, // Nome do perfil do bot ou ID

                // Informações do remetente
                from: message.from.split('@')[0], // Número de telefone do remetente. Remove o "@c.us" do final
                contacts: {
                    profile: {
                        name: contact.pushname || contact.name // Nome do contato no WhatsApp
                    }
                },
                is_group: chat.isGroup,

                // Informações da mensagem
                message_id: message.id.id, // ID único da mensagem
                timestamp: message.timestamp, // Carimbo de data/hora da mensagem
                message_type: message.type, // Tipo da mensagem (text, image, video, audio, document, sticker, location, etc.)

                // Objetos para conteúdo específico, inicializados vazios
                text: {},
                audio: {},
                video: {},
                image: {},
                document: {},
            };

            // Processamento da mídia
            if (message.hasMedia) {
                const media = await message.downloadMedia();

                if (media) {
                    // Determina a extensão do arquivo a partir do mimetype ou usa 'bin' como fallback
                    const extension = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
                    // Gera um nome de arquivo único para evitar colisões
                    const filename = `${Date.now()}-${uuidv4()}.${extension}`;
                    // Constrói o caminho completo para salvar a mídia
                    const fullPath = path.join(MEDIA_DIR, filename);

                    // Salva a mídia localmente usando fs.promises.writeFile (assíncrono)
                    await fs.writeFile(fullPath, Buffer.from(media.data, 'base64'));
                    console.log(`💾 Mídia salva localmente: ${fullPath}`);

                    // Constrói a URL pública da mídia para ser enviada ao webhook
                    const mediaUrl = `${PUBLIC_URL}/media/${filename}`;

                    // Popula o objeto de mídia específico no payload com base no tipo de mensagem
                    switch (message.type) {
                        case 'audio':
                        case 'ptt': // Push to talk (áudio)
                            payload.audio = {
                                mime_type: media.mimetype,
                                // Tenta usar o nome original do arquivo, fallback para o gerado
                                filename: message._data?.filename || filename,
                                url: mediaUrl
                            };
                            break;
                        case 'image':
                            payload.image = {
                                mime_type: media.mimetype,
                                // Legenda, nome original ou gerado
                                filename: message.caption || message._data?.filename || filename,
                                url: mediaUrl
                            };
                            break;
                        case 'video':
                            payload.video = {
                                mime_type: media.mimetype,
                                // Legenda, nome original ou gerado
                                filename: message.caption || message._data?.filename || filename,
                                url: mediaUrl
                            };
                            break;
                        case 'document':
                            payload.document = {
                                mime_type: media.mimetype,
                                // Nome original ou gerado
                                filename: message.filename || message._data?.filename || filename,
                                url: mediaUrl
                            };
                            break;
                        default:
                            // Para outros tipos de mídia não tratados especificamente
                            payload.other_media = {
                                mime_type: media.mimetype,
                                filename: message._data?.filename || filename,
                                url: mediaUrl
                            };
                            console.log(`⚠️ Tipo de mídia não tratado especificamente: ${message.type}`);
                            break;
                    }
                }
            } else if (message.type === 'chat') { // Mensagem de texto simples
                payload.text.body = message.body;
            } else {
                // Para tipos de mensagem não reconhecidos ou sem mídia
                payload.unknown_message_data = message;
                console.log(`⚠️ Tipo de mensagem não tratado: ${message.type}`);
            }

            try {
                // Envia o payload da mensagem para o webhook do n8n
                console.log('DEBUG: Tentando enviar payload para n8n...');
                await axios.post(N8N_WEBHOOK_URL, payload);
                console.log('DEBUG: Payload enviado para n8n com sucesso.');
            } catch (error) {
                console.error('DEBUG: Erro ao enviar payload para n8n:', error.message);
                // Considere um mecanismo de retry ou fila de mensagens aqui para maior robustez
            }

        } catch (error) {
            console.error('❌ Erro no processamento da mensagem:', error.message);
            // Loga o erro, mas não encerra o processo para não perder outras mensagens
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
