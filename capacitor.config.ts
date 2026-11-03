import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Technical appId preserved for backward compatibility with existing Android builds
  appId: 'com.rangolitextiles.app',
  appName: 'Kala',
  webDir: 'dist',
  server: {
    // Allow loading from Supabase
    allowNavigation: ['*.supabase.co'],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#C2410C',
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
