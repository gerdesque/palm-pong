import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'node_modules', '@mediapipe', 'hands');
const targetDir = path.join(projectRoot, 'vendor', 'mediapipe');

if (!existsSync(sourceDir)) {
    console.error('Missing @mediapipe/hands in node_modules. Run npm install first.');
    process.exit(1);
}

mkdirSync(targetDir, { recursive: true });

for (const fileName of readdirSync(targetDir)) {
    rmSync(path.join(targetDir, fileName), { recursive: true, force: true });
}

cpSync(sourceDir, targetDir, { recursive: true });
console.log(`Copied MediaPipe Hands assets to ${targetDir}`);
