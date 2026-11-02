import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rangolitextiles.app',
  appName: 'Rangoli Textiles',
  webDir: 'dist',
  server: {
    // Allow loading from Supabase
    allowNavigation: ['*.supabase.co'],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#EA580C',
      showSpinner: false,
      launchFadeOutDuration: 500,
    },
  },
  android: {
    // Allow mixed content for local + remote resources
    allowMixedContent: true,
  },
};

export default config;
