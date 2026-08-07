/**
 * A no-op stand-in for the `server-only` package under vitest.
 *
 * That package's default entry throws on import — which is the point: it makes
 * a client component that imports a server module a build error rather than a
 * runtime leak. Outside Next's bundler there is no `react-server` condition to
 * select its empty entry, so a plain test run would fail to import any module
 * that carries the marker.
 *
 * Aliasing it here does NOT weaken the guarantee. `test/deps.test.ts` asserts
 * that every key-touching module carries the marker, and separately that no
 * client component can reach one. This stub only lets those modules be loaded
 * by a test that has already established it is allowed to.
 */
export {};
