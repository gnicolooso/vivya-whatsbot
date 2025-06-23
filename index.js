// Carrega variáveis de ambiente do .env
require('dotenv').config({ path: './variaveis.env' });

// Importações de bibliotecas
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Para gerar nomes de arquivos únicos
const cors = require('cors'); // Para lidar com requisições de diferentes origens

const app = express();

// --- Variáveis de Configuração e Constantes ---
// Diretório onde as sessões do whatsapp-web.js serão salvas.
// Montado como volume no Railway: /app/.wwebjs_auth
const SESSION_DIR = '/app/.wwebjs_auth';
// ID fixo para a sessão do bot. É CRUCIAL que este ID não mude entre deploys para persistência.
const CLIENT_ID = "session-bot-principal";
// Caminho completo para o diretório de sessão específico deste cliente.
const CLIENT_SESSION_DIR = path.join(SESSION_DIR, `session-${CLIENT_ID}`);

// URL do microserviço de QR Code (ajuste conforme seu deploy do microserviço)
const QR_SERVICE_URL = process.env.QR_SERVICE_URL || 'https://qr-code-viewer-docker-production.up.railway.app';
// URL do webhook do n8n para processar mensagens (ajuste conforme seu webhook)
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://vivya.app.n8n.cloud/webhook-test/56816120-1928-4e36-9e36-7dfdf5277260';
// URL pública do seu bot (usada para servir mídia)
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:8080';

// --- Configuração CORS (ADICIONADA/MODIFICADA PARA SEGURANÇA E TESTES) ---
app.use(cors({
    origin: QR_SERVICE_URL, // Permita especificamente o seu frontend do microserviço
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Métodos permitidos
    credentials: true, // Se o frontend precisar de cookies/credenciais (geralmente não para este caso)
    optionsSuccessStatus: 204 // Status para preflight OPTIONS
}));
app.use(express.json());

// --- Configuração para servir arquivos estáticos (MUITO IMPORTANTE!) ---
// Isso permite que as URLs como process.env.PUBLIC_URL/media/{filename} funcionem.
const mediaDir = path.join(__dirname, 'tmp', 'media');
app.use('/media', express.static(mediaDir));

// Garante que o diretório de mídia existe na inicialização do servidor
if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
}
console.log(`📂 Servindo arquivos estáticos de: ${mediaDir}`);
// --- Fim da configuração de arquivos estáticos ---

let client; // Variável global para o cliente WhatsApp
let isBotInitializing = false; // Flag para evitar inicializações múltiplas
let isBotReallyConnected = false; 

// Função para garantir que os diretórios existam
function ensureSessionDirectoriesExist() {
    try {
        if (!fs.existsSync(SESSION_DIR)) {
            console.log(`[INIT] Criando diretório de sessão: ${SESSION_DIR}`);
            fs.mkdirSync(SESSION_DIR, { recursive: true });
            console.log(`[INIT] Diretório ${SESSION_DIR} criado.`);
        } else {
            console.log(`[INIT] Diretório de sessão ${SESSION_DIR} já existe.`);
        }

        if (!fs.existsSync(CLIENT_SESSION_DIR)) {
            console.log(`[INIT] Criando diretório específico do cliente: ${CLIENT_SESSION_DIR}`);
            fs.mkdirSync(CLIENT_SESSION_DIR, { recursive: true });
            console.log(`[INIT] Diretório ${CLIENT_SESSION_DIR} criado.`);
        } else {
            console.log(`[INIT] Diretório específico do cliente ${CLIENT_SESSION_DIR} já existe.`);
        }

        // --- INÍCIO: Limpeza de Pastas de Sessão Antigas e Inconsistentes ---
        // Isso é crucial para evitar que o LocalAuth se confunda com múltiplas sessões.
        // Itera sobre o diretório raiz da sessão e remove pastas que não sejam a do CLIENT_ID fixo.
        fs.readdirSync(SESSION_DIR).forEach(file => {
            const fullPath = path.join(SESSION_DIR, file);
            if (file.startsWith('session-') && file !== `session-${CLIENT_ID}`) {
                console.warn(`⚠️ [INIT] Removendo pasta de sessão antiga/inconsistente: ${fullPath}`);
                fs.rmSync(fullPath, { recursive: true, force: true });
            }
            // O diretório 'session' sem clientId também pode ser um resquício.
            if (file === 'session' && fs.statSync(fullPath).isDirectory()) {
                console.warn(`⚠️ [INIT] Removendo diretório 'session' genérico: ${fullPath}`);
                fs.rmSync(fullPath, { recursive: true, force: true });
            }
        });
        // --- FIM: Limpeza de Pastas de Sessão Antigas e Inconsistentes ---

        // Opcional: Para depuração, tente listar o conteúdo via Node.js
        console.log(`[INIT] Conteúdo atual de ${SESSION_DIR}:`);
        fs.readdirSync(SESSION_DIR).forEach(file => {
            console.log(`  - ${file}`);
        });
        console.log(`[INIT] Conteúdo atual de ${CLIENT_SESSION_DIR}:`);
        fs.readdirSync(CLIENT_SESSION_DIR).forEach(file => {
            console.log(`  - ${file}`);
        });

    } catch (error) {
        console.error(`❌ [INIT] Erro ao garantir diretórios de sessão: ${error.message}`);
        process.exit(1); // Interrompe o processo se não conseguir criar os diretórios
    }
}

// Garante que os diretórios de sessão existam e limpa sessões antigas ANTES de iniciar o cliente.
ensureSessionDirectoriesExist();

/**
 * Inicializa o cliente WhatsApp Web JS.
 * Esta função deve ser chamada apenas uma vez ou após um `client.destroy()`.
 */
function startClient() {
    // Evita inicializações múltiplas se já estiver inicializando
    if (isBotInitializing) {
        console.log('🟡 Bot já está em processo de inicialização. Ignorando nova chamada.');
        return;
    }
    isBotInitializing = true;
    isBotReallyConnected = false; // Resetar o status ao iniciar

    console.log('🟢 Inicializando cliente WhatsApp Web...');
    client = new Client({
        // Usa LocalAuth com o CLIENT_ID fixo e o dataPath apontando para a raiz do volume
        authStrategy: new LocalAuth({ clientId: CLIENT_ID, dataPath: SESSION_DIR }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
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

    client.on('qr', async (qr) => {
        qrcode.generate(qr, { small: true });
        console.log('📱 QR code gerado. Escaneie com o WhatsApp.');
        isBotReallyConnected = false; // Não conectado ainda

        try {
            await axios.post(`${QR_SERVICE_URL}/api/qr`, { qr });
            console.log('✅ QR code enviado ao microserviço.');
        } catch (error) {
            console.error('❌ Falha ao enviar QR code ao microserviço:', error.message);
        }
    });

    client.on('ready', async () => {
        console.log('✅ Cliente conectado ao WhatsApp!');
        isBotInitializing = false; // Resetar flag após conexão bem-sucedida
        isBotReallyConnected = true; // Definir como TRUE aqui!
        try {
            await axios.post(`${QR_SERVICE_URL}/api/connected`);
            console.log(`✅ Status de conexão enviado ao microserviço. Status = ${client.info.status}`);
        } catch (error) {
            console.error('❌ Erro ao atualizar status de conexão no microserviço:', error.message);
        }
    });

    client.on('message', async message => {
        if (message.fromMe || message.isStatus || message.isGroupMsg) return;

        try {
            const chat = await message.getChat();
            const contact = await message.getContact();
            const botInfo = client.info; // Informações do cliente/bot

            // Inicializa o payload com informações comuns
            console.log('DEBUG: Inicializa o payload...');
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
                    const extension = media.mimetype.split('/')[1].split(';')[0] || 'bin';
                    const filename = `${Date.now()}-${uuidv4()}.${extension}`; // Nome único do arquivo
                    const fullPath = path.join(mediaDir, filename); // Usa o diretório de mídia global

                    fs.writeFileSync(fullPath, Buffer.from(media.data, 'base64'));
                    console.log(`💾 Mídia salva localmente: ${fullPath}`);

                    const mediaUrl = `${PUBLIC_URL}/media/${filename}`;

                    // Popula o objeto de mídia específico no payload
                    switch (message.type) {
                        case 'audio':
                        case 'ptt': // Push to talk (áudio)
                            payload.audio = {
                                mime_type: media.mimetype,
                                filename: message._data?.filename || filename, // Tenta usar o nome original, fallback para o gerado
                                url: mediaUrl
                            };
                            break;
                        case 'image':
                            payload.image = {
                                mime_type: media.mimetype,
                                filename: message.caption || message._data?.filename || filename, // Legenda, nome original ou gerado
                                url: mediaUrl
                            };
                            break;
                        case 'video':
                            payload.video = {
                                mime_type: media.mimetype,
                                filename: message.caption || message._data?.filename || filename, // Legenda, nome original ou gerado
                                url: mediaUrl
                            };
                            break;
                        case 'document':
                            payload.document = {
                                mime_type: media.mimetype,
                                filename: message.filename || message._data?.filename || filename, // Nome original, ou gerado
                                url: mediaUrl
                            };
                            break;
                        default:
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
                payload.unknown_message_data = message;
                console.log(`⚠️ Tipo de mensagem não tratado: ${message.type}`);
            }

            try {
                console.log('DEBUG: Tentando enviar payload para n8n...');
                await axios.post(N8N_WEBHOOK_URL, payload);
                console.log('DEBUG: Payload enviado para n8n com sucesso.');
            } catch (error) {
                console.error('DEBUG: Erro ao enviar payload para n8n:', error.message);
            }

        } catch (error) {
            console.error('❌ Erro no webhook ou no processamento da mensagem:', error.message);
        }
    });

    client.on('auth_failure', async (msg) => {
        console.error('🔐 Falha de autenticação:', msg);
        console.error('Reinicializando sessão após falha de autenticação...');
        isBotInitializing = false; // Permitir nova inicialização
        isBotReallyConnected = false; // Não conectado
        await client.destroy(); // Destrói o cliente atual
        // Não é necessário remover arquivos de sessão aqui, pois o destroy() é suficiente
        // e queremos que o LocalAuth tente reusar a mesma pasta na próxima inicialização.
        startClient(); // Tenta iniciar novamente, possivelmente gerando novo QR
    });

    client.on('disconnected', async (reason) => {
        console.warn(`⚠️ Cliente desconectado: ${reason}`);
        isBotInitializing = false; // Permitir nova inicialização
        isBotReallyConnected = false; // Não conectado
        if (client && client.pupBrowser) { // Verifica se o navegador ainda está aberto antes de tentar destruir
            await client.destroy();
            console.log('✅ Cliente destruído após desconexão.');
        } else {
            console.log('ℹ️ Cliente já estava fechado ou não tinha navegador para destruir.');
        }
        startClient(); // Tenta iniciar novamente
    });

    // Adicionar um evento de estado para debug
    client.on('change_state', state => {
        console.log('🔄 Estado do cliente WhatsApp-web.js mudou para:', state);
        // Possíveis estados: CONNECTED, DISCONNECTED, INITIALIZING, QRCODE_RECEIVED, AUTHENTICATING,
        // AUTH_FAILURE, LOADING_CHATTS
        if (state === 'CONNECTED') {
            isBotReallyConnected = true;
        } else {
            isBotReallyConnected = false;
        }
    });    

    client.initialize();
}

// Inicia o cliente na inicialização do aplicativo Node.js
startClient();

// --- Funções Auxiliares para Verificar o Status do Cliente ---
// Centraliza a lógica de verificação de conexão
function isClientConnected() {
    // client deve existir e estar conectado
    return isBotReallyConnected && client; 
}

// --- Endpoints HTTP do Bot ---

// Endpoint raiz
app.get('/', (req, res) => {
    res.send('🤖 Bot do WhatsApp está rodando!');
});

/**
 * Endpoint para reset manual da sessão.
 * Este endpoint irá destruir a sessão atual e apagar seus arquivos,
 * forçando o bot a gerar um novo QR Code na próxima inicialização.
 */
app.post('/reset-session', async (req, res) => {
    console.log('🔄 Requisição de reset de sessão recebida no bot.');
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
        if (fs.existsSync(CLIENT_SESSION_DIR)) {
            console.log(`🧹 Removendo arquivos de sessão de: ${CLIENT_SESSION_DIR}`);
            fs.rmSync(CLIENT_SESSION_DIR, { recursive: true, force: true });
            console.log('✅ Arquivos de sessão removidos.');
        } else {
            console.log('ℹ️ Diretório de sessão não encontrado para remover.');
        }

        // 3. Resetar a flag de inicialização para permitir um novo start
        isBotInitializing = false;

        // 4. Enviar a resposta de sucesso
        res.status(200).json({ message: 'Sessão do bot resetada e arquivos removidos. O bot tentará se reconectar e gerará um novo QR Code.' });
        console.log('✅ Resposta de reset enviada ao microserviço.');

        // 5. Iniciar o cliente NOVAMENTE para forçar um novo QR Code.
        // Pequeno atraso para garantir que a resposta HTTP foi enviada
        setTimeout(() => {
            console.log('🚀 Iniciando novamente o cliente WhatsApp Web para gerar novo QR.');
            startClient(); // Chama a função que inicializa o client com o ID fixo
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
 */
app.post('/api/request-qr', async (req, res) => {
    console.log('🔄 Solicitação de QR code recebida do microserviço.');
    // Se o cliente não estiver conectado ou estiver inicializando, force uma nova inicialização
    if (!client || !client.info || client.info.status !== 'CONNECTED') {
        console.log('Bot não conectado ou inicializado. Forçando inicialização para gerar QR.');
        startClient(); // Tenta iniciar/re-inicializar o cliente
        res.status(200).send('Bot instruído a iniciar/gerar QR.');
    } else {
        console.log('Bot já conectado, não é necessário gerar QR.');
        res.status(200).send('Bot já conectado.');
    }
});

// --- Endpoints para Controle de Estado do Chat (Digitando/Gravando/Limpar) ---

app.post('/api/set-typing-state', async (req, res) => {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Parâmetro "to" é obrigatório.' });

    if (!isClientConnected()) { 
        console.warn(`⚠️ Tentativa de definir estado de digitação para ${to}, mas o bot não está conectado. isBotReallyConnected: ${isBotReallyConnected}. client.info.status: ${client?.info?.status || 'N/A'}`);
        return res.status(500).json({ error: 'Bot não está conectado ao WhatsApp. Tente novamente mais tarde.' });
    }

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

app.post('/api/set-recording-state', async (req, res) =>  {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Parâmetro "to" é obrigatório.' });
    if (!isClientConnected()) { 
        console.warn(`⚠️ Tentativa de definir estado de digitação para ${to}, mas o bot não está conectado. isBotReallyConnected: ${isBotReallyConnected}. client.info.status: ${client?.info?.status || 'N/A'}`);
        return res.status(500).json({ error: 'Bot não está conectado ao WhatsApp. Tente novamente mais tarde.' });
    }
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

app.post('/api/clear-chat-state', async (req, res) => {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Parâmetro "to" é obrigatório.' });
    if (!isClientConnected()) { 
        console.warn(`⚠️ Tentativa de definir estado de digitação para ${to}, mas o bot não está conectado. isBotReallyConnected: ${isBotReallyConnected}. client.info.status: ${client?.info?.status || 'N/A'}`);
        return res.status(500).json({ error: 'Bot não está conectado ao WhatsApp. Tente novamente mais tarde.' });
    }
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
 * Recebe 'to', 'message' (para texto) e/ou 'mediaType', 'mediaUrl', 'caption', 'filename' (para mídia).
 */
app.post('/api/send-whatsapp-message', async (req, res) => {
    const { to, message, mediaType, mediaUrl, caption, filename } = req.body;

    if (!to) {
        return res.status(400).json({ error: 'Parâmetro "to" é obrigatório.' });
    }
    if (!client || !client.info || client.info.status !== 'CONNECTED') {
        console.error('❌ Cliente WhatsApp não está pronto ou conectado para enviar mensagem.');
        return res.status(500).json({ error: 'Bot não está conectado ao WhatsApp.' });
    }

    try {
        if (mediaType && mediaUrl) {
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
                        return res.status(400).json({ error: 'Tipo de mídia não suportado e nenhuma mensagem de texto fornecida.' });
                    }
            }
        } else if (message) {
            await client.sendMessage(to, message);
            console.log(`✅ Mensagem de texto enviada para ${to}: ${message}`);
        } else {
            return res.status(400).json({ error: 'Nenhuma mensagem de texto ou mídia fornecida para enviar.' });
        }

        res.status(200).json({ success: true, message: 'Mensagem enviada com sucesso.' });
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem para ${to}:`, error.message);
        res.status(500).json({ success: false, error: 'Falha ao enviar mensagem.', details: error.message });
    }
});


console.log('🟡 Tentando iniciar servidor Express...');
// Inicializa servidor na porta correta
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

// Captura falhas não tratadas
process.on('unhandledRejection', (reason, p) => {
    console.error('🚨 Erro não tratado (Promise Rejection):', reason);
});

process.on('uncaughtException', (err) => {
    console.error('🚨 Exceção não capturada:', err);
    process.exit(1); // É uma boa prática sair para permitir que o Railway reinicie o app
});