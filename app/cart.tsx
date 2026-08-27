import { useEffect } from "react";
import { router } from "expo-router";

import { Screen } from "../components/ui";

/** `/cart` is a short alias for the real cart screen at `/support/cart`. */
export default function CartRedirectScreen() {
  useEffect(() => {
    router.replace("/support/cart");
  }, []);

  // Paint the single redirect frame in the app background so the alias never
  // flashes the navigator's default colour before /support/cart mounts.
  return <Screen />;
}
