// utils/fsUtils.js

const fs = require('fs').promises; // Usando a versão de Promises do módulo 'fs' para operações assíncronas 
const path = require('path');
// Importar as variáveis de configuração do módulo config
const { SESSION_DIR, CLIENT_SESSION_DIR, MEDIA_DIR, CLIENT_ID } = require('../config');

/**
 * @file Funções utilitárias para operações de sistema de arquivos.
 * Inclui lógica para garantir a existência de diretórios e limpeza de sessões antigas.
 */

/**
 * Garante que os diretórios de sessão e mídia existam.
 * Realiza uma limpeza de pastas de sessão antigas ou inconsistentes.
 * Utiliza operações de arquivo assíncronas para evitar bloqueio do event loop.
 * @async
 * @function ensureCriticalDirectoriesExist
 * @returns {Promise<void>} Uma promessa que resolve quando os diretórios são garantidos.
 */
async function ensureCriticalDirectoriesExist() {
    try {
        // 1. Garantir o diretório raiz da sessão
        if (!(await pathExists(SESSION_DIR))) {
            console.log(`[INIT] Criando diretório de sessão: ${SESSION_DIR}`);
            await fs.mkdir(SESSION_DIR, { recursive: true });
            console.log(`[INIT] Diretório ${SESSION_DIR} criado.`);
        } else {
            console.log(`[INIT] Diretório de sessão ${SESSION_DIR} já existe.`);
        }

        // 2. Garantir o diretório específico do cliente
        if (!(await pathExists(CLIENT_SESSION_DIR))) {
            console.log(`[INIT] Criando diretório específico do cliente: ${CLIENT_SESSION_DIR}`);
            await fs.mkdir(CLIENT_SESSION_DIR, { recursive: true });
            console.log(`[INIT] Diretório ${CLIENT_SESSION_DIR} criado.`);
        } else {
            console.log(`[INIT] Diretório específico do cliente ${CLIENT_SESSION_DIR} já existe.`);
        }

        // 3. Garantir o diretório de mídia
        if (!(await pathExists(MEDIA_DIR))) {
            console.log(`[INIT] Criando diretório de mídia: ${MEDIA_DIR}`);
            await fs.mkdir(MEDIA_DIR, { recursive: true });
            console.log(`[INIT] Diretório ${MEDIA_DIR} criado.`);
        } else {
            console.log(`[INIT] Diretório de mídia ${MEDIA_DIR} já existe.`);
        }

        // 4. Limpeza de Pastas de Sessão Antigas e Inconsistentes
        // Isso é crucial para evitar que o LocalAuth se confunda com múltiplas sessões.
        console.log(`[INIT] Iniciando limpeza de sessões antigas em ${SESSION_DIR}...`);
        const files = await fs.readdir(SESSION_DIR);
        for (const file of files) {
            const fullPath = path.join(SESSION_DIR, file);
            const stats = await fs.stat(fullPath);

            // Remove pastas que não sejam a do CLIENT_ID fixo e que comecem com 'session-'
            if (stats.isDirectory() && file.startsWith('session-') && file !== `session-${CLIENT_ID}`) {
                console.warn(`⚠️ [INIT] Removendo pasta de sessão antiga/inconsistente: ${fullPath}`);
                await fs.rm(fullPath, { recursive: true, force: true });
            }
            // O diretório 'session' sem clientId também pode ser um resquício.
            if (stats.isDirectory() && file === 'session') {
                console.warn(`⚠️ [INIT] Removendo diretório 'session' genérico: ${fullPath}`);
                await fs.rm(fullPath, { recursive: true, force: true });
            }
        }
        console.log(`[INIT] Limpeza de sessões antigas concluída.`);

        // Opcional: Para depuração, tente listar o conteúdo via Node.js
        console.log(`[INIT] Conteúdo atual de ${SESSION_DIR}:`);
        const sessionContents = await fs.readdir(SESSION_DIR);
        sessionContents.forEach(file => {
            console.log(`  - ${file}`);
        });
        console.log(`[INIT] Conteúdo atual de ${CLIENT_SESSION_DIR}:`);
        const clientSessionContents = await fs.readdir(CLIENT_SESSION_DIR);
        clientSessionContents.forEach(file => {
            console.log(`  - ${file}`);
        });

    } catch (error) {
        console.error(`❌ [INIT] Erro crítico ao garantir ou limpar diretórios de sessão/mídia: ${error.message}`);
        // Em caso de erro crítico na inicialização, o processo deve ser encerrado.
        process.exit(1);
    }
}

/**
 * Verifica se um caminho de arquivo ou diretório existe.
 * @param {string} path O caminho a ser verificado.
 * @returns {Promise<boolean>} Verdadeiro se o caminho existe, falso caso contrário.
 */
async function pathExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    ensureCriticalDirectoriesExist,
    pathExists
};
