// deno-lint-ignore-file no-explicit-any ban-types

/**
 * Copyright (C) 2026 Theros <https://github.com/therosin>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type {
  AnyMiddleware,
  AnyRouteHandler,
  ErrorHandler,
  HttpMethod,
  MiddlewareData,
  RouteDefinition,
  RouteHandler,
  RouteMetadata,
  RouteOptions,
  RouterConstructorOptions,
  RouterContext,
  RouterMetadata,
  RouterOptions,
  RouterServices,
} from "./types.ts";

export type {
  ErrorHandler,
  HttpMethod,
  Middleware,
  MiddlewareData,
  Next,
  RouteDefinition,
  RouteHandler,
  RouteMetadata,
  RouteOptions,
  RouterConstructorOptions,
  RouterContext,
  RouterMetadata,
  RouterOptions,
  RouterServices,
} from "./types.ts";

const SUPPORTED_METHODS = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

interface DecoratedRoute {
  propertyKey: PropertyKey;

  options: RouteOptions;
}

interface InternalRoute {
  definition: RouteDefinition;

  handler: AnyRouteHandler;
}

interface MountedRouter {
  router: Router<any, any>;

  mountPath?: string;
}

interface MiddlewareInvocation {
  router: Router<any, any>;

  middleware: AnyMiddleware;
}

interface ResolvedRoute {
  owner: Router<any, any>;

  definition: RouteDefinition;

  handler: AnyRouteHandler;

  middleware: readonly MiddlewareInvocation[];
}

/**
 * Decorator metadata is deliberately private to this module.
 *
 * No Symbol.for(), package namespace, project namespace, or other
 * globally-coupled metadata keys are required.
 */
const routerOptionsMetadata = new WeakMap<
  Function,
  RouterOptions
>();

const routerMiddlewareMetadata = new WeakMap<
  Function,
  AnyMiddleware[]
>();

const routeMetadata = new WeakMap<
  object,
  DecoratedRoute[]
>();

const methodMiddlewareMetadata = new WeakMap<
  object,
  Map<PropertyKey, AnyMiddleware[]>
>();

function normalizeBase(
  path: string,
): string {
  const trimmed = path.trim();

  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const leading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;

  const normalized = leading
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

  return normalized || "/";
}

function normalizeRelativePath(
  path: string,
): string {
  const normalized = normalizeBase(path);

  return normalized === "/" ? "" : normalized;
}

function joinPath(
  base: string,
  path: string,
): string {
  const left = normalizeBase(base);
  const right = normalizeRelativePath(path);

  if (!right) {
    return left;
  }

  if (left === "/") {
    return right;
  }

  return `${left}${right}`;
}

function isResponse(
  value: unknown,
): value is Response {
  return value instanceof Response;
}

function isMiddlewareData(
  value: unknown,
): value is MiddlewareData {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * next() forwards the existing object unchanged.
 *
 * next({ ... }) adds/replaces supplied properties while preserving
 * anything already forwarded by earlier middleware.
 */
function mergeMiddlewareData(
  current: MiddlewareData | undefined,
  incoming: MiddlewareData | undefined,
): MiddlewareData | undefined {
  if (incoming === undefined) {
    return current;
  }

  if (!isMiddlewareData(incoming)) {
    throw new TypeError(
      "next(data) expects an object when data is supplied",
    );
  }

  if (current === undefined) {
    return {
      ...incoming,
    };
  }

  return {
    ...current,
    ...incoming,
  };
}

function constructorChain(
  instance: object,
): Function[] {
  const chain: Function[] = [];

  let current: Function | null = instance.constructor as Function;

  while (
    current &&
    current !== Router
  ) {
    chain.unshift(current);

    current = Object.getPrototypeOf(
      current,
    ) as Function | null;
  }

  return chain;
}

function prototypeChain(
  instance: object,
): object[] {
  const chain: object[] = [];

  let current = Object.getPrototypeOf(
    instance,
  ) as object | null;

  while (
    current &&
    current !== Router.prototype
  ) {
    chain.unshift(current);

    current = Object.getPrototypeOf(
      current,
    ) as object | null;
  }

  return chain;
}

function collectRouterOptions(
  instance: object,
): RouterOptions {
  const merged: Record<
    string,
    unknown
  > = {};

  const middleware: AnyMiddleware[] = [];

  for (
    const ctor of constructorChain(instance)
  ) {
    const options = routerOptionsMetadata.get(ctor);

    if (!options) {
      continue;
    }

    const {
      middleware: configuredMiddleware,
      ...rest
    } = options;

    Object.assign(
      merged,
      rest,
    );

    if (configuredMiddleware) {
      middleware.push(
        ...configuredMiddleware,
      );
    }
  }

  if (middleware.length) {
    merged.middleware = middleware;
  }

  return merged as RouterOptions;
}

function collectClassMiddleware(
  instance: object,
): AnyMiddleware[] {
  const result: AnyMiddleware[] = [];

  for (
    const ctor of constructorChain(instance)
  ) {
    const middleware = routerMiddlewareMetadata.get(ctor);

    if (middleware) {
      result.push(
        ...middleware,
      );
    }
  }

  return result;
}

function collectDecoratedRoutes(
  instance: object,
): DecoratedRoute[] {
  const result: DecoratedRoute[] = [];

  for (
    const prototype of prototypeChain(instance)
  ) {
    const routes = routeMetadata.get(prototype);

    if (routes) {
      result.push(
        ...routes,
      );
    }
  }

  return result;
}

function collectMethodMiddleware(
  instance: object,
  propertyKey: PropertyKey,
): AnyMiddleware[] {
  const result: AnyMiddleware[] = [];

  for (
    const prototype of prototypeChain(instance)
  ) {
    const middleware = methodMiddlewareMetadata
      .get(prototype)
      ?.get(propertyKey);

    if (middleware) {
      result.push(
        ...middleware,
      );
    }
  }

  return result;
}

function normalizeRouteOptions<
  TMetadata extends RouteMetadata,
>(
  options: RouteOptions<TMetadata>,
): RouteOptions<TMetadata> {
  return Object.freeze({
    ...options,

    method: options.method.toUpperCase() as HttpMethod,

    path: normalizeRelativePath(
      options.path,
    ),

    middleware: options.middleware
      ? Object.freeze([
        ...options.middleware,
      ])
      : undefined,
  }) as RouteOptions<TMetadata>;
}

export function validateMiddleware(
  middleware: unknown,
): middleware is AnyMiddleware {
  return typeof middleware === "function";
}

export function validateRoute(
  route: RouteOptions,
): boolean {
  const method = route?.method?.toUpperCase() as HttpMethod;

  return Boolean(
    route &&
      typeof route.path === "string" &&
      typeof route.method === "string" &&
      SUPPORTED_METHODS.has(method) &&
      (
        route.middleware === undefined ||
        (
          Array.isArray(
            route.middleware,
          ) &&
          route.middleware.every(
            validateMiddleware,
          )
        )
      ),
  );
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers?: HeadersInit,
  ) {
    super(message);

    this.name = "HttpError";
  }
}

/**
 * Route declaration.
 *
 * Router itself interprets only:
 *
 * method
 * path
 * middleware
 *
 * All other properties remain opaque and are preserved in
 * RouteDefinition.options.
 */
export function RouteDecorator<
  const TMetadata extends RouteMetadata = RouteMetadata,
>(
  options: RouteOptions<TMetadata>,
): MethodDecorator {
  if (!validateRoute(options)) {
    throw new TypeError(
      `Invalid route declaration: ${JSON.stringify(options)}`,
    );
  }

  const normalized = normalizeRouteOptions(options);

  return (
    target,
    propertyKey,
    descriptor,
  ) => {
    if (
      typeof descriptor?.value !==
        "function"
    ) {
      throw new TypeError(
        "@RouteDecorator can only decorate methods",
      );
    }

    const routes = routeMetadata.get(target) ?? [];

    routes.push({
      propertyKey,
      options: normalized,
    });

    routeMetadata.set(
      target,
      routes,
    );
  };
}

/**
 * Middleware may be applied to either:
 *
 * a Router class
 * a route method
 *
 * RouteDecorator({ middleware: [...] }) remains fully supported and is
 * expected to be the normal declarative route form.
 */
export function MiddlewareDecorator(
  middleware: AnyMiddleware,
): ClassDecorator & MethodDecorator {
  if (!validateMiddleware(middleware)) {
    throw new TypeError(
      "Invalid middleware",
    );
  }

  return ((
    target: object | Function,
    propertyKey?: PropertyKey,
  ) => {
    if (propertyKey === undefined) {
      if (
        typeof target !== "function"
      ) {
        throw new TypeError(
          "Invalid @MiddlewareDecorator target",
        );
      }

      const middlewareList = routerMiddlewareMetadata
        .get(target) ?? [];

      /**
       * Legacy decorators execute bottom-up.
       *
       * unshift() preserves the visual top-to-bottom order in source.
       */
      middlewareList.unshift(
        middleware,
      );

      routerMiddlewareMetadata.set(
        target,
        middlewareList,
      );

      return;
    }

    const byMethod = methodMiddlewareMetadata
      .get(target as object) ??
      new Map<
        PropertyKey,
        AnyMiddleware[]
      >();

    const middlewareList = byMethod.get(propertyKey) ?? [];

    middlewareList.unshift(
      middleware,
    );

    byMethod.set(
      propertyKey,
      middlewareList,
    );

    methodMiddlewareMetadata.set(
      target as object,
      byMethod,
    );
  }) as ClassDecorator & MethodDecorator;
}

/**
 * Router declaration.
 *
 * Router itself interprets only:
 *
 * base
 * middleware
 * context
 * services
 * onError
 *
 * Everything else is preserved in router.options.
 */
export function RouterDecorator<
  TContext extends RouterContext = RouterContext,
  TServices extends RouterServices = RouterServices,
  const TMetadata extends RouterMetadata = RouterMetadata,
>(
  options: RouterOptions<
    TContext,
    TServices,
    TMetadata
  > = {} as RouterOptions<
    TContext,
    TServices,
    TMetadata
  >,
): ClassDecorator {
  const normalized = Object.freeze({
    ...options,

    base: normalizeBase(
      options.base ?? "/",
    ),

    middleware: options.middleware
      ? Object.freeze([
        ...options.middleware,
      ])
      : undefined,
  });

  return (target) => {
    routerOptionsMetadata.set(
      target,
      normalized as RouterOptions,
    );
  };
}

export class Router<
  TContext extends RouterContext = RouterContext,
  TServices extends RouterServices = RouterServices,
> {
  protected readonly context: TContext;

  protected readonly services: TServices;

  public readonly options: Readonly<
    RouterOptions<
      TContext,
      TServices
    >
  >;

  private readonly routes: InternalRoute[] = [];

  private readonly mountedRouters: MountedRouter[] = [];

  private readonly runtimeMiddleware: AnyMiddleware[] = [];

  constructor(
    overrides: RouterConstructorOptions<
      TContext,
      TServices
    > = {},
  ) {
    const options = collectRouterOptions(
      this,
    ) as RouterOptions<
      TContext,
      TServices
    >;

    this.options = Object.freeze({
      ...options,
    });

    const configuredContext = options.context;

    const configuredServices = options.services;

    this.context = overrides.context ??
      (
        typeof configuredContext ===
            "function"
          ? configuredContext()
          : configuredContext ?? {}
      ) as TContext;

    this.services = overrides.services ??
      (
        typeof configuredServices ===
            "function"
          ? configuredServices(
            this.context,
          )
          : configuredServices ?? {}
      ) as TServices;

    this.registerDecoratedRoutes();
  }

  /**
   * Bound Request -> Response handler.
   *
   * The Router does not import or reference Deno.
   *
   * Deno can still use it directly:
   *
   * Deno.serve(router.fetch);
   *
   * The optional second argument allows a runtime to provide handler
   * information without Router assigning meaning to it.
   */
  public readonly fetch = (
    req: Request,
    _info?: unknown,
  ): Promise<Response> => {
    return this.handleRequest(req);
  };

  public readonly handleRequest = (
    req: Request,
  ): Promise<Response> => {
    let pathname: string;

    try {
      pathname = normalizeBase(
        new URL(
          req.url,
        ).pathname,
      );
    } catch (error) {
      return this.errorToResponse(
        error,
        req,
      );
    }

    const candidates = this.collectCandidates(
      "/",
      undefined,
      [],
    );

    const pathMatches = candidates.filter(
      (candidate) =>
        candidate
          .definition
          .path === pathname,
    );

    if (!pathMatches.length) {
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }

    const method = req.method.toUpperCase() as HttpMethod;

    const match = pathMatches.find(
      (candidate) =>
        candidate
          .definition
          .method === method,
    );

    if (!match) {
      const allowed = [
        ...new Set(
          pathMatches.map(
            (candidate) =>
              candidate
                .definition
                .method,
          ),
        ),
      ].sort();

      return Promise.resolve(
        new Response(
          "Method Not Allowed",
          {
            status: 405,

            headers: {
              Allow: allowed.join(
                ", ",
              ),
            },
          },
        ),
      );
    }

    return this.executeResolvedRoute(
      req,
      match,
    );
  };

  /**
   * Compose another Router.
   *
   * child.base is automatically respected:
   *
   * @RouterDecorator({ base: "/api" })
   * class ApiRouter extends Router {}
   *
   * @RouterDecorator({ base: "/users" })
   * class UserRouter extends Router {}
   *
   * api.use(new UserRouter());
   *
   * produces:
   *
   * /api/users/...
   *
   * An explicit mount path is an additional prefix:
   *
   * api.use("/v1", new UserRouter());
   *
   * produces:
   *
   * /api/v1/users/...
   */
  public use(
    router: Router<any, any>,
  ): this;

  public use(
    base: string,
    router: Router<any, any>,
  ): this;

  public use(
    baseOrRouter:
      | string
      | Router<any, any>,
    maybeRouter?: Router<any, any>,
  ): this {
    const router = typeof baseOrRouter ===
        "string"
      ? maybeRouter
      : baseOrRouter;

    if (!(router instanceof Router)) {
      throw new TypeError(
        "Router.use() expects a Router instance",
      );
    }

    if (
      router === this ||
      router.containsRouter(this)
    ) {
      throw new TypeError(
        "Router.use() would create a mount cycle",
      );
    }

    this.mountedRouters.push({
      router,

      mountPath: typeof baseOrRouter ===
          "string"
        ? normalizeRelativePath(
          baseOrRouter,
        )
        : undefined,
    });

    return this;
  }

  public addMiddleware(
    middleware: AnyMiddleware,
  ): this {
    if (
      !validateMiddleware(
        middleware,
      )
    ) {
      throw new TypeError(
        "Invalid middleware",
      );
    }

    this.runtimeMiddleware.push(
      middleware,
    );

    return this;
  }

  public addRoute<
    const TMetadata extends RouteMetadata = RouteMetadata,
    TData extends MiddlewareData = MiddlewareData,
  >(
    options: RouteOptions<TMetadata>,
    handler: RouteHandler<TData>,
  ): this {
    if (!validateRoute(options)) {
      throw new TypeError(
        `Invalid route declaration: ${JSON.stringify(options)}`,
      );
    }

    if (
      typeof handler !== "function"
    ) {
      throw new TypeError(
        "Route handler must be a function",
      );
    }

    const normalized = normalizeRouteOptions(options);

    this.routes.push({
      definition: Object.freeze({
        method: normalized.method,

        path: normalized.path,

        middleware: Object.freeze([
          ...(
            normalized
              .middleware ??
              []
          ),
        ]),

        options: normalized,
      }),

      handler: handler as AnyRouteHandler,
    });

    return this;
  }

  /**
   * Returns this Router's local route declarations.
   *
   * Paths remain relative to this Router's base.
   */
  public getRoutes(): readonly RouteDefinition[] {
    return Object.freeze(
      this.routes.map(
        (route) => route.definition,
      ),
    );
  }

  /**
   * Generic application extension point.
   *
   * Router itself still assigns no meaning to arbitrary route fields.
   *
   * A consuming application may override this and translate whatever
   * declarations it understands into middleware.
   *
   * For example, an application may decide that:
   *
   * route.options.permissions
   *
   * means some particular permission system.
   *
   * Another application can give that field entirely different semantics.
   */
  protected middlewareForRoute(
    _route: RouteDefinition,
  ): readonly AnyMiddleware[] {
    return [];
  }

  private registerDecoratedRoutes(): void {
    for (
      const decorated of collectDecoratedRoutes(
        this,
      )
    ) {
      const handler = (
        this as unknown as Record<
          PropertyKey,
          unknown
        >
      )[
        decorated.propertyKey
      ];

      if (
        typeof handler !==
          "function"
      ) {
        throw new TypeError(
          `Decorated route ${
            String(
              decorated
                .propertyKey,
            )
          } is not a method`,
        );
      }

      const methodMiddleware = collectMethodMiddleware(
        this,
        decorated.propertyKey,
      );

      const routeMiddleware = [
        ...(
          decorated
            .options
            .middleware ??
            []
        ),

        ...methodMiddleware,
      ];

      const definition: RouteDefinition = Object.freeze({
        method: decorated
          .options
          .method,

        path: decorated
          .options
          .path,

        middleware: Object.freeze(
          routeMiddleware,
        ),

        options: decorated.options,

        handlerKey: decorated
          .propertyKey,
      });

      this.routes.push({
        definition,

        handler: handler.bind(
          this,
        ) as AnyRouteHandler,
      });
    }
  }

  private getRouterMiddleware(): readonly AnyMiddleware[] {
    return [
      ...(
        this.options
          .middleware ??
          []
      ),

      ...collectClassMiddleware(
        this,
      ),

      ...this.runtimeMiddleware,
    ];
  }

  /**
   * Resolve this Router and all mounted Routers into complete route
   * candidates for the current mount tree.
   *
   * Parent Router middleware is inherited by mounted child Routers.
   */
  private collectCandidates(
    parentBase: string,
    mountPath: string | undefined,
    inheritedMiddleware: readonly MiddlewareInvocation[],
  ): ResolvedRoute[] {
    const mountedBase = mountPath
      ? joinPath(
        parentBase,
        mountPath,
      )
      : parentBase;

    const ownBase = normalizeRelativePath(
      this.options.base ?? "/",
    );

    const effectiveBase = joinPath(
      mountedBase,
      ownBase,
    );

    const routerMiddleware: MiddlewareInvocation[] = [
      ...inheritedMiddleware,

      ...this
        .getRouterMiddleware()
        .map(
          (
            middleware,
          ) => ({
            router: this,

            middleware,
          }),
        ),
    ];

    const result: ResolvedRoute[] = this.routes.map(
      (route) => {
        const fullPath = joinPath(
          effectiveBase,
          route
            .definition
            .path,
        );

        const definition: RouteDefinition = Object.freeze({
          ...route.definition,

          path: fullPath,
        });

        const interpretedMiddleware = this.middlewareForRoute(
          route.definition,
        );

        return {
          owner: this,

          definition,

          handler: route.handler,

          middleware: [
            ...routerMiddleware,

            ...interpretedMiddleware.map(
              (
                middleware,
              ) => ({
                router: this,

                middleware,
              }),
            ),

            ...route
              .definition
              .middleware
              .map(
                (
                  middleware,
                ) => ({
                  router: this,

                  middleware,
                }),
              ),
          ],
        };
      },
    );

    for (
      const mount of this.mountedRouters
    ) {
      result.push(
        ...mount
          .router
          .collectCandidates(
            effectiveBase,
            mount.mountPath,
            routerMiddleware,
          ),
      );
    }

    return result;
  }

  private executeResolvedRoute(
    req: Request,
    resolved: ResolvedRoute,
  ): Promise<Response> {
    const dispatch = async (
      index: number,
      data?: MiddlewareData,
    ): Promise<Response> => {
      if (
        index >=
          resolved.middleware.length
      ) {
        try {
          const response = await resolved.handler(
            req,
            data,
          );

          if (
            !isResponse(
              response,
            )
          ) {
            throw new TypeError(
              "Route handlers must return a Response",
            );
          }

          return response;
        } catch (error) {
          return resolved
            .owner
            .errorToResponse(
              error,
              req,
            );
        }
      }

      const invocation = resolved.middleware[
        index
      ];

      let nextCalled = false;

      let nextResponse: Response | undefined;

      const next = async (
        nextData?: MiddlewareData,
      ): Promise<Response> => {
        if (nextCalled) {
          throw new Error(
            "next() may only be called once per middleware",
          );
        }

        nextCalled = true;

        nextResponse = await dispatch(
          index + 1,
          mergeMiddlewareData(
            data,
            nextData,
          ),
        );

        return nextResponse;
      };

      try {
        const result = await invocation
          .middleware
          .call(
            invocation.router,
            req,
            next,
            data,
          );

        /**
         * Explicit Response terminates or unwinds the chain.
         */
        if (
          isResponse(result)
        ) {
          return result;
        }

        /**
         * Middleware must not return arbitrary values.
         */
        if (
          result !== undefined
        ) {
          throw new TypeError(
            "Middleware must return a Response, return next(), or return nothing after calling next()",
          );
        }

        /**
         * Express-like:
         *
         * await next();
         *
         * with no explicit return is still valid.
         */
        if (
          nextCalled &&
          nextResponse
        ) {
          return nextResponse;
        }

        /**
         * Unlike Express, silently hanging forever is not useful.
         *
         * Middleware must either:
         *
         * return Response
         * call next()
         */
        throw new Error(
          "Middleware returned without a Response and without calling next()",
        );
      } catch (error) {
        return invocation
          .router
          .errorToResponse(
            error,
            req,
          );
      }
    };

    return dispatch(0);
  }

  private async errorToResponse(
    error: unknown,
    req: Request,
  ): Promise<Response> {
    const onError = this.options.onError as
      | ErrorHandler
      | undefined;

    if (onError) {
      try {
        const response = await onError.call(
          this,
          error,
          req,
        );

        if (
          isResponse(
            response,
          )
        ) {
          return response;
        }
      } catch (handlerError) {
        error = handlerError;
      }
    }

    if (
      error instanceof
        HttpError
    ) {
      return new Response(
        error.message,
        {
          status: error.status,

          headers: error.headers,
        },
      );
    }

    console.error(error);

    return new Response(
      "Internal Server Error",
      {
        status: 500,
      },
    );
  }

  private containsRouter(
    target: Router<any, any>,
  ): boolean {
    for (
      const mount of this.mountedRouters
    ) {
      if (
        mount.router === target ||
        mount
          .router
          .containsRouter(
            target,
          )
      ) {
        return true;
      }
    }

    return false;
  }
}
