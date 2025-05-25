require('dotenv').config({ path: './variaveis.env' });
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express'); // Importar express
const fs = require('fs');  // Importar fs
const path = require('path'); // Importar path
const { v4: uuidv4 } = require('uuid'); // Importar uuidv4
const cors = require('cors');


const app = express();
// --- Configuração CORS (ADICIONE OU MODIFIQUE ESTA SEÇÃO) ---
app.use(cors({
    origin: 'https://qr-code-viewer-docker-production.up.railway.app' // Permita especificamente o seu frontend
    // Ou, para permitir qualquer origem (menos seguro em produção, mas útil para testes rápidos):
    // origin: '*', 
    // methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Métodos permitidos
    // credentials: true, // Se você precisar de cookies/credenciais
    // optionsSuccessStatus: 204 // Status para preflight OPTIONS
}));
app.use(express.json());

let client;
let currentClientId = "bot-principal"; // Variável para controlar o ID do cliente

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


function startClient() {
    console.log('🟢 Inicializando cliente WhatsApp Web...');
    client = new Client({
        authStrategy: new LocalAuth({ clientId: currentClientId }), // Usa o clientId dinâmico aqui
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', async (qr) => {
        qrcode.generate(qr, { small: true });
        console.log('📱 QR code gerado. Escaneie com o WhatsApp.');

        try {
            await axios.post('https://qr-code-viewer-docker-production.up.railway.app/api/qr', { qr });
            console.log('✅ QR code enviado ao microserviço.');
        } catch (error) {
            console.error('❌ Falha ao enviar QR code:', error.message);
        }
    });

    client.on('ready', async () => {
        console.log('✅ Cliente conectado ao WhatsApp!');
        try {
            await axios.post('https://qr-code-viewer-docker-production.up.railway.app/api/connected');
            console.log('✅ Status de conexão enviado ao microserviço.');
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
            if (message.hasMedia) { // Use message.hasMedia em vez de verificar os tipos manualmente
                const media = await message.downloadMedia();

                if (media) {
                    const extension = media.mimetype.split('/')[1].split(';')[0] || 'bin';
                    const filename = `${Date.now()}-${uuidv4()}.${extension}`; // Nome único do arquivo
                    const fullPath = path.join(mediaDir, filename); // Usa o diretório de mídia global

                    fs.writeFileSync(fullPath, Buffer.from(media.data, 'base64'));
                    console.log(`💾 Mídia salva localmente: ${fullPath}`);

                    const mediaUrl = `${process.env.PUBLIC_URL}/media/${filename}`;

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
                            // Para outros tipos de mídia que você não quer tratar separadamente
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
                // Mensagens sem mídia e não texto (ex: location, contact_card, sticker)
                // Você pode adicionar mais cases aqui ou enviar o objeto message completo
                payload.unknown_message_data = message;
                console.log(`⚠️ Tipo de mensagem não tratado: ${message.type}`);
            }

            // Envia o payload completo para o n8n
            // Produção
            //const response = await axios.post('https://vivya.app.n8n.cloud/webhook/56816120-1928-4e36-9e36-7dfdf5277260', payload);
            // Teste
            //const response = await axios.post('https://vivya.app.n8n.cloud/webhook-test/56816120-1928-4e36-9e36-7dfdf5277260', payload);
            // Envia mensagem e aguarda resposta
            //if (response.data && response.data.reply) {
            //    await client.sendMessage(message.from, response.data.reply);
            //} else {
            //    console.warn('⚠️ Resposta do webhook do n8n não continha "reply".');
            //}

            // Apenas "dispara e esquece" (fire and forget) a chamada para o n8n.
            // É importante que o n8n não retorne um erro HTTP aqui, apenas 200 OK.
            await axios.post('https://vivya.app.n8n.cloud/webhook-test/56816120-1928-4e36-9e36-7dfdf5277260', payload);
            console.log('Payload enviado para n8n com sucesso. Esperando resposta do n8n via webhook.');


        } catch (error) {
            console.error('❌ Erro no webhook ou no processamento da mensagem:', error.message);
            // Considere enviar uma mensagem de erro ou logar mais detalhes
        }
    });

    client.on('auth_failure', async () => {
        console.error('🔐 Falha de autenticação. Reinicializando sessão...');
        await client.destroy();
        startClient();
    });

    client.on('disconnected', async (reason) => {
        console.warn(`⚠️ Cliente desconectado: ${reason}`);
        await client.destroy();
        startClient();
    });

    client.initialize();
}

startClient();

// Endpoint raiz
app.get('/', (req, res) => {
    res.send('🤖 Bot do WhatsApp está rodando!');
});

// Endpoint para reset manual da sessão
app.post('/reset-session', async (req, res) => {
    console.log('🔄 Requisição de reset de sessão recebida no bot.');
    try {
        // 1. Tentar destruir o cliente WhatsApp Web JS se ele estiver ativo
        if (client && client.pupBrowser) { // Verifica se o cliente está ativo e tem um navegador Puppeteer
            console.log('🔌 Tentando destruir o cliente WhatsApp Web.');
            await client.destroy();
            console.log('✅ Cliente WhatsApp Web destruído.');
        } else {
            console.log('ℹ️ Cliente WhatsApp Web não estava ativo para destruir.');
        }

        // 2. Mudar o clientId para forçar uma nova sessão
        currentClientId = `bot-principal-${Date.now()}`; // Usa um timestamp para um ID único
        console.log(`🆕 Novo Client ID para próxima sessão: ${currentClientId}`);

        // 3. Enviar a resposta de sucesso
        // É CRÍTICO enviar a resposta AQUI e APENAS AQUI.
        res.status(200).json({ message: 'Sessão do bot resetada. O bot tentará se reconectar com um novo Client ID.' });
        console.log('✅ Resposta de reset enviada ao microserviço.');

        // 4. Iniciar o cliente NOVAMENTE para forçar um novo QR Code.
        // Envolver em um timeout para garantir que a resposta HTTP foi enviada
        // e que o sistema teve um momento para processar (se aplicável).
        setTimeout(() => {
            console.log('🚀 Iniciando novamente o cliente WhatsApp Web para gerar novo QR.');
            startClient(); // Chama a função que inicializa o client com o novo ID
        }, 1000); // Pequeno atraso para evitar conflitos imediatos

    } catch (err) {
        console.error('❌ Erro inesperado ao resetar sessão manualmente:', err);
        // Em caso de erro na lógica de reset, envia uma resposta de erro
        if (!res.headersSent) { // Verifica se a resposta já não foi enviada
            res.status(500).json({ error: 'Erro interno ao tentar resetar sessão.', details: err.message });
        }
    }
});

app.post('/api/request-qr', async (req, res) => {
    console.log('🔄 Solicitação de QR code recebida do microserviço.');
    if (!client || !client.info) { // Se o cliente não estiver inicializado ou conectado
        console.log('Bot não conectado ou inicializado. Forçando inicialização para gerar QR.');
        // Chamar initialize() novamente, o que deve gerar um QR se não houver sessão válida
        client.initialize(); 
        res.status(200).send('Bot instruído a iniciar/gerar QR.');
    } else if (client.info && client.info.status !== 'CONNECTED') { // Se estiver em algum estado diferente de conectado
        console.log('Bot não está em estado conectado. Forçando inicialização para gerar QR.');
        client.initialize();
        res.status(200).send('Bot instruído a iniciar/gerar QR.');
    }
    else {
        console.log('Bot já conectado, não é necessário gerar QR.');
        res.status(200).send('Bot já conectado.');
    }
});


app.post('/api/send-whatsapp-message', async (req, res) => {
    const { to, message } = req.body;

    if (!to || !message) {
        return res.status(400).json({ error: 'Parâmetros "to" e "message" são obrigatórios.' });
    }

    if (!client || !client.info) {
        console.error('❌ Cliente WhatsApp não está pronto ou conectado para enviar mensagem.');
        return res.status(500).json({ error: 'Bot não está conectado ao WhatsApp.' });
    }

    try {
        await client.sendMessage(to, message);
        console.log(`✅ Mensagem enviada para ${to}`);
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
    console.error('🚨 Erro não tratado:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('🚨 Exceção não capturada:', err);
});