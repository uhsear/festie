// Extends app.json. Provider sign-in needs native modules, so a build gets them only when the
// EAS build env opts in: FESTIE_APPLE_SIGNIN=1 adds the Apple entitlement and plugin, and
// GOOGLE_IOS_URL_SCHEME (the reversed iOS client ID, set per build, never committed) adds the Google plugin.
module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
  const ios = { ...config.ios };
  if (process.env.FESTIE_APPLE_SIGNIN === '1') {
    ios.usesAppleSignIn = true;
    plugins.push('expo-apple-authentication');
  }
  if (process.env.GOOGLE_IOS_URL_SCHEME) {
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME }]);
  }
  // Autolinking adds both modules to every build, so the app reads these flags to know the native
  // setup (entitlement, URL scheme) exists. Android Google sign-in needs no build-time setup.
  const extra = {
    ...config.extra,
    appleSignIn: ios.usesAppleSignIn === true,
    googleSignIn: Boolean(process.env.GOOGLE_IOS_URL_SCHEME),
  };
  return { ...config, ios, plugins, extra };
};
