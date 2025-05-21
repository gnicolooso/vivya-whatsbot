require('dotenv').config({ path: './variaveis.env' });
const { Client } = require('whatsapp-web.js');
const { OpenAI } = require('openai');
const qrcode = require('qrcode-terminal');

// Configuração OpenAI com versão 4.x+
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


// Inicializa o cliente do WhatsApp
const client = new Client();

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('QR code gerado, escaneie com o WhatsApp para conectar.');
});

client.on('ready', () => {
  console.log('Cliente conectado!');
});

client.on('message', async (msg) => {
  if (msg.body && !msg.isGroupMsg) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: msg.body }],
        max_tokens: 150,
      });

      msg.reply(response.choices[0].message.content.trim());
    } catch (error) {
      console.error('Erro ao chamar OpenAI API:', error);
      msg.reply('Desculpe, ocorreu um erro ao processar sua solicitação.');
    }
  }
});

client.initialize();
