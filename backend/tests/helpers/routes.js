/**
 * Walks the mounted router tree and reports every route the API actually
 * serves — checklist 10.1, 10.2 and 10.5.
 *
 * The audits built on this are deliberately derived from the app rather than
 * from a list somebody remembered to update: a new endpoint is audited the
 * moment it is mounted, and a route that forgets `requireAuth` or a param
 * schema fails a test instead of shipping.
 */

/** Recovers the literal prefix a sub-router was mounted at, e.g. '/orders'. */
function prefixOf(layer) {
  const match = layer.regexp.source.match(/^\^\\\/([^\\?]*)\\\//);
  if (!match) return '';
  return `/${match[1].replace(/\\\//g, '/')}`;
}

export function collectRoutes(router, prefix = '') {
  const routes = [];

  for (const layer of router.stack) {
    if (layer.route) {
      const path = `${prefix}${layer.route.path}`.replace(/\/+$/, '') || '/';
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        routes.push({
          method: method.toUpperCase(),
          path,
          // Named middleware on the route, so an audit can ask what guards it.
          handlers: layer.route.stack.map((entry) => entry.name),
        });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      routes.push(...collectRoutes(layer.handle, `${prefix}${prefixOf(layer)}`));
    }
  }

  return routes;
}

/** The routes that must work with no token at all, and why. */
export const PUBLIC_ROUTES = new Map([
  ['GET /health', 'liveness probe'],
  ['POST /auth/register', 'creating the account'],
  ['POST /auth/login', 'signing in'],
  ['POST /auth/refresh', 'rotating a session'],
  ['POST /auth/forgot-password', 'password reset request'],
  ['POST /auth/reset-password', 'password reset completion'],
  ['GET /stores/:slug', 'public store page — must open from a shared link'],
  ['GET /stores/:slug/categories', 'public store page'],
  ['GET /stores/:slug/products', 'public store page'],
  ['GET /stores/:slug/products/:productId', 'public product page'],
  ['GET /stores/:slug/search', 'public store search'],
  ['GET /payments/methods', 'shown on checkout before anything exists'],
  ['POST /payments/webhook', 'the gateway authenticates with an HMAC signature'],
]);

export const routeKey = ({ method, path }) => `${method} ${path}`;

/** Substitutes concrete values into a route pattern. */
export function fill(path, values = {}) {
  return path.replace(/:([A-Za-z]+)/g, (_, name) => values[name] ?? values.default ?? 'x');
}

/** Every path parameter in a route, in order. */
export const paramsOf = (path) => [...path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]);
