module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Must stay last: it compiles the 'worklet' directive used by the frame processor (TR-25).
    plugins: ['react-native-worklets/plugin'],
  };
};
