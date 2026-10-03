import { router } from "expo-router";
import { useEffect } from "react";

import { Screen } from "../../components/ui";
import { C } from "../../constants/colors";

/** `/support/cart` → `/support/checkout`: checkout IS the cart (DECISIONS D5). The route stays so typed hrefs remain valid. */
export default function CartRedirectScreen() {
  useEffect(() => {
    router.replace("/support/checkout");
  }, []);

  // One white frame in the checkout's own ground so the redirect never flashes before checkout mounts.
  return <Screen bg={C.card} />;
}
