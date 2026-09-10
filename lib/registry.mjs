/**
 * Every feature the app knows about, in menu order.
 *
 * This list is the whole plugin system. To add a feature: write a folder under
 * lib/features/ exporting the descriptor shape that lib/features/hatchery/
 * demonstrates, import it here, and put it in the array. The menu, the command
 * names, the help text and the background services are all derived from this.
 */

import brew from "./features/brew/index.mjs";
import hatchery from "./features/hatchery/index.mjs";
import notifications from "./features/notifications/index.mjs";

export const REGISTRY = [hatchery, notifications, brew];
