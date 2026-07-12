/** Shared router singleton so any module can navigate programmatically. */

import { Router } from "../ui/router";

export const appRouter = new Router();

export function router(): Router {
  return appRouter;
}
