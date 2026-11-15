// Lets code outside any screen (a push tap, the notifications modal) navigate.
// Its own module so screens can import it without importing RootNavigator,
// which imports those screens.
import { createNavigationContainerRef } from "@react-navigation/native";
import type { NotificationRoute } from "../services/notificationMeta";

export const navigationRef = createNavigationContainerRef<any>();

export function openNotificationRoute(route: NotificationRoute) {
  if (!route || !navigationRef.isReady()) return;
  navigationRef.navigate(route.name, route.params);
}
