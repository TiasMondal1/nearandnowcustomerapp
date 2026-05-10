import { useEffect } from "react";
import { router } from "expo-router";

/** `/cart` is a short alias for the real cart screen at `/support/cart`. */
export default function CartRedirectScreen() {
  useEffect(() => {
    router.replace("/support/cart");
  }, []);

  return null;
}
