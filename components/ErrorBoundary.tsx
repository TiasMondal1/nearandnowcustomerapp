import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { C } from "../constants/colors";

// An unhandled render exception anywhere in the tree previously crashed the
// whole app with no fallback UI — the customer was left staring at a blank/
// native crash screen with no way back in except force-quitting and
// relaunching. This catches it and offers a retry instead. Mirrors the rider
// app's identical fix (components/ErrorBoundary.tsx there) — the customer
// app never got the equivalent.
type BoundaryState = { hasError: boolean; message: string };

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: any): BoundaryState {
    return {
      hasError: true,
      message: error?.message ?? String(error) ?? "Unknown error",
    };
  }

  componentDidCatch(error: any, info: any) {
    if (__DEV__) console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="alert-circle-outline" size={40} color={C.danger} />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message} numberOfLines={6} selectable>
            {this.state.message}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => this.setState({ hasError: false, message: "" })}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: C.bg,
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: C.dangerLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_800ExtraBold",
    color: C.danger,
    marginBottom: 8,
    textAlign: "center",
  },
  message: { fontFamily: "PlusJakartaSans_400Regular",
    fontSize: 13,
    color: C.textSub,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: C.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    minWidth: 160,
    alignItems: "center",
  },
  retryText: { fontFamily: "PlusJakartaSans_600SemiBold",
    color: C.card,
    fontSize: 15,
  },
});
