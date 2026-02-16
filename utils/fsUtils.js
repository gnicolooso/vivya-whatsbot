// utils/fsUtils.js

const fs = require('fs').promises;
const path = require('path');
const { SESSION_DIR, MEDIA_DIR } = require('../config');

async function ensureCriticalDirectoriesExist() {
    try {

        // 1️⃣ Garantir diretório raiz de sessões
        await fs.mkdir(SESSION_DIR, { recursive: true });
        console.log(`[INIT] Diretório de sessão garantido: ${SESSION_DIR}`);

        // 2️⃣ Garantir diretório de mídia
        await fs.mkdir(MEDIA_DIR, { recursive: true });
        console.log(`[INIT] Diretório de mídia garantido: ${MEDIA_DIR}`);

    } catch (error) {
        console.error(`❌ Erro ao garantir diretórios críticos: ${error.message}`);
        process.exit(1);
    }
}

module.exports = {
    ensureCriticalDirectoriesExist
};
