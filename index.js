require('dotenv').config({ path: './variaveis.env' });
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');


// Inicializa o cliente do WhatsApp
const client = new Client();

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('QR code gerado, escaneie com o WhatsApp para conectar.');
});

client.on('ready', () => {
  console.log('Cliente conectado!');
});

client.on('message', async message => {
  // Ignora mensagens de grupos, status e mensagens do próprio bot
  if (message.fromMe || message.isStatus || message.isGroupMsg) return;

  try {
    const response = await axios.post('https://vivya.app.n8n.cloud/webhook/56816120-1928-4e36-9e36-7dfdf5277260', {
      from: message.from,
      message: message.body
    });

    // Verifica se veio uma resposta no campo 'reply'
    if (response.data && response.data.reply) {
      await client.sendMessage(message.from, response.data.reply);
    } else {
      console.warn('Resposta do webhook não contém campo "reply"');
    }

  } catch (error) {
    console.error('Erro ao enviar mensagem ao webhook n8n:', error.message);
  }
});

client.initialize();
