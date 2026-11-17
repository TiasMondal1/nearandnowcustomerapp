/**
 * Full-screen "Update Near & Now" when this build is below the server's minimum (lib/appUpdateGate.ts). Checked at
 * launch and whenever the app comes back to the foreground; renders nothing otherwise. A leaf, so the root shell
 * never re-renders for it.
 */
import { useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';

import { EmptyState } from './ui';
import { C } from '../constants/colors';
import { checkAppUpdate, type UpdateRequirement } from '../lib/appUpdateGate';

export function UpdateRequiredGate() {
  const [state, setState] = useState<UpdateRequirement>({ required: false });

  useEffect(() => {
    let alive = true;
    const run = () => {
      void checkAppUpdate().then((next) => {
        if (alive) setState(next);
      });
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  if (!state.required) return null;
  return (
    <View style={styles.cover} testID="update-required">
      <EmptyState
        fill
        iconWrap
        icon="cellphone-arrow-down"
        title="Update Near & Now"
        text={state.message}
        action={{
          label: 'Update now',
          icon: 'google-play',
          size: 'md',
          onPress: () => {
            Linking.openURL(state.storeUrl).catch(() => {});
          },
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: C.card, zIndex: 1000, elevation: 1000 },
});
