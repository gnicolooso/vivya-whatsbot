require('dotenv').config({ path: './variaveis.env' });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Inicializa o cliente com autenticação persistente
const client = new Client({
  authStrategy: new LocalAuth(), // Salva a sessão localmente
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// Geração e envio do QR code
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

// Quando o bot estiver pronto
client.on('ready', () => {
  console.log('✅ Cliente conectado ao WhatsApp!');
});

// Escuta mensagens recebidas
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

// Trata falhas inesperadas do Puppeteer (ex: Execution context was destroyed)
client.on('disconnected', (reason) => {
  console.warn(`⚠️ Cliente desconectado: ${reason}`);
  console.warn('Tentando reiniciar o cliente...');
  client.initialize();
});

// Captura falhas globais
process.on('unhandledRejection', (reason, p) => {
  console.error('🚨 Erro não tratado:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('🚨 Exceção não capturada:', err);
});

// Inicia o cliente
client.initialize();
