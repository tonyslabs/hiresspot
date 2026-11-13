const path = require('node:path');
const { VitePlugin } = require('@electron-forge/plugin-vite');

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: 'HiResSpot',
    executableName: 'hiresspot',
    asar: true,
    // Linux usa el PNG; Electron toma `icon` sin extensión según la plataforma
    icon: path.resolve(__dirname, 'assets/icon')
  },
  rebuildConfig: {},
  makers: [
    // .deb (Debian/Ubuntu y derivadas) y .zip portable (cualquier distro: descomprimir y ejecutar `hiresspot`)
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'hiresspot',
          bin: 'hiresspot',
          productName: 'HiResSpot',
          genericName: 'Reproductor de música',
          description: 'Reproductor hi-fi: cliente Navidrome, biblioteca de Spotify de solo lectura y comparación de bibliotecas.',
          categories: ['Audio', 'AudioVideo', 'Player'],
          icon: path.resolve(__dirname, 'assets/icon.png'),
          homepage: 'https://hiresspot.drskxll.io'
        }
      }
    },
    // Instalador de Windows (Squirrel): HiResSpot-Setup.exe instala en %LocalAppData% sin pedir administrador
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'HiResSpot',
        authors: 'tonyslabs',
        exe: 'hiresspot.exe',
        setupExe: 'HiResSpot-Setup.exe',
        setupIcon: path.resolve(__dirname, 'assets/icon.ico'),
        description: 'Reproductor hi-fi: cliente Navidrome, biblioteca de Spotify de solo lectura y comparación de bibliotecas.',
        noMsi: true
      }
    },
    { name: '@electron-forge/maker-zip', platforms: ['linux', 'win32'] }
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};
