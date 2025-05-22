const express = require('express');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
let qrCodeData = null;

// Cria o cliente WhatsApp
const client = new Client();

client.on('qr', async (qr) => {
  qrCodeData = await qrcode.toDataURL(qr); // converte QR para imagem base64
  console.log('QR code gerado. Acesse http://localhost:3000 para escanear.');
});

client.on('ready', () => {
  console.log('Cliente conectado!');
});

client.initialize();

// Página HTML simples para exibir o QR code
app.get('/', (req, res) => {
  if (!qrCodeData) return res.send('QR Code ainda não gerado.');
  res.send(`
    <html>
      <body style="display:flex; align-items:center; justify-content:center; height:100vh; background:#f0f0f0;">
        <div style="text-align:center;">
          <h2>Escaneie o QR Code para autenticar o WhatsApp</h2>
          <img src="${qrCodeData}" />
        </div>
      </body>
    </html>
  `);
});

app.listen(3000, () => {
  console.log('Servidor web rodando em http://localhost:3000');
});
