// Legacy add-address route → a redirect to the centre-pin map picker (U3: ONE add flow). The file stays so
// every typed `/location/add` href keeps compiling; `returnTo` is forwarded (only via parseReturnTo).
// (quartz, 2026-10-03)
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";

import { Screen } from "../../components/ui";
import { C } from "../../constants/colors";
import { parseReturnTo } from "../../lib/addressService";

export default function AddLocationRedirect(): React.JSX.Element {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = parseReturnTo(params.returnTo);

  useEffect(() => {
    router.replace(returnTo ? { pathname: "/location/select-map", params: { returnTo } } : "/location/select-map");
  }, [returnTo]);

  return <Screen bg={C.card} />;
}
