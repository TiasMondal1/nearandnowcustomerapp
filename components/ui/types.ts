import type { MaterialCommunityIcons } from "@expo/vector-icons";
import type React from "react";

/** Any MaterialCommunityIcons glyph name — the only icon set used in the app. */
export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];
