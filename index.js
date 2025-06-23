// index.js (Arquivo principal refatorado)

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises; // Usando a versão de Promises do módulo 'fs'

// Importações dos módulos refatorados
const config = require('./config'); // Módulo de configuração
const { ensureCriticalDirectoriesExist } = require('./utils/fsUtils'); // Utilitários de sistema de arquivos
const { startWhatsAppClient } = require('./whatsapp/client'); // Gerenciamento do cliente WhatsApp
const whatsappApiRoutes = require('./routes/whatsappApi'); // Rotas da API do WhatsApp

/**
 * @file Arquivo principal do bot do WhatsApp.
 * Orquestra a inicialização do servidor Express, do cliente WhatsApp e dos middlewares.
 */

const app = express();

// --- Configuração CORS ---
// Permite requisições do microserviço de QR Code e outros domínios configurados.
app.use(cors({
    origin: config.QR_SERVICE_URL, // Permita especificamente o seu frontend do microserviço
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Métodos HTTP permitidos
    credentials: true, // Se o frontend precisar de cookies/credenciais
    optionsSuccessStatus: 204 // Status para preflight OPTIONS
}));
app.use(express.json()); // Habilita o parsing de JSON no corpo das requisições

// --- Configuração para servir arquivos estáticos (MUITO IMPORTANTE!) ---
// Isso permite que as URLs como PUBLIC_URL/media/{filename} funcionem.
// O diretório de mídia é configurado em config/index.js
app.use('/media', express.static(config.MEDIA_DIR));
console.log(`📂 Servindo arquivos estáticos de: ${config.MEDIA_DIR}`);
// O diretório em si será criado pela função ensureCriticalDirectoriesExist

// --- Inicialização do Aplicativo ---
async function initializeApp() {
    try {
        // Garante que os diretórios de sessão e mídia existam e limpa sessões antigas
        await ensureCriticalDirectoriesExist();

        // Inicia o cliente WhatsApp Web
        await startWhatsAppClient();

        // Inicializa servidor Express na porta correta
        app.listen(config.PORT, () => {
            console.log(`🚀 Servidor rodando na porta ${config.PORT}`);
        });

    } catch (error) {
        console.error('❌ Erro fatal durante a inicialização do aplicativo:', error.message);
        process.exit(1); // Encerra o processo em caso de erro crítico na inicialização
    }
}

// Endpoint raiz
app.get('/', (req, res) => {
    res.send('🤖 Bot do WhatsApp está rodando!');
});

// Monta as rotas da API do WhatsApp
app.use('/', whatsappApiRoutes); // Pode ser /api se preferir prefixar todas as rotas

// --- Captura de Falhas Não Tratadas (Robustez) ---
// Isso ajuda a identificar e reagir a erros que não foram capturados por blocos try-catch.
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Erro não tratado (Promise Rejection):', reason);
    // Em produção, você pode querer logar isso em um serviço de monitoramento de erros
    // e/ou decidir se o processo deve ser encerrado.
});

process.on('uncaughtException', (err) => {
    console.error('🚨 Exceção não capturada:', err);
    // Para exceções síncronas não capturadas, é uma boa prática encerrar o processo
    // e confiar no gerenciador de processos (como Railway) para reiniciá-lo,
    // garantindo que o aplicativo volte a um estado limpo.
    process.exit(1);
});

// Inicia o processo de inicialização do aplicativo
initializeApp();
