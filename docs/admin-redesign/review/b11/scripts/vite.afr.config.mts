import orig from 'D:/admin-fr/frontend/web/vite.config.ts';
export default {
  ...(orig as any),
  root: 'D:/admin-fr/frontend/web',
  cacheDir: 'C:/Users/Windows/AppData/Local/Temp/claude/d--FitnessAssistant/8150a6b1-e4ea-4fe2-88a6-fd7d83b674f1/scratchpad/b11/vite-cache',
  server: { ...(orig as any).server, port: 45173, strictPort: true, host: '127.0.0.1' },
};
