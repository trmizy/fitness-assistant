import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'vn.fitnessassistant.app',
  appName: 'Fitness Assistant',
  webDir: 'dist',
  android: {
    // Scheme http cho bản LAN: origin app là http://localhost, gọi tới
    // http://<LAN_IP>:3000 nên không bị chặn mixed content. Nếu để mặc định
    // 'https', origin là https://localhost và WebView sẽ chặn mọi request
    // http:// tới gateway — triệu chứng là request im lặng không đi.
    androidScheme: 'http',
  },
  server: {
    cleartext: true,
  },
};

export default config;
