// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// TR-20: .tflite models are bundled as assets so they can be swapped without a rebuild.
config.resolver.assetExts.push('tflite');

module.exports = config;
