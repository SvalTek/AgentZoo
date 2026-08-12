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

export type MaybePromise<T> = T | Promise<T>;

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

/**
 * Request-local data forwarded through middleware with next(data).
 *
 * The Router itself assigns no shape or meaning to this object.
 * Individual middleware can type only the properties it expects.
 */
export type MiddlewareData = object;

export type Next = (
  data?: MiddlewareData,
) => Promise<Response>;

export type Middleware<
  TData extends MiddlewareData = MiddlewareData,
> = (
  req: Request,
  next: Next,
  data?: TData,
) => MaybePromise<Response | void>;

export type RouteHandler<
  TData extends MiddlewareData = MiddlewareData,
> = (
  req: Request,
  data?: TData,
) => MaybePromise<Response>;

export interface RouterContext {
  [key: string]: unknown;
}

export interface RouterServices {
  [key: string]: unknown;
}

/**
 * Open router declaration surface.
 *
 * Only fields explicitly defined by RouterOptions have meaning to Router.
 * Everything else is preserved for the consuming application.
 */
export interface RouterMetadata {
  [key: string]: unknown;
}

/**
 * Open route declaration surface.
 *
 * Things such as:
 *
 * permissions
 * schema
 * rateLimit
 * tags
 * documentation
 * capabilities
 *
 * can be declared without Router deciding what any of them mean.
 */
export interface RouteMetadata {
  [key: string]: unknown;
}

export type ContextProvider<
  TContext extends RouterContext,
> =
  | TContext
  | (() => TContext);

export type ServicesProvider<
  TContext extends RouterContext,
  TServices extends RouterServices,
> =
  | TServices
  | ((context: TContext) => TServices);

export type ErrorHandler = (
  error: unknown,
  req: Request,
) => MaybePromise<Response>;

export type AnyMiddleware = Middleware;

export type AnyRouteHandler = RouteHandler;

/**
 * Router itself only interprets:
 *
 * base
 * middleware
 * context
 * services
 * onError
 *
 * Any additional fields remain opaque.
 */
export type RouterOptions<
  TContext extends RouterContext = RouterContext,
  TServices extends RouterServices = RouterServices,
  TMetadata extends RouterMetadata = RouterMetadata,
> = {
  base?: string;

  middleware?: readonly AnyMiddleware[];

  context?: ContextProvider<TContext>;

  services?: ServicesProvider<
    TContext,
    TServices
  >;

  onError?: ErrorHandler;
} & TMetadata;

/**
 * Router itself only interprets:
 *
 * method
 * path
 * middleware
 *
 * Everything else is application-defined route metadata.
 */
export type RouteOptions<
  TMetadata extends RouteMetadata = RouteMetadata,
> = {
  method: HttpMethod;

  path: string;

  middleware?: readonly AnyMiddleware[];
} & TMetadata;

/**
 * Runtime representation of a declared route.
 *
 * `path` is relative when obtained directly from getRoutes().
 *
 * The complete decorator/configuration object remains available as
 * `options`, including all opaque application-defined fields.
 */
export interface RouteDefinition<
  TMetadata extends RouteMetadata = RouteMetadata,
> {
  readonly method: HttpMethod;

  readonly path: string;

  readonly middleware: readonly AnyMiddleware[];

  readonly options: Readonly<
    RouteOptions<TMetadata>
  >;

  readonly handlerKey?: PropertyKey;
}

export interface RouterConstructorOptions<
  TContext extends RouterContext,
  TServices extends RouterServices,
> {
  context?: TContext;

  services?: TServices;
}
