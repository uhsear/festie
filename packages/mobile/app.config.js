// Extends app.json. Provider sign-in needs native modules, so a build gets them only when the
// EAS build env opts in: FESTIE_APPLE_SIGNIN=1 adds the Apple entitlement and plugin, and
// GOOGLE_IOS_URL_SCHEME (the reversed iOS client ID, set per build, never committed) adds the Google plugin.
// FESTIE_LIVE_ACTIVITY=1 adds the iOS Now & Next widget extension and turns the Live Activity on.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
  const ios = { ...config.ios };
  if (process.env.FESTIE_APPLE_SIGNIN === '1') {
    ios.usesAppleSignIn = true;
    plugins.push('expo-apple-authentication');
  } else {
    // Prebuild auto-applies expo-apple-authentication's plugin whenever the package is installed,
    // which adds the entitlement and fails signing against a profile without the capability.
    plugins.push((cfg) =>
      withEntitlementsPlist(cfg, (c) => {
        delete c.modResults['com.apple.developer.applesignin'];
        return c;
      }),
    );
  }
  if (process.env.GOOGLE_IOS_URL_SCHEME) {
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME }]);
  }
  // The Live Activity and the home-screen widget share one widget extension. Without the flag the
  // build has no extension and the app never calls it. An OTA published without the flag turns the
  // feature off for builds that have it, so keep the flag set on every publish for such builds.
  const liveActivity = process.env.FESTIE_LIVE_ACTIVITY === '1';
  if (liveActivity) {
    plugins.push([
      'expo-widgets',
      {
        bundleIdentifier: 'us.festie.app.widgets',
        widgets: [
          {
            name: 'NowNextActivity',
            displayName: 'Now & Next',
            description: 'Your current and upcoming festival set.',
            ios: { supportedFamilies: ['systemSmall', 'systemMedium'] },
          },
        ],
      },
    ]);
  }
  // Autolinking adds both modules to every build, so the app reads these flags to know the native
  // setup (entitlement, URL scheme) exists. Android Google sign-in needs no build-time setup.
  const extra = {
    ...config.extra,
    appleSignIn: ios.usesAppleSignIn === true,
    googleSignIn: Boolean(process.env.GOOGLE_IOS_URL_SCHEME),
    liveActivity,
  };
  return { ...config, ios, plugins, extra };
};
