/**
 * @since 1.0.0
 */
import * as Reactivity from "@effect/experimental/Reactivity"
import * as Client from "@effect/sql/SqlClient"
import type { Connection } from "@effect/sql/SqlConnection"
import { SqlError } from "@effect/sql/SqlError"
import * as Statement from "@effect/sql/Statement"
import * as Config from "effect/Config"
import type { ConfigError } from "effect/ConfigError"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FiberRef from "effect/FiberRef"
import { identity } from "effect/Function"
import { globalValue } from "effect/GlobalValue"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as ExpoSqlite from "expo-sqlite"
import type { SQLiteVariadicBindParams } from "expo-sqlite"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

/**
 * @category type ids
 * @since 1.0.0
 */
export const TypeId: unique symbol = Symbol.for("@effect/sql-sqlite-expo/SqliteClient")

/**
 * @category type ids
 * @since 1.0.0
 */
export type TypeId = typeof TypeId

/**
 * @category models
 * @since 1.0.0
 */
export interface SqliteClient extends Client.SqlClient {
  readonly [TypeId]: TypeId
  readonly config: SqliteClientConfig

  /** Not supported in sqlite */
  readonly updateValues: never
}

/**
 * @category tags
 * @since 1.0.0
 */
export const SqliteClient = Context.GenericTag<SqliteClient>("@effect/sql-sqlite-expo/SqliteClient")

/**
 * @category models
 * @since 1.0.0
 */
export interface SqliteClientConfig {
  readonly database: string
  readonly encryptionKey?: string | undefined
  readonly spanAttributes?: Record<string, unknown> | undefined
  readonly transformResultNames?: ((str: string) => string) | undefined
  readonly transformQueryNames?: ((str: string) => string) | undefined
}

/**
 * @category fiber refs
 * @since 1.0.0
 */
export const asyncQuery: FiberRef.FiberRef<boolean> = globalValue(
  "@effect/sql-sqlite-expo/Client/asyncQuery",
  () => FiberRef.unsafeMake(false)
)

/**
 * @category fiber refs
 * @since 1.0.0
 */
export const withAsyncQuery = <R, E, A>(effect: Effect.Effect<A, E, R>) => Effect.locally(effect, asyncQuery, true)

interface SqliteConnection extends Connection { }

/**
 * @category constructor
 * @since 1.0.0
 */
export const make = (
  options: SqliteClientConfig
): Effect.Effect<SqliteClient, never, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames ?
      Statement.defaultTransforms(options.transformResultNames).array :
      undefined

    const makeConnection = Effect.gen(function* () {
      const db = ExpoSqlite.openDatabaseSync(options.database)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          try {
            db.closeSync()
          } catch {
            // nothing to do
          }
        })
      )

      const run = (
        sql: string,
        params: ReadonlyArray<unknown> = []
      ) =>
        Effect.withFiberRuntime<Array<any>, SqlError>((fiber) => {
          if (fiber.getFiberRef(asyncQuery)) {
            return Effect.tryPromise({
              try: () => db.getAllAsync(sql, ...(params as SQLiteVariadicBindParams)) as Promise<Array<any>>,
              catch: (cause) => new SqlError({ cause, message: "Failed to execute statement (async)" })
            })
          }
          return Effect.try({
            try: () => db.getAllSync<any>(sql, ...(params as SQLiteVariadicBindParams)),
            catch: (cause) => new SqlError({ cause, message: "Failed to execute statement" })
          })
        })

      return identity<SqliteConnection>({
        execute(sql, params, transformRows) {
          return transformRows
            ? Effect.map(run(sql, params), transformRows)
            : run(sql, params)
        },
        executeRaw(sql, params) {
          return run(sql, params)
        },
        executeValues(sql, params) {
          return Effect.map(run(sql, params), (results) => {
            if (results.length === 0) {
              return []
            }
            const columns = Object.keys(results[0])
            return results.map((row: any) => columns.map((column) => row[column]))
          })
        },
        executeUnprepared(sql, params, transformRows) {
          return this.execute(sql, params, transformRows)
        },
        executeStream() {
          return Effect.dieMessage("executeStream not implemented")
        }
      })
    })

    const semaphore = yield* Effect.makeSemaphore(1)
    const connection = yield* makeConnection

    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection))
    const transactionAcquirer = Effect.uninterruptibleMask((restore) =>
      Effect.as(
        Effect.zipRight(
          restore(semaphore.take(1)),
          Effect.tap(
            Effect.scope,
            (scope) => Scope.addFinalizer(scope, semaphore.release(1))
          )
        ),
        connection
      )
    )

    const spanAttributes: ReadonlyArray<readonly [string, unknown]> = [
      ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
      [ATTR_DB_SYSTEM_NAME, "sqlite"]
    ]

    const sql = Statement.make(acquirer, compiler, spanAttributes, transformRows)

    const client = yield* sql`PRAGMA key = ${options.encryptionKey!}`.pipe(
      Effect.orDie,
      Effect.when(() => options.encryptionKey !== undefined && options.encryptionKey !== ""),
      Effect.andThen(Client.make({
        acquirer,
        compiler,
        transactionAcquirer,
        spanAttributes,
        transformRows
      }))
    )

    return Object.assign(
      client as SqliteClient,
      {
        [TypeId]: TypeId,
        config: options
      }
    )
  })

/**
 * @category layers
 * @since 1.0.0
 */
export const layerConfig = (
  config: Config.Config.Wrap<SqliteClientConfig>
): Layer.Layer<SqliteClient | Client.SqlClient, ConfigError> =>
  Layer.scopedContext(
    Config.unwrap(config).pipe(
      Effect.flatMap(make),
      Effect.map((client) =>
        Context.make(SqliteClient, client).pipe(
          Context.add(Client.SqlClient, client)
        )
      )
    )
  ).pipe(Layer.provide(Reactivity.layer))

/**
 * @category layers
 * @since 1.0.0
 */
export const layer = (
  config: SqliteClientConfig
): Layer.Layer<SqliteClient | Client.SqlClient> =>
  Layer.scopedContext(
    Effect.map(make(config), (client) =>
      Context.make(SqliteClient, client).pipe(
        Context.add(Client.SqlClient, client)
      ))
  ).pipe(Layer.provide(Reactivity.layer))
