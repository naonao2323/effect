/**
 * @since 1.0.0
 */
import * as Reactivity from "@effect/experimental/Reactivity"
import * as Client from "@effect/sql/SqlClient"
import { SqlError } from "@effect/sql/SqlError"
import * as Config from "effect/Config"
import type { ConfigError } from "effect/ConfigError"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Crypto from "expo-crypto"
import * as SecureStore from "expo-secure-store"
import { make, SqliteClient, type SqliteClientConfig } from "./SqliteClient.js"

/**
 * @category models
 * @since 1.0.0
 */
export interface SqliteCipherClientConfig extends Omit<SqliteClientConfig, "encryptionKey"> {
  /** Key name used to store the encryption key in SecureStore. Defaults to `"dbKey"`. */
  readonly keyName?: string | undefined
}

/**
 * Get the encryption key from SecureStore, generating and storing a new one if absent.
 *
 * @category constructor
 * @since 1.0.0
 */
export const getEncryptionKey = (keyName = "dbKey"): Effect.Effect<string, SqlError> =>
  Effect.tryPromise({
    try: async () => {
      let key = await SecureStore.getItemAsync(keyName)
      if (!key) {
        key = Crypto.randomUUID()
        await SecureStore.setItemAsync(keyName, key)
      }
      return key
    },
    catch: (cause) => new SqlError({ cause, message: "Failed to get encryption key" })
  })

/**
 * @category layers
 * @since 1.0.0
 */
export const layerConfig = (
  config: Config.Config.Wrap<SqliteCipherClientConfig>
): Layer.Layer<SqliteClient | Client.SqlClient, ConfigError | SqlError> =>
  Layer.unwrapEffect(
    Config.unwrap(config).pipe(
      Effect.flatMap((options) =>
        Effect.map(
          getEncryptionKey(options.keyName),
          (encryptionKey) => makeLayer({ ...options, encryptionKey })
        )
      )
    )
  )

/**
 * @category layers
 * @since 1.0.0
 */
export const layer = (
  config: SqliteCipherClientConfig
): Layer.Layer<SqliteClient | Client.SqlClient, SqlError> =>
  Layer.unwrapEffect(
    Effect.map(
      getEncryptionKey(config.keyName),
      (encryptionKey) => makeLayer({ ...config, encryptionKey })
    )
  )

const makeLayer = (
  options: SqliteClientConfig
): Layer.Layer<SqliteClient | Client.SqlClient> =>
  Layer.scopedContext(
    Effect.map(make(options), (client) =>
      Context.make(SqliteClient, client).pipe(
        Context.add(Client.SqlClient, client)
      ))
  ).pipe(Layer.provide(Reactivity.layer))
