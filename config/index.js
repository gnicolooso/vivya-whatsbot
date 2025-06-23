// config/index.js

// Carrega variáveis de ambiente do .env para todo o projeto
// O caminho do arquivo .env é especificado como './variaveis.env'
require('dotenv').config({ path: './variaveis.env' });

/**
 * @file Arquivo de configuração centralizado para o bot do WhatsApp.
 * Gerencia variáveis de ambiente e constantes para evitar repetição e facilitar a manutenção.
 */

const path = require('path');

// --- Variáveis de Configuração e Constantes ---

/**
 * Diretório base onde as sessões do whatsapp-web.js serão salvas.
 * Em ambientes como Railway, é montado como volume para persistência.
 * @type {string}
 */
const SESSION_DIR = process.env.SESSION_DIR || '/app/.wwebjs_auth';

/**
 * ID fixo para a sessão do bot.
 * É CRUCIAL que este ID não mude entre deploys para garantir a persistência da sessão.
 * @type {string}
 */
const CLIENT_ID = process.env.CLIENT_ID || "session-bot-principal";

/**
 * Caminho completo para o diretório de sessão específico deste cliente.
 * É derivado de SESSION_DIR e CLIENT_ID.
 * @type {string}
 */
const CLIENT_SESSION_DIR = path.join(SESSION_DIR, `session-${CLIENT_ID}`);

/**
 * URL do microserviço de QR Code.
 * Ajuste conforme seu deploy do microserviço.
 * @type {string}
 */
const QR_SERVICE_URL = process.env.QR_SERVICE_URL || 'https://qr-code-viewer-docker-production.up.railway.app';

/**
 * URL do webhook do n8n para processar mensagens.
 * Ajuste conforme seu webhook do n8n.
 * @type {string}
 */
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://vivya.app.n8n.cloud/webhook-test/56816120-1928-4e36-9e36-7dfdf5277260';

/**
 * URL pública do seu bot.
 * Usada para servir mídia temporariamente. Deve ser acessível externamente.
 * @type {string}
 */
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:8080';

/**
 * Porta em que o servidor Express irá escutar.
 * @type {number}
 */
const PORT = process.env.PORT || 8080;

/**
 * Diretório para armazenar arquivos de mídia temporários.
 * @type {string}
 */
const MEDIA_DIR = path.join(__dirname, '..', 'tmp', 'media');

module.exports = {
    SESSION_DIR,
    CLIENT_ID,
    CLIENT_SESSION_DIR,
    QR_SERVICE_URL,
    N8N_WEBHOOK_URL,
    PUBLIC_URL,
    PORT,
    MEDIA_DIR
};
