import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function startBot() {
    console.log('[Runner] Starting Discord Bot (index.js)...');
    
    // Spawn index.js as a child process, inheriting stdio so logs show up in Railway
    const bot = spawn('node', [path.join(__dirname, 'index.js')], {
        stdio: 'inherit'
    });

    bot.on('exit', (code, signal) => {
        console.log(`[Runner] Bot process exited (code: ${code}, signal: ${signal}).`);
        console.log('[Runner] Restarting bot in 5 seconds to prevent Railway container restart limit...');
        setTimeout(startBot, 5000);
    });
}

startBot();
