require('dotenv').config({ path: './variaveis.env' });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const app = express();
const path = require('path');
const tmpDir = path.join(__dirname, 'tmp');
const { v4: uuidv4 } = require('uuid');

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

app.use(express.json());
let client;
app.use('/media', express.static(tmpDir));


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

/*
  client.on('message', async message => {
    if (message.fromMe || message.isStatus || message.isGroupMsg) return;

    try {
      const response = await axios.post('https://vivya.app.n8n.cloud/webhook/56816120-1928-4e36-9e36-7dfdf5277260', {
        from: message.from,
        message: message.body
      });

      if (response.data && response.data.reply) {
        await client.sendMessage(message.from, response.data.reply);
      } else {
        console.warn('⚠️ Resposta do webhook não continha "reply".');
      }
    } catch (error) {
      console.error('❌ Erro no webhook:', error.message);
    }
  });
*/

client.on('message', async message => {
  if (message.fromMe || message.isStatus || message.isGroupMsg) return;

  try {
    const chat = await message.getChat();
    const contact = await message.getContact();
    const payload = {
      from: message.from,
      message_type: message.type,
      message: message.body || null,
      contact_name: contact?.pushname || null,
      is_group: chat.isGroup,
      timestamp: message.timestamp
    };

    // Extração de mídia, se houver
    if (['image', 'video', 'audio', 'document', 'ptt'].includes(message.type)) {
      const media = await message.downloadMedia();

      if (media) {
        const extension = media.mimetype.split('/')[1] || 'bin';
        const filename = `${Date.now()}-${uuidv4()}.${extension}`;
        const filePath = path.join(__dirname, 'tmp', 'media');

        // Garante que o diretório existe
        if (!fs.existsSync(filePath)) {
          fs.mkdirSync(filePath, { recursive: true });
        }

        const fullPath = path.join(filePath, filename);
        fs.writeFileSync(fullPath, Buffer.from(media.data, 'base64'));

        payload.media_mimetype = media.mimetype;
        payload.media_filename = message._data?.filename || filename;
        payload.media_url = `${process.env.PUBLIC_URL}/media/${filename}`;
      }
    }

    // Envia para o n8n
    const response = await axios.post('https://vivya.app.n8n.cloud/webhook/56816120-1928-4e36-9e36-7dfdf5277260', payload);

    if (response.data && response.data.reply) {
      await client.sendMessage(message.from, response.data.reply);
    } else {
      console.warn('⚠️ Resposta do webhook não continha "reply".');
    }

  } catch (error) {
    console.error('❌ Erro no webhook ou no processamento da mensagem:', error.message);
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
