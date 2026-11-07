import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        refetchOnWindowFocus: false,
        // Retry only what might work on a second try: network drops, 429s, 5xx.
        retry: (count, error: any) => Boolean(error?.isTransient ?? (error?.status === 0 || error?.status >= 500)) && count < 2,
      },
    },
  });

  const router = createRouter({
    routeTree,
    basepath: "/v2",
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
