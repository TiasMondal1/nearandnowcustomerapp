// Web-only mock for react-native-maps, aliased in from metro.config.js.
// react-native-maps has no web implementation (it wraps native Google/Apple
// map SDKs) — importing it directly crashes Metro's web bundle outright for
// the whole app, not just the screens that use it, since expo-router
// eagerly resolves every route under app/ for web. Found 2026-08-13 via
// live click-testing. This mock lets every screen that imports MapView/
// Marker/etc. still render (as a plain placeholder box) instead of taking
// the entire web bundle down; native builds are completely unaffected,
// since Metro only picks this file when platform === 'web'.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

function MapView({ children, style, ...props }) {
  return (
    <View style={[styles.map, style]} {...props}>
      <Text style={styles.label}>Map view (not available on web)</Text>
      {children}
    </View>
  );
}

function Marker() {
  return null;
}

function Polyline() {
  return null;
}

function Circle() {
  return null;
}

const PROVIDER_GOOGLE = 'google';
const PROVIDER_DEFAULT = 'default';

const styles = StyleSheet.create({
  map: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e7eb',
  },
  label: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default MapView;
export { Marker, Polyline, Circle, PROVIDER_GOOGLE, PROVIDER_DEFAULT };
