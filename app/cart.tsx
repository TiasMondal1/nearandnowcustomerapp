import { useEffect } from "react";
import { router } from "expo-router";

export default function CartScreen() {
  useEffect(() => {
    router.replace("/support/checkout");
  }, []);

  return null;
}
