# @effect/sql-sqlite-expo

An `@effect/sql` implementation using [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/).

## Installation

```sh
npx expo install expo-sqlite
pnpm add @effect/sql @effect/sql-sqlite-expo
```

## Usage

```ts
import { SqliteClient } from "@effect/sql-sqlite-expo"
import { Effect, Layer } from "effect"

const SqlLive = SqliteClient.layer({ database: "my.db" })

const program = Effect.gen(function* () {
  const sql = yield* SqliteClient.SqliteClient
  const rows = yield* sql`SELECT * FROM users`
  console.log(rows)
})

program.pipe(Effect.provide(SqlLive), Effect.runPromise)
```
