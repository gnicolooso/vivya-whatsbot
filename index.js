require('dotenv').config({ path: './variaveis.env' });
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path'); // Importar path
const { v4: uuidv4 } = require('uuid'); // Importar uuidv4

const app = express();
app.use(express.json());

let client;

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
        authStrategy: new LocalAuth(),
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
                from: message.from, // Número de telefone do remetente (ex: 554791234567@c.us)
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
                    const extension = media.mimetype.split('/')[1] || 'bin';
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
            const response = await axios.post('https://vivya.app.n8n.cloud/webhook/56816120-1928-4e36-9e36-7dfdf5277260', payload);

            if (response.data && response.data.reply) {
                await client.sendMessage(message.from, response.data.reply);
            } else {
                console.warn('⚠️ Resposta do webhook do n8n não continha "reply".');
            }

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
    try {
        if (client) {
            console.log('🔄 Reset manual solicitado via API.');
            await client.destroy();
        }

        // Remove cache da sessão anterior
        const sessionPath = './.wwebjs_auth';
        if (fs.existsSync(sessionPath)) {
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log('🧹 Sessão antiga removida');
            } catch (err) {
                console.warn('⚠️ Falha ao remover pasta de sessão:', err.message);
            }
        }
        startClient();
        res.status(200).send('Sessão reinicializada.');
    } catch (err) {
        console.error('❌ Erro ao resetar sessão manualmente:', err);
        res.status(500).send('Erro ao resetar sessão.');
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