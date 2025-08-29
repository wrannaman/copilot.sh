module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      // Must be last: required for react-native-reanimated in Release/TestFlight builds
      "react-native-reanimated/plugin",
    ],
  };
};