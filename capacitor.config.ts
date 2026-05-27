import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.unknown.speedtest',
  appName: 'UNKNOWN SPEED TEST',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#06060f',
      showSpinner: false,
    },
  },
};

export default config;
