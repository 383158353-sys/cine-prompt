import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},server:{host:'127.0.0.1',fs:{deny:['.env','.env.*','**/local-data/**','**/server/**','**/base44/**']}},build:{outDir:'dist'}});
