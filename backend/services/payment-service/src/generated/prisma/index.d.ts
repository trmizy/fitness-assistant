
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model Wallet
 * 
 */
export type Wallet = $Result.DefaultSelection<Prisma.$WalletPayload>
/**
 * Model WalletLedgerEntry
 * 
 */
export type WalletLedgerEntry = $Result.DefaultSelection<Prisma.$WalletLedgerEntryPayload>
/**
 * Model PaymentTransaction
 * 
 */
export type PaymentTransaction = $Result.DefaultSelection<Prisma.$PaymentTransactionPayload>
/**
 * Model PlatformCommission
 * 
 */
export type PlatformCommission = $Result.DefaultSelection<Prisma.$PlatformCommissionPayload>
/**
 * Model PaymentWebhookEvent
 * 
 */
export type PaymentWebhookEvent = $Result.DefaultSelection<Prisma.$PaymentWebhookEventPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const WalletOwnerType: {
  CLIENT: 'CLIENT',
  PT: 'PT',
  GYM: 'GYM',
  PLATFORM: 'PLATFORM'
};

export type WalletOwnerType = (typeof WalletOwnerType)[keyof typeof WalletOwnerType]


export const WalletStatus: {
  ACTIVE: 'ACTIVE',
  FROZEN: 'FROZEN',
  CLOSED: 'CLOSED'
};

export type WalletStatus = (typeof WalletStatus)[keyof typeof WalletStatus]


export const LedgerEntryType: {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT'
};

export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType]


export const PurposeType: {
  GYM_MEMBERSHIP: 'GYM_MEMBERSHIP',
  PT_CONTRACT: 'PT_CONTRACT',
  GYM_PT_COMBO: 'GYM_PT_COMBO',
  WALLET_TOPUP: 'WALLET_TOPUP',
  REFUND: 'REFUND',
  TRAINING_PACKAGE_PURCHASE: 'TRAINING_PACKAGE_PURCHASE'
};

export type PurposeType = (typeof PurposeType)[keyof typeof PurposeType]


export const PaymentStatus: {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED'
};

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus]


export const PaymentProviderType: {
  MOCK: 'MOCK',
  VNPAY: 'VNPAY',
  MOMO: 'MOMO',
  ZALOPAY: 'ZALOPAY',
  PAYOS: 'PAYOS',
  STRIPE: 'STRIPE',
  MANUAL_BANK_TRANSFER: 'MANUAL_BANK_TRANSFER'
};

export type PaymentProviderType = (typeof PaymentProviderType)[keyof typeof PaymentProviderType]


export const RelatedEntityType: {
  GYM_MEMBERSHIP: 'GYM_MEMBERSHIP',
  PT_CONTRACT: 'PT_CONTRACT',
  WALLET_TOPUP: 'WALLET_TOPUP',
  TRAINING_PACKAGE_PURCHASE: 'TRAINING_PACKAGE_PURCHASE'
};

export type RelatedEntityType = (typeof RelatedEntityType)[keyof typeof RelatedEntityType]


export const ActivationStatus: {
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  PENDING: 'PENDING',
  ACTIVATED: 'ACTIVATED',
  ACTIVATION_FAILED: 'ACTIVATION_FAILED'
};

export type ActivationStatus = (typeof ActivationStatus)[keyof typeof ActivationStatus]


export const PartnerType: {
  GYM: 'GYM',
  PT: 'PT',
  CLIENT: 'CLIENT'
};

export type PartnerType = (typeof PartnerType)[keyof typeof PartnerType]


export const CommissionStatus: {
  PENDING: 'PENDING',
  SETTLED: 'SETTLED',
  CANCELLED: 'CANCELLED'
};

export type CommissionStatus = (typeof CommissionStatus)[keyof typeof CommissionStatus]

}

export type WalletOwnerType = $Enums.WalletOwnerType

export const WalletOwnerType: typeof $Enums.WalletOwnerType

export type WalletStatus = $Enums.WalletStatus

export const WalletStatus: typeof $Enums.WalletStatus

export type LedgerEntryType = $Enums.LedgerEntryType

export const LedgerEntryType: typeof $Enums.LedgerEntryType

export type PurposeType = $Enums.PurposeType

export const PurposeType: typeof $Enums.PurposeType

export type PaymentStatus = $Enums.PaymentStatus

export const PaymentStatus: typeof $Enums.PaymentStatus

export type PaymentProviderType = $Enums.PaymentProviderType

export const PaymentProviderType: typeof $Enums.PaymentProviderType

export type RelatedEntityType = $Enums.RelatedEntityType

export const RelatedEntityType: typeof $Enums.RelatedEntityType

export type ActivationStatus = $Enums.ActivationStatus

export const ActivationStatus: typeof $Enums.ActivationStatus

export type PartnerType = $Enums.PartnerType

export const PartnerType: typeof $Enums.PartnerType

export type CommissionStatus = $Enums.CommissionStatus

export const CommissionStatus: typeof $Enums.CommissionStatus

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Wallets
 * const wallets = await prisma.wallet.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Wallets
   * const wallets = await prisma.wallet.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb, ExtArgs>

      /**
   * `prisma.wallet`: Exposes CRUD operations for the **Wallet** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Wallets
    * const wallets = await prisma.wallet.findMany()
    * ```
    */
  get wallet(): Prisma.WalletDelegate<ExtArgs>;

  /**
   * `prisma.walletLedgerEntry`: Exposes CRUD operations for the **WalletLedgerEntry** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WalletLedgerEntries
    * const walletLedgerEntries = await prisma.walletLedgerEntry.findMany()
    * ```
    */
  get walletLedgerEntry(): Prisma.WalletLedgerEntryDelegate<ExtArgs>;

  /**
   * `prisma.paymentTransaction`: Exposes CRUD operations for the **PaymentTransaction** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PaymentTransactions
    * const paymentTransactions = await prisma.paymentTransaction.findMany()
    * ```
    */
  get paymentTransaction(): Prisma.PaymentTransactionDelegate<ExtArgs>;

  /**
   * `prisma.platformCommission`: Exposes CRUD operations for the **PlatformCommission** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PlatformCommissions
    * const platformCommissions = await prisma.platformCommission.findMany()
    * ```
    */
  get platformCommission(): Prisma.PlatformCommissionDelegate<ExtArgs>;

  /**
   * `prisma.paymentWebhookEvent`: Exposes CRUD operations for the **PaymentWebhookEvent** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PaymentWebhookEvents
    * const paymentWebhookEvents = await prisma.paymentWebhookEvent.findMany()
    * ```
    */
  get paymentWebhookEvent(): Prisma.PaymentWebhookEventDelegate<ExtArgs>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 5.22.0
   * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    Wallet: 'Wallet',
    WalletLedgerEntry: 'WalletLedgerEntry',
    PaymentTransaction: 'PaymentTransaction',
    PlatformCommission: 'PlatformCommission',
    PaymentWebhookEvent: 'PaymentWebhookEvent'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb extends $Utils.Fn<{extArgs: $Extensions.InternalArgs, clientOptions: PrismaClientOptions }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], this['params']['clientOptions']>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, ClientOptions = {}> = {
    meta: {
      modelProps: "wallet" | "walletLedgerEntry" | "paymentTransaction" | "platformCommission" | "paymentWebhookEvent"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Wallet: {
        payload: Prisma.$WalletPayload<ExtArgs>
        fields: Prisma.WalletFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WalletFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WalletFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload>
          }
          findFirst: {
            args: Prisma.WalletFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WalletFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload>
          }
          findMany: {
            args: Prisma.WalletFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload>[]
          }
          create: {
            args: Prisma.WalletCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload>
          }
          createMany: {
            args: Prisma.WalletCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WalletCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload>[]
          }
          delete: {
            args: Prisma.WalletDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload>
          }
          update: {
            args: Prisma.WalletUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload>
          }
          deleteMany: {
            args: Prisma.WalletDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WalletUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WalletUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletPayload>
          }
          aggregate: {
            args: Prisma.WalletAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWallet>
          }
          groupBy: {
            args: Prisma.WalletGroupByArgs<ExtArgs>
            result: $Utils.Optional<WalletGroupByOutputType>[]
          }
          count: {
            args: Prisma.WalletCountArgs<ExtArgs>
            result: $Utils.Optional<WalletCountAggregateOutputType> | number
          }
        }
      }
      WalletLedgerEntry: {
        payload: Prisma.$WalletLedgerEntryPayload<ExtArgs>
        fields: Prisma.WalletLedgerEntryFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WalletLedgerEntryFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WalletLedgerEntryFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload>
          }
          findFirst: {
            args: Prisma.WalletLedgerEntryFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WalletLedgerEntryFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload>
          }
          findMany: {
            args: Prisma.WalletLedgerEntryFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload>[]
          }
          create: {
            args: Prisma.WalletLedgerEntryCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload>
          }
          createMany: {
            args: Prisma.WalletLedgerEntryCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WalletLedgerEntryCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload>[]
          }
          delete: {
            args: Prisma.WalletLedgerEntryDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload>
          }
          update: {
            args: Prisma.WalletLedgerEntryUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload>
          }
          deleteMany: {
            args: Prisma.WalletLedgerEntryDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WalletLedgerEntryUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WalletLedgerEntryUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WalletLedgerEntryPayload>
          }
          aggregate: {
            args: Prisma.WalletLedgerEntryAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWalletLedgerEntry>
          }
          groupBy: {
            args: Prisma.WalletLedgerEntryGroupByArgs<ExtArgs>
            result: $Utils.Optional<WalletLedgerEntryGroupByOutputType>[]
          }
          count: {
            args: Prisma.WalletLedgerEntryCountArgs<ExtArgs>
            result: $Utils.Optional<WalletLedgerEntryCountAggregateOutputType> | number
          }
        }
      }
      PaymentTransaction: {
        payload: Prisma.$PaymentTransactionPayload<ExtArgs>
        fields: Prisma.PaymentTransactionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PaymentTransactionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PaymentTransactionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload>
          }
          findFirst: {
            args: Prisma.PaymentTransactionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PaymentTransactionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload>
          }
          findMany: {
            args: Prisma.PaymentTransactionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload>[]
          }
          create: {
            args: Prisma.PaymentTransactionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload>
          }
          createMany: {
            args: Prisma.PaymentTransactionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PaymentTransactionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload>[]
          }
          delete: {
            args: Prisma.PaymentTransactionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload>
          }
          update: {
            args: Prisma.PaymentTransactionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload>
          }
          deleteMany: {
            args: Prisma.PaymentTransactionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PaymentTransactionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PaymentTransactionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentTransactionPayload>
          }
          aggregate: {
            args: Prisma.PaymentTransactionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePaymentTransaction>
          }
          groupBy: {
            args: Prisma.PaymentTransactionGroupByArgs<ExtArgs>
            result: $Utils.Optional<PaymentTransactionGroupByOutputType>[]
          }
          count: {
            args: Prisma.PaymentTransactionCountArgs<ExtArgs>
            result: $Utils.Optional<PaymentTransactionCountAggregateOutputType> | number
          }
        }
      }
      PlatformCommission: {
        payload: Prisma.$PlatformCommissionPayload<ExtArgs>
        fields: Prisma.PlatformCommissionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PlatformCommissionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PlatformCommissionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload>
          }
          findFirst: {
            args: Prisma.PlatformCommissionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PlatformCommissionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload>
          }
          findMany: {
            args: Prisma.PlatformCommissionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload>[]
          }
          create: {
            args: Prisma.PlatformCommissionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload>
          }
          createMany: {
            args: Prisma.PlatformCommissionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PlatformCommissionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload>[]
          }
          delete: {
            args: Prisma.PlatformCommissionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload>
          }
          update: {
            args: Prisma.PlatformCommissionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload>
          }
          deleteMany: {
            args: Prisma.PlatformCommissionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PlatformCommissionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PlatformCommissionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlatformCommissionPayload>
          }
          aggregate: {
            args: Prisma.PlatformCommissionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePlatformCommission>
          }
          groupBy: {
            args: Prisma.PlatformCommissionGroupByArgs<ExtArgs>
            result: $Utils.Optional<PlatformCommissionGroupByOutputType>[]
          }
          count: {
            args: Prisma.PlatformCommissionCountArgs<ExtArgs>
            result: $Utils.Optional<PlatformCommissionCountAggregateOutputType> | number
          }
        }
      }
      PaymentWebhookEvent: {
        payload: Prisma.$PaymentWebhookEventPayload<ExtArgs>
        fields: Prisma.PaymentWebhookEventFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PaymentWebhookEventFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PaymentWebhookEventFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload>
          }
          findFirst: {
            args: Prisma.PaymentWebhookEventFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PaymentWebhookEventFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload>
          }
          findMany: {
            args: Prisma.PaymentWebhookEventFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload>[]
          }
          create: {
            args: Prisma.PaymentWebhookEventCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload>
          }
          createMany: {
            args: Prisma.PaymentWebhookEventCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PaymentWebhookEventCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload>[]
          }
          delete: {
            args: Prisma.PaymentWebhookEventDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload>
          }
          update: {
            args: Prisma.PaymentWebhookEventUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload>
          }
          deleteMany: {
            args: Prisma.PaymentWebhookEventDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PaymentWebhookEventUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PaymentWebhookEventUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentWebhookEventPayload>
          }
          aggregate: {
            args: Prisma.PaymentWebhookEventAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePaymentWebhookEvent>
          }
          groupBy: {
            args: Prisma.PaymentWebhookEventGroupByArgs<ExtArgs>
            result: $Utils.Optional<PaymentWebhookEventGroupByOutputType>[]
          }
          count: {
            args: Prisma.PaymentWebhookEventCountArgs<ExtArgs>
            result: $Utils.Optional<PaymentWebhookEventCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
  }


  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type WalletCountOutputType
   */

  export type WalletCountOutputType = {
    ledgerEntries: number
  }

  export type WalletCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    ledgerEntries?: boolean | WalletCountOutputTypeCountLedgerEntriesArgs
  }

  // Custom InputTypes
  /**
   * WalletCountOutputType without action
   */
  export type WalletCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletCountOutputType
     */
    select?: WalletCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * WalletCountOutputType without action
   */
  export type WalletCountOutputTypeCountLedgerEntriesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WalletLedgerEntryWhereInput
  }


  /**
   * Count Type PaymentTransactionCountOutputType
   */

  export type PaymentTransactionCountOutputType = {
    commissions: number
    ledgerEntries: number
  }

  export type PaymentTransactionCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    commissions?: boolean | PaymentTransactionCountOutputTypeCountCommissionsArgs
    ledgerEntries?: boolean | PaymentTransactionCountOutputTypeCountLedgerEntriesArgs
  }

  // Custom InputTypes
  /**
   * PaymentTransactionCountOutputType without action
   */
  export type PaymentTransactionCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransactionCountOutputType
     */
    select?: PaymentTransactionCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * PaymentTransactionCountOutputType without action
   */
  export type PaymentTransactionCountOutputTypeCountCommissionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PlatformCommissionWhereInput
  }

  /**
   * PaymentTransactionCountOutputType without action
   */
  export type PaymentTransactionCountOutputTypeCountLedgerEntriesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WalletLedgerEntryWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Wallet
   */

  export type AggregateWallet = {
    _count: WalletCountAggregateOutputType | null
    _avg: WalletAvgAggregateOutputType | null
    _sum: WalletSumAggregateOutputType | null
    _min: WalletMinAggregateOutputType | null
    _max: WalletMaxAggregateOutputType | null
  }

  export type WalletAvgAggregateOutputType = {
    availableBalance: Decimal | null
    lockedBalance: Decimal | null
  }

  export type WalletSumAggregateOutputType = {
    availableBalance: Decimal | null
    lockedBalance: Decimal | null
  }

  export type WalletMinAggregateOutputType = {
    id: string | null
    ownerType: $Enums.WalletOwnerType | null
    ownerId: string | null
    availableBalance: Decimal | null
    lockedBalance: Decimal | null
    status: $Enums.WalletStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WalletMaxAggregateOutputType = {
    id: string | null
    ownerType: $Enums.WalletOwnerType | null
    ownerId: string | null
    availableBalance: Decimal | null
    lockedBalance: Decimal | null
    status: $Enums.WalletStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WalletCountAggregateOutputType = {
    id: number
    ownerType: number
    ownerId: number
    availableBalance: number
    lockedBalance: number
    status: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type WalletAvgAggregateInputType = {
    availableBalance?: true
    lockedBalance?: true
  }

  export type WalletSumAggregateInputType = {
    availableBalance?: true
    lockedBalance?: true
  }

  export type WalletMinAggregateInputType = {
    id?: true
    ownerType?: true
    ownerId?: true
    availableBalance?: true
    lockedBalance?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WalletMaxAggregateInputType = {
    id?: true
    ownerType?: true
    ownerId?: true
    availableBalance?: true
    lockedBalance?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WalletCountAggregateInputType = {
    id?: true
    ownerType?: true
    ownerId?: true
    availableBalance?: true
    lockedBalance?: true
    status?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type WalletAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Wallet to aggregate.
     */
    where?: WalletWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Wallets to fetch.
     */
    orderBy?: WalletOrderByWithRelationInput | WalletOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WalletWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Wallets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Wallets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Wallets
    **/
    _count?: true | WalletCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: WalletAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: WalletSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WalletMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WalletMaxAggregateInputType
  }

  export type GetWalletAggregateType<T extends WalletAggregateArgs> = {
        [P in keyof T & keyof AggregateWallet]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWallet[P]>
      : GetScalarType<T[P], AggregateWallet[P]>
  }




  export type WalletGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WalletWhereInput
    orderBy?: WalletOrderByWithAggregationInput | WalletOrderByWithAggregationInput[]
    by: WalletScalarFieldEnum[] | WalletScalarFieldEnum
    having?: WalletScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WalletCountAggregateInputType | true
    _avg?: WalletAvgAggregateInputType
    _sum?: WalletSumAggregateInputType
    _min?: WalletMinAggregateInputType
    _max?: WalletMaxAggregateInputType
  }

  export type WalletGroupByOutputType = {
    id: string
    ownerType: $Enums.WalletOwnerType
    ownerId: string
    availableBalance: Decimal
    lockedBalance: Decimal
    status: $Enums.WalletStatus
    createdAt: Date
    updatedAt: Date
    _count: WalletCountAggregateOutputType | null
    _avg: WalletAvgAggregateOutputType | null
    _sum: WalletSumAggregateOutputType | null
    _min: WalletMinAggregateOutputType | null
    _max: WalletMaxAggregateOutputType | null
  }

  type GetWalletGroupByPayload<T extends WalletGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WalletGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WalletGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WalletGroupByOutputType[P]>
            : GetScalarType<T[P], WalletGroupByOutputType[P]>
        }
      >
    >


  export type WalletSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    ownerType?: boolean
    ownerId?: boolean
    availableBalance?: boolean
    lockedBalance?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    ledgerEntries?: boolean | Wallet$ledgerEntriesArgs<ExtArgs>
    _count?: boolean | WalletCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["wallet"]>

  export type WalletSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    ownerType?: boolean
    ownerId?: boolean
    availableBalance?: boolean
    lockedBalance?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["wallet"]>

  export type WalletSelectScalar = {
    id?: boolean
    ownerType?: boolean
    ownerId?: boolean
    availableBalance?: boolean
    lockedBalance?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type WalletInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    ledgerEntries?: boolean | Wallet$ledgerEntriesArgs<ExtArgs>
    _count?: boolean | WalletCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type WalletIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $WalletPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Wallet"
    objects: {
      ledgerEntries: Prisma.$WalletLedgerEntryPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      ownerType: $Enums.WalletOwnerType
      ownerId: string
      availableBalance: Prisma.Decimal
      lockedBalance: Prisma.Decimal
      status: $Enums.WalletStatus
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["wallet"]>
    composites: {}
  }

  type WalletGetPayload<S extends boolean | null | undefined | WalletDefaultArgs> = $Result.GetResult<Prisma.$WalletPayload, S>

  type WalletCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WalletFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WalletCountAggregateInputType | true
    }

  export interface WalletDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Wallet'], meta: { name: 'Wallet' } }
    /**
     * Find zero or one Wallet that matches the filter.
     * @param {WalletFindUniqueArgs} args - Arguments to find a Wallet
     * @example
     * // Get one Wallet
     * const wallet = await prisma.wallet.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WalletFindUniqueArgs>(args: SelectSubset<T, WalletFindUniqueArgs<ExtArgs>>): Prisma__WalletClient<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Wallet that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WalletFindUniqueOrThrowArgs} args - Arguments to find a Wallet
     * @example
     * // Get one Wallet
     * const wallet = await prisma.wallet.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WalletFindUniqueOrThrowArgs>(args: SelectSubset<T, WalletFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WalletClient<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Wallet that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletFindFirstArgs} args - Arguments to find a Wallet
     * @example
     * // Get one Wallet
     * const wallet = await prisma.wallet.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WalletFindFirstArgs>(args?: SelectSubset<T, WalletFindFirstArgs<ExtArgs>>): Prisma__WalletClient<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Wallet that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletFindFirstOrThrowArgs} args - Arguments to find a Wallet
     * @example
     * // Get one Wallet
     * const wallet = await prisma.wallet.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WalletFindFirstOrThrowArgs>(args?: SelectSubset<T, WalletFindFirstOrThrowArgs<ExtArgs>>): Prisma__WalletClient<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Wallets that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Wallets
     * const wallets = await prisma.wallet.findMany()
     * 
     * // Get first 10 Wallets
     * const wallets = await prisma.wallet.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const walletWithIdOnly = await prisma.wallet.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WalletFindManyArgs>(args?: SelectSubset<T, WalletFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Wallet.
     * @param {WalletCreateArgs} args - Arguments to create a Wallet.
     * @example
     * // Create one Wallet
     * const Wallet = await prisma.wallet.create({
     *   data: {
     *     // ... data to create a Wallet
     *   }
     * })
     * 
     */
    create<T extends WalletCreateArgs>(args: SelectSubset<T, WalletCreateArgs<ExtArgs>>): Prisma__WalletClient<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Wallets.
     * @param {WalletCreateManyArgs} args - Arguments to create many Wallets.
     * @example
     * // Create many Wallets
     * const wallet = await prisma.wallet.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WalletCreateManyArgs>(args?: SelectSubset<T, WalletCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Wallets and returns the data saved in the database.
     * @param {WalletCreateManyAndReturnArgs} args - Arguments to create many Wallets.
     * @example
     * // Create many Wallets
     * const wallet = await prisma.wallet.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Wallets and only return the `id`
     * const walletWithIdOnly = await prisma.wallet.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WalletCreateManyAndReturnArgs>(args?: SelectSubset<T, WalletCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Wallet.
     * @param {WalletDeleteArgs} args - Arguments to delete one Wallet.
     * @example
     * // Delete one Wallet
     * const Wallet = await prisma.wallet.delete({
     *   where: {
     *     // ... filter to delete one Wallet
     *   }
     * })
     * 
     */
    delete<T extends WalletDeleteArgs>(args: SelectSubset<T, WalletDeleteArgs<ExtArgs>>): Prisma__WalletClient<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Wallet.
     * @param {WalletUpdateArgs} args - Arguments to update one Wallet.
     * @example
     * // Update one Wallet
     * const wallet = await prisma.wallet.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WalletUpdateArgs>(args: SelectSubset<T, WalletUpdateArgs<ExtArgs>>): Prisma__WalletClient<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Wallets.
     * @param {WalletDeleteManyArgs} args - Arguments to filter Wallets to delete.
     * @example
     * // Delete a few Wallets
     * const { count } = await prisma.wallet.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WalletDeleteManyArgs>(args?: SelectSubset<T, WalletDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Wallets.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Wallets
     * const wallet = await prisma.wallet.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WalletUpdateManyArgs>(args: SelectSubset<T, WalletUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Wallet.
     * @param {WalletUpsertArgs} args - Arguments to update or create a Wallet.
     * @example
     * // Update or create a Wallet
     * const wallet = await prisma.wallet.upsert({
     *   create: {
     *     // ... data to create a Wallet
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Wallet we want to update
     *   }
     * })
     */
    upsert<T extends WalletUpsertArgs>(args: SelectSubset<T, WalletUpsertArgs<ExtArgs>>): Prisma__WalletClient<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Wallets.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletCountArgs} args - Arguments to filter Wallets to count.
     * @example
     * // Count the number of Wallets
     * const count = await prisma.wallet.count({
     *   where: {
     *     // ... the filter for the Wallets we want to count
     *   }
     * })
    **/
    count<T extends WalletCountArgs>(
      args?: Subset<T, WalletCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WalletCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Wallet.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends WalletAggregateArgs>(args: Subset<T, WalletAggregateArgs>): Prisma.PrismaPromise<GetWalletAggregateType<T>>

    /**
     * Group by Wallet.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends WalletGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WalletGroupByArgs['orderBy'] }
        : { orderBy?: WalletGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, WalletGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWalletGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Wallet model
   */
  readonly fields: WalletFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Wallet.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WalletClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    ledgerEntries<T extends Wallet$ledgerEntriesArgs<ExtArgs> = {}>(args?: Subset<T, Wallet$ledgerEntriesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Wallet model
   */ 
  interface WalletFieldRefs {
    readonly id: FieldRef<"Wallet", 'String'>
    readonly ownerType: FieldRef<"Wallet", 'WalletOwnerType'>
    readonly ownerId: FieldRef<"Wallet", 'String'>
    readonly availableBalance: FieldRef<"Wallet", 'Decimal'>
    readonly lockedBalance: FieldRef<"Wallet", 'Decimal'>
    readonly status: FieldRef<"Wallet", 'WalletStatus'>
    readonly createdAt: FieldRef<"Wallet", 'DateTime'>
    readonly updatedAt: FieldRef<"Wallet", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Wallet findUnique
   */
  export type WalletFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
    /**
     * Filter, which Wallet to fetch.
     */
    where: WalletWhereUniqueInput
  }

  /**
   * Wallet findUniqueOrThrow
   */
  export type WalletFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
    /**
     * Filter, which Wallet to fetch.
     */
    where: WalletWhereUniqueInput
  }

  /**
   * Wallet findFirst
   */
  export type WalletFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
    /**
     * Filter, which Wallet to fetch.
     */
    where?: WalletWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Wallets to fetch.
     */
    orderBy?: WalletOrderByWithRelationInput | WalletOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Wallets.
     */
    cursor?: WalletWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Wallets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Wallets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Wallets.
     */
    distinct?: WalletScalarFieldEnum | WalletScalarFieldEnum[]
  }

  /**
   * Wallet findFirstOrThrow
   */
  export type WalletFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
    /**
     * Filter, which Wallet to fetch.
     */
    where?: WalletWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Wallets to fetch.
     */
    orderBy?: WalletOrderByWithRelationInput | WalletOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Wallets.
     */
    cursor?: WalletWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Wallets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Wallets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Wallets.
     */
    distinct?: WalletScalarFieldEnum | WalletScalarFieldEnum[]
  }

  /**
   * Wallet findMany
   */
  export type WalletFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
    /**
     * Filter, which Wallets to fetch.
     */
    where?: WalletWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Wallets to fetch.
     */
    orderBy?: WalletOrderByWithRelationInput | WalletOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Wallets.
     */
    cursor?: WalletWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Wallets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Wallets.
     */
    skip?: number
    distinct?: WalletScalarFieldEnum | WalletScalarFieldEnum[]
  }

  /**
   * Wallet create
   */
  export type WalletCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
    /**
     * The data needed to create a Wallet.
     */
    data: XOR<WalletCreateInput, WalletUncheckedCreateInput>
  }

  /**
   * Wallet createMany
   */
  export type WalletCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Wallets.
     */
    data: WalletCreateManyInput | WalletCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Wallet createManyAndReturn
   */
  export type WalletCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Wallets.
     */
    data: WalletCreateManyInput | WalletCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Wallet update
   */
  export type WalletUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
    /**
     * The data needed to update a Wallet.
     */
    data: XOR<WalletUpdateInput, WalletUncheckedUpdateInput>
    /**
     * Choose, which Wallet to update.
     */
    where: WalletWhereUniqueInput
  }

  /**
   * Wallet updateMany
   */
  export type WalletUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Wallets.
     */
    data: XOR<WalletUpdateManyMutationInput, WalletUncheckedUpdateManyInput>
    /**
     * Filter which Wallets to update
     */
    where?: WalletWhereInput
  }

  /**
   * Wallet upsert
   */
  export type WalletUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
    /**
     * The filter to search for the Wallet to update in case it exists.
     */
    where: WalletWhereUniqueInput
    /**
     * In case the Wallet found by the `where` argument doesn't exist, create a new Wallet with this data.
     */
    create: XOR<WalletCreateInput, WalletUncheckedCreateInput>
    /**
     * In case the Wallet was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WalletUpdateInput, WalletUncheckedUpdateInput>
  }

  /**
   * Wallet delete
   */
  export type WalletDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
    /**
     * Filter which Wallet to delete.
     */
    where: WalletWhereUniqueInput
  }

  /**
   * Wallet deleteMany
   */
  export type WalletDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Wallets to delete
     */
    where?: WalletWhereInput
  }

  /**
   * Wallet.ledgerEntries
   */
  export type Wallet$ledgerEntriesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    where?: WalletLedgerEntryWhereInput
    orderBy?: WalletLedgerEntryOrderByWithRelationInput | WalletLedgerEntryOrderByWithRelationInput[]
    cursor?: WalletLedgerEntryWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WalletLedgerEntryScalarFieldEnum | WalletLedgerEntryScalarFieldEnum[]
  }

  /**
   * Wallet without action
   */
  export type WalletDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Wallet
     */
    select?: WalletSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletInclude<ExtArgs> | null
  }


  /**
   * Model WalletLedgerEntry
   */

  export type AggregateWalletLedgerEntry = {
    _count: WalletLedgerEntryCountAggregateOutputType | null
    _avg: WalletLedgerEntryAvgAggregateOutputType | null
    _sum: WalletLedgerEntrySumAggregateOutputType | null
    _min: WalletLedgerEntryMinAggregateOutputType | null
    _max: WalletLedgerEntryMaxAggregateOutputType | null
  }

  export type WalletLedgerEntryAvgAggregateOutputType = {
    amount: Decimal | null
    balanceBefore: Decimal | null
    balanceAfter: Decimal | null
  }

  export type WalletLedgerEntrySumAggregateOutputType = {
    amount: Decimal | null
    balanceBefore: Decimal | null
    balanceAfter: Decimal | null
  }

  export type WalletLedgerEntryMinAggregateOutputType = {
    id: string | null
    walletId: string | null
    transactionId: string | null
    entryType: $Enums.LedgerEntryType | null
    amount: Decimal | null
    balanceBefore: Decimal | null
    balanceAfter: Decimal | null
    description: string | null
    createdAt: Date | null
  }

  export type WalletLedgerEntryMaxAggregateOutputType = {
    id: string | null
    walletId: string | null
    transactionId: string | null
    entryType: $Enums.LedgerEntryType | null
    amount: Decimal | null
    balanceBefore: Decimal | null
    balanceAfter: Decimal | null
    description: string | null
    createdAt: Date | null
  }

  export type WalletLedgerEntryCountAggregateOutputType = {
    id: number
    walletId: number
    transactionId: number
    entryType: number
    amount: number
    balanceBefore: number
    balanceAfter: number
    description: number
    createdAt: number
    _all: number
  }


  export type WalletLedgerEntryAvgAggregateInputType = {
    amount?: true
    balanceBefore?: true
    balanceAfter?: true
  }

  export type WalletLedgerEntrySumAggregateInputType = {
    amount?: true
    balanceBefore?: true
    balanceAfter?: true
  }

  export type WalletLedgerEntryMinAggregateInputType = {
    id?: true
    walletId?: true
    transactionId?: true
    entryType?: true
    amount?: true
    balanceBefore?: true
    balanceAfter?: true
    description?: true
    createdAt?: true
  }

  export type WalletLedgerEntryMaxAggregateInputType = {
    id?: true
    walletId?: true
    transactionId?: true
    entryType?: true
    amount?: true
    balanceBefore?: true
    balanceAfter?: true
    description?: true
    createdAt?: true
  }

  export type WalletLedgerEntryCountAggregateInputType = {
    id?: true
    walletId?: true
    transactionId?: true
    entryType?: true
    amount?: true
    balanceBefore?: true
    balanceAfter?: true
    description?: true
    createdAt?: true
    _all?: true
  }

  export type WalletLedgerEntryAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WalletLedgerEntry to aggregate.
     */
    where?: WalletLedgerEntryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WalletLedgerEntries to fetch.
     */
    orderBy?: WalletLedgerEntryOrderByWithRelationInput | WalletLedgerEntryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WalletLedgerEntryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WalletLedgerEntries from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WalletLedgerEntries.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WalletLedgerEntries
    **/
    _count?: true | WalletLedgerEntryCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: WalletLedgerEntryAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: WalletLedgerEntrySumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WalletLedgerEntryMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WalletLedgerEntryMaxAggregateInputType
  }

  export type GetWalletLedgerEntryAggregateType<T extends WalletLedgerEntryAggregateArgs> = {
        [P in keyof T & keyof AggregateWalletLedgerEntry]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWalletLedgerEntry[P]>
      : GetScalarType<T[P], AggregateWalletLedgerEntry[P]>
  }




  export type WalletLedgerEntryGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WalletLedgerEntryWhereInput
    orderBy?: WalletLedgerEntryOrderByWithAggregationInput | WalletLedgerEntryOrderByWithAggregationInput[]
    by: WalletLedgerEntryScalarFieldEnum[] | WalletLedgerEntryScalarFieldEnum
    having?: WalletLedgerEntryScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WalletLedgerEntryCountAggregateInputType | true
    _avg?: WalletLedgerEntryAvgAggregateInputType
    _sum?: WalletLedgerEntrySumAggregateInputType
    _min?: WalletLedgerEntryMinAggregateInputType
    _max?: WalletLedgerEntryMaxAggregateInputType
  }

  export type WalletLedgerEntryGroupByOutputType = {
    id: string
    walletId: string
    transactionId: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal
    balanceBefore: Decimal
    balanceAfter: Decimal
    description: string | null
    createdAt: Date
    _count: WalletLedgerEntryCountAggregateOutputType | null
    _avg: WalletLedgerEntryAvgAggregateOutputType | null
    _sum: WalletLedgerEntrySumAggregateOutputType | null
    _min: WalletLedgerEntryMinAggregateOutputType | null
    _max: WalletLedgerEntryMaxAggregateOutputType | null
  }

  type GetWalletLedgerEntryGroupByPayload<T extends WalletLedgerEntryGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WalletLedgerEntryGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WalletLedgerEntryGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WalletLedgerEntryGroupByOutputType[P]>
            : GetScalarType<T[P], WalletLedgerEntryGroupByOutputType[P]>
        }
      >
    >


  export type WalletLedgerEntrySelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    walletId?: boolean
    transactionId?: boolean
    entryType?: boolean
    amount?: boolean
    balanceBefore?: boolean
    balanceAfter?: boolean
    description?: boolean
    createdAt?: boolean
    wallet?: boolean | WalletDefaultArgs<ExtArgs>
    transaction?: boolean | PaymentTransactionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["walletLedgerEntry"]>

  export type WalletLedgerEntrySelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    walletId?: boolean
    transactionId?: boolean
    entryType?: boolean
    amount?: boolean
    balanceBefore?: boolean
    balanceAfter?: boolean
    description?: boolean
    createdAt?: boolean
    wallet?: boolean | WalletDefaultArgs<ExtArgs>
    transaction?: boolean | PaymentTransactionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["walletLedgerEntry"]>

  export type WalletLedgerEntrySelectScalar = {
    id?: boolean
    walletId?: boolean
    transactionId?: boolean
    entryType?: boolean
    amount?: boolean
    balanceBefore?: boolean
    balanceAfter?: boolean
    description?: boolean
    createdAt?: boolean
  }

  export type WalletLedgerEntryInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    wallet?: boolean | WalletDefaultArgs<ExtArgs>
    transaction?: boolean | PaymentTransactionDefaultArgs<ExtArgs>
  }
  export type WalletLedgerEntryIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    wallet?: boolean | WalletDefaultArgs<ExtArgs>
    transaction?: boolean | PaymentTransactionDefaultArgs<ExtArgs>
  }

  export type $WalletLedgerEntryPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WalletLedgerEntry"
    objects: {
      wallet: Prisma.$WalletPayload<ExtArgs>
      transaction: Prisma.$PaymentTransactionPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      walletId: string
      transactionId: string
      entryType: $Enums.LedgerEntryType
      amount: Prisma.Decimal
      balanceBefore: Prisma.Decimal
      balanceAfter: Prisma.Decimal
      description: string | null
      createdAt: Date
    }, ExtArgs["result"]["walletLedgerEntry"]>
    composites: {}
  }

  type WalletLedgerEntryGetPayload<S extends boolean | null | undefined | WalletLedgerEntryDefaultArgs> = $Result.GetResult<Prisma.$WalletLedgerEntryPayload, S>

  type WalletLedgerEntryCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WalletLedgerEntryFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WalletLedgerEntryCountAggregateInputType | true
    }

  export interface WalletLedgerEntryDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WalletLedgerEntry'], meta: { name: 'WalletLedgerEntry' } }
    /**
     * Find zero or one WalletLedgerEntry that matches the filter.
     * @param {WalletLedgerEntryFindUniqueArgs} args - Arguments to find a WalletLedgerEntry
     * @example
     * // Get one WalletLedgerEntry
     * const walletLedgerEntry = await prisma.walletLedgerEntry.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WalletLedgerEntryFindUniqueArgs>(args: SelectSubset<T, WalletLedgerEntryFindUniqueArgs<ExtArgs>>): Prisma__WalletLedgerEntryClient<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WalletLedgerEntry that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WalletLedgerEntryFindUniqueOrThrowArgs} args - Arguments to find a WalletLedgerEntry
     * @example
     * // Get one WalletLedgerEntry
     * const walletLedgerEntry = await prisma.walletLedgerEntry.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WalletLedgerEntryFindUniqueOrThrowArgs>(args: SelectSubset<T, WalletLedgerEntryFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WalletLedgerEntryClient<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WalletLedgerEntry that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletLedgerEntryFindFirstArgs} args - Arguments to find a WalletLedgerEntry
     * @example
     * // Get one WalletLedgerEntry
     * const walletLedgerEntry = await prisma.walletLedgerEntry.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WalletLedgerEntryFindFirstArgs>(args?: SelectSubset<T, WalletLedgerEntryFindFirstArgs<ExtArgs>>): Prisma__WalletLedgerEntryClient<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WalletLedgerEntry that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletLedgerEntryFindFirstOrThrowArgs} args - Arguments to find a WalletLedgerEntry
     * @example
     * // Get one WalletLedgerEntry
     * const walletLedgerEntry = await prisma.walletLedgerEntry.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WalletLedgerEntryFindFirstOrThrowArgs>(args?: SelectSubset<T, WalletLedgerEntryFindFirstOrThrowArgs<ExtArgs>>): Prisma__WalletLedgerEntryClient<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WalletLedgerEntries that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletLedgerEntryFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WalletLedgerEntries
     * const walletLedgerEntries = await prisma.walletLedgerEntry.findMany()
     * 
     * // Get first 10 WalletLedgerEntries
     * const walletLedgerEntries = await prisma.walletLedgerEntry.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const walletLedgerEntryWithIdOnly = await prisma.walletLedgerEntry.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WalletLedgerEntryFindManyArgs>(args?: SelectSubset<T, WalletLedgerEntryFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WalletLedgerEntry.
     * @param {WalletLedgerEntryCreateArgs} args - Arguments to create a WalletLedgerEntry.
     * @example
     * // Create one WalletLedgerEntry
     * const WalletLedgerEntry = await prisma.walletLedgerEntry.create({
     *   data: {
     *     // ... data to create a WalletLedgerEntry
     *   }
     * })
     * 
     */
    create<T extends WalletLedgerEntryCreateArgs>(args: SelectSubset<T, WalletLedgerEntryCreateArgs<ExtArgs>>): Prisma__WalletLedgerEntryClient<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WalletLedgerEntries.
     * @param {WalletLedgerEntryCreateManyArgs} args - Arguments to create many WalletLedgerEntries.
     * @example
     * // Create many WalletLedgerEntries
     * const walletLedgerEntry = await prisma.walletLedgerEntry.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WalletLedgerEntryCreateManyArgs>(args?: SelectSubset<T, WalletLedgerEntryCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WalletLedgerEntries and returns the data saved in the database.
     * @param {WalletLedgerEntryCreateManyAndReturnArgs} args - Arguments to create many WalletLedgerEntries.
     * @example
     * // Create many WalletLedgerEntries
     * const walletLedgerEntry = await prisma.walletLedgerEntry.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WalletLedgerEntries and only return the `id`
     * const walletLedgerEntryWithIdOnly = await prisma.walletLedgerEntry.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WalletLedgerEntryCreateManyAndReturnArgs>(args?: SelectSubset<T, WalletLedgerEntryCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WalletLedgerEntry.
     * @param {WalletLedgerEntryDeleteArgs} args - Arguments to delete one WalletLedgerEntry.
     * @example
     * // Delete one WalletLedgerEntry
     * const WalletLedgerEntry = await prisma.walletLedgerEntry.delete({
     *   where: {
     *     // ... filter to delete one WalletLedgerEntry
     *   }
     * })
     * 
     */
    delete<T extends WalletLedgerEntryDeleteArgs>(args: SelectSubset<T, WalletLedgerEntryDeleteArgs<ExtArgs>>): Prisma__WalletLedgerEntryClient<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WalletLedgerEntry.
     * @param {WalletLedgerEntryUpdateArgs} args - Arguments to update one WalletLedgerEntry.
     * @example
     * // Update one WalletLedgerEntry
     * const walletLedgerEntry = await prisma.walletLedgerEntry.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WalletLedgerEntryUpdateArgs>(args: SelectSubset<T, WalletLedgerEntryUpdateArgs<ExtArgs>>): Prisma__WalletLedgerEntryClient<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WalletLedgerEntries.
     * @param {WalletLedgerEntryDeleteManyArgs} args - Arguments to filter WalletLedgerEntries to delete.
     * @example
     * // Delete a few WalletLedgerEntries
     * const { count } = await prisma.walletLedgerEntry.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WalletLedgerEntryDeleteManyArgs>(args?: SelectSubset<T, WalletLedgerEntryDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WalletLedgerEntries.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletLedgerEntryUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WalletLedgerEntries
     * const walletLedgerEntry = await prisma.walletLedgerEntry.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WalletLedgerEntryUpdateManyArgs>(args: SelectSubset<T, WalletLedgerEntryUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WalletLedgerEntry.
     * @param {WalletLedgerEntryUpsertArgs} args - Arguments to update or create a WalletLedgerEntry.
     * @example
     * // Update or create a WalletLedgerEntry
     * const walletLedgerEntry = await prisma.walletLedgerEntry.upsert({
     *   create: {
     *     // ... data to create a WalletLedgerEntry
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WalletLedgerEntry we want to update
     *   }
     * })
     */
    upsert<T extends WalletLedgerEntryUpsertArgs>(args: SelectSubset<T, WalletLedgerEntryUpsertArgs<ExtArgs>>): Prisma__WalletLedgerEntryClient<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WalletLedgerEntries.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletLedgerEntryCountArgs} args - Arguments to filter WalletLedgerEntries to count.
     * @example
     * // Count the number of WalletLedgerEntries
     * const count = await prisma.walletLedgerEntry.count({
     *   where: {
     *     // ... the filter for the WalletLedgerEntries we want to count
     *   }
     * })
    **/
    count<T extends WalletLedgerEntryCountArgs>(
      args?: Subset<T, WalletLedgerEntryCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WalletLedgerEntryCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WalletLedgerEntry.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletLedgerEntryAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends WalletLedgerEntryAggregateArgs>(args: Subset<T, WalletLedgerEntryAggregateArgs>): Prisma.PrismaPromise<GetWalletLedgerEntryAggregateType<T>>

    /**
     * Group by WalletLedgerEntry.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WalletLedgerEntryGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends WalletLedgerEntryGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WalletLedgerEntryGroupByArgs['orderBy'] }
        : { orderBy?: WalletLedgerEntryGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, WalletLedgerEntryGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWalletLedgerEntryGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WalletLedgerEntry model
   */
  readonly fields: WalletLedgerEntryFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WalletLedgerEntry.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WalletLedgerEntryClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    wallet<T extends WalletDefaultArgs<ExtArgs> = {}>(args?: Subset<T, WalletDefaultArgs<ExtArgs>>): Prisma__WalletClient<$Result.GetResult<Prisma.$WalletPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    transaction<T extends PaymentTransactionDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PaymentTransactionDefaultArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the WalletLedgerEntry model
   */ 
  interface WalletLedgerEntryFieldRefs {
    readonly id: FieldRef<"WalletLedgerEntry", 'String'>
    readonly walletId: FieldRef<"WalletLedgerEntry", 'String'>
    readonly transactionId: FieldRef<"WalletLedgerEntry", 'String'>
    readonly entryType: FieldRef<"WalletLedgerEntry", 'LedgerEntryType'>
    readonly amount: FieldRef<"WalletLedgerEntry", 'Decimal'>
    readonly balanceBefore: FieldRef<"WalletLedgerEntry", 'Decimal'>
    readonly balanceAfter: FieldRef<"WalletLedgerEntry", 'Decimal'>
    readonly description: FieldRef<"WalletLedgerEntry", 'String'>
    readonly createdAt: FieldRef<"WalletLedgerEntry", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * WalletLedgerEntry findUnique
   */
  export type WalletLedgerEntryFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    /**
     * Filter, which WalletLedgerEntry to fetch.
     */
    where: WalletLedgerEntryWhereUniqueInput
  }

  /**
   * WalletLedgerEntry findUniqueOrThrow
   */
  export type WalletLedgerEntryFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    /**
     * Filter, which WalletLedgerEntry to fetch.
     */
    where: WalletLedgerEntryWhereUniqueInput
  }

  /**
   * WalletLedgerEntry findFirst
   */
  export type WalletLedgerEntryFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    /**
     * Filter, which WalletLedgerEntry to fetch.
     */
    where?: WalletLedgerEntryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WalletLedgerEntries to fetch.
     */
    orderBy?: WalletLedgerEntryOrderByWithRelationInput | WalletLedgerEntryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WalletLedgerEntries.
     */
    cursor?: WalletLedgerEntryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WalletLedgerEntries from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WalletLedgerEntries.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WalletLedgerEntries.
     */
    distinct?: WalletLedgerEntryScalarFieldEnum | WalletLedgerEntryScalarFieldEnum[]
  }

  /**
   * WalletLedgerEntry findFirstOrThrow
   */
  export type WalletLedgerEntryFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    /**
     * Filter, which WalletLedgerEntry to fetch.
     */
    where?: WalletLedgerEntryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WalletLedgerEntries to fetch.
     */
    orderBy?: WalletLedgerEntryOrderByWithRelationInput | WalletLedgerEntryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WalletLedgerEntries.
     */
    cursor?: WalletLedgerEntryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WalletLedgerEntries from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WalletLedgerEntries.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WalletLedgerEntries.
     */
    distinct?: WalletLedgerEntryScalarFieldEnum | WalletLedgerEntryScalarFieldEnum[]
  }

  /**
   * WalletLedgerEntry findMany
   */
  export type WalletLedgerEntryFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    /**
     * Filter, which WalletLedgerEntries to fetch.
     */
    where?: WalletLedgerEntryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WalletLedgerEntries to fetch.
     */
    orderBy?: WalletLedgerEntryOrderByWithRelationInput | WalletLedgerEntryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WalletLedgerEntries.
     */
    cursor?: WalletLedgerEntryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WalletLedgerEntries from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WalletLedgerEntries.
     */
    skip?: number
    distinct?: WalletLedgerEntryScalarFieldEnum | WalletLedgerEntryScalarFieldEnum[]
  }

  /**
   * WalletLedgerEntry create
   */
  export type WalletLedgerEntryCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    /**
     * The data needed to create a WalletLedgerEntry.
     */
    data: XOR<WalletLedgerEntryCreateInput, WalletLedgerEntryUncheckedCreateInput>
  }

  /**
   * WalletLedgerEntry createMany
   */
  export type WalletLedgerEntryCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WalletLedgerEntries.
     */
    data: WalletLedgerEntryCreateManyInput | WalletLedgerEntryCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WalletLedgerEntry createManyAndReturn
   */
  export type WalletLedgerEntryCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WalletLedgerEntries.
     */
    data: WalletLedgerEntryCreateManyInput | WalletLedgerEntryCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * WalletLedgerEntry update
   */
  export type WalletLedgerEntryUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    /**
     * The data needed to update a WalletLedgerEntry.
     */
    data: XOR<WalletLedgerEntryUpdateInput, WalletLedgerEntryUncheckedUpdateInput>
    /**
     * Choose, which WalletLedgerEntry to update.
     */
    where: WalletLedgerEntryWhereUniqueInput
  }

  /**
   * WalletLedgerEntry updateMany
   */
  export type WalletLedgerEntryUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WalletLedgerEntries.
     */
    data: XOR<WalletLedgerEntryUpdateManyMutationInput, WalletLedgerEntryUncheckedUpdateManyInput>
    /**
     * Filter which WalletLedgerEntries to update
     */
    where?: WalletLedgerEntryWhereInput
  }

  /**
   * WalletLedgerEntry upsert
   */
  export type WalletLedgerEntryUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    /**
     * The filter to search for the WalletLedgerEntry to update in case it exists.
     */
    where: WalletLedgerEntryWhereUniqueInput
    /**
     * In case the WalletLedgerEntry found by the `where` argument doesn't exist, create a new WalletLedgerEntry with this data.
     */
    create: XOR<WalletLedgerEntryCreateInput, WalletLedgerEntryUncheckedCreateInput>
    /**
     * In case the WalletLedgerEntry was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WalletLedgerEntryUpdateInput, WalletLedgerEntryUncheckedUpdateInput>
  }

  /**
   * WalletLedgerEntry delete
   */
  export type WalletLedgerEntryDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    /**
     * Filter which WalletLedgerEntry to delete.
     */
    where: WalletLedgerEntryWhereUniqueInput
  }

  /**
   * WalletLedgerEntry deleteMany
   */
  export type WalletLedgerEntryDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WalletLedgerEntries to delete
     */
    where?: WalletLedgerEntryWhereInput
  }

  /**
   * WalletLedgerEntry without action
   */
  export type WalletLedgerEntryDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
  }


  /**
   * Model PaymentTransaction
   */

  export type AggregatePaymentTransaction = {
    _count: PaymentTransactionCountAggregateOutputType | null
    _avg: PaymentTransactionAvgAggregateOutputType | null
    _sum: PaymentTransactionSumAggregateOutputType | null
    _min: PaymentTransactionMinAggregateOutputType | null
    _max: PaymentTransactionMaxAggregateOutputType | null
  }

  export type PaymentTransactionAvgAggregateOutputType = {
    amount: Decimal | null
    activationRetryCount: number | null
  }

  export type PaymentTransactionSumAggregateOutputType = {
    amount: Decimal | null
    activationRetryCount: number | null
  }

  export type PaymentTransactionMinAggregateOutputType = {
    id: string | null
    payerId: string | null
    purpose: $Enums.PurposeType | null
    gymId: string | null
    ptId: string | null
    membershipId: string | null
    ptContractId: string | null
    amount: Decimal | null
    currency: string | null
    status: $Enums.PaymentStatus | null
    provider: $Enums.PaymentProviderType | null
    providerTransactionId: string | null
    paymentMethod: string | null
    idempotencyKey: string | null
    requestFingerprint: string | null
    extraData: string | null
    paidAt: Date | null
    failedAt: Date | null
    refundedAt: Date | null
    payerWalletId: string | null
    receiverWalletId: string | null
    relatedEntityType: $Enums.RelatedEntityType | null
    relatedEntityId: string | null
    activationStatus: $Enums.ActivationStatus | null
    activationRetryCount: number | null
    lastActivationRetryAt: Date | null
    initiatedBy: string | null
    sourceService: string | null
    refundOfTransactionId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PaymentTransactionMaxAggregateOutputType = {
    id: string | null
    payerId: string | null
    purpose: $Enums.PurposeType | null
    gymId: string | null
    ptId: string | null
    membershipId: string | null
    ptContractId: string | null
    amount: Decimal | null
    currency: string | null
    status: $Enums.PaymentStatus | null
    provider: $Enums.PaymentProviderType | null
    providerTransactionId: string | null
    paymentMethod: string | null
    idempotencyKey: string | null
    requestFingerprint: string | null
    extraData: string | null
    paidAt: Date | null
    failedAt: Date | null
    refundedAt: Date | null
    payerWalletId: string | null
    receiverWalletId: string | null
    relatedEntityType: $Enums.RelatedEntityType | null
    relatedEntityId: string | null
    activationStatus: $Enums.ActivationStatus | null
    activationRetryCount: number | null
    lastActivationRetryAt: Date | null
    initiatedBy: string | null
    sourceService: string | null
    refundOfTransactionId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PaymentTransactionCountAggregateOutputType = {
    id: number
    payerId: number
    purpose: number
    gymId: number
    ptId: number
    membershipId: number
    ptContractId: number
    amount: number
    currency: number
    status: number
    provider: number
    providerTransactionId: number
    paymentMethod: number
    idempotencyKey: number
    requestFingerprint: number
    extraData: number
    paidAt: number
    failedAt: number
    refundedAt: number
    metadata: number
    payerWalletId: number
    receiverWalletId: number
    relatedEntityType: number
    relatedEntityId: number
    activationStatus: number
    activationRetryCount: number
    lastActivationRetryAt: number
    initiatedBy: number
    sourceService: number
    refundOfTransactionId: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type PaymentTransactionAvgAggregateInputType = {
    amount?: true
    activationRetryCount?: true
  }

  export type PaymentTransactionSumAggregateInputType = {
    amount?: true
    activationRetryCount?: true
  }

  export type PaymentTransactionMinAggregateInputType = {
    id?: true
    payerId?: true
    purpose?: true
    gymId?: true
    ptId?: true
    membershipId?: true
    ptContractId?: true
    amount?: true
    currency?: true
    status?: true
    provider?: true
    providerTransactionId?: true
    paymentMethod?: true
    idempotencyKey?: true
    requestFingerprint?: true
    extraData?: true
    paidAt?: true
    failedAt?: true
    refundedAt?: true
    payerWalletId?: true
    receiverWalletId?: true
    relatedEntityType?: true
    relatedEntityId?: true
    activationStatus?: true
    activationRetryCount?: true
    lastActivationRetryAt?: true
    initiatedBy?: true
    sourceService?: true
    refundOfTransactionId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PaymentTransactionMaxAggregateInputType = {
    id?: true
    payerId?: true
    purpose?: true
    gymId?: true
    ptId?: true
    membershipId?: true
    ptContractId?: true
    amount?: true
    currency?: true
    status?: true
    provider?: true
    providerTransactionId?: true
    paymentMethod?: true
    idempotencyKey?: true
    requestFingerprint?: true
    extraData?: true
    paidAt?: true
    failedAt?: true
    refundedAt?: true
    payerWalletId?: true
    receiverWalletId?: true
    relatedEntityType?: true
    relatedEntityId?: true
    activationStatus?: true
    activationRetryCount?: true
    lastActivationRetryAt?: true
    initiatedBy?: true
    sourceService?: true
    refundOfTransactionId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PaymentTransactionCountAggregateInputType = {
    id?: true
    payerId?: true
    purpose?: true
    gymId?: true
    ptId?: true
    membershipId?: true
    ptContractId?: true
    amount?: true
    currency?: true
    status?: true
    provider?: true
    providerTransactionId?: true
    paymentMethod?: true
    idempotencyKey?: true
    requestFingerprint?: true
    extraData?: true
    paidAt?: true
    failedAt?: true
    refundedAt?: true
    metadata?: true
    payerWalletId?: true
    receiverWalletId?: true
    relatedEntityType?: true
    relatedEntityId?: true
    activationStatus?: true
    activationRetryCount?: true
    lastActivationRetryAt?: true
    initiatedBy?: true
    sourceService?: true
    refundOfTransactionId?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type PaymentTransactionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PaymentTransaction to aggregate.
     */
    where?: PaymentTransactionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PaymentTransactions to fetch.
     */
    orderBy?: PaymentTransactionOrderByWithRelationInput | PaymentTransactionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PaymentTransactionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PaymentTransactions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PaymentTransactions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PaymentTransactions
    **/
    _count?: true | PaymentTransactionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PaymentTransactionAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PaymentTransactionSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PaymentTransactionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PaymentTransactionMaxAggregateInputType
  }

  export type GetPaymentTransactionAggregateType<T extends PaymentTransactionAggregateArgs> = {
        [P in keyof T & keyof AggregatePaymentTransaction]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePaymentTransaction[P]>
      : GetScalarType<T[P], AggregatePaymentTransaction[P]>
  }




  export type PaymentTransactionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PaymentTransactionWhereInput
    orderBy?: PaymentTransactionOrderByWithAggregationInput | PaymentTransactionOrderByWithAggregationInput[]
    by: PaymentTransactionScalarFieldEnum[] | PaymentTransactionScalarFieldEnum
    having?: PaymentTransactionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PaymentTransactionCountAggregateInputType | true
    _avg?: PaymentTransactionAvgAggregateInputType
    _sum?: PaymentTransactionSumAggregateInputType
    _min?: PaymentTransactionMinAggregateInputType
    _max?: PaymentTransactionMaxAggregateInputType
  }

  export type PaymentTransactionGroupByOutputType = {
    id: string
    payerId: string
    purpose: $Enums.PurposeType
    gymId: string | null
    ptId: string | null
    membershipId: string | null
    ptContractId: string | null
    amount: Decimal
    currency: string
    status: $Enums.PaymentStatus
    provider: $Enums.PaymentProviderType
    providerTransactionId: string | null
    paymentMethod: string | null
    idempotencyKey: string
    requestFingerprint: string | null
    extraData: string | null
    paidAt: Date | null
    failedAt: Date | null
    refundedAt: Date | null
    metadata: JsonValue | null
    payerWalletId: string | null
    receiverWalletId: string | null
    relatedEntityType: $Enums.RelatedEntityType | null
    relatedEntityId: string | null
    activationStatus: $Enums.ActivationStatus
    activationRetryCount: number
    lastActivationRetryAt: Date | null
    initiatedBy: string | null
    sourceService: string | null
    refundOfTransactionId: string | null
    createdAt: Date
    updatedAt: Date
    _count: PaymentTransactionCountAggregateOutputType | null
    _avg: PaymentTransactionAvgAggregateOutputType | null
    _sum: PaymentTransactionSumAggregateOutputType | null
    _min: PaymentTransactionMinAggregateOutputType | null
    _max: PaymentTransactionMaxAggregateOutputType | null
  }

  type GetPaymentTransactionGroupByPayload<T extends PaymentTransactionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PaymentTransactionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PaymentTransactionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PaymentTransactionGroupByOutputType[P]>
            : GetScalarType<T[P], PaymentTransactionGroupByOutputType[P]>
        }
      >
    >


  export type PaymentTransactionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    payerId?: boolean
    purpose?: boolean
    gymId?: boolean
    ptId?: boolean
    membershipId?: boolean
    ptContractId?: boolean
    amount?: boolean
    currency?: boolean
    status?: boolean
    provider?: boolean
    providerTransactionId?: boolean
    paymentMethod?: boolean
    idempotencyKey?: boolean
    requestFingerprint?: boolean
    extraData?: boolean
    paidAt?: boolean
    failedAt?: boolean
    refundedAt?: boolean
    metadata?: boolean
    payerWalletId?: boolean
    receiverWalletId?: boolean
    relatedEntityType?: boolean
    relatedEntityId?: boolean
    activationStatus?: boolean
    activationRetryCount?: boolean
    lastActivationRetryAt?: boolean
    initiatedBy?: boolean
    sourceService?: boolean
    refundOfTransactionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    commissions?: boolean | PaymentTransaction$commissionsArgs<ExtArgs>
    ledgerEntries?: boolean | PaymentTransaction$ledgerEntriesArgs<ExtArgs>
    _count?: boolean | PaymentTransactionCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["paymentTransaction"]>

  export type PaymentTransactionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    payerId?: boolean
    purpose?: boolean
    gymId?: boolean
    ptId?: boolean
    membershipId?: boolean
    ptContractId?: boolean
    amount?: boolean
    currency?: boolean
    status?: boolean
    provider?: boolean
    providerTransactionId?: boolean
    paymentMethod?: boolean
    idempotencyKey?: boolean
    requestFingerprint?: boolean
    extraData?: boolean
    paidAt?: boolean
    failedAt?: boolean
    refundedAt?: boolean
    metadata?: boolean
    payerWalletId?: boolean
    receiverWalletId?: boolean
    relatedEntityType?: boolean
    relatedEntityId?: boolean
    activationStatus?: boolean
    activationRetryCount?: boolean
    lastActivationRetryAt?: boolean
    initiatedBy?: boolean
    sourceService?: boolean
    refundOfTransactionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["paymentTransaction"]>

  export type PaymentTransactionSelectScalar = {
    id?: boolean
    payerId?: boolean
    purpose?: boolean
    gymId?: boolean
    ptId?: boolean
    membershipId?: boolean
    ptContractId?: boolean
    amount?: boolean
    currency?: boolean
    status?: boolean
    provider?: boolean
    providerTransactionId?: boolean
    paymentMethod?: boolean
    idempotencyKey?: boolean
    requestFingerprint?: boolean
    extraData?: boolean
    paidAt?: boolean
    failedAt?: boolean
    refundedAt?: boolean
    metadata?: boolean
    payerWalletId?: boolean
    receiverWalletId?: boolean
    relatedEntityType?: boolean
    relatedEntityId?: boolean
    activationStatus?: boolean
    activationRetryCount?: boolean
    lastActivationRetryAt?: boolean
    initiatedBy?: boolean
    sourceService?: boolean
    refundOfTransactionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type PaymentTransactionInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    commissions?: boolean | PaymentTransaction$commissionsArgs<ExtArgs>
    ledgerEntries?: boolean | PaymentTransaction$ledgerEntriesArgs<ExtArgs>
    _count?: boolean | PaymentTransactionCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type PaymentTransactionIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $PaymentTransactionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PaymentTransaction"
    objects: {
      commissions: Prisma.$PlatformCommissionPayload<ExtArgs>[]
      ledgerEntries: Prisma.$WalletLedgerEntryPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      payerId: string
      purpose: $Enums.PurposeType
      gymId: string | null
      ptId: string | null
      membershipId: string | null
      ptContractId: string | null
      amount: Prisma.Decimal
      currency: string
      status: $Enums.PaymentStatus
      provider: $Enums.PaymentProviderType
      providerTransactionId: string | null
      paymentMethod: string | null
      idempotencyKey: string
      requestFingerprint: string | null
      extraData: string | null
      paidAt: Date | null
      failedAt: Date | null
      refundedAt: Date | null
      metadata: Prisma.JsonValue | null
      payerWalletId: string | null
      receiverWalletId: string | null
      relatedEntityType: $Enums.RelatedEntityType | null
      relatedEntityId: string | null
      activationStatus: $Enums.ActivationStatus
      activationRetryCount: number
      lastActivationRetryAt: Date | null
      initiatedBy: string | null
      sourceService: string | null
      refundOfTransactionId: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["paymentTransaction"]>
    composites: {}
  }

  type PaymentTransactionGetPayload<S extends boolean | null | undefined | PaymentTransactionDefaultArgs> = $Result.GetResult<Prisma.$PaymentTransactionPayload, S>

  type PaymentTransactionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PaymentTransactionFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PaymentTransactionCountAggregateInputType | true
    }

  export interface PaymentTransactionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PaymentTransaction'], meta: { name: 'PaymentTransaction' } }
    /**
     * Find zero or one PaymentTransaction that matches the filter.
     * @param {PaymentTransactionFindUniqueArgs} args - Arguments to find a PaymentTransaction
     * @example
     * // Get one PaymentTransaction
     * const paymentTransaction = await prisma.paymentTransaction.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PaymentTransactionFindUniqueArgs>(args: SelectSubset<T, PaymentTransactionFindUniqueArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PaymentTransaction that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PaymentTransactionFindUniqueOrThrowArgs} args - Arguments to find a PaymentTransaction
     * @example
     * // Get one PaymentTransaction
     * const paymentTransaction = await prisma.paymentTransaction.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PaymentTransactionFindUniqueOrThrowArgs>(args: SelectSubset<T, PaymentTransactionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PaymentTransaction that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentTransactionFindFirstArgs} args - Arguments to find a PaymentTransaction
     * @example
     * // Get one PaymentTransaction
     * const paymentTransaction = await prisma.paymentTransaction.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PaymentTransactionFindFirstArgs>(args?: SelectSubset<T, PaymentTransactionFindFirstArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PaymentTransaction that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentTransactionFindFirstOrThrowArgs} args - Arguments to find a PaymentTransaction
     * @example
     * // Get one PaymentTransaction
     * const paymentTransaction = await prisma.paymentTransaction.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PaymentTransactionFindFirstOrThrowArgs>(args?: SelectSubset<T, PaymentTransactionFindFirstOrThrowArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PaymentTransactions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentTransactionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PaymentTransactions
     * const paymentTransactions = await prisma.paymentTransaction.findMany()
     * 
     * // Get first 10 PaymentTransactions
     * const paymentTransactions = await prisma.paymentTransaction.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const paymentTransactionWithIdOnly = await prisma.paymentTransaction.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PaymentTransactionFindManyArgs>(args?: SelectSubset<T, PaymentTransactionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PaymentTransaction.
     * @param {PaymentTransactionCreateArgs} args - Arguments to create a PaymentTransaction.
     * @example
     * // Create one PaymentTransaction
     * const PaymentTransaction = await prisma.paymentTransaction.create({
     *   data: {
     *     // ... data to create a PaymentTransaction
     *   }
     * })
     * 
     */
    create<T extends PaymentTransactionCreateArgs>(args: SelectSubset<T, PaymentTransactionCreateArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PaymentTransactions.
     * @param {PaymentTransactionCreateManyArgs} args - Arguments to create many PaymentTransactions.
     * @example
     * // Create many PaymentTransactions
     * const paymentTransaction = await prisma.paymentTransaction.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PaymentTransactionCreateManyArgs>(args?: SelectSubset<T, PaymentTransactionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PaymentTransactions and returns the data saved in the database.
     * @param {PaymentTransactionCreateManyAndReturnArgs} args - Arguments to create many PaymentTransactions.
     * @example
     * // Create many PaymentTransactions
     * const paymentTransaction = await prisma.paymentTransaction.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PaymentTransactions and only return the `id`
     * const paymentTransactionWithIdOnly = await prisma.paymentTransaction.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PaymentTransactionCreateManyAndReturnArgs>(args?: SelectSubset<T, PaymentTransactionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PaymentTransaction.
     * @param {PaymentTransactionDeleteArgs} args - Arguments to delete one PaymentTransaction.
     * @example
     * // Delete one PaymentTransaction
     * const PaymentTransaction = await prisma.paymentTransaction.delete({
     *   where: {
     *     // ... filter to delete one PaymentTransaction
     *   }
     * })
     * 
     */
    delete<T extends PaymentTransactionDeleteArgs>(args: SelectSubset<T, PaymentTransactionDeleteArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PaymentTransaction.
     * @param {PaymentTransactionUpdateArgs} args - Arguments to update one PaymentTransaction.
     * @example
     * // Update one PaymentTransaction
     * const paymentTransaction = await prisma.paymentTransaction.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PaymentTransactionUpdateArgs>(args: SelectSubset<T, PaymentTransactionUpdateArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PaymentTransactions.
     * @param {PaymentTransactionDeleteManyArgs} args - Arguments to filter PaymentTransactions to delete.
     * @example
     * // Delete a few PaymentTransactions
     * const { count } = await prisma.paymentTransaction.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PaymentTransactionDeleteManyArgs>(args?: SelectSubset<T, PaymentTransactionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PaymentTransactions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentTransactionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PaymentTransactions
     * const paymentTransaction = await prisma.paymentTransaction.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PaymentTransactionUpdateManyArgs>(args: SelectSubset<T, PaymentTransactionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PaymentTransaction.
     * @param {PaymentTransactionUpsertArgs} args - Arguments to update or create a PaymentTransaction.
     * @example
     * // Update or create a PaymentTransaction
     * const paymentTransaction = await prisma.paymentTransaction.upsert({
     *   create: {
     *     // ... data to create a PaymentTransaction
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PaymentTransaction we want to update
     *   }
     * })
     */
    upsert<T extends PaymentTransactionUpsertArgs>(args: SelectSubset<T, PaymentTransactionUpsertArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PaymentTransactions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentTransactionCountArgs} args - Arguments to filter PaymentTransactions to count.
     * @example
     * // Count the number of PaymentTransactions
     * const count = await prisma.paymentTransaction.count({
     *   where: {
     *     // ... the filter for the PaymentTransactions we want to count
     *   }
     * })
    **/
    count<T extends PaymentTransactionCountArgs>(
      args?: Subset<T, PaymentTransactionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PaymentTransactionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PaymentTransaction.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentTransactionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PaymentTransactionAggregateArgs>(args: Subset<T, PaymentTransactionAggregateArgs>): Prisma.PrismaPromise<GetPaymentTransactionAggregateType<T>>

    /**
     * Group by PaymentTransaction.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentTransactionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PaymentTransactionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PaymentTransactionGroupByArgs['orderBy'] }
        : { orderBy?: PaymentTransactionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PaymentTransactionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPaymentTransactionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PaymentTransaction model
   */
  readonly fields: PaymentTransactionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PaymentTransaction.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PaymentTransactionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    commissions<T extends PaymentTransaction$commissionsArgs<ExtArgs> = {}>(args?: Subset<T, PaymentTransaction$commissionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "findMany"> | Null>
    ledgerEntries<T extends PaymentTransaction$ledgerEntriesArgs<ExtArgs> = {}>(args?: Subset<T, PaymentTransaction$ledgerEntriesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WalletLedgerEntryPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the PaymentTransaction model
   */ 
  interface PaymentTransactionFieldRefs {
    readonly id: FieldRef<"PaymentTransaction", 'String'>
    readonly payerId: FieldRef<"PaymentTransaction", 'String'>
    readonly purpose: FieldRef<"PaymentTransaction", 'PurposeType'>
    readonly gymId: FieldRef<"PaymentTransaction", 'String'>
    readonly ptId: FieldRef<"PaymentTransaction", 'String'>
    readonly membershipId: FieldRef<"PaymentTransaction", 'String'>
    readonly ptContractId: FieldRef<"PaymentTransaction", 'String'>
    readonly amount: FieldRef<"PaymentTransaction", 'Decimal'>
    readonly currency: FieldRef<"PaymentTransaction", 'String'>
    readonly status: FieldRef<"PaymentTransaction", 'PaymentStatus'>
    readonly provider: FieldRef<"PaymentTransaction", 'PaymentProviderType'>
    readonly providerTransactionId: FieldRef<"PaymentTransaction", 'String'>
    readonly paymentMethod: FieldRef<"PaymentTransaction", 'String'>
    readonly idempotencyKey: FieldRef<"PaymentTransaction", 'String'>
    readonly requestFingerprint: FieldRef<"PaymentTransaction", 'String'>
    readonly extraData: FieldRef<"PaymentTransaction", 'String'>
    readonly paidAt: FieldRef<"PaymentTransaction", 'DateTime'>
    readonly failedAt: FieldRef<"PaymentTransaction", 'DateTime'>
    readonly refundedAt: FieldRef<"PaymentTransaction", 'DateTime'>
    readonly metadata: FieldRef<"PaymentTransaction", 'Json'>
    readonly payerWalletId: FieldRef<"PaymentTransaction", 'String'>
    readonly receiverWalletId: FieldRef<"PaymentTransaction", 'String'>
    readonly relatedEntityType: FieldRef<"PaymentTransaction", 'RelatedEntityType'>
    readonly relatedEntityId: FieldRef<"PaymentTransaction", 'String'>
    readonly activationStatus: FieldRef<"PaymentTransaction", 'ActivationStatus'>
    readonly activationRetryCount: FieldRef<"PaymentTransaction", 'Int'>
    readonly lastActivationRetryAt: FieldRef<"PaymentTransaction", 'DateTime'>
    readonly initiatedBy: FieldRef<"PaymentTransaction", 'String'>
    readonly sourceService: FieldRef<"PaymentTransaction", 'String'>
    readonly refundOfTransactionId: FieldRef<"PaymentTransaction", 'String'>
    readonly createdAt: FieldRef<"PaymentTransaction", 'DateTime'>
    readonly updatedAt: FieldRef<"PaymentTransaction", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PaymentTransaction findUnique
   */
  export type PaymentTransactionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
    /**
     * Filter, which PaymentTransaction to fetch.
     */
    where: PaymentTransactionWhereUniqueInput
  }

  /**
   * PaymentTransaction findUniqueOrThrow
   */
  export type PaymentTransactionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
    /**
     * Filter, which PaymentTransaction to fetch.
     */
    where: PaymentTransactionWhereUniqueInput
  }

  /**
   * PaymentTransaction findFirst
   */
  export type PaymentTransactionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
    /**
     * Filter, which PaymentTransaction to fetch.
     */
    where?: PaymentTransactionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PaymentTransactions to fetch.
     */
    orderBy?: PaymentTransactionOrderByWithRelationInput | PaymentTransactionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PaymentTransactions.
     */
    cursor?: PaymentTransactionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PaymentTransactions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PaymentTransactions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PaymentTransactions.
     */
    distinct?: PaymentTransactionScalarFieldEnum | PaymentTransactionScalarFieldEnum[]
  }

  /**
   * PaymentTransaction findFirstOrThrow
   */
  export type PaymentTransactionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
    /**
     * Filter, which PaymentTransaction to fetch.
     */
    where?: PaymentTransactionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PaymentTransactions to fetch.
     */
    orderBy?: PaymentTransactionOrderByWithRelationInput | PaymentTransactionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PaymentTransactions.
     */
    cursor?: PaymentTransactionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PaymentTransactions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PaymentTransactions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PaymentTransactions.
     */
    distinct?: PaymentTransactionScalarFieldEnum | PaymentTransactionScalarFieldEnum[]
  }

  /**
   * PaymentTransaction findMany
   */
  export type PaymentTransactionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
    /**
     * Filter, which PaymentTransactions to fetch.
     */
    where?: PaymentTransactionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PaymentTransactions to fetch.
     */
    orderBy?: PaymentTransactionOrderByWithRelationInput | PaymentTransactionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PaymentTransactions.
     */
    cursor?: PaymentTransactionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PaymentTransactions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PaymentTransactions.
     */
    skip?: number
    distinct?: PaymentTransactionScalarFieldEnum | PaymentTransactionScalarFieldEnum[]
  }

  /**
   * PaymentTransaction create
   */
  export type PaymentTransactionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
    /**
     * The data needed to create a PaymentTransaction.
     */
    data: XOR<PaymentTransactionCreateInput, PaymentTransactionUncheckedCreateInput>
  }

  /**
   * PaymentTransaction createMany
   */
  export type PaymentTransactionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PaymentTransactions.
     */
    data: PaymentTransactionCreateManyInput | PaymentTransactionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PaymentTransaction createManyAndReturn
   */
  export type PaymentTransactionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PaymentTransactions.
     */
    data: PaymentTransactionCreateManyInput | PaymentTransactionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PaymentTransaction update
   */
  export type PaymentTransactionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
    /**
     * The data needed to update a PaymentTransaction.
     */
    data: XOR<PaymentTransactionUpdateInput, PaymentTransactionUncheckedUpdateInput>
    /**
     * Choose, which PaymentTransaction to update.
     */
    where: PaymentTransactionWhereUniqueInput
  }

  /**
   * PaymentTransaction updateMany
   */
  export type PaymentTransactionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PaymentTransactions.
     */
    data: XOR<PaymentTransactionUpdateManyMutationInput, PaymentTransactionUncheckedUpdateManyInput>
    /**
     * Filter which PaymentTransactions to update
     */
    where?: PaymentTransactionWhereInput
  }

  /**
   * PaymentTransaction upsert
   */
  export type PaymentTransactionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
    /**
     * The filter to search for the PaymentTransaction to update in case it exists.
     */
    where: PaymentTransactionWhereUniqueInput
    /**
     * In case the PaymentTransaction found by the `where` argument doesn't exist, create a new PaymentTransaction with this data.
     */
    create: XOR<PaymentTransactionCreateInput, PaymentTransactionUncheckedCreateInput>
    /**
     * In case the PaymentTransaction was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PaymentTransactionUpdateInput, PaymentTransactionUncheckedUpdateInput>
  }

  /**
   * PaymentTransaction delete
   */
  export type PaymentTransactionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
    /**
     * Filter which PaymentTransaction to delete.
     */
    where: PaymentTransactionWhereUniqueInput
  }

  /**
   * PaymentTransaction deleteMany
   */
  export type PaymentTransactionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PaymentTransactions to delete
     */
    where?: PaymentTransactionWhereInput
  }

  /**
   * PaymentTransaction.commissions
   */
  export type PaymentTransaction$commissionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    where?: PlatformCommissionWhereInput
    orderBy?: PlatformCommissionOrderByWithRelationInput | PlatformCommissionOrderByWithRelationInput[]
    cursor?: PlatformCommissionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PlatformCommissionScalarFieldEnum | PlatformCommissionScalarFieldEnum[]
  }

  /**
   * PaymentTransaction.ledgerEntries
   */
  export type PaymentTransaction$ledgerEntriesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WalletLedgerEntry
     */
    select?: WalletLedgerEntrySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WalletLedgerEntryInclude<ExtArgs> | null
    where?: WalletLedgerEntryWhereInput
    orderBy?: WalletLedgerEntryOrderByWithRelationInput | WalletLedgerEntryOrderByWithRelationInput[]
    cursor?: WalletLedgerEntryWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WalletLedgerEntryScalarFieldEnum | WalletLedgerEntryScalarFieldEnum[]
  }

  /**
   * PaymentTransaction without action
   */
  export type PaymentTransactionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentTransaction
     */
    select?: PaymentTransactionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentTransactionInclude<ExtArgs> | null
  }


  /**
   * Model PlatformCommission
   */

  export type AggregatePlatformCommission = {
    _count: PlatformCommissionCountAggregateOutputType | null
    _avg: PlatformCommissionAvgAggregateOutputType | null
    _sum: PlatformCommissionSumAggregateOutputType | null
    _min: PlatformCommissionMinAggregateOutputType | null
    _max: PlatformCommissionMaxAggregateOutputType | null
  }

  export type PlatformCommissionAvgAggregateOutputType = {
    grossAmount: Decimal | null
    platformFeeAmount: Decimal | null
    partnerPayoutAmount: Decimal | null
    commissionRate: Decimal | null
  }

  export type PlatformCommissionSumAggregateOutputType = {
    grossAmount: Decimal | null
    platformFeeAmount: Decimal | null
    partnerPayoutAmount: Decimal | null
    commissionRate: Decimal | null
  }

  export type PlatformCommissionMinAggregateOutputType = {
    id: string | null
    paymentTransactionId: string | null
    partnerType: $Enums.PartnerType | null
    partnerId: string | null
    grossAmount: Decimal | null
    platformFeeAmount: Decimal | null
    partnerPayoutAmount: Decimal | null
    commissionRate: Decimal | null
    status: $Enums.CommissionStatus | null
    settledAt: Date | null
    createdAt: Date | null
  }

  export type PlatformCommissionMaxAggregateOutputType = {
    id: string | null
    paymentTransactionId: string | null
    partnerType: $Enums.PartnerType | null
    partnerId: string | null
    grossAmount: Decimal | null
    platformFeeAmount: Decimal | null
    partnerPayoutAmount: Decimal | null
    commissionRate: Decimal | null
    status: $Enums.CommissionStatus | null
    settledAt: Date | null
    createdAt: Date | null
  }

  export type PlatformCommissionCountAggregateOutputType = {
    id: number
    paymentTransactionId: number
    partnerType: number
    partnerId: number
    grossAmount: number
    platformFeeAmount: number
    partnerPayoutAmount: number
    commissionRate: number
    status: number
    settledAt: number
    createdAt: number
    _all: number
  }


  export type PlatformCommissionAvgAggregateInputType = {
    grossAmount?: true
    platformFeeAmount?: true
    partnerPayoutAmount?: true
    commissionRate?: true
  }

  export type PlatformCommissionSumAggregateInputType = {
    grossAmount?: true
    platformFeeAmount?: true
    partnerPayoutAmount?: true
    commissionRate?: true
  }

  export type PlatformCommissionMinAggregateInputType = {
    id?: true
    paymentTransactionId?: true
    partnerType?: true
    partnerId?: true
    grossAmount?: true
    platformFeeAmount?: true
    partnerPayoutAmount?: true
    commissionRate?: true
    status?: true
    settledAt?: true
    createdAt?: true
  }

  export type PlatformCommissionMaxAggregateInputType = {
    id?: true
    paymentTransactionId?: true
    partnerType?: true
    partnerId?: true
    grossAmount?: true
    platformFeeAmount?: true
    partnerPayoutAmount?: true
    commissionRate?: true
    status?: true
    settledAt?: true
    createdAt?: true
  }

  export type PlatformCommissionCountAggregateInputType = {
    id?: true
    paymentTransactionId?: true
    partnerType?: true
    partnerId?: true
    grossAmount?: true
    platformFeeAmount?: true
    partnerPayoutAmount?: true
    commissionRate?: true
    status?: true
    settledAt?: true
    createdAt?: true
    _all?: true
  }

  export type PlatformCommissionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PlatformCommission to aggregate.
     */
    where?: PlatformCommissionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PlatformCommissions to fetch.
     */
    orderBy?: PlatformCommissionOrderByWithRelationInput | PlatformCommissionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PlatformCommissionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PlatformCommissions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PlatformCommissions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PlatformCommissions
    **/
    _count?: true | PlatformCommissionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PlatformCommissionAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PlatformCommissionSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PlatformCommissionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PlatformCommissionMaxAggregateInputType
  }

  export type GetPlatformCommissionAggregateType<T extends PlatformCommissionAggregateArgs> = {
        [P in keyof T & keyof AggregatePlatformCommission]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePlatformCommission[P]>
      : GetScalarType<T[P], AggregatePlatformCommission[P]>
  }




  export type PlatformCommissionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PlatformCommissionWhereInput
    orderBy?: PlatformCommissionOrderByWithAggregationInput | PlatformCommissionOrderByWithAggregationInput[]
    by: PlatformCommissionScalarFieldEnum[] | PlatformCommissionScalarFieldEnum
    having?: PlatformCommissionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PlatformCommissionCountAggregateInputType | true
    _avg?: PlatformCommissionAvgAggregateInputType
    _sum?: PlatformCommissionSumAggregateInputType
    _min?: PlatformCommissionMinAggregateInputType
    _max?: PlatformCommissionMaxAggregateInputType
  }

  export type PlatformCommissionGroupByOutputType = {
    id: string
    paymentTransactionId: string
    partnerType: $Enums.PartnerType
    partnerId: string
    grossAmount: Decimal
    platformFeeAmount: Decimal
    partnerPayoutAmount: Decimal
    commissionRate: Decimal
    status: $Enums.CommissionStatus
    settledAt: Date | null
    createdAt: Date
    _count: PlatformCommissionCountAggregateOutputType | null
    _avg: PlatformCommissionAvgAggregateOutputType | null
    _sum: PlatformCommissionSumAggregateOutputType | null
    _min: PlatformCommissionMinAggregateOutputType | null
    _max: PlatformCommissionMaxAggregateOutputType | null
  }

  type GetPlatformCommissionGroupByPayload<T extends PlatformCommissionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PlatformCommissionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PlatformCommissionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PlatformCommissionGroupByOutputType[P]>
            : GetScalarType<T[P], PlatformCommissionGroupByOutputType[P]>
        }
      >
    >


  export type PlatformCommissionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    paymentTransactionId?: boolean
    partnerType?: boolean
    partnerId?: boolean
    grossAmount?: boolean
    platformFeeAmount?: boolean
    partnerPayoutAmount?: boolean
    commissionRate?: boolean
    status?: boolean
    settledAt?: boolean
    createdAt?: boolean
    transaction?: boolean | PaymentTransactionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["platformCommission"]>

  export type PlatformCommissionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    paymentTransactionId?: boolean
    partnerType?: boolean
    partnerId?: boolean
    grossAmount?: boolean
    platformFeeAmount?: boolean
    partnerPayoutAmount?: boolean
    commissionRate?: boolean
    status?: boolean
    settledAt?: boolean
    createdAt?: boolean
    transaction?: boolean | PaymentTransactionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["platformCommission"]>

  export type PlatformCommissionSelectScalar = {
    id?: boolean
    paymentTransactionId?: boolean
    partnerType?: boolean
    partnerId?: boolean
    grossAmount?: boolean
    platformFeeAmount?: boolean
    partnerPayoutAmount?: boolean
    commissionRate?: boolean
    status?: boolean
    settledAt?: boolean
    createdAt?: boolean
  }

  export type PlatformCommissionInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    transaction?: boolean | PaymentTransactionDefaultArgs<ExtArgs>
  }
  export type PlatformCommissionIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    transaction?: boolean | PaymentTransactionDefaultArgs<ExtArgs>
  }

  export type $PlatformCommissionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PlatformCommission"
    objects: {
      transaction: Prisma.$PaymentTransactionPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      paymentTransactionId: string
      partnerType: $Enums.PartnerType
      partnerId: string
      grossAmount: Prisma.Decimal
      platformFeeAmount: Prisma.Decimal
      partnerPayoutAmount: Prisma.Decimal
      commissionRate: Prisma.Decimal
      status: $Enums.CommissionStatus
      settledAt: Date | null
      createdAt: Date
    }, ExtArgs["result"]["platformCommission"]>
    composites: {}
  }

  type PlatformCommissionGetPayload<S extends boolean | null | undefined | PlatformCommissionDefaultArgs> = $Result.GetResult<Prisma.$PlatformCommissionPayload, S>

  type PlatformCommissionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PlatformCommissionFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PlatformCommissionCountAggregateInputType | true
    }

  export interface PlatformCommissionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PlatformCommission'], meta: { name: 'PlatformCommission' } }
    /**
     * Find zero or one PlatformCommission that matches the filter.
     * @param {PlatformCommissionFindUniqueArgs} args - Arguments to find a PlatformCommission
     * @example
     * // Get one PlatformCommission
     * const platformCommission = await prisma.platformCommission.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PlatformCommissionFindUniqueArgs>(args: SelectSubset<T, PlatformCommissionFindUniqueArgs<ExtArgs>>): Prisma__PlatformCommissionClient<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PlatformCommission that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PlatformCommissionFindUniqueOrThrowArgs} args - Arguments to find a PlatformCommission
     * @example
     * // Get one PlatformCommission
     * const platformCommission = await prisma.platformCommission.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PlatformCommissionFindUniqueOrThrowArgs>(args: SelectSubset<T, PlatformCommissionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PlatformCommissionClient<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PlatformCommission that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlatformCommissionFindFirstArgs} args - Arguments to find a PlatformCommission
     * @example
     * // Get one PlatformCommission
     * const platformCommission = await prisma.platformCommission.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PlatformCommissionFindFirstArgs>(args?: SelectSubset<T, PlatformCommissionFindFirstArgs<ExtArgs>>): Prisma__PlatformCommissionClient<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PlatformCommission that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlatformCommissionFindFirstOrThrowArgs} args - Arguments to find a PlatformCommission
     * @example
     * // Get one PlatformCommission
     * const platformCommission = await prisma.platformCommission.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PlatformCommissionFindFirstOrThrowArgs>(args?: SelectSubset<T, PlatformCommissionFindFirstOrThrowArgs<ExtArgs>>): Prisma__PlatformCommissionClient<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PlatformCommissions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlatformCommissionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PlatformCommissions
     * const platformCommissions = await prisma.platformCommission.findMany()
     * 
     * // Get first 10 PlatformCommissions
     * const platformCommissions = await prisma.platformCommission.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const platformCommissionWithIdOnly = await prisma.platformCommission.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PlatformCommissionFindManyArgs>(args?: SelectSubset<T, PlatformCommissionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PlatformCommission.
     * @param {PlatformCommissionCreateArgs} args - Arguments to create a PlatformCommission.
     * @example
     * // Create one PlatformCommission
     * const PlatformCommission = await prisma.platformCommission.create({
     *   data: {
     *     // ... data to create a PlatformCommission
     *   }
     * })
     * 
     */
    create<T extends PlatformCommissionCreateArgs>(args: SelectSubset<T, PlatformCommissionCreateArgs<ExtArgs>>): Prisma__PlatformCommissionClient<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PlatformCommissions.
     * @param {PlatformCommissionCreateManyArgs} args - Arguments to create many PlatformCommissions.
     * @example
     * // Create many PlatformCommissions
     * const platformCommission = await prisma.platformCommission.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PlatformCommissionCreateManyArgs>(args?: SelectSubset<T, PlatformCommissionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PlatformCommissions and returns the data saved in the database.
     * @param {PlatformCommissionCreateManyAndReturnArgs} args - Arguments to create many PlatformCommissions.
     * @example
     * // Create many PlatformCommissions
     * const platformCommission = await prisma.platformCommission.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PlatformCommissions and only return the `id`
     * const platformCommissionWithIdOnly = await prisma.platformCommission.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PlatformCommissionCreateManyAndReturnArgs>(args?: SelectSubset<T, PlatformCommissionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PlatformCommission.
     * @param {PlatformCommissionDeleteArgs} args - Arguments to delete one PlatformCommission.
     * @example
     * // Delete one PlatformCommission
     * const PlatformCommission = await prisma.platformCommission.delete({
     *   where: {
     *     // ... filter to delete one PlatformCommission
     *   }
     * })
     * 
     */
    delete<T extends PlatformCommissionDeleteArgs>(args: SelectSubset<T, PlatformCommissionDeleteArgs<ExtArgs>>): Prisma__PlatformCommissionClient<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PlatformCommission.
     * @param {PlatformCommissionUpdateArgs} args - Arguments to update one PlatformCommission.
     * @example
     * // Update one PlatformCommission
     * const platformCommission = await prisma.platformCommission.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PlatformCommissionUpdateArgs>(args: SelectSubset<T, PlatformCommissionUpdateArgs<ExtArgs>>): Prisma__PlatformCommissionClient<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PlatformCommissions.
     * @param {PlatformCommissionDeleteManyArgs} args - Arguments to filter PlatformCommissions to delete.
     * @example
     * // Delete a few PlatformCommissions
     * const { count } = await prisma.platformCommission.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PlatformCommissionDeleteManyArgs>(args?: SelectSubset<T, PlatformCommissionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PlatformCommissions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlatformCommissionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PlatformCommissions
     * const platformCommission = await prisma.platformCommission.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PlatformCommissionUpdateManyArgs>(args: SelectSubset<T, PlatformCommissionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PlatformCommission.
     * @param {PlatformCommissionUpsertArgs} args - Arguments to update or create a PlatformCommission.
     * @example
     * // Update or create a PlatformCommission
     * const platformCommission = await prisma.platformCommission.upsert({
     *   create: {
     *     // ... data to create a PlatformCommission
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PlatformCommission we want to update
     *   }
     * })
     */
    upsert<T extends PlatformCommissionUpsertArgs>(args: SelectSubset<T, PlatformCommissionUpsertArgs<ExtArgs>>): Prisma__PlatformCommissionClient<$Result.GetResult<Prisma.$PlatformCommissionPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PlatformCommissions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlatformCommissionCountArgs} args - Arguments to filter PlatformCommissions to count.
     * @example
     * // Count the number of PlatformCommissions
     * const count = await prisma.platformCommission.count({
     *   where: {
     *     // ... the filter for the PlatformCommissions we want to count
     *   }
     * })
    **/
    count<T extends PlatformCommissionCountArgs>(
      args?: Subset<T, PlatformCommissionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PlatformCommissionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PlatformCommission.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlatformCommissionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PlatformCommissionAggregateArgs>(args: Subset<T, PlatformCommissionAggregateArgs>): Prisma.PrismaPromise<GetPlatformCommissionAggregateType<T>>

    /**
     * Group by PlatformCommission.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlatformCommissionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PlatformCommissionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PlatformCommissionGroupByArgs['orderBy'] }
        : { orderBy?: PlatformCommissionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PlatformCommissionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPlatformCommissionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PlatformCommission model
   */
  readonly fields: PlatformCommissionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PlatformCommission.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PlatformCommissionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    transaction<T extends PaymentTransactionDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PaymentTransactionDefaultArgs<ExtArgs>>): Prisma__PaymentTransactionClient<$Result.GetResult<Prisma.$PaymentTransactionPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the PlatformCommission model
   */ 
  interface PlatformCommissionFieldRefs {
    readonly id: FieldRef<"PlatformCommission", 'String'>
    readonly paymentTransactionId: FieldRef<"PlatformCommission", 'String'>
    readonly partnerType: FieldRef<"PlatformCommission", 'PartnerType'>
    readonly partnerId: FieldRef<"PlatformCommission", 'String'>
    readonly grossAmount: FieldRef<"PlatformCommission", 'Decimal'>
    readonly platformFeeAmount: FieldRef<"PlatformCommission", 'Decimal'>
    readonly partnerPayoutAmount: FieldRef<"PlatformCommission", 'Decimal'>
    readonly commissionRate: FieldRef<"PlatformCommission", 'Decimal'>
    readonly status: FieldRef<"PlatformCommission", 'CommissionStatus'>
    readonly settledAt: FieldRef<"PlatformCommission", 'DateTime'>
    readonly createdAt: FieldRef<"PlatformCommission", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PlatformCommission findUnique
   */
  export type PlatformCommissionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    /**
     * Filter, which PlatformCommission to fetch.
     */
    where: PlatformCommissionWhereUniqueInput
  }

  /**
   * PlatformCommission findUniqueOrThrow
   */
  export type PlatformCommissionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    /**
     * Filter, which PlatformCommission to fetch.
     */
    where: PlatformCommissionWhereUniqueInput
  }

  /**
   * PlatformCommission findFirst
   */
  export type PlatformCommissionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    /**
     * Filter, which PlatformCommission to fetch.
     */
    where?: PlatformCommissionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PlatformCommissions to fetch.
     */
    orderBy?: PlatformCommissionOrderByWithRelationInput | PlatformCommissionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PlatformCommissions.
     */
    cursor?: PlatformCommissionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PlatformCommissions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PlatformCommissions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PlatformCommissions.
     */
    distinct?: PlatformCommissionScalarFieldEnum | PlatformCommissionScalarFieldEnum[]
  }

  /**
   * PlatformCommission findFirstOrThrow
   */
  export type PlatformCommissionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    /**
     * Filter, which PlatformCommission to fetch.
     */
    where?: PlatformCommissionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PlatformCommissions to fetch.
     */
    orderBy?: PlatformCommissionOrderByWithRelationInput | PlatformCommissionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PlatformCommissions.
     */
    cursor?: PlatformCommissionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PlatformCommissions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PlatformCommissions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PlatformCommissions.
     */
    distinct?: PlatformCommissionScalarFieldEnum | PlatformCommissionScalarFieldEnum[]
  }

  /**
   * PlatformCommission findMany
   */
  export type PlatformCommissionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    /**
     * Filter, which PlatformCommissions to fetch.
     */
    where?: PlatformCommissionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PlatformCommissions to fetch.
     */
    orderBy?: PlatformCommissionOrderByWithRelationInput | PlatformCommissionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PlatformCommissions.
     */
    cursor?: PlatformCommissionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PlatformCommissions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PlatformCommissions.
     */
    skip?: number
    distinct?: PlatformCommissionScalarFieldEnum | PlatformCommissionScalarFieldEnum[]
  }

  /**
   * PlatformCommission create
   */
  export type PlatformCommissionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    /**
     * The data needed to create a PlatformCommission.
     */
    data: XOR<PlatformCommissionCreateInput, PlatformCommissionUncheckedCreateInput>
  }

  /**
   * PlatformCommission createMany
   */
  export type PlatformCommissionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PlatformCommissions.
     */
    data: PlatformCommissionCreateManyInput | PlatformCommissionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PlatformCommission createManyAndReturn
   */
  export type PlatformCommissionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PlatformCommissions.
     */
    data: PlatformCommissionCreateManyInput | PlatformCommissionCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * PlatformCommission update
   */
  export type PlatformCommissionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    /**
     * The data needed to update a PlatformCommission.
     */
    data: XOR<PlatformCommissionUpdateInput, PlatformCommissionUncheckedUpdateInput>
    /**
     * Choose, which PlatformCommission to update.
     */
    where: PlatformCommissionWhereUniqueInput
  }

  /**
   * PlatformCommission updateMany
   */
  export type PlatformCommissionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PlatformCommissions.
     */
    data: XOR<PlatformCommissionUpdateManyMutationInput, PlatformCommissionUncheckedUpdateManyInput>
    /**
     * Filter which PlatformCommissions to update
     */
    where?: PlatformCommissionWhereInput
  }

  /**
   * PlatformCommission upsert
   */
  export type PlatformCommissionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    /**
     * The filter to search for the PlatformCommission to update in case it exists.
     */
    where: PlatformCommissionWhereUniqueInput
    /**
     * In case the PlatformCommission found by the `where` argument doesn't exist, create a new PlatformCommission with this data.
     */
    create: XOR<PlatformCommissionCreateInput, PlatformCommissionUncheckedCreateInput>
    /**
     * In case the PlatformCommission was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PlatformCommissionUpdateInput, PlatformCommissionUncheckedUpdateInput>
  }

  /**
   * PlatformCommission delete
   */
  export type PlatformCommissionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
    /**
     * Filter which PlatformCommission to delete.
     */
    where: PlatformCommissionWhereUniqueInput
  }

  /**
   * PlatformCommission deleteMany
   */
  export type PlatformCommissionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PlatformCommissions to delete
     */
    where?: PlatformCommissionWhereInput
  }

  /**
   * PlatformCommission without action
   */
  export type PlatformCommissionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlatformCommission
     */
    select?: PlatformCommissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlatformCommissionInclude<ExtArgs> | null
  }


  /**
   * Model PaymentWebhookEvent
   */

  export type AggregatePaymentWebhookEvent = {
    _count: PaymentWebhookEventCountAggregateOutputType | null
    _avg: PaymentWebhookEventAvgAggregateOutputType | null
    _sum: PaymentWebhookEventSumAggregateOutputType | null
    _min: PaymentWebhookEventMinAggregateOutputType | null
    _max: PaymentWebhookEventMaxAggregateOutputType | null
  }

  export type PaymentWebhookEventAvgAggregateOutputType = {
    retryCount: number | null
  }

  export type PaymentWebhookEventSumAggregateOutputType = {
    retryCount: number | null
  }

  export type PaymentWebhookEventMinAggregateOutputType = {
    id: string | null
    provider: $Enums.PaymentProviderType | null
    providerEventId: string | null
    providerTransactionId: string | null
    processedAt: Date | null
    retryCount: number | null
    lastRetryAt: Date | null
    createdAt: Date | null
  }

  export type PaymentWebhookEventMaxAggregateOutputType = {
    id: string | null
    provider: $Enums.PaymentProviderType | null
    providerEventId: string | null
    providerTransactionId: string | null
    processedAt: Date | null
    retryCount: number | null
    lastRetryAt: Date | null
    createdAt: Date | null
  }

  export type PaymentWebhookEventCountAggregateOutputType = {
    id: number
    provider: number
    providerEventId: number
    providerTransactionId: number
    payload: number
    processedAt: number
    retryCount: number
    lastRetryAt: number
    createdAt: number
    _all: number
  }


  export type PaymentWebhookEventAvgAggregateInputType = {
    retryCount?: true
  }

  export type PaymentWebhookEventSumAggregateInputType = {
    retryCount?: true
  }

  export type PaymentWebhookEventMinAggregateInputType = {
    id?: true
    provider?: true
    providerEventId?: true
    providerTransactionId?: true
    processedAt?: true
    retryCount?: true
    lastRetryAt?: true
    createdAt?: true
  }

  export type PaymentWebhookEventMaxAggregateInputType = {
    id?: true
    provider?: true
    providerEventId?: true
    providerTransactionId?: true
    processedAt?: true
    retryCount?: true
    lastRetryAt?: true
    createdAt?: true
  }

  export type PaymentWebhookEventCountAggregateInputType = {
    id?: true
    provider?: true
    providerEventId?: true
    providerTransactionId?: true
    payload?: true
    processedAt?: true
    retryCount?: true
    lastRetryAt?: true
    createdAt?: true
    _all?: true
  }

  export type PaymentWebhookEventAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PaymentWebhookEvent to aggregate.
     */
    where?: PaymentWebhookEventWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PaymentWebhookEvents to fetch.
     */
    orderBy?: PaymentWebhookEventOrderByWithRelationInput | PaymentWebhookEventOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PaymentWebhookEventWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PaymentWebhookEvents from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PaymentWebhookEvents.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PaymentWebhookEvents
    **/
    _count?: true | PaymentWebhookEventCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PaymentWebhookEventAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PaymentWebhookEventSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PaymentWebhookEventMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PaymentWebhookEventMaxAggregateInputType
  }

  export type GetPaymentWebhookEventAggregateType<T extends PaymentWebhookEventAggregateArgs> = {
        [P in keyof T & keyof AggregatePaymentWebhookEvent]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePaymentWebhookEvent[P]>
      : GetScalarType<T[P], AggregatePaymentWebhookEvent[P]>
  }




  export type PaymentWebhookEventGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PaymentWebhookEventWhereInput
    orderBy?: PaymentWebhookEventOrderByWithAggregationInput | PaymentWebhookEventOrderByWithAggregationInput[]
    by: PaymentWebhookEventScalarFieldEnum[] | PaymentWebhookEventScalarFieldEnum
    having?: PaymentWebhookEventScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PaymentWebhookEventCountAggregateInputType | true
    _avg?: PaymentWebhookEventAvgAggregateInputType
    _sum?: PaymentWebhookEventSumAggregateInputType
    _min?: PaymentWebhookEventMinAggregateInputType
    _max?: PaymentWebhookEventMaxAggregateInputType
  }

  export type PaymentWebhookEventGroupByOutputType = {
    id: string
    provider: $Enums.PaymentProviderType
    providerEventId: string
    providerTransactionId: string | null
    payload: JsonValue
    processedAt: Date | null
    retryCount: number
    lastRetryAt: Date | null
    createdAt: Date
    _count: PaymentWebhookEventCountAggregateOutputType | null
    _avg: PaymentWebhookEventAvgAggregateOutputType | null
    _sum: PaymentWebhookEventSumAggregateOutputType | null
    _min: PaymentWebhookEventMinAggregateOutputType | null
    _max: PaymentWebhookEventMaxAggregateOutputType | null
  }

  type GetPaymentWebhookEventGroupByPayload<T extends PaymentWebhookEventGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PaymentWebhookEventGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PaymentWebhookEventGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PaymentWebhookEventGroupByOutputType[P]>
            : GetScalarType<T[P], PaymentWebhookEventGroupByOutputType[P]>
        }
      >
    >


  export type PaymentWebhookEventSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    provider?: boolean
    providerEventId?: boolean
    providerTransactionId?: boolean
    payload?: boolean
    processedAt?: boolean
    retryCount?: boolean
    lastRetryAt?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["paymentWebhookEvent"]>

  export type PaymentWebhookEventSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    provider?: boolean
    providerEventId?: boolean
    providerTransactionId?: boolean
    payload?: boolean
    processedAt?: boolean
    retryCount?: boolean
    lastRetryAt?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["paymentWebhookEvent"]>

  export type PaymentWebhookEventSelectScalar = {
    id?: boolean
    provider?: boolean
    providerEventId?: boolean
    providerTransactionId?: boolean
    payload?: boolean
    processedAt?: boolean
    retryCount?: boolean
    lastRetryAt?: boolean
    createdAt?: boolean
  }


  export type $PaymentWebhookEventPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PaymentWebhookEvent"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      provider: $Enums.PaymentProviderType
      providerEventId: string
      providerTransactionId: string | null
      payload: Prisma.JsonValue
      processedAt: Date | null
      retryCount: number
      lastRetryAt: Date | null
      createdAt: Date
    }, ExtArgs["result"]["paymentWebhookEvent"]>
    composites: {}
  }

  type PaymentWebhookEventGetPayload<S extends boolean | null | undefined | PaymentWebhookEventDefaultArgs> = $Result.GetResult<Prisma.$PaymentWebhookEventPayload, S>

  type PaymentWebhookEventCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PaymentWebhookEventFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PaymentWebhookEventCountAggregateInputType | true
    }

  export interface PaymentWebhookEventDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PaymentWebhookEvent'], meta: { name: 'PaymentWebhookEvent' } }
    /**
     * Find zero or one PaymentWebhookEvent that matches the filter.
     * @param {PaymentWebhookEventFindUniqueArgs} args - Arguments to find a PaymentWebhookEvent
     * @example
     * // Get one PaymentWebhookEvent
     * const paymentWebhookEvent = await prisma.paymentWebhookEvent.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PaymentWebhookEventFindUniqueArgs>(args: SelectSubset<T, PaymentWebhookEventFindUniqueArgs<ExtArgs>>): Prisma__PaymentWebhookEventClient<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PaymentWebhookEvent that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PaymentWebhookEventFindUniqueOrThrowArgs} args - Arguments to find a PaymentWebhookEvent
     * @example
     * // Get one PaymentWebhookEvent
     * const paymentWebhookEvent = await prisma.paymentWebhookEvent.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PaymentWebhookEventFindUniqueOrThrowArgs>(args: SelectSubset<T, PaymentWebhookEventFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PaymentWebhookEventClient<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PaymentWebhookEvent that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentWebhookEventFindFirstArgs} args - Arguments to find a PaymentWebhookEvent
     * @example
     * // Get one PaymentWebhookEvent
     * const paymentWebhookEvent = await prisma.paymentWebhookEvent.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PaymentWebhookEventFindFirstArgs>(args?: SelectSubset<T, PaymentWebhookEventFindFirstArgs<ExtArgs>>): Prisma__PaymentWebhookEventClient<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PaymentWebhookEvent that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentWebhookEventFindFirstOrThrowArgs} args - Arguments to find a PaymentWebhookEvent
     * @example
     * // Get one PaymentWebhookEvent
     * const paymentWebhookEvent = await prisma.paymentWebhookEvent.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PaymentWebhookEventFindFirstOrThrowArgs>(args?: SelectSubset<T, PaymentWebhookEventFindFirstOrThrowArgs<ExtArgs>>): Prisma__PaymentWebhookEventClient<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PaymentWebhookEvents that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentWebhookEventFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PaymentWebhookEvents
     * const paymentWebhookEvents = await prisma.paymentWebhookEvent.findMany()
     * 
     * // Get first 10 PaymentWebhookEvents
     * const paymentWebhookEvents = await prisma.paymentWebhookEvent.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const paymentWebhookEventWithIdOnly = await prisma.paymentWebhookEvent.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PaymentWebhookEventFindManyArgs>(args?: SelectSubset<T, PaymentWebhookEventFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PaymentWebhookEvent.
     * @param {PaymentWebhookEventCreateArgs} args - Arguments to create a PaymentWebhookEvent.
     * @example
     * // Create one PaymentWebhookEvent
     * const PaymentWebhookEvent = await prisma.paymentWebhookEvent.create({
     *   data: {
     *     // ... data to create a PaymentWebhookEvent
     *   }
     * })
     * 
     */
    create<T extends PaymentWebhookEventCreateArgs>(args: SelectSubset<T, PaymentWebhookEventCreateArgs<ExtArgs>>): Prisma__PaymentWebhookEventClient<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PaymentWebhookEvents.
     * @param {PaymentWebhookEventCreateManyArgs} args - Arguments to create many PaymentWebhookEvents.
     * @example
     * // Create many PaymentWebhookEvents
     * const paymentWebhookEvent = await prisma.paymentWebhookEvent.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PaymentWebhookEventCreateManyArgs>(args?: SelectSubset<T, PaymentWebhookEventCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PaymentWebhookEvents and returns the data saved in the database.
     * @param {PaymentWebhookEventCreateManyAndReturnArgs} args - Arguments to create many PaymentWebhookEvents.
     * @example
     * // Create many PaymentWebhookEvents
     * const paymentWebhookEvent = await prisma.paymentWebhookEvent.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PaymentWebhookEvents and only return the `id`
     * const paymentWebhookEventWithIdOnly = await prisma.paymentWebhookEvent.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PaymentWebhookEventCreateManyAndReturnArgs>(args?: SelectSubset<T, PaymentWebhookEventCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PaymentWebhookEvent.
     * @param {PaymentWebhookEventDeleteArgs} args - Arguments to delete one PaymentWebhookEvent.
     * @example
     * // Delete one PaymentWebhookEvent
     * const PaymentWebhookEvent = await prisma.paymentWebhookEvent.delete({
     *   where: {
     *     // ... filter to delete one PaymentWebhookEvent
     *   }
     * })
     * 
     */
    delete<T extends PaymentWebhookEventDeleteArgs>(args: SelectSubset<T, PaymentWebhookEventDeleteArgs<ExtArgs>>): Prisma__PaymentWebhookEventClient<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PaymentWebhookEvent.
     * @param {PaymentWebhookEventUpdateArgs} args - Arguments to update one PaymentWebhookEvent.
     * @example
     * // Update one PaymentWebhookEvent
     * const paymentWebhookEvent = await prisma.paymentWebhookEvent.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PaymentWebhookEventUpdateArgs>(args: SelectSubset<T, PaymentWebhookEventUpdateArgs<ExtArgs>>): Prisma__PaymentWebhookEventClient<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PaymentWebhookEvents.
     * @param {PaymentWebhookEventDeleteManyArgs} args - Arguments to filter PaymentWebhookEvents to delete.
     * @example
     * // Delete a few PaymentWebhookEvents
     * const { count } = await prisma.paymentWebhookEvent.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PaymentWebhookEventDeleteManyArgs>(args?: SelectSubset<T, PaymentWebhookEventDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PaymentWebhookEvents.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentWebhookEventUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PaymentWebhookEvents
     * const paymentWebhookEvent = await prisma.paymentWebhookEvent.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PaymentWebhookEventUpdateManyArgs>(args: SelectSubset<T, PaymentWebhookEventUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PaymentWebhookEvent.
     * @param {PaymentWebhookEventUpsertArgs} args - Arguments to update or create a PaymentWebhookEvent.
     * @example
     * // Update or create a PaymentWebhookEvent
     * const paymentWebhookEvent = await prisma.paymentWebhookEvent.upsert({
     *   create: {
     *     // ... data to create a PaymentWebhookEvent
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PaymentWebhookEvent we want to update
     *   }
     * })
     */
    upsert<T extends PaymentWebhookEventUpsertArgs>(args: SelectSubset<T, PaymentWebhookEventUpsertArgs<ExtArgs>>): Prisma__PaymentWebhookEventClient<$Result.GetResult<Prisma.$PaymentWebhookEventPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PaymentWebhookEvents.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentWebhookEventCountArgs} args - Arguments to filter PaymentWebhookEvents to count.
     * @example
     * // Count the number of PaymentWebhookEvents
     * const count = await prisma.paymentWebhookEvent.count({
     *   where: {
     *     // ... the filter for the PaymentWebhookEvents we want to count
     *   }
     * })
    **/
    count<T extends PaymentWebhookEventCountArgs>(
      args?: Subset<T, PaymentWebhookEventCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PaymentWebhookEventCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PaymentWebhookEvent.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentWebhookEventAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PaymentWebhookEventAggregateArgs>(args: Subset<T, PaymentWebhookEventAggregateArgs>): Prisma.PrismaPromise<GetPaymentWebhookEventAggregateType<T>>

    /**
     * Group by PaymentWebhookEvent.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentWebhookEventGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PaymentWebhookEventGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PaymentWebhookEventGroupByArgs['orderBy'] }
        : { orderBy?: PaymentWebhookEventGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PaymentWebhookEventGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPaymentWebhookEventGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PaymentWebhookEvent model
   */
  readonly fields: PaymentWebhookEventFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PaymentWebhookEvent.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PaymentWebhookEventClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the PaymentWebhookEvent model
   */ 
  interface PaymentWebhookEventFieldRefs {
    readonly id: FieldRef<"PaymentWebhookEvent", 'String'>
    readonly provider: FieldRef<"PaymentWebhookEvent", 'PaymentProviderType'>
    readonly providerEventId: FieldRef<"PaymentWebhookEvent", 'String'>
    readonly providerTransactionId: FieldRef<"PaymentWebhookEvent", 'String'>
    readonly payload: FieldRef<"PaymentWebhookEvent", 'Json'>
    readonly processedAt: FieldRef<"PaymentWebhookEvent", 'DateTime'>
    readonly retryCount: FieldRef<"PaymentWebhookEvent", 'Int'>
    readonly lastRetryAt: FieldRef<"PaymentWebhookEvent", 'DateTime'>
    readonly createdAt: FieldRef<"PaymentWebhookEvent", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PaymentWebhookEvent findUnique
   */
  export type PaymentWebhookEventFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
    /**
     * Filter, which PaymentWebhookEvent to fetch.
     */
    where: PaymentWebhookEventWhereUniqueInput
  }

  /**
   * PaymentWebhookEvent findUniqueOrThrow
   */
  export type PaymentWebhookEventFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
    /**
     * Filter, which PaymentWebhookEvent to fetch.
     */
    where: PaymentWebhookEventWhereUniqueInput
  }

  /**
   * PaymentWebhookEvent findFirst
   */
  export type PaymentWebhookEventFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
    /**
     * Filter, which PaymentWebhookEvent to fetch.
     */
    where?: PaymentWebhookEventWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PaymentWebhookEvents to fetch.
     */
    orderBy?: PaymentWebhookEventOrderByWithRelationInput | PaymentWebhookEventOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PaymentWebhookEvents.
     */
    cursor?: PaymentWebhookEventWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PaymentWebhookEvents from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PaymentWebhookEvents.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PaymentWebhookEvents.
     */
    distinct?: PaymentWebhookEventScalarFieldEnum | PaymentWebhookEventScalarFieldEnum[]
  }

  /**
   * PaymentWebhookEvent findFirstOrThrow
   */
  export type PaymentWebhookEventFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
    /**
     * Filter, which PaymentWebhookEvent to fetch.
     */
    where?: PaymentWebhookEventWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PaymentWebhookEvents to fetch.
     */
    orderBy?: PaymentWebhookEventOrderByWithRelationInput | PaymentWebhookEventOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PaymentWebhookEvents.
     */
    cursor?: PaymentWebhookEventWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PaymentWebhookEvents from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PaymentWebhookEvents.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PaymentWebhookEvents.
     */
    distinct?: PaymentWebhookEventScalarFieldEnum | PaymentWebhookEventScalarFieldEnum[]
  }

  /**
   * PaymentWebhookEvent findMany
   */
  export type PaymentWebhookEventFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
    /**
     * Filter, which PaymentWebhookEvents to fetch.
     */
    where?: PaymentWebhookEventWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PaymentWebhookEvents to fetch.
     */
    orderBy?: PaymentWebhookEventOrderByWithRelationInput | PaymentWebhookEventOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PaymentWebhookEvents.
     */
    cursor?: PaymentWebhookEventWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PaymentWebhookEvents from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PaymentWebhookEvents.
     */
    skip?: number
    distinct?: PaymentWebhookEventScalarFieldEnum | PaymentWebhookEventScalarFieldEnum[]
  }

  /**
   * PaymentWebhookEvent create
   */
  export type PaymentWebhookEventCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
    /**
     * The data needed to create a PaymentWebhookEvent.
     */
    data: XOR<PaymentWebhookEventCreateInput, PaymentWebhookEventUncheckedCreateInput>
  }

  /**
   * PaymentWebhookEvent createMany
   */
  export type PaymentWebhookEventCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PaymentWebhookEvents.
     */
    data: PaymentWebhookEventCreateManyInput | PaymentWebhookEventCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PaymentWebhookEvent createManyAndReturn
   */
  export type PaymentWebhookEventCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PaymentWebhookEvents.
     */
    data: PaymentWebhookEventCreateManyInput | PaymentWebhookEventCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PaymentWebhookEvent update
   */
  export type PaymentWebhookEventUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
    /**
     * The data needed to update a PaymentWebhookEvent.
     */
    data: XOR<PaymentWebhookEventUpdateInput, PaymentWebhookEventUncheckedUpdateInput>
    /**
     * Choose, which PaymentWebhookEvent to update.
     */
    where: PaymentWebhookEventWhereUniqueInput
  }

  /**
   * PaymentWebhookEvent updateMany
   */
  export type PaymentWebhookEventUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PaymentWebhookEvents.
     */
    data: XOR<PaymentWebhookEventUpdateManyMutationInput, PaymentWebhookEventUncheckedUpdateManyInput>
    /**
     * Filter which PaymentWebhookEvents to update
     */
    where?: PaymentWebhookEventWhereInput
  }

  /**
   * PaymentWebhookEvent upsert
   */
  export type PaymentWebhookEventUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
    /**
     * The filter to search for the PaymentWebhookEvent to update in case it exists.
     */
    where: PaymentWebhookEventWhereUniqueInput
    /**
     * In case the PaymentWebhookEvent found by the `where` argument doesn't exist, create a new PaymentWebhookEvent with this data.
     */
    create: XOR<PaymentWebhookEventCreateInput, PaymentWebhookEventUncheckedCreateInput>
    /**
     * In case the PaymentWebhookEvent was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PaymentWebhookEventUpdateInput, PaymentWebhookEventUncheckedUpdateInput>
  }

  /**
   * PaymentWebhookEvent delete
   */
  export type PaymentWebhookEventDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
    /**
     * Filter which PaymentWebhookEvent to delete.
     */
    where: PaymentWebhookEventWhereUniqueInput
  }

  /**
   * PaymentWebhookEvent deleteMany
   */
  export type PaymentWebhookEventDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PaymentWebhookEvents to delete
     */
    where?: PaymentWebhookEventWhereInput
  }

  /**
   * PaymentWebhookEvent without action
   */
  export type PaymentWebhookEventDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PaymentWebhookEvent
     */
    select?: PaymentWebhookEventSelect<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const WalletScalarFieldEnum: {
    id: 'id',
    ownerType: 'ownerType',
    ownerId: 'ownerId',
    availableBalance: 'availableBalance',
    lockedBalance: 'lockedBalance',
    status: 'status',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type WalletScalarFieldEnum = (typeof WalletScalarFieldEnum)[keyof typeof WalletScalarFieldEnum]


  export const WalletLedgerEntryScalarFieldEnum: {
    id: 'id',
    walletId: 'walletId',
    transactionId: 'transactionId',
    entryType: 'entryType',
    amount: 'amount',
    balanceBefore: 'balanceBefore',
    balanceAfter: 'balanceAfter',
    description: 'description',
    createdAt: 'createdAt'
  };

  export type WalletLedgerEntryScalarFieldEnum = (typeof WalletLedgerEntryScalarFieldEnum)[keyof typeof WalletLedgerEntryScalarFieldEnum]


  export const PaymentTransactionScalarFieldEnum: {
    id: 'id',
    payerId: 'payerId',
    purpose: 'purpose',
    gymId: 'gymId',
    ptId: 'ptId',
    membershipId: 'membershipId',
    ptContractId: 'ptContractId',
    amount: 'amount',
    currency: 'currency',
    status: 'status',
    provider: 'provider',
    providerTransactionId: 'providerTransactionId',
    paymentMethod: 'paymentMethod',
    idempotencyKey: 'idempotencyKey',
    requestFingerprint: 'requestFingerprint',
    extraData: 'extraData',
    paidAt: 'paidAt',
    failedAt: 'failedAt',
    refundedAt: 'refundedAt',
    metadata: 'metadata',
    payerWalletId: 'payerWalletId',
    receiverWalletId: 'receiverWalletId',
    relatedEntityType: 'relatedEntityType',
    relatedEntityId: 'relatedEntityId',
    activationStatus: 'activationStatus',
    activationRetryCount: 'activationRetryCount',
    lastActivationRetryAt: 'lastActivationRetryAt',
    initiatedBy: 'initiatedBy',
    sourceService: 'sourceService',
    refundOfTransactionId: 'refundOfTransactionId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type PaymentTransactionScalarFieldEnum = (typeof PaymentTransactionScalarFieldEnum)[keyof typeof PaymentTransactionScalarFieldEnum]


  export const PlatformCommissionScalarFieldEnum: {
    id: 'id',
    paymentTransactionId: 'paymentTransactionId',
    partnerType: 'partnerType',
    partnerId: 'partnerId',
    grossAmount: 'grossAmount',
    platformFeeAmount: 'platformFeeAmount',
    partnerPayoutAmount: 'partnerPayoutAmount',
    commissionRate: 'commissionRate',
    status: 'status',
    settledAt: 'settledAt',
    createdAt: 'createdAt'
  };

  export type PlatformCommissionScalarFieldEnum = (typeof PlatformCommissionScalarFieldEnum)[keyof typeof PlatformCommissionScalarFieldEnum]


  export const PaymentWebhookEventScalarFieldEnum: {
    id: 'id',
    provider: 'provider',
    providerEventId: 'providerEventId',
    providerTransactionId: 'providerTransactionId',
    payload: 'payload',
    processedAt: 'processedAt',
    retryCount: 'retryCount',
    lastRetryAt: 'lastRetryAt',
    createdAt: 'createdAt'
  };

  export type PaymentWebhookEventScalarFieldEnum = (typeof PaymentWebhookEventScalarFieldEnum)[keyof typeof PaymentWebhookEventScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const NullableJsonNullValueInput: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull
  };

  export type NullableJsonNullValueInput = (typeof NullableJsonNullValueInput)[keyof typeof NullableJsonNullValueInput]


  export const JsonNullValueInput: {
    JsonNull: typeof JsonNull
  };

  export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  /**
   * Field references 
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'WalletOwnerType'
   */
  export type EnumWalletOwnerTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'WalletOwnerType'>
    


  /**
   * Reference to a field of type 'WalletOwnerType[]'
   */
  export type ListEnumWalletOwnerTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'WalletOwnerType[]'>
    


  /**
   * Reference to a field of type 'Decimal'
   */
  export type DecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal'>
    


  /**
   * Reference to a field of type 'Decimal[]'
   */
  export type ListDecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal[]'>
    


  /**
   * Reference to a field of type 'WalletStatus'
   */
  export type EnumWalletStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'WalletStatus'>
    


  /**
   * Reference to a field of type 'WalletStatus[]'
   */
  export type ListEnumWalletStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'WalletStatus[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'LedgerEntryType'
   */
  export type EnumLedgerEntryTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'LedgerEntryType'>
    


  /**
   * Reference to a field of type 'LedgerEntryType[]'
   */
  export type ListEnumLedgerEntryTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'LedgerEntryType[]'>
    


  /**
   * Reference to a field of type 'PurposeType'
   */
  export type EnumPurposeTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PurposeType'>
    


  /**
   * Reference to a field of type 'PurposeType[]'
   */
  export type ListEnumPurposeTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PurposeType[]'>
    


  /**
   * Reference to a field of type 'PaymentStatus'
   */
  export type EnumPaymentStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentStatus'>
    


  /**
   * Reference to a field of type 'PaymentStatus[]'
   */
  export type ListEnumPaymentStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentStatus[]'>
    


  /**
   * Reference to a field of type 'PaymentProviderType'
   */
  export type EnumPaymentProviderTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentProviderType'>
    


  /**
   * Reference to a field of type 'PaymentProviderType[]'
   */
  export type ListEnumPaymentProviderTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentProviderType[]'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'RelatedEntityType'
   */
  export type EnumRelatedEntityTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'RelatedEntityType'>
    


  /**
   * Reference to a field of type 'RelatedEntityType[]'
   */
  export type ListEnumRelatedEntityTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'RelatedEntityType[]'>
    


  /**
   * Reference to a field of type 'ActivationStatus'
   */
  export type EnumActivationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ActivationStatus'>
    


  /**
   * Reference to a field of type 'ActivationStatus[]'
   */
  export type ListEnumActivationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ActivationStatus[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'PartnerType'
   */
  export type EnumPartnerTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PartnerType'>
    


  /**
   * Reference to a field of type 'PartnerType[]'
   */
  export type ListEnumPartnerTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PartnerType[]'>
    


  /**
   * Reference to a field of type 'CommissionStatus'
   */
  export type EnumCommissionStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'CommissionStatus'>
    


  /**
   * Reference to a field of type 'CommissionStatus[]'
   */
  export type ListEnumCommissionStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'CommissionStatus[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type WalletWhereInput = {
    AND?: WalletWhereInput | WalletWhereInput[]
    OR?: WalletWhereInput[]
    NOT?: WalletWhereInput | WalletWhereInput[]
    id?: StringFilter<"Wallet"> | string
    ownerType?: EnumWalletOwnerTypeFilter<"Wallet"> | $Enums.WalletOwnerType
    ownerId?: StringFilter<"Wallet"> | string
    availableBalance?: DecimalFilter<"Wallet"> | Decimal | DecimalJsLike | number | string
    lockedBalance?: DecimalFilter<"Wallet"> | Decimal | DecimalJsLike | number | string
    status?: EnumWalletStatusFilter<"Wallet"> | $Enums.WalletStatus
    createdAt?: DateTimeFilter<"Wallet"> | Date | string
    updatedAt?: DateTimeFilter<"Wallet"> | Date | string
    ledgerEntries?: WalletLedgerEntryListRelationFilter
  }

  export type WalletOrderByWithRelationInput = {
    id?: SortOrder
    ownerType?: SortOrder
    ownerId?: SortOrder
    availableBalance?: SortOrder
    lockedBalance?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    ledgerEntries?: WalletLedgerEntryOrderByRelationAggregateInput
  }

  export type WalletWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    ownerType_ownerId?: WalletOwnerTypeOwnerIdCompoundUniqueInput
    AND?: WalletWhereInput | WalletWhereInput[]
    OR?: WalletWhereInput[]
    NOT?: WalletWhereInput | WalletWhereInput[]
    ownerType?: EnumWalletOwnerTypeFilter<"Wallet"> | $Enums.WalletOwnerType
    ownerId?: StringFilter<"Wallet"> | string
    availableBalance?: DecimalFilter<"Wallet"> | Decimal | DecimalJsLike | number | string
    lockedBalance?: DecimalFilter<"Wallet"> | Decimal | DecimalJsLike | number | string
    status?: EnumWalletStatusFilter<"Wallet"> | $Enums.WalletStatus
    createdAt?: DateTimeFilter<"Wallet"> | Date | string
    updatedAt?: DateTimeFilter<"Wallet"> | Date | string
    ledgerEntries?: WalletLedgerEntryListRelationFilter
  }, "id" | "ownerType_ownerId">

  export type WalletOrderByWithAggregationInput = {
    id?: SortOrder
    ownerType?: SortOrder
    ownerId?: SortOrder
    availableBalance?: SortOrder
    lockedBalance?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: WalletCountOrderByAggregateInput
    _avg?: WalletAvgOrderByAggregateInput
    _max?: WalletMaxOrderByAggregateInput
    _min?: WalletMinOrderByAggregateInput
    _sum?: WalletSumOrderByAggregateInput
  }

  export type WalletScalarWhereWithAggregatesInput = {
    AND?: WalletScalarWhereWithAggregatesInput | WalletScalarWhereWithAggregatesInput[]
    OR?: WalletScalarWhereWithAggregatesInput[]
    NOT?: WalletScalarWhereWithAggregatesInput | WalletScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Wallet"> | string
    ownerType?: EnumWalletOwnerTypeWithAggregatesFilter<"Wallet"> | $Enums.WalletOwnerType
    ownerId?: StringWithAggregatesFilter<"Wallet"> | string
    availableBalance?: DecimalWithAggregatesFilter<"Wallet"> | Decimal | DecimalJsLike | number | string
    lockedBalance?: DecimalWithAggregatesFilter<"Wallet"> | Decimal | DecimalJsLike | number | string
    status?: EnumWalletStatusWithAggregatesFilter<"Wallet"> | $Enums.WalletStatus
    createdAt?: DateTimeWithAggregatesFilter<"Wallet"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Wallet"> | Date | string
  }

  export type WalletLedgerEntryWhereInput = {
    AND?: WalletLedgerEntryWhereInput | WalletLedgerEntryWhereInput[]
    OR?: WalletLedgerEntryWhereInput[]
    NOT?: WalletLedgerEntryWhereInput | WalletLedgerEntryWhereInput[]
    id?: StringFilter<"WalletLedgerEntry"> | string
    walletId?: StringFilter<"WalletLedgerEntry"> | string
    transactionId?: StringFilter<"WalletLedgerEntry"> | string
    entryType?: EnumLedgerEntryTypeFilter<"WalletLedgerEntry"> | $Enums.LedgerEntryType
    amount?: DecimalFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    description?: StringNullableFilter<"WalletLedgerEntry"> | string | null
    createdAt?: DateTimeFilter<"WalletLedgerEntry"> | Date | string
    wallet?: XOR<WalletRelationFilter, WalletWhereInput>
    transaction?: XOR<PaymentTransactionRelationFilter, PaymentTransactionWhereInput>
  }

  export type WalletLedgerEntryOrderByWithRelationInput = {
    id?: SortOrder
    walletId?: SortOrder
    transactionId?: SortOrder
    entryType?: SortOrder
    amount?: SortOrder
    balanceBefore?: SortOrder
    balanceAfter?: SortOrder
    description?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    wallet?: WalletOrderByWithRelationInput
    transaction?: PaymentTransactionOrderByWithRelationInput
  }

  export type WalletLedgerEntryWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: WalletLedgerEntryWhereInput | WalletLedgerEntryWhereInput[]
    OR?: WalletLedgerEntryWhereInput[]
    NOT?: WalletLedgerEntryWhereInput | WalletLedgerEntryWhereInput[]
    walletId?: StringFilter<"WalletLedgerEntry"> | string
    transactionId?: StringFilter<"WalletLedgerEntry"> | string
    entryType?: EnumLedgerEntryTypeFilter<"WalletLedgerEntry"> | $Enums.LedgerEntryType
    amount?: DecimalFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    description?: StringNullableFilter<"WalletLedgerEntry"> | string | null
    createdAt?: DateTimeFilter<"WalletLedgerEntry"> | Date | string
    wallet?: XOR<WalletRelationFilter, WalletWhereInput>
    transaction?: XOR<PaymentTransactionRelationFilter, PaymentTransactionWhereInput>
  }, "id">

  export type WalletLedgerEntryOrderByWithAggregationInput = {
    id?: SortOrder
    walletId?: SortOrder
    transactionId?: SortOrder
    entryType?: SortOrder
    amount?: SortOrder
    balanceBefore?: SortOrder
    balanceAfter?: SortOrder
    description?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: WalletLedgerEntryCountOrderByAggregateInput
    _avg?: WalletLedgerEntryAvgOrderByAggregateInput
    _max?: WalletLedgerEntryMaxOrderByAggregateInput
    _min?: WalletLedgerEntryMinOrderByAggregateInput
    _sum?: WalletLedgerEntrySumOrderByAggregateInput
  }

  export type WalletLedgerEntryScalarWhereWithAggregatesInput = {
    AND?: WalletLedgerEntryScalarWhereWithAggregatesInput | WalletLedgerEntryScalarWhereWithAggregatesInput[]
    OR?: WalletLedgerEntryScalarWhereWithAggregatesInput[]
    NOT?: WalletLedgerEntryScalarWhereWithAggregatesInput | WalletLedgerEntryScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WalletLedgerEntry"> | string
    walletId?: StringWithAggregatesFilter<"WalletLedgerEntry"> | string
    transactionId?: StringWithAggregatesFilter<"WalletLedgerEntry"> | string
    entryType?: EnumLedgerEntryTypeWithAggregatesFilter<"WalletLedgerEntry"> | $Enums.LedgerEntryType
    amount?: DecimalWithAggregatesFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalWithAggregatesFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalWithAggregatesFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    description?: StringNullableWithAggregatesFilter<"WalletLedgerEntry"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"WalletLedgerEntry"> | Date | string
  }

  export type PaymentTransactionWhereInput = {
    AND?: PaymentTransactionWhereInput | PaymentTransactionWhereInput[]
    OR?: PaymentTransactionWhereInput[]
    NOT?: PaymentTransactionWhereInput | PaymentTransactionWhereInput[]
    id?: StringFilter<"PaymentTransaction"> | string
    payerId?: StringFilter<"PaymentTransaction"> | string
    purpose?: EnumPurposeTypeFilter<"PaymentTransaction"> | $Enums.PurposeType
    gymId?: StringNullableFilter<"PaymentTransaction"> | string | null
    ptId?: StringNullableFilter<"PaymentTransaction"> | string | null
    membershipId?: StringNullableFilter<"PaymentTransaction"> | string | null
    ptContractId?: StringNullableFilter<"PaymentTransaction"> | string | null
    amount?: DecimalFilter<"PaymentTransaction"> | Decimal | DecimalJsLike | number | string
    currency?: StringFilter<"PaymentTransaction"> | string
    status?: EnumPaymentStatusFilter<"PaymentTransaction"> | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFilter<"PaymentTransaction"> | $Enums.PaymentProviderType
    providerTransactionId?: StringNullableFilter<"PaymentTransaction"> | string | null
    paymentMethod?: StringNullableFilter<"PaymentTransaction"> | string | null
    idempotencyKey?: StringFilter<"PaymentTransaction"> | string
    requestFingerprint?: StringNullableFilter<"PaymentTransaction"> | string | null
    extraData?: StringNullableFilter<"PaymentTransaction"> | string | null
    paidAt?: DateTimeNullableFilter<"PaymentTransaction"> | Date | string | null
    failedAt?: DateTimeNullableFilter<"PaymentTransaction"> | Date | string | null
    refundedAt?: DateTimeNullableFilter<"PaymentTransaction"> | Date | string | null
    metadata?: JsonNullableFilter<"PaymentTransaction">
    payerWalletId?: StringNullableFilter<"PaymentTransaction"> | string | null
    receiverWalletId?: StringNullableFilter<"PaymentTransaction"> | string | null
    relatedEntityType?: EnumRelatedEntityTypeNullableFilter<"PaymentTransaction"> | $Enums.RelatedEntityType | null
    relatedEntityId?: StringNullableFilter<"PaymentTransaction"> | string | null
    activationStatus?: EnumActivationStatusFilter<"PaymentTransaction"> | $Enums.ActivationStatus
    activationRetryCount?: IntFilter<"PaymentTransaction"> | number
    lastActivationRetryAt?: DateTimeNullableFilter<"PaymentTransaction"> | Date | string | null
    initiatedBy?: StringNullableFilter<"PaymentTransaction"> | string | null
    sourceService?: StringNullableFilter<"PaymentTransaction"> | string | null
    refundOfTransactionId?: StringNullableFilter<"PaymentTransaction"> | string | null
    createdAt?: DateTimeFilter<"PaymentTransaction"> | Date | string
    updatedAt?: DateTimeFilter<"PaymentTransaction"> | Date | string
    commissions?: PlatformCommissionListRelationFilter
    ledgerEntries?: WalletLedgerEntryListRelationFilter
  }

  export type PaymentTransactionOrderByWithRelationInput = {
    id?: SortOrder
    payerId?: SortOrder
    purpose?: SortOrder
    gymId?: SortOrderInput | SortOrder
    ptId?: SortOrderInput | SortOrder
    membershipId?: SortOrderInput | SortOrder
    ptContractId?: SortOrderInput | SortOrder
    amount?: SortOrder
    currency?: SortOrder
    status?: SortOrder
    provider?: SortOrder
    providerTransactionId?: SortOrderInput | SortOrder
    paymentMethod?: SortOrderInput | SortOrder
    idempotencyKey?: SortOrder
    requestFingerprint?: SortOrderInput | SortOrder
    extraData?: SortOrderInput | SortOrder
    paidAt?: SortOrderInput | SortOrder
    failedAt?: SortOrderInput | SortOrder
    refundedAt?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    payerWalletId?: SortOrderInput | SortOrder
    receiverWalletId?: SortOrderInput | SortOrder
    relatedEntityType?: SortOrderInput | SortOrder
    relatedEntityId?: SortOrderInput | SortOrder
    activationStatus?: SortOrder
    activationRetryCount?: SortOrder
    lastActivationRetryAt?: SortOrderInput | SortOrder
    initiatedBy?: SortOrderInput | SortOrder
    sourceService?: SortOrderInput | SortOrder
    refundOfTransactionId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    commissions?: PlatformCommissionOrderByRelationAggregateInput
    ledgerEntries?: WalletLedgerEntryOrderByRelationAggregateInput
  }

  export type PaymentTransactionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    idempotencyKey?: string
    AND?: PaymentTransactionWhereInput | PaymentTransactionWhereInput[]
    OR?: PaymentTransactionWhereInput[]
    NOT?: PaymentTransactionWhereInput | PaymentTransactionWhereInput[]
    payerId?: StringFilter<"PaymentTransaction"> | string
    purpose?: EnumPurposeTypeFilter<"PaymentTransaction"> | $Enums.PurposeType
    gymId?: StringNullableFilter<"PaymentTransaction"> | string | null
    ptId?: StringNullableFilter<"PaymentTransaction"> | string | null
    membershipId?: StringNullableFilter<"PaymentTransaction"> | string | null
    ptContractId?: StringNullableFilter<"PaymentTransaction"> | string | null
    amount?: DecimalFilter<"PaymentTransaction"> | Decimal | DecimalJsLike | number | string
    currency?: StringFilter<"PaymentTransaction"> | string
    status?: EnumPaymentStatusFilter<"PaymentTransaction"> | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFilter<"PaymentTransaction"> | $Enums.PaymentProviderType
    providerTransactionId?: StringNullableFilter<"PaymentTransaction"> | string | null
    paymentMethod?: StringNullableFilter<"PaymentTransaction"> | string | null
    requestFingerprint?: StringNullableFilter<"PaymentTransaction"> | string | null
    extraData?: StringNullableFilter<"PaymentTransaction"> | string | null
    paidAt?: DateTimeNullableFilter<"PaymentTransaction"> | Date | string | null
    failedAt?: DateTimeNullableFilter<"PaymentTransaction"> | Date | string | null
    refundedAt?: DateTimeNullableFilter<"PaymentTransaction"> | Date | string | null
    metadata?: JsonNullableFilter<"PaymentTransaction">
    payerWalletId?: StringNullableFilter<"PaymentTransaction"> | string | null
    receiverWalletId?: StringNullableFilter<"PaymentTransaction"> | string | null
    relatedEntityType?: EnumRelatedEntityTypeNullableFilter<"PaymentTransaction"> | $Enums.RelatedEntityType | null
    relatedEntityId?: StringNullableFilter<"PaymentTransaction"> | string | null
    activationStatus?: EnumActivationStatusFilter<"PaymentTransaction"> | $Enums.ActivationStatus
    activationRetryCount?: IntFilter<"PaymentTransaction"> | number
    lastActivationRetryAt?: DateTimeNullableFilter<"PaymentTransaction"> | Date | string | null
    initiatedBy?: StringNullableFilter<"PaymentTransaction"> | string | null
    sourceService?: StringNullableFilter<"PaymentTransaction"> | string | null
    refundOfTransactionId?: StringNullableFilter<"PaymentTransaction"> | string | null
    createdAt?: DateTimeFilter<"PaymentTransaction"> | Date | string
    updatedAt?: DateTimeFilter<"PaymentTransaction"> | Date | string
    commissions?: PlatformCommissionListRelationFilter
    ledgerEntries?: WalletLedgerEntryListRelationFilter
  }, "id" | "idempotencyKey">

  export type PaymentTransactionOrderByWithAggregationInput = {
    id?: SortOrder
    payerId?: SortOrder
    purpose?: SortOrder
    gymId?: SortOrderInput | SortOrder
    ptId?: SortOrderInput | SortOrder
    membershipId?: SortOrderInput | SortOrder
    ptContractId?: SortOrderInput | SortOrder
    amount?: SortOrder
    currency?: SortOrder
    status?: SortOrder
    provider?: SortOrder
    providerTransactionId?: SortOrderInput | SortOrder
    paymentMethod?: SortOrderInput | SortOrder
    idempotencyKey?: SortOrder
    requestFingerprint?: SortOrderInput | SortOrder
    extraData?: SortOrderInput | SortOrder
    paidAt?: SortOrderInput | SortOrder
    failedAt?: SortOrderInput | SortOrder
    refundedAt?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    payerWalletId?: SortOrderInput | SortOrder
    receiverWalletId?: SortOrderInput | SortOrder
    relatedEntityType?: SortOrderInput | SortOrder
    relatedEntityId?: SortOrderInput | SortOrder
    activationStatus?: SortOrder
    activationRetryCount?: SortOrder
    lastActivationRetryAt?: SortOrderInput | SortOrder
    initiatedBy?: SortOrderInput | SortOrder
    sourceService?: SortOrderInput | SortOrder
    refundOfTransactionId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: PaymentTransactionCountOrderByAggregateInput
    _avg?: PaymentTransactionAvgOrderByAggregateInput
    _max?: PaymentTransactionMaxOrderByAggregateInput
    _min?: PaymentTransactionMinOrderByAggregateInput
    _sum?: PaymentTransactionSumOrderByAggregateInput
  }

  export type PaymentTransactionScalarWhereWithAggregatesInput = {
    AND?: PaymentTransactionScalarWhereWithAggregatesInput | PaymentTransactionScalarWhereWithAggregatesInput[]
    OR?: PaymentTransactionScalarWhereWithAggregatesInput[]
    NOT?: PaymentTransactionScalarWhereWithAggregatesInput | PaymentTransactionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PaymentTransaction"> | string
    payerId?: StringWithAggregatesFilter<"PaymentTransaction"> | string
    purpose?: EnumPurposeTypeWithAggregatesFilter<"PaymentTransaction"> | $Enums.PurposeType
    gymId?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    ptId?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    membershipId?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    ptContractId?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    amount?: DecimalWithAggregatesFilter<"PaymentTransaction"> | Decimal | DecimalJsLike | number | string
    currency?: StringWithAggregatesFilter<"PaymentTransaction"> | string
    status?: EnumPaymentStatusWithAggregatesFilter<"PaymentTransaction"> | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeWithAggregatesFilter<"PaymentTransaction"> | $Enums.PaymentProviderType
    providerTransactionId?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    paymentMethod?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    idempotencyKey?: StringWithAggregatesFilter<"PaymentTransaction"> | string
    requestFingerprint?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    extraData?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    paidAt?: DateTimeNullableWithAggregatesFilter<"PaymentTransaction"> | Date | string | null
    failedAt?: DateTimeNullableWithAggregatesFilter<"PaymentTransaction"> | Date | string | null
    refundedAt?: DateTimeNullableWithAggregatesFilter<"PaymentTransaction"> | Date | string | null
    metadata?: JsonNullableWithAggregatesFilter<"PaymentTransaction">
    payerWalletId?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    receiverWalletId?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    relatedEntityType?: EnumRelatedEntityTypeNullableWithAggregatesFilter<"PaymentTransaction"> | $Enums.RelatedEntityType | null
    relatedEntityId?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    activationStatus?: EnumActivationStatusWithAggregatesFilter<"PaymentTransaction"> | $Enums.ActivationStatus
    activationRetryCount?: IntWithAggregatesFilter<"PaymentTransaction"> | number
    lastActivationRetryAt?: DateTimeNullableWithAggregatesFilter<"PaymentTransaction"> | Date | string | null
    initiatedBy?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    sourceService?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    refundOfTransactionId?: StringNullableWithAggregatesFilter<"PaymentTransaction"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PaymentTransaction"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"PaymentTransaction"> | Date | string
  }

  export type PlatformCommissionWhereInput = {
    AND?: PlatformCommissionWhereInput | PlatformCommissionWhereInput[]
    OR?: PlatformCommissionWhereInput[]
    NOT?: PlatformCommissionWhereInput | PlatformCommissionWhereInput[]
    id?: StringFilter<"PlatformCommission"> | string
    paymentTransactionId?: StringFilter<"PlatformCommission"> | string
    partnerType?: EnumPartnerTypeFilter<"PlatformCommission"> | $Enums.PartnerType
    partnerId?: StringFilter<"PlatformCommission"> | string
    grossAmount?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFilter<"PlatformCommission"> | $Enums.CommissionStatus
    settledAt?: DateTimeNullableFilter<"PlatformCommission"> | Date | string | null
    createdAt?: DateTimeFilter<"PlatformCommission"> | Date | string
    transaction?: XOR<PaymentTransactionRelationFilter, PaymentTransactionWhereInput>
  }

  export type PlatformCommissionOrderByWithRelationInput = {
    id?: SortOrder
    paymentTransactionId?: SortOrder
    partnerType?: SortOrder
    partnerId?: SortOrder
    grossAmount?: SortOrder
    platformFeeAmount?: SortOrder
    partnerPayoutAmount?: SortOrder
    commissionRate?: SortOrder
    status?: SortOrder
    settledAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    transaction?: PaymentTransactionOrderByWithRelationInput
  }

  export type PlatformCommissionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: PlatformCommissionWhereInput | PlatformCommissionWhereInput[]
    OR?: PlatformCommissionWhereInput[]
    NOT?: PlatformCommissionWhereInput | PlatformCommissionWhereInput[]
    paymentTransactionId?: StringFilter<"PlatformCommission"> | string
    partnerType?: EnumPartnerTypeFilter<"PlatformCommission"> | $Enums.PartnerType
    partnerId?: StringFilter<"PlatformCommission"> | string
    grossAmount?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFilter<"PlatformCommission"> | $Enums.CommissionStatus
    settledAt?: DateTimeNullableFilter<"PlatformCommission"> | Date | string | null
    createdAt?: DateTimeFilter<"PlatformCommission"> | Date | string
    transaction?: XOR<PaymentTransactionRelationFilter, PaymentTransactionWhereInput>
  }, "id">

  export type PlatformCommissionOrderByWithAggregationInput = {
    id?: SortOrder
    paymentTransactionId?: SortOrder
    partnerType?: SortOrder
    partnerId?: SortOrder
    grossAmount?: SortOrder
    platformFeeAmount?: SortOrder
    partnerPayoutAmount?: SortOrder
    commissionRate?: SortOrder
    status?: SortOrder
    settledAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: PlatformCommissionCountOrderByAggregateInput
    _avg?: PlatformCommissionAvgOrderByAggregateInput
    _max?: PlatformCommissionMaxOrderByAggregateInput
    _min?: PlatformCommissionMinOrderByAggregateInput
    _sum?: PlatformCommissionSumOrderByAggregateInput
  }

  export type PlatformCommissionScalarWhereWithAggregatesInput = {
    AND?: PlatformCommissionScalarWhereWithAggregatesInput | PlatformCommissionScalarWhereWithAggregatesInput[]
    OR?: PlatformCommissionScalarWhereWithAggregatesInput[]
    NOT?: PlatformCommissionScalarWhereWithAggregatesInput | PlatformCommissionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PlatformCommission"> | string
    paymentTransactionId?: StringWithAggregatesFilter<"PlatformCommission"> | string
    partnerType?: EnumPartnerTypeWithAggregatesFilter<"PlatformCommission"> | $Enums.PartnerType
    partnerId?: StringWithAggregatesFilter<"PlatformCommission"> | string
    grossAmount?: DecimalWithAggregatesFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalWithAggregatesFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalWithAggregatesFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalWithAggregatesFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusWithAggregatesFilter<"PlatformCommission"> | $Enums.CommissionStatus
    settledAt?: DateTimeNullableWithAggregatesFilter<"PlatformCommission"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PlatformCommission"> | Date | string
  }

  export type PaymentWebhookEventWhereInput = {
    AND?: PaymentWebhookEventWhereInput | PaymentWebhookEventWhereInput[]
    OR?: PaymentWebhookEventWhereInput[]
    NOT?: PaymentWebhookEventWhereInput | PaymentWebhookEventWhereInput[]
    id?: StringFilter<"PaymentWebhookEvent"> | string
    provider?: EnumPaymentProviderTypeFilter<"PaymentWebhookEvent"> | $Enums.PaymentProviderType
    providerEventId?: StringFilter<"PaymentWebhookEvent"> | string
    providerTransactionId?: StringNullableFilter<"PaymentWebhookEvent"> | string | null
    payload?: JsonFilter<"PaymentWebhookEvent">
    processedAt?: DateTimeNullableFilter<"PaymentWebhookEvent"> | Date | string | null
    retryCount?: IntFilter<"PaymentWebhookEvent"> | number
    lastRetryAt?: DateTimeNullableFilter<"PaymentWebhookEvent"> | Date | string | null
    createdAt?: DateTimeFilter<"PaymentWebhookEvent"> | Date | string
  }

  export type PaymentWebhookEventOrderByWithRelationInput = {
    id?: SortOrder
    provider?: SortOrder
    providerEventId?: SortOrder
    providerTransactionId?: SortOrderInput | SortOrder
    payload?: SortOrder
    processedAt?: SortOrderInput | SortOrder
    retryCount?: SortOrder
    lastRetryAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
  }

  export type PaymentWebhookEventWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    provider_providerEventId?: PaymentWebhookEventProviderProviderEventIdCompoundUniqueInput
    AND?: PaymentWebhookEventWhereInput | PaymentWebhookEventWhereInput[]
    OR?: PaymentWebhookEventWhereInput[]
    NOT?: PaymentWebhookEventWhereInput | PaymentWebhookEventWhereInput[]
    provider?: EnumPaymentProviderTypeFilter<"PaymentWebhookEvent"> | $Enums.PaymentProviderType
    providerEventId?: StringFilter<"PaymentWebhookEvent"> | string
    providerTransactionId?: StringNullableFilter<"PaymentWebhookEvent"> | string | null
    payload?: JsonFilter<"PaymentWebhookEvent">
    processedAt?: DateTimeNullableFilter<"PaymentWebhookEvent"> | Date | string | null
    retryCount?: IntFilter<"PaymentWebhookEvent"> | number
    lastRetryAt?: DateTimeNullableFilter<"PaymentWebhookEvent"> | Date | string | null
    createdAt?: DateTimeFilter<"PaymentWebhookEvent"> | Date | string
  }, "id" | "provider_providerEventId">

  export type PaymentWebhookEventOrderByWithAggregationInput = {
    id?: SortOrder
    provider?: SortOrder
    providerEventId?: SortOrder
    providerTransactionId?: SortOrderInput | SortOrder
    payload?: SortOrder
    processedAt?: SortOrderInput | SortOrder
    retryCount?: SortOrder
    lastRetryAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: PaymentWebhookEventCountOrderByAggregateInput
    _avg?: PaymentWebhookEventAvgOrderByAggregateInput
    _max?: PaymentWebhookEventMaxOrderByAggregateInput
    _min?: PaymentWebhookEventMinOrderByAggregateInput
    _sum?: PaymentWebhookEventSumOrderByAggregateInput
  }

  export type PaymentWebhookEventScalarWhereWithAggregatesInput = {
    AND?: PaymentWebhookEventScalarWhereWithAggregatesInput | PaymentWebhookEventScalarWhereWithAggregatesInput[]
    OR?: PaymentWebhookEventScalarWhereWithAggregatesInput[]
    NOT?: PaymentWebhookEventScalarWhereWithAggregatesInput | PaymentWebhookEventScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PaymentWebhookEvent"> | string
    provider?: EnumPaymentProviderTypeWithAggregatesFilter<"PaymentWebhookEvent"> | $Enums.PaymentProviderType
    providerEventId?: StringWithAggregatesFilter<"PaymentWebhookEvent"> | string
    providerTransactionId?: StringNullableWithAggregatesFilter<"PaymentWebhookEvent"> | string | null
    payload?: JsonWithAggregatesFilter<"PaymentWebhookEvent">
    processedAt?: DateTimeNullableWithAggregatesFilter<"PaymentWebhookEvent"> | Date | string | null
    retryCount?: IntWithAggregatesFilter<"PaymentWebhookEvent"> | number
    lastRetryAt?: DateTimeNullableWithAggregatesFilter<"PaymentWebhookEvent"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PaymentWebhookEvent"> | Date | string
  }

  export type WalletCreateInput = {
    id?: string
    ownerType: $Enums.WalletOwnerType
    ownerId: string
    availableBalance?: Decimal | DecimalJsLike | number | string
    lockedBalance?: Decimal | DecimalJsLike | number | string
    status?: $Enums.WalletStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    ledgerEntries?: WalletLedgerEntryCreateNestedManyWithoutWalletInput
  }

  export type WalletUncheckedCreateInput = {
    id?: string
    ownerType: $Enums.WalletOwnerType
    ownerId: string
    availableBalance?: Decimal | DecimalJsLike | number | string
    lockedBalance?: Decimal | DecimalJsLike | number | string
    status?: $Enums.WalletStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    ledgerEntries?: WalletLedgerEntryUncheckedCreateNestedManyWithoutWalletInput
  }

  export type WalletUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerType?: EnumWalletOwnerTypeFieldUpdateOperationsInput | $Enums.WalletOwnerType
    ownerId?: StringFieldUpdateOperationsInput | string
    availableBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    lockedBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumWalletStatusFieldUpdateOperationsInput | $Enums.WalletStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    ledgerEntries?: WalletLedgerEntryUpdateManyWithoutWalletNestedInput
  }

  export type WalletUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerType?: EnumWalletOwnerTypeFieldUpdateOperationsInput | $Enums.WalletOwnerType
    ownerId?: StringFieldUpdateOperationsInput | string
    availableBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    lockedBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumWalletStatusFieldUpdateOperationsInput | $Enums.WalletStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    ledgerEntries?: WalletLedgerEntryUncheckedUpdateManyWithoutWalletNestedInput
  }

  export type WalletCreateManyInput = {
    id?: string
    ownerType: $Enums.WalletOwnerType
    ownerId: string
    availableBalance?: Decimal | DecimalJsLike | number | string
    lockedBalance?: Decimal | DecimalJsLike | number | string
    status?: $Enums.WalletStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WalletUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerType?: EnumWalletOwnerTypeFieldUpdateOperationsInput | $Enums.WalletOwnerType
    ownerId?: StringFieldUpdateOperationsInput | string
    availableBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    lockedBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumWalletStatusFieldUpdateOperationsInput | $Enums.WalletStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WalletUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerType?: EnumWalletOwnerTypeFieldUpdateOperationsInput | $Enums.WalletOwnerType
    ownerId?: StringFieldUpdateOperationsInput | string
    availableBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    lockedBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumWalletStatusFieldUpdateOperationsInput | $Enums.WalletStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WalletLedgerEntryCreateInput = {
    id?: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal | DecimalJsLike | number | string
    balanceBefore: Decimal | DecimalJsLike | number | string
    balanceAfter: Decimal | DecimalJsLike | number | string
    description?: string | null
    createdAt?: Date | string
    wallet: WalletCreateNestedOneWithoutLedgerEntriesInput
    transaction: PaymentTransactionCreateNestedOneWithoutLedgerEntriesInput
  }

  export type WalletLedgerEntryUncheckedCreateInput = {
    id?: string
    walletId: string
    transactionId: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal | DecimalJsLike | number | string
    balanceBefore: Decimal | DecimalJsLike | number | string
    balanceAfter: Decimal | DecimalJsLike | number | string
    description?: string | null
    createdAt?: Date | string
  }

  export type WalletLedgerEntryUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    wallet?: WalletUpdateOneRequiredWithoutLedgerEntriesNestedInput
    transaction?: PaymentTransactionUpdateOneRequiredWithoutLedgerEntriesNestedInput
  }

  export type WalletLedgerEntryUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletId?: StringFieldUpdateOperationsInput | string
    transactionId?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WalletLedgerEntryCreateManyInput = {
    id?: string
    walletId: string
    transactionId: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal | DecimalJsLike | number | string
    balanceBefore: Decimal | DecimalJsLike | number | string
    balanceAfter: Decimal | DecimalJsLike | number | string
    description?: string | null
    createdAt?: Date | string
  }

  export type WalletLedgerEntryUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WalletLedgerEntryUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletId?: StringFieldUpdateOperationsInput | string
    transactionId?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentTransactionCreateInput = {
    id?: string
    payerId: string
    purpose: $Enums.PurposeType
    gymId?: string | null
    ptId?: string | null
    membershipId?: string | null
    ptContractId?: string | null
    amount: Decimal | DecimalJsLike | number | string
    currency?: string
    status?: $Enums.PaymentStatus
    provider?: $Enums.PaymentProviderType
    providerTransactionId?: string | null
    paymentMethod?: string | null
    idempotencyKey: string
    requestFingerprint?: string | null
    extraData?: string | null
    paidAt?: Date | string | null
    failedAt?: Date | string | null
    refundedAt?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: string | null
    receiverWalletId?: string | null
    relatedEntityType?: $Enums.RelatedEntityType | null
    relatedEntityId?: string | null
    activationStatus?: $Enums.ActivationStatus
    activationRetryCount?: number
    lastActivationRetryAt?: Date | string | null
    initiatedBy?: string | null
    sourceService?: string | null
    refundOfTransactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    commissions?: PlatformCommissionCreateNestedManyWithoutTransactionInput
    ledgerEntries?: WalletLedgerEntryCreateNestedManyWithoutTransactionInput
  }

  export type PaymentTransactionUncheckedCreateInput = {
    id?: string
    payerId: string
    purpose: $Enums.PurposeType
    gymId?: string | null
    ptId?: string | null
    membershipId?: string | null
    ptContractId?: string | null
    amount: Decimal | DecimalJsLike | number | string
    currency?: string
    status?: $Enums.PaymentStatus
    provider?: $Enums.PaymentProviderType
    providerTransactionId?: string | null
    paymentMethod?: string | null
    idempotencyKey: string
    requestFingerprint?: string | null
    extraData?: string | null
    paidAt?: Date | string | null
    failedAt?: Date | string | null
    refundedAt?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: string | null
    receiverWalletId?: string | null
    relatedEntityType?: $Enums.RelatedEntityType | null
    relatedEntityId?: string | null
    activationStatus?: $Enums.ActivationStatus
    activationRetryCount?: number
    lastActivationRetryAt?: Date | string | null
    initiatedBy?: string | null
    sourceService?: string | null
    refundOfTransactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    commissions?: PlatformCommissionUncheckedCreateNestedManyWithoutTransactionInput
    ledgerEntries?: WalletLedgerEntryUncheckedCreateNestedManyWithoutTransactionInput
  }

  export type PaymentTransactionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    payerId?: StringFieldUpdateOperationsInput | string
    purpose?: EnumPurposeTypeFieldUpdateOperationsInput | $Enums.PurposeType
    gymId?: NullableStringFieldUpdateOperationsInput | string | null
    ptId?: NullableStringFieldUpdateOperationsInput | string | null
    membershipId?: NullableStringFieldUpdateOperationsInput | string | null
    ptContractId?: NullableStringFieldUpdateOperationsInput | string | null
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    currency?: StringFieldUpdateOperationsInput | string
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    paymentMethod?: NullableStringFieldUpdateOperationsInput | string | null
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    requestFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    extraData?: NullableStringFieldUpdateOperationsInput | string | null
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    receiverWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    relatedEntityType?: NullableEnumRelatedEntityTypeFieldUpdateOperationsInput | $Enums.RelatedEntityType | null
    relatedEntityId?: NullableStringFieldUpdateOperationsInput | string | null
    activationStatus?: EnumActivationStatusFieldUpdateOperationsInput | $Enums.ActivationStatus
    activationRetryCount?: IntFieldUpdateOperationsInput | number
    lastActivationRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    initiatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    sourceService?: NullableStringFieldUpdateOperationsInput | string | null
    refundOfTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    commissions?: PlatformCommissionUpdateManyWithoutTransactionNestedInput
    ledgerEntries?: WalletLedgerEntryUpdateManyWithoutTransactionNestedInput
  }

  export type PaymentTransactionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    payerId?: StringFieldUpdateOperationsInput | string
    purpose?: EnumPurposeTypeFieldUpdateOperationsInput | $Enums.PurposeType
    gymId?: NullableStringFieldUpdateOperationsInput | string | null
    ptId?: NullableStringFieldUpdateOperationsInput | string | null
    membershipId?: NullableStringFieldUpdateOperationsInput | string | null
    ptContractId?: NullableStringFieldUpdateOperationsInput | string | null
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    currency?: StringFieldUpdateOperationsInput | string
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    paymentMethod?: NullableStringFieldUpdateOperationsInput | string | null
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    requestFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    extraData?: NullableStringFieldUpdateOperationsInput | string | null
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    receiverWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    relatedEntityType?: NullableEnumRelatedEntityTypeFieldUpdateOperationsInput | $Enums.RelatedEntityType | null
    relatedEntityId?: NullableStringFieldUpdateOperationsInput | string | null
    activationStatus?: EnumActivationStatusFieldUpdateOperationsInput | $Enums.ActivationStatus
    activationRetryCount?: IntFieldUpdateOperationsInput | number
    lastActivationRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    initiatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    sourceService?: NullableStringFieldUpdateOperationsInput | string | null
    refundOfTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    commissions?: PlatformCommissionUncheckedUpdateManyWithoutTransactionNestedInput
    ledgerEntries?: WalletLedgerEntryUncheckedUpdateManyWithoutTransactionNestedInput
  }

  export type PaymentTransactionCreateManyInput = {
    id?: string
    payerId: string
    purpose: $Enums.PurposeType
    gymId?: string | null
    ptId?: string | null
    membershipId?: string | null
    ptContractId?: string | null
    amount: Decimal | DecimalJsLike | number | string
    currency?: string
    status?: $Enums.PaymentStatus
    provider?: $Enums.PaymentProviderType
    providerTransactionId?: string | null
    paymentMethod?: string | null
    idempotencyKey: string
    requestFingerprint?: string | null
    extraData?: string | null
    paidAt?: Date | string | null
    failedAt?: Date | string | null
    refundedAt?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: string | null
    receiverWalletId?: string | null
    relatedEntityType?: $Enums.RelatedEntityType | null
    relatedEntityId?: string | null
    activationStatus?: $Enums.ActivationStatus
    activationRetryCount?: number
    lastActivationRetryAt?: Date | string | null
    initiatedBy?: string | null
    sourceService?: string | null
    refundOfTransactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PaymentTransactionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    payerId?: StringFieldUpdateOperationsInput | string
    purpose?: EnumPurposeTypeFieldUpdateOperationsInput | $Enums.PurposeType
    gymId?: NullableStringFieldUpdateOperationsInput | string | null
    ptId?: NullableStringFieldUpdateOperationsInput | string | null
    membershipId?: NullableStringFieldUpdateOperationsInput | string | null
    ptContractId?: NullableStringFieldUpdateOperationsInput | string | null
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    currency?: StringFieldUpdateOperationsInput | string
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    paymentMethod?: NullableStringFieldUpdateOperationsInput | string | null
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    requestFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    extraData?: NullableStringFieldUpdateOperationsInput | string | null
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    receiverWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    relatedEntityType?: NullableEnumRelatedEntityTypeFieldUpdateOperationsInput | $Enums.RelatedEntityType | null
    relatedEntityId?: NullableStringFieldUpdateOperationsInput | string | null
    activationStatus?: EnumActivationStatusFieldUpdateOperationsInput | $Enums.ActivationStatus
    activationRetryCount?: IntFieldUpdateOperationsInput | number
    lastActivationRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    initiatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    sourceService?: NullableStringFieldUpdateOperationsInput | string | null
    refundOfTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentTransactionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    payerId?: StringFieldUpdateOperationsInput | string
    purpose?: EnumPurposeTypeFieldUpdateOperationsInput | $Enums.PurposeType
    gymId?: NullableStringFieldUpdateOperationsInput | string | null
    ptId?: NullableStringFieldUpdateOperationsInput | string | null
    membershipId?: NullableStringFieldUpdateOperationsInput | string | null
    ptContractId?: NullableStringFieldUpdateOperationsInput | string | null
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    currency?: StringFieldUpdateOperationsInput | string
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    paymentMethod?: NullableStringFieldUpdateOperationsInput | string | null
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    requestFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    extraData?: NullableStringFieldUpdateOperationsInput | string | null
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    receiverWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    relatedEntityType?: NullableEnumRelatedEntityTypeFieldUpdateOperationsInput | $Enums.RelatedEntityType | null
    relatedEntityId?: NullableStringFieldUpdateOperationsInput | string | null
    activationStatus?: EnumActivationStatusFieldUpdateOperationsInput | $Enums.ActivationStatus
    activationRetryCount?: IntFieldUpdateOperationsInput | number
    lastActivationRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    initiatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    sourceService?: NullableStringFieldUpdateOperationsInput | string | null
    refundOfTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlatformCommissionCreateInput = {
    id?: string
    partnerType: $Enums.PartnerType
    partnerId: string
    grossAmount: Decimal | DecimalJsLike | number | string
    platformFeeAmount: Decimal | DecimalJsLike | number | string
    partnerPayoutAmount: Decimal | DecimalJsLike | number | string
    commissionRate: Decimal | DecimalJsLike | number | string
    status?: $Enums.CommissionStatus
    settledAt?: Date | string | null
    createdAt?: Date | string
    transaction: PaymentTransactionCreateNestedOneWithoutCommissionsInput
  }

  export type PlatformCommissionUncheckedCreateInput = {
    id?: string
    paymentTransactionId: string
    partnerType: $Enums.PartnerType
    partnerId: string
    grossAmount: Decimal | DecimalJsLike | number | string
    platformFeeAmount: Decimal | DecimalJsLike | number | string
    partnerPayoutAmount: Decimal | DecimalJsLike | number | string
    commissionRate: Decimal | DecimalJsLike | number | string
    status?: $Enums.CommissionStatus
    settledAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PlatformCommissionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    partnerType?: EnumPartnerTypeFieldUpdateOperationsInput | $Enums.PartnerType
    partnerId?: StringFieldUpdateOperationsInput | string
    grossAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFieldUpdateOperationsInput | $Enums.CommissionStatus
    settledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    transaction?: PaymentTransactionUpdateOneRequiredWithoutCommissionsNestedInput
  }

  export type PlatformCommissionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    paymentTransactionId?: StringFieldUpdateOperationsInput | string
    partnerType?: EnumPartnerTypeFieldUpdateOperationsInput | $Enums.PartnerType
    partnerId?: StringFieldUpdateOperationsInput | string
    grossAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFieldUpdateOperationsInput | $Enums.CommissionStatus
    settledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlatformCommissionCreateManyInput = {
    id?: string
    paymentTransactionId: string
    partnerType: $Enums.PartnerType
    partnerId: string
    grossAmount: Decimal | DecimalJsLike | number | string
    platformFeeAmount: Decimal | DecimalJsLike | number | string
    partnerPayoutAmount: Decimal | DecimalJsLike | number | string
    commissionRate: Decimal | DecimalJsLike | number | string
    status?: $Enums.CommissionStatus
    settledAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PlatformCommissionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    partnerType?: EnumPartnerTypeFieldUpdateOperationsInput | $Enums.PartnerType
    partnerId?: StringFieldUpdateOperationsInput | string
    grossAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFieldUpdateOperationsInput | $Enums.CommissionStatus
    settledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlatformCommissionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    paymentTransactionId?: StringFieldUpdateOperationsInput | string
    partnerType?: EnumPartnerTypeFieldUpdateOperationsInput | $Enums.PartnerType
    partnerId?: StringFieldUpdateOperationsInput | string
    grossAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFieldUpdateOperationsInput | $Enums.CommissionStatus
    settledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentWebhookEventCreateInput = {
    id?: string
    provider: $Enums.PaymentProviderType
    providerEventId: string
    providerTransactionId?: string | null
    payload: JsonNullValueInput | InputJsonValue
    processedAt?: Date | string | null
    retryCount?: number
    lastRetryAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PaymentWebhookEventUncheckedCreateInput = {
    id?: string
    provider: $Enums.PaymentProviderType
    providerEventId: string
    providerTransactionId?: string | null
    payload: JsonNullValueInput | InputJsonValue
    processedAt?: Date | string | null
    retryCount?: number
    lastRetryAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PaymentWebhookEventUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerEventId?: StringFieldUpdateOperationsInput | string
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    payload?: JsonNullValueInput | InputJsonValue
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    retryCount?: IntFieldUpdateOperationsInput | number
    lastRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentWebhookEventUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerEventId?: StringFieldUpdateOperationsInput | string
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    payload?: JsonNullValueInput | InputJsonValue
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    retryCount?: IntFieldUpdateOperationsInput | number
    lastRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentWebhookEventCreateManyInput = {
    id?: string
    provider: $Enums.PaymentProviderType
    providerEventId: string
    providerTransactionId?: string | null
    payload: JsonNullValueInput | InputJsonValue
    processedAt?: Date | string | null
    retryCount?: number
    lastRetryAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PaymentWebhookEventUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerEventId?: StringFieldUpdateOperationsInput | string
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    payload?: JsonNullValueInput | InputJsonValue
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    retryCount?: IntFieldUpdateOperationsInput | number
    lastRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentWebhookEventUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerEventId?: StringFieldUpdateOperationsInput | string
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    payload?: JsonNullValueInput | InputJsonValue
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    retryCount?: IntFieldUpdateOperationsInput | number
    lastRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type EnumWalletOwnerTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.WalletOwnerType | EnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.WalletOwnerType[] | ListEnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.WalletOwnerType[] | ListEnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumWalletOwnerTypeFilter<$PrismaModel> | $Enums.WalletOwnerType
  }

  export type DecimalFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string
  }

  export type EnumWalletStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.WalletStatus | EnumWalletStatusFieldRefInput<$PrismaModel>
    in?: $Enums.WalletStatus[] | ListEnumWalletStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.WalletStatus[] | ListEnumWalletStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumWalletStatusFilter<$PrismaModel> | $Enums.WalletStatus
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type WalletLedgerEntryListRelationFilter = {
    every?: WalletLedgerEntryWhereInput
    some?: WalletLedgerEntryWhereInput
    none?: WalletLedgerEntryWhereInput
  }

  export type WalletLedgerEntryOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type WalletOwnerTypeOwnerIdCompoundUniqueInput = {
    ownerType: $Enums.WalletOwnerType
    ownerId: string
  }

  export type WalletCountOrderByAggregateInput = {
    id?: SortOrder
    ownerType?: SortOrder
    ownerId?: SortOrder
    availableBalance?: SortOrder
    lockedBalance?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WalletAvgOrderByAggregateInput = {
    availableBalance?: SortOrder
    lockedBalance?: SortOrder
  }

  export type WalletMaxOrderByAggregateInput = {
    id?: SortOrder
    ownerType?: SortOrder
    ownerId?: SortOrder
    availableBalance?: SortOrder
    lockedBalance?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WalletMinOrderByAggregateInput = {
    id?: SortOrder
    ownerType?: SortOrder
    ownerId?: SortOrder
    availableBalance?: SortOrder
    lockedBalance?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WalletSumOrderByAggregateInput = {
    availableBalance?: SortOrder
    lockedBalance?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type EnumWalletOwnerTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.WalletOwnerType | EnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.WalletOwnerType[] | ListEnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.WalletOwnerType[] | ListEnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumWalletOwnerTypeWithAggregatesFilter<$PrismaModel> | $Enums.WalletOwnerType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumWalletOwnerTypeFilter<$PrismaModel>
    _max?: NestedEnumWalletOwnerTypeFilter<$PrismaModel>
  }

  export type DecimalWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalWithAggregatesFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedDecimalFilter<$PrismaModel>
    _sum?: NestedDecimalFilter<$PrismaModel>
    _min?: NestedDecimalFilter<$PrismaModel>
    _max?: NestedDecimalFilter<$PrismaModel>
  }

  export type EnumWalletStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.WalletStatus | EnumWalletStatusFieldRefInput<$PrismaModel>
    in?: $Enums.WalletStatus[] | ListEnumWalletStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.WalletStatus[] | ListEnumWalletStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumWalletStatusWithAggregatesFilter<$PrismaModel> | $Enums.WalletStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumWalletStatusFilter<$PrismaModel>
    _max?: NestedEnumWalletStatusFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type EnumLedgerEntryTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.LedgerEntryType | EnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    in?: $Enums.LedgerEntryType[] | ListEnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.LedgerEntryType[] | ListEnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumLedgerEntryTypeFilter<$PrismaModel> | $Enums.LedgerEntryType
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type WalletRelationFilter = {
    is?: WalletWhereInput
    isNot?: WalletWhereInput
  }

  export type PaymentTransactionRelationFilter = {
    is?: PaymentTransactionWhereInput
    isNot?: PaymentTransactionWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type WalletLedgerEntryCountOrderByAggregateInput = {
    id?: SortOrder
    walletId?: SortOrder
    transactionId?: SortOrder
    entryType?: SortOrder
    amount?: SortOrder
    balanceBefore?: SortOrder
    balanceAfter?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
  }

  export type WalletLedgerEntryAvgOrderByAggregateInput = {
    amount?: SortOrder
    balanceBefore?: SortOrder
    balanceAfter?: SortOrder
  }

  export type WalletLedgerEntryMaxOrderByAggregateInput = {
    id?: SortOrder
    walletId?: SortOrder
    transactionId?: SortOrder
    entryType?: SortOrder
    amount?: SortOrder
    balanceBefore?: SortOrder
    balanceAfter?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
  }

  export type WalletLedgerEntryMinOrderByAggregateInput = {
    id?: SortOrder
    walletId?: SortOrder
    transactionId?: SortOrder
    entryType?: SortOrder
    amount?: SortOrder
    balanceBefore?: SortOrder
    balanceAfter?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
  }

  export type WalletLedgerEntrySumOrderByAggregateInput = {
    amount?: SortOrder
    balanceBefore?: SortOrder
    balanceAfter?: SortOrder
  }

  export type EnumLedgerEntryTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.LedgerEntryType | EnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    in?: $Enums.LedgerEntryType[] | ListEnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.LedgerEntryType[] | ListEnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumLedgerEntryTypeWithAggregatesFilter<$PrismaModel> | $Enums.LedgerEntryType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumLedgerEntryTypeFilter<$PrismaModel>
    _max?: NestedEnumLedgerEntryTypeFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type EnumPurposeTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.PurposeType | EnumPurposeTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PurposeType[] | ListEnumPurposeTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PurposeType[] | ListEnumPurposeTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPurposeTypeFilter<$PrismaModel> | $Enums.PurposeType
  }

  export type EnumPaymentStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentStatus | EnumPaymentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentStatusFilter<$PrismaModel> | $Enums.PaymentStatus
  }

  export type EnumPaymentProviderTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentProviderType | EnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentProviderType[] | ListEnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentProviderType[] | ListEnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentProviderTypeFilter<$PrismaModel> | $Enums.PaymentProviderType
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }
  export type JsonNullableFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type EnumRelatedEntityTypeNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.RelatedEntityType | EnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    in?: $Enums.RelatedEntityType[] | ListEnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.RelatedEntityType[] | ListEnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    not?: NestedEnumRelatedEntityTypeNullableFilter<$PrismaModel> | $Enums.RelatedEntityType | null
  }

  export type EnumActivationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.ActivationStatus | EnumActivationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.ActivationStatus[] | ListEnumActivationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.ActivationStatus[] | ListEnumActivationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumActivationStatusFilter<$PrismaModel> | $Enums.ActivationStatus
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type PlatformCommissionListRelationFilter = {
    every?: PlatformCommissionWhereInput
    some?: PlatformCommissionWhereInput
    none?: PlatformCommissionWhereInput
  }

  export type PlatformCommissionOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PaymentTransactionCountOrderByAggregateInput = {
    id?: SortOrder
    payerId?: SortOrder
    purpose?: SortOrder
    gymId?: SortOrder
    ptId?: SortOrder
    membershipId?: SortOrder
    ptContractId?: SortOrder
    amount?: SortOrder
    currency?: SortOrder
    status?: SortOrder
    provider?: SortOrder
    providerTransactionId?: SortOrder
    paymentMethod?: SortOrder
    idempotencyKey?: SortOrder
    requestFingerprint?: SortOrder
    extraData?: SortOrder
    paidAt?: SortOrder
    failedAt?: SortOrder
    refundedAt?: SortOrder
    metadata?: SortOrder
    payerWalletId?: SortOrder
    receiverWalletId?: SortOrder
    relatedEntityType?: SortOrder
    relatedEntityId?: SortOrder
    activationStatus?: SortOrder
    activationRetryCount?: SortOrder
    lastActivationRetryAt?: SortOrder
    initiatedBy?: SortOrder
    sourceService?: SortOrder
    refundOfTransactionId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PaymentTransactionAvgOrderByAggregateInput = {
    amount?: SortOrder
    activationRetryCount?: SortOrder
  }

  export type PaymentTransactionMaxOrderByAggregateInput = {
    id?: SortOrder
    payerId?: SortOrder
    purpose?: SortOrder
    gymId?: SortOrder
    ptId?: SortOrder
    membershipId?: SortOrder
    ptContractId?: SortOrder
    amount?: SortOrder
    currency?: SortOrder
    status?: SortOrder
    provider?: SortOrder
    providerTransactionId?: SortOrder
    paymentMethod?: SortOrder
    idempotencyKey?: SortOrder
    requestFingerprint?: SortOrder
    extraData?: SortOrder
    paidAt?: SortOrder
    failedAt?: SortOrder
    refundedAt?: SortOrder
    payerWalletId?: SortOrder
    receiverWalletId?: SortOrder
    relatedEntityType?: SortOrder
    relatedEntityId?: SortOrder
    activationStatus?: SortOrder
    activationRetryCount?: SortOrder
    lastActivationRetryAt?: SortOrder
    initiatedBy?: SortOrder
    sourceService?: SortOrder
    refundOfTransactionId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PaymentTransactionMinOrderByAggregateInput = {
    id?: SortOrder
    payerId?: SortOrder
    purpose?: SortOrder
    gymId?: SortOrder
    ptId?: SortOrder
    membershipId?: SortOrder
    ptContractId?: SortOrder
    amount?: SortOrder
    currency?: SortOrder
    status?: SortOrder
    provider?: SortOrder
    providerTransactionId?: SortOrder
    paymentMethod?: SortOrder
    idempotencyKey?: SortOrder
    requestFingerprint?: SortOrder
    extraData?: SortOrder
    paidAt?: SortOrder
    failedAt?: SortOrder
    refundedAt?: SortOrder
    payerWalletId?: SortOrder
    receiverWalletId?: SortOrder
    relatedEntityType?: SortOrder
    relatedEntityId?: SortOrder
    activationStatus?: SortOrder
    activationRetryCount?: SortOrder
    lastActivationRetryAt?: SortOrder
    initiatedBy?: SortOrder
    sourceService?: SortOrder
    refundOfTransactionId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PaymentTransactionSumOrderByAggregateInput = {
    amount?: SortOrder
    activationRetryCount?: SortOrder
  }

  export type EnumPurposeTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PurposeType | EnumPurposeTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PurposeType[] | ListEnumPurposeTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PurposeType[] | ListEnumPurposeTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPurposeTypeWithAggregatesFilter<$PrismaModel> | $Enums.PurposeType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPurposeTypeFilter<$PrismaModel>
    _max?: NestedEnumPurposeTypeFilter<$PrismaModel>
  }

  export type EnumPaymentStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentStatus | EnumPaymentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentStatusWithAggregatesFilter<$PrismaModel> | $Enums.PaymentStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPaymentStatusFilter<$PrismaModel>
    _max?: NestedEnumPaymentStatusFilter<$PrismaModel>
  }

  export type EnumPaymentProviderTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentProviderType | EnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentProviderType[] | ListEnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentProviderType[] | ListEnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentProviderTypeWithAggregatesFilter<$PrismaModel> | $Enums.PaymentProviderType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPaymentProviderTypeFilter<$PrismaModel>
    _max?: NestedEnumPaymentProviderTypeFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }
  export type JsonNullableWithAggregatesFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedJsonNullableFilter<$PrismaModel>
    _max?: NestedJsonNullableFilter<$PrismaModel>
  }

  export type EnumRelatedEntityTypeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.RelatedEntityType | EnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    in?: $Enums.RelatedEntityType[] | ListEnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.RelatedEntityType[] | ListEnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    not?: NestedEnumRelatedEntityTypeNullableWithAggregatesFilter<$PrismaModel> | $Enums.RelatedEntityType | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumRelatedEntityTypeNullableFilter<$PrismaModel>
    _max?: NestedEnumRelatedEntityTypeNullableFilter<$PrismaModel>
  }

  export type EnumActivationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ActivationStatus | EnumActivationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.ActivationStatus[] | ListEnumActivationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.ActivationStatus[] | ListEnumActivationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumActivationStatusWithAggregatesFilter<$PrismaModel> | $Enums.ActivationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumActivationStatusFilter<$PrismaModel>
    _max?: NestedEnumActivationStatusFilter<$PrismaModel>
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type EnumPartnerTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.PartnerType | EnumPartnerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PartnerType[] | ListEnumPartnerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PartnerType[] | ListEnumPartnerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPartnerTypeFilter<$PrismaModel> | $Enums.PartnerType
  }

  export type EnumCommissionStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.CommissionStatus | EnumCommissionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.CommissionStatus[] | ListEnumCommissionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.CommissionStatus[] | ListEnumCommissionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumCommissionStatusFilter<$PrismaModel> | $Enums.CommissionStatus
  }

  export type PlatformCommissionCountOrderByAggregateInput = {
    id?: SortOrder
    paymentTransactionId?: SortOrder
    partnerType?: SortOrder
    partnerId?: SortOrder
    grossAmount?: SortOrder
    platformFeeAmount?: SortOrder
    partnerPayoutAmount?: SortOrder
    commissionRate?: SortOrder
    status?: SortOrder
    settledAt?: SortOrder
    createdAt?: SortOrder
  }

  export type PlatformCommissionAvgOrderByAggregateInput = {
    grossAmount?: SortOrder
    platformFeeAmount?: SortOrder
    partnerPayoutAmount?: SortOrder
    commissionRate?: SortOrder
  }

  export type PlatformCommissionMaxOrderByAggregateInput = {
    id?: SortOrder
    paymentTransactionId?: SortOrder
    partnerType?: SortOrder
    partnerId?: SortOrder
    grossAmount?: SortOrder
    platformFeeAmount?: SortOrder
    partnerPayoutAmount?: SortOrder
    commissionRate?: SortOrder
    status?: SortOrder
    settledAt?: SortOrder
    createdAt?: SortOrder
  }

  export type PlatformCommissionMinOrderByAggregateInput = {
    id?: SortOrder
    paymentTransactionId?: SortOrder
    partnerType?: SortOrder
    partnerId?: SortOrder
    grossAmount?: SortOrder
    platformFeeAmount?: SortOrder
    partnerPayoutAmount?: SortOrder
    commissionRate?: SortOrder
    status?: SortOrder
    settledAt?: SortOrder
    createdAt?: SortOrder
  }

  export type PlatformCommissionSumOrderByAggregateInput = {
    grossAmount?: SortOrder
    platformFeeAmount?: SortOrder
    partnerPayoutAmount?: SortOrder
    commissionRate?: SortOrder
  }

  export type EnumPartnerTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PartnerType | EnumPartnerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PartnerType[] | ListEnumPartnerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PartnerType[] | ListEnumPartnerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPartnerTypeWithAggregatesFilter<$PrismaModel> | $Enums.PartnerType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPartnerTypeFilter<$PrismaModel>
    _max?: NestedEnumPartnerTypeFilter<$PrismaModel>
  }

  export type EnumCommissionStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.CommissionStatus | EnumCommissionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.CommissionStatus[] | ListEnumCommissionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.CommissionStatus[] | ListEnumCommissionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumCommissionStatusWithAggregatesFilter<$PrismaModel> | $Enums.CommissionStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumCommissionStatusFilter<$PrismaModel>
    _max?: NestedEnumCommissionStatusFilter<$PrismaModel>
  }
  export type JsonFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonFilterBase<$PrismaModel>>, 'path'>>

  export type JsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type PaymentWebhookEventProviderProviderEventIdCompoundUniqueInput = {
    provider: $Enums.PaymentProviderType
    providerEventId: string
  }

  export type PaymentWebhookEventCountOrderByAggregateInput = {
    id?: SortOrder
    provider?: SortOrder
    providerEventId?: SortOrder
    providerTransactionId?: SortOrder
    payload?: SortOrder
    processedAt?: SortOrder
    retryCount?: SortOrder
    lastRetryAt?: SortOrder
    createdAt?: SortOrder
  }

  export type PaymentWebhookEventAvgOrderByAggregateInput = {
    retryCount?: SortOrder
  }

  export type PaymentWebhookEventMaxOrderByAggregateInput = {
    id?: SortOrder
    provider?: SortOrder
    providerEventId?: SortOrder
    providerTransactionId?: SortOrder
    processedAt?: SortOrder
    retryCount?: SortOrder
    lastRetryAt?: SortOrder
    createdAt?: SortOrder
  }

  export type PaymentWebhookEventMinOrderByAggregateInput = {
    id?: SortOrder
    provider?: SortOrder
    providerEventId?: SortOrder
    providerTransactionId?: SortOrder
    processedAt?: SortOrder
    retryCount?: SortOrder
    lastRetryAt?: SortOrder
    createdAt?: SortOrder
  }

  export type PaymentWebhookEventSumOrderByAggregateInput = {
    retryCount?: SortOrder
  }
  export type JsonWithAggregatesFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedJsonFilter<$PrismaModel>
    _max?: NestedJsonFilter<$PrismaModel>
  }

  export type WalletLedgerEntryCreateNestedManyWithoutWalletInput = {
    create?: XOR<WalletLedgerEntryCreateWithoutWalletInput, WalletLedgerEntryUncheckedCreateWithoutWalletInput> | WalletLedgerEntryCreateWithoutWalletInput[] | WalletLedgerEntryUncheckedCreateWithoutWalletInput[]
    connectOrCreate?: WalletLedgerEntryCreateOrConnectWithoutWalletInput | WalletLedgerEntryCreateOrConnectWithoutWalletInput[]
    createMany?: WalletLedgerEntryCreateManyWalletInputEnvelope
    connect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
  }

  export type WalletLedgerEntryUncheckedCreateNestedManyWithoutWalletInput = {
    create?: XOR<WalletLedgerEntryCreateWithoutWalletInput, WalletLedgerEntryUncheckedCreateWithoutWalletInput> | WalletLedgerEntryCreateWithoutWalletInput[] | WalletLedgerEntryUncheckedCreateWithoutWalletInput[]
    connectOrCreate?: WalletLedgerEntryCreateOrConnectWithoutWalletInput | WalletLedgerEntryCreateOrConnectWithoutWalletInput[]
    createMany?: WalletLedgerEntryCreateManyWalletInputEnvelope
    connect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type EnumWalletOwnerTypeFieldUpdateOperationsInput = {
    set?: $Enums.WalletOwnerType
  }

  export type DecimalFieldUpdateOperationsInput = {
    set?: Decimal | DecimalJsLike | number | string
    increment?: Decimal | DecimalJsLike | number | string
    decrement?: Decimal | DecimalJsLike | number | string
    multiply?: Decimal | DecimalJsLike | number | string
    divide?: Decimal | DecimalJsLike | number | string
  }

  export type EnumWalletStatusFieldUpdateOperationsInput = {
    set?: $Enums.WalletStatus
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type WalletLedgerEntryUpdateManyWithoutWalletNestedInput = {
    create?: XOR<WalletLedgerEntryCreateWithoutWalletInput, WalletLedgerEntryUncheckedCreateWithoutWalletInput> | WalletLedgerEntryCreateWithoutWalletInput[] | WalletLedgerEntryUncheckedCreateWithoutWalletInput[]
    connectOrCreate?: WalletLedgerEntryCreateOrConnectWithoutWalletInput | WalletLedgerEntryCreateOrConnectWithoutWalletInput[]
    upsert?: WalletLedgerEntryUpsertWithWhereUniqueWithoutWalletInput | WalletLedgerEntryUpsertWithWhereUniqueWithoutWalletInput[]
    createMany?: WalletLedgerEntryCreateManyWalletInputEnvelope
    set?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    disconnect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    delete?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    connect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    update?: WalletLedgerEntryUpdateWithWhereUniqueWithoutWalletInput | WalletLedgerEntryUpdateWithWhereUniqueWithoutWalletInput[]
    updateMany?: WalletLedgerEntryUpdateManyWithWhereWithoutWalletInput | WalletLedgerEntryUpdateManyWithWhereWithoutWalletInput[]
    deleteMany?: WalletLedgerEntryScalarWhereInput | WalletLedgerEntryScalarWhereInput[]
  }

  export type WalletLedgerEntryUncheckedUpdateManyWithoutWalletNestedInput = {
    create?: XOR<WalletLedgerEntryCreateWithoutWalletInput, WalletLedgerEntryUncheckedCreateWithoutWalletInput> | WalletLedgerEntryCreateWithoutWalletInput[] | WalletLedgerEntryUncheckedCreateWithoutWalletInput[]
    connectOrCreate?: WalletLedgerEntryCreateOrConnectWithoutWalletInput | WalletLedgerEntryCreateOrConnectWithoutWalletInput[]
    upsert?: WalletLedgerEntryUpsertWithWhereUniqueWithoutWalletInput | WalletLedgerEntryUpsertWithWhereUniqueWithoutWalletInput[]
    createMany?: WalletLedgerEntryCreateManyWalletInputEnvelope
    set?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    disconnect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    delete?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    connect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    update?: WalletLedgerEntryUpdateWithWhereUniqueWithoutWalletInput | WalletLedgerEntryUpdateWithWhereUniqueWithoutWalletInput[]
    updateMany?: WalletLedgerEntryUpdateManyWithWhereWithoutWalletInput | WalletLedgerEntryUpdateManyWithWhereWithoutWalletInput[]
    deleteMany?: WalletLedgerEntryScalarWhereInput | WalletLedgerEntryScalarWhereInput[]
  }

  export type WalletCreateNestedOneWithoutLedgerEntriesInput = {
    create?: XOR<WalletCreateWithoutLedgerEntriesInput, WalletUncheckedCreateWithoutLedgerEntriesInput>
    connectOrCreate?: WalletCreateOrConnectWithoutLedgerEntriesInput
    connect?: WalletWhereUniqueInput
  }

  export type PaymentTransactionCreateNestedOneWithoutLedgerEntriesInput = {
    create?: XOR<PaymentTransactionCreateWithoutLedgerEntriesInput, PaymentTransactionUncheckedCreateWithoutLedgerEntriesInput>
    connectOrCreate?: PaymentTransactionCreateOrConnectWithoutLedgerEntriesInput
    connect?: PaymentTransactionWhereUniqueInput
  }

  export type EnumLedgerEntryTypeFieldUpdateOperationsInput = {
    set?: $Enums.LedgerEntryType
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type WalletUpdateOneRequiredWithoutLedgerEntriesNestedInput = {
    create?: XOR<WalletCreateWithoutLedgerEntriesInput, WalletUncheckedCreateWithoutLedgerEntriesInput>
    connectOrCreate?: WalletCreateOrConnectWithoutLedgerEntriesInput
    upsert?: WalletUpsertWithoutLedgerEntriesInput
    connect?: WalletWhereUniqueInput
    update?: XOR<XOR<WalletUpdateToOneWithWhereWithoutLedgerEntriesInput, WalletUpdateWithoutLedgerEntriesInput>, WalletUncheckedUpdateWithoutLedgerEntriesInput>
  }

  export type PaymentTransactionUpdateOneRequiredWithoutLedgerEntriesNestedInput = {
    create?: XOR<PaymentTransactionCreateWithoutLedgerEntriesInput, PaymentTransactionUncheckedCreateWithoutLedgerEntriesInput>
    connectOrCreate?: PaymentTransactionCreateOrConnectWithoutLedgerEntriesInput
    upsert?: PaymentTransactionUpsertWithoutLedgerEntriesInput
    connect?: PaymentTransactionWhereUniqueInput
    update?: XOR<XOR<PaymentTransactionUpdateToOneWithWhereWithoutLedgerEntriesInput, PaymentTransactionUpdateWithoutLedgerEntriesInput>, PaymentTransactionUncheckedUpdateWithoutLedgerEntriesInput>
  }

  export type PlatformCommissionCreateNestedManyWithoutTransactionInput = {
    create?: XOR<PlatformCommissionCreateWithoutTransactionInput, PlatformCommissionUncheckedCreateWithoutTransactionInput> | PlatformCommissionCreateWithoutTransactionInput[] | PlatformCommissionUncheckedCreateWithoutTransactionInput[]
    connectOrCreate?: PlatformCommissionCreateOrConnectWithoutTransactionInput | PlatformCommissionCreateOrConnectWithoutTransactionInput[]
    createMany?: PlatformCommissionCreateManyTransactionInputEnvelope
    connect?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
  }

  export type WalletLedgerEntryCreateNestedManyWithoutTransactionInput = {
    create?: XOR<WalletLedgerEntryCreateWithoutTransactionInput, WalletLedgerEntryUncheckedCreateWithoutTransactionInput> | WalletLedgerEntryCreateWithoutTransactionInput[] | WalletLedgerEntryUncheckedCreateWithoutTransactionInput[]
    connectOrCreate?: WalletLedgerEntryCreateOrConnectWithoutTransactionInput | WalletLedgerEntryCreateOrConnectWithoutTransactionInput[]
    createMany?: WalletLedgerEntryCreateManyTransactionInputEnvelope
    connect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
  }

  export type PlatformCommissionUncheckedCreateNestedManyWithoutTransactionInput = {
    create?: XOR<PlatformCommissionCreateWithoutTransactionInput, PlatformCommissionUncheckedCreateWithoutTransactionInput> | PlatformCommissionCreateWithoutTransactionInput[] | PlatformCommissionUncheckedCreateWithoutTransactionInput[]
    connectOrCreate?: PlatformCommissionCreateOrConnectWithoutTransactionInput | PlatformCommissionCreateOrConnectWithoutTransactionInput[]
    createMany?: PlatformCommissionCreateManyTransactionInputEnvelope
    connect?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
  }

  export type WalletLedgerEntryUncheckedCreateNestedManyWithoutTransactionInput = {
    create?: XOR<WalletLedgerEntryCreateWithoutTransactionInput, WalletLedgerEntryUncheckedCreateWithoutTransactionInput> | WalletLedgerEntryCreateWithoutTransactionInput[] | WalletLedgerEntryUncheckedCreateWithoutTransactionInput[]
    connectOrCreate?: WalletLedgerEntryCreateOrConnectWithoutTransactionInput | WalletLedgerEntryCreateOrConnectWithoutTransactionInput[]
    createMany?: WalletLedgerEntryCreateManyTransactionInputEnvelope
    connect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
  }

  export type EnumPurposeTypeFieldUpdateOperationsInput = {
    set?: $Enums.PurposeType
  }

  export type EnumPaymentStatusFieldUpdateOperationsInput = {
    set?: $Enums.PaymentStatus
  }

  export type EnumPaymentProviderTypeFieldUpdateOperationsInput = {
    set?: $Enums.PaymentProviderType
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type NullableEnumRelatedEntityTypeFieldUpdateOperationsInput = {
    set?: $Enums.RelatedEntityType | null
  }

  export type EnumActivationStatusFieldUpdateOperationsInput = {
    set?: $Enums.ActivationStatus
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type PlatformCommissionUpdateManyWithoutTransactionNestedInput = {
    create?: XOR<PlatformCommissionCreateWithoutTransactionInput, PlatformCommissionUncheckedCreateWithoutTransactionInput> | PlatformCommissionCreateWithoutTransactionInput[] | PlatformCommissionUncheckedCreateWithoutTransactionInput[]
    connectOrCreate?: PlatformCommissionCreateOrConnectWithoutTransactionInput | PlatformCommissionCreateOrConnectWithoutTransactionInput[]
    upsert?: PlatformCommissionUpsertWithWhereUniqueWithoutTransactionInput | PlatformCommissionUpsertWithWhereUniqueWithoutTransactionInput[]
    createMany?: PlatformCommissionCreateManyTransactionInputEnvelope
    set?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
    disconnect?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
    delete?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
    connect?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
    update?: PlatformCommissionUpdateWithWhereUniqueWithoutTransactionInput | PlatformCommissionUpdateWithWhereUniqueWithoutTransactionInput[]
    updateMany?: PlatformCommissionUpdateManyWithWhereWithoutTransactionInput | PlatformCommissionUpdateManyWithWhereWithoutTransactionInput[]
    deleteMany?: PlatformCommissionScalarWhereInput | PlatformCommissionScalarWhereInput[]
  }

  export type WalletLedgerEntryUpdateManyWithoutTransactionNestedInput = {
    create?: XOR<WalletLedgerEntryCreateWithoutTransactionInput, WalletLedgerEntryUncheckedCreateWithoutTransactionInput> | WalletLedgerEntryCreateWithoutTransactionInput[] | WalletLedgerEntryUncheckedCreateWithoutTransactionInput[]
    connectOrCreate?: WalletLedgerEntryCreateOrConnectWithoutTransactionInput | WalletLedgerEntryCreateOrConnectWithoutTransactionInput[]
    upsert?: WalletLedgerEntryUpsertWithWhereUniqueWithoutTransactionInput | WalletLedgerEntryUpsertWithWhereUniqueWithoutTransactionInput[]
    createMany?: WalletLedgerEntryCreateManyTransactionInputEnvelope
    set?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    disconnect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    delete?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    connect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    update?: WalletLedgerEntryUpdateWithWhereUniqueWithoutTransactionInput | WalletLedgerEntryUpdateWithWhereUniqueWithoutTransactionInput[]
    updateMany?: WalletLedgerEntryUpdateManyWithWhereWithoutTransactionInput | WalletLedgerEntryUpdateManyWithWhereWithoutTransactionInput[]
    deleteMany?: WalletLedgerEntryScalarWhereInput | WalletLedgerEntryScalarWhereInput[]
  }

  export type PlatformCommissionUncheckedUpdateManyWithoutTransactionNestedInput = {
    create?: XOR<PlatformCommissionCreateWithoutTransactionInput, PlatformCommissionUncheckedCreateWithoutTransactionInput> | PlatformCommissionCreateWithoutTransactionInput[] | PlatformCommissionUncheckedCreateWithoutTransactionInput[]
    connectOrCreate?: PlatformCommissionCreateOrConnectWithoutTransactionInput | PlatformCommissionCreateOrConnectWithoutTransactionInput[]
    upsert?: PlatformCommissionUpsertWithWhereUniqueWithoutTransactionInput | PlatformCommissionUpsertWithWhereUniqueWithoutTransactionInput[]
    createMany?: PlatformCommissionCreateManyTransactionInputEnvelope
    set?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
    disconnect?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
    delete?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
    connect?: PlatformCommissionWhereUniqueInput | PlatformCommissionWhereUniqueInput[]
    update?: PlatformCommissionUpdateWithWhereUniqueWithoutTransactionInput | PlatformCommissionUpdateWithWhereUniqueWithoutTransactionInput[]
    updateMany?: PlatformCommissionUpdateManyWithWhereWithoutTransactionInput | PlatformCommissionUpdateManyWithWhereWithoutTransactionInput[]
    deleteMany?: PlatformCommissionScalarWhereInput | PlatformCommissionScalarWhereInput[]
  }

  export type WalletLedgerEntryUncheckedUpdateManyWithoutTransactionNestedInput = {
    create?: XOR<WalletLedgerEntryCreateWithoutTransactionInput, WalletLedgerEntryUncheckedCreateWithoutTransactionInput> | WalletLedgerEntryCreateWithoutTransactionInput[] | WalletLedgerEntryUncheckedCreateWithoutTransactionInput[]
    connectOrCreate?: WalletLedgerEntryCreateOrConnectWithoutTransactionInput | WalletLedgerEntryCreateOrConnectWithoutTransactionInput[]
    upsert?: WalletLedgerEntryUpsertWithWhereUniqueWithoutTransactionInput | WalletLedgerEntryUpsertWithWhereUniqueWithoutTransactionInput[]
    createMany?: WalletLedgerEntryCreateManyTransactionInputEnvelope
    set?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    disconnect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    delete?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    connect?: WalletLedgerEntryWhereUniqueInput | WalletLedgerEntryWhereUniqueInput[]
    update?: WalletLedgerEntryUpdateWithWhereUniqueWithoutTransactionInput | WalletLedgerEntryUpdateWithWhereUniqueWithoutTransactionInput[]
    updateMany?: WalletLedgerEntryUpdateManyWithWhereWithoutTransactionInput | WalletLedgerEntryUpdateManyWithWhereWithoutTransactionInput[]
    deleteMany?: WalletLedgerEntryScalarWhereInput | WalletLedgerEntryScalarWhereInput[]
  }

  export type PaymentTransactionCreateNestedOneWithoutCommissionsInput = {
    create?: XOR<PaymentTransactionCreateWithoutCommissionsInput, PaymentTransactionUncheckedCreateWithoutCommissionsInput>
    connectOrCreate?: PaymentTransactionCreateOrConnectWithoutCommissionsInput
    connect?: PaymentTransactionWhereUniqueInput
  }

  export type EnumPartnerTypeFieldUpdateOperationsInput = {
    set?: $Enums.PartnerType
  }

  export type EnumCommissionStatusFieldUpdateOperationsInput = {
    set?: $Enums.CommissionStatus
  }

  export type PaymentTransactionUpdateOneRequiredWithoutCommissionsNestedInput = {
    create?: XOR<PaymentTransactionCreateWithoutCommissionsInput, PaymentTransactionUncheckedCreateWithoutCommissionsInput>
    connectOrCreate?: PaymentTransactionCreateOrConnectWithoutCommissionsInput
    upsert?: PaymentTransactionUpsertWithoutCommissionsInput
    connect?: PaymentTransactionWhereUniqueInput
    update?: XOR<XOR<PaymentTransactionUpdateToOneWithWhereWithoutCommissionsInput, PaymentTransactionUpdateWithoutCommissionsInput>, PaymentTransactionUncheckedUpdateWithoutCommissionsInput>
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedEnumWalletOwnerTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.WalletOwnerType | EnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.WalletOwnerType[] | ListEnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.WalletOwnerType[] | ListEnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumWalletOwnerTypeFilter<$PrismaModel> | $Enums.WalletOwnerType
  }

  export type NestedDecimalFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string
  }

  export type NestedEnumWalletStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.WalletStatus | EnumWalletStatusFieldRefInput<$PrismaModel>
    in?: $Enums.WalletStatus[] | ListEnumWalletStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.WalletStatus[] | ListEnumWalletStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumWalletStatusFilter<$PrismaModel> | $Enums.WalletStatus
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedEnumWalletOwnerTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.WalletOwnerType | EnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.WalletOwnerType[] | ListEnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.WalletOwnerType[] | ListEnumWalletOwnerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumWalletOwnerTypeWithAggregatesFilter<$PrismaModel> | $Enums.WalletOwnerType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumWalletOwnerTypeFilter<$PrismaModel>
    _max?: NestedEnumWalletOwnerTypeFilter<$PrismaModel>
  }

  export type NestedDecimalWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalWithAggregatesFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedDecimalFilter<$PrismaModel>
    _sum?: NestedDecimalFilter<$PrismaModel>
    _min?: NestedDecimalFilter<$PrismaModel>
    _max?: NestedDecimalFilter<$PrismaModel>
  }

  export type NestedEnumWalletStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.WalletStatus | EnumWalletStatusFieldRefInput<$PrismaModel>
    in?: $Enums.WalletStatus[] | ListEnumWalletStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.WalletStatus[] | ListEnumWalletStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumWalletStatusWithAggregatesFilter<$PrismaModel> | $Enums.WalletStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumWalletStatusFilter<$PrismaModel>
    _max?: NestedEnumWalletStatusFilter<$PrismaModel>
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedEnumLedgerEntryTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.LedgerEntryType | EnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    in?: $Enums.LedgerEntryType[] | ListEnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.LedgerEntryType[] | ListEnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumLedgerEntryTypeFilter<$PrismaModel> | $Enums.LedgerEntryType
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedEnumLedgerEntryTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.LedgerEntryType | EnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    in?: $Enums.LedgerEntryType[] | ListEnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.LedgerEntryType[] | ListEnumLedgerEntryTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumLedgerEntryTypeWithAggregatesFilter<$PrismaModel> | $Enums.LedgerEntryType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumLedgerEntryTypeFilter<$PrismaModel>
    _max?: NestedEnumLedgerEntryTypeFilter<$PrismaModel>
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedEnumPurposeTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.PurposeType | EnumPurposeTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PurposeType[] | ListEnumPurposeTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PurposeType[] | ListEnumPurposeTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPurposeTypeFilter<$PrismaModel> | $Enums.PurposeType
  }

  export type NestedEnumPaymentStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentStatus | EnumPaymentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentStatusFilter<$PrismaModel> | $Enums.PaymentStatus
  }

  export type NestedEnumPaymentProviderTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentProviderType | EnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentProviderType[] | ListEnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentProviderType[] | ListEnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentProviderTypeFilter<$PrismaModel> | $Enums.PaymentProviderType
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedEnumRelatedEntityTypeNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.RelatedEntityType | EnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    in?: $Enums.RelatedEntityType[] | ListEnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.RelatedEntityType[] | ListEnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    not?: NestedEnumRelatedEntityTypeNullableFilter<$PrismaModel> | $Enums.RelatedEntityType | null
  }

  export type NestedEnumActivationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.ActivationStatus | EnumActivationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.ActivationStatus[] | ListEnumActivationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.ActivationStatus[] | ListEnumActivationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumActivationStatusFilter<$PrismaModel> | $Enums.ActivationStatus
  }

  export type NestedEnumPurposeTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PurposeType | EnumPurposeTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PurposeType[] | ListEnumPurposeTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PurposeType[] | ListEnumPurposeTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPurposeTypeWithAggregatesFilter<$PrismaModel> | $Enums.PurposeType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPurposeTypeFilter<$PrismaModel>
    _max?: NestedEnumPurposeTypeFilter<$PrismaModel>
  }

  export type NestedEnumPaymentStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentStatus | EnumPaymentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentStatusWithAggregatesFilter<$PrismaModel> | $Enums.PaymentStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPaymentStatusFilter<$PrismaModel>
    _max?: NestedEnumPaymentStatusFilter<$PrismaModel>
  }

  export type NestedEnumPaymentProviderTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentProviderType | EnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentProviderType[] | ListEnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentProviderType[] | ListEnumPaymentProviderTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentProviderTypeWithAggregatesFilter<$PrismaModel> | $Enums.PaymentProviderType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPaymentProviderTypeFilter<$PrismaModel>
    _max?: NestedEnumPaymentProviderTypeFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }
  export type NestedJsonNullableFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<NestedJsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedEnumRelatedEntityTypeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.RelatedEntityType | EnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    in?: $Enums.RelatedEntityType[] | ListEnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.RelatedEntityType[] | ListEnumRelatedEntityTypeFieldRefInput<$PrismaModel> | null
    not?: NestedEnumRelatedEntityTypeNullableWithAggregatesFilter<$PrismaModel> | $Enums.RelatedEntityType | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumRelatedEntityTypeNullableFilter<$PrismaModel>
    _max?: NestedEnumRelatedEntityTypeNullableFilter<$PrismaModel>
  }

  export type NestedEnumActivationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ActivationStatus | EnumActivationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.ActivationStatus[] | ListEnumActivationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.ActivationStatus[] | ListEnumActivationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumActivationStatusWithAggregatesFilter<$PrismaModel> | $Enums.ActivationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumActivationStatusFilter<$PrismaModel>
    _max?: NestedEnumActivationStatusFilter<$PrismaModel>
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedEnumPartnerTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.PartnerType | EnumPartnerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PartnerType[] | ListEnumPartnerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PartnerType[] | ListEnumPartnerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPartnerTypeFilter<$PrismaModel> | $Enums.PartnerType
  }

  export type NestedEnumCommissionStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.CommissionStatus | EnumCommissionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.CommissionStatus[] | ListEnumCommissionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.CommissionStatus[] | ListEnumCommissionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumCommissionStatusFilter<$PrismaModel> | $Enums.CommissionStatus
  }

  export type NestedEnumPartnerTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PartnerType | EnumPartnerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.PartnerType[] | ListEnumPartnerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.PartnerType[] | ListEnumPartnerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumPartnerTypeWithAggregatesFilter<$PrismaModel> | $Enums.PartnerType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPartnerTypeFilter<$PrismaModel>
    _max?: NestedEnumPartnerTypeFilter<$PrismaModel>
  }

  export type NestedEnumCommissionStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.CommissionStatus | EnumCommissionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.CommissionStatus[] | ListEnumCommissionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.CommissionStatus[] | ListEnumCommissionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumCommissionStatusWithAggregatesFilter<$PrismaModel> | $Enums.CommissionStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumCommissionStatusFilter<$PrismaModel>
    _max?: NestedEnumCommissionStatusFilter<$PrismaModel>
  }
  export type NestedJsonFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<NestedJsonFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type WalletLedgerEntryCreateWithoutWalletInput = {
    id?: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal | DecimalJsLike | number | string
    balanceBefore: Decimal | DecimalJsLike | number | string
    balanceAfter: Decimal | DecimalJsLike | number | string
    description?: string | null
    createdAt?: Date | string
    transaction: PaymentTransactionCreateNestedOneWithoutLedgerEntriesInput
  }

  export type WalletLedgerEntryUncheckedCreateWithoutWalletInput = {
    id?: string
    transactionId: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal | DecimalJsLike | number | string
    balanceBefore: Decimal | DecimalJsLike | number | string
    balanceAfter: Decimal | DecimalJsLike | number | string
    description?: string | null
    createdAt?: Date | string
  }

  export type WalletLedgerEntryCreateOrConnectWithoutWalletInput = {
    where: WalletLedgerEntryWhereUniqueInput
    create: XOR<WalletLedgerEntryCreateWithoutWalletInput, WalletLedgerEntryUncheckedCreateWithoutWalletInput>
  }

  export type WalletLedgerEntryCreateManyWalletInputEnvelope = {
    data: WalletLedgerEntryCreateManyWalletInput | WalletLedgerEntryCreateManyWalletInput[]
    skipDuplicates?: boolean
  }

  export type WalletLedgerEntryUpsertWithWhereUniqueWithoutWalletInput = {
    where: WalletLedgerEntryWhereUniqueInput
    update: XOR<WalletLedgerEntryUpdateWithoutWalletInput, WalletLedgerEntryUncheckedUpdateWithoutWalletInput>
    create: XOR<WalletLedgerEntryCreateWithoutWalletInput, WalletLedgerEntryUncheckedCreateWithoutWalletInput>
  }

  export type WalletLedgerEntryUpdateWithWhereUniqueWithoutWalletInput = {
    where: WalletLedgerEntryWhereUniqueInput
    data: XOR<WalletLedgerEntryUpdateWithoutWalletInput, WalletLedgerEntryUncheckedUpdateWithoutWalletInput>
  }

  export type WalletLedgerEntryUpdateManyWithWhereWithoutWalletInput = {
    where: WalletLedgerEntryScalarWhereInput
    data: XOR<WalletLedgerEntryUpdateManyMutationInput, WalletLedgerEntryUncheckedUpdateManyWithoutWalletInput>
  }

  export type WalletLedgerEntryScalarWhereInput = {
    AND?: WalletLedgerEntryScalarWhereInput | WalletLedgerEntryScalarWhereInput[]
    OR?: WalletLedgerEntryScalarWhereInput[]
    NOT?: WalletLedgerEntryScalarWhereInput | WalletLedgerEntryScalarWhereInput[]
    id?: StringFilter<"WalletLedgerEntry"> | string
    walletId?: StringFilter<"WalletLedgerEntry"> | string
    transactionId?: StringFilter<"WalletLedgerEntry"> | string
    entryType?: EnumLedgerEntryTypeFilter<"WalletLedgerEntry"> | $Enums.LedgerEntryType
    amount?: DecimalFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFilter<"WalletLedgerEntry"> | Decimal | DecimalJsLike | number | string
    description?: StringNullableFilter<"WalletLedgerEntry"> | string | null
    createdAt?: DateTimeFilter<"WalletLedgerEntry"> | Date | string
  }

  export type WalletCreateWithoutLedgerEntriesInput = {
    id?: string
    ownerType: $Enums.WalletOwnerType
    ownerId: string
    availableBalance?: Decimal | DecimalJsLike | number | string
    lockedBalance?: Decimal | DecimalJsLike | number | string
    status?: $Enums.WalletStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WalletUncheckedCreateWithoutLedgerEntriesInput = {
    id?: string
    ownerType: $Enums.WalletOwnerType
    ownerId: string
    availableBalance?: Decimal | DecimalJsLike | number | string
    lockedBalance?: Decimal | DecimalJsLike | number | string
    status?: $Enums.WalletStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WalletCreateOrConnectWithoutLedgerEntriesInput = {
    where: WalletWhereUniqueInput
    create: XOR<WalletCreateWithoutLedgerEntriesInput, WalletUncheckedCreateWithoutLedgerEntriesInput>
  }

  export type PaymentTransactionCreateWithoutLedgerEntriesInput = {
    id?: string
    payerId: string
    purpose: $Enums.PurposeType
    gymId?: string | null
    ptId?: string | null
    membershipId?: string | null
    ptContractId?: string | null
    amount: Decimal | DecimalJsLike | number | string
    currency?: string
    status?: $Enums.PaymentStatus
    provider?: $Enums.PaymentProviderType
    providerTransactionId?: string | null
    paymentMethod?: string | null
    idempotencyKey: string
    requestFingerprint?: string | null
    extraData?: string | null
    paidAt?: Date | string | null
    failedAt?: Date | string | null
    refundedAt?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: string | null
    receiverWalletId?: string | null
    relatedEntityType?: $Enums.RelatedEntityType | null
    relatedEntityId?: string | null
    activationStatus?: $Enums.ActivationStatus
    activationRetryCount?: number
    lastActivationRetryAt?: Date | string | null
    initiatedBy?: string | null
    sourceService?: string | null
    refundOfTransactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    commissions?: PlatformCommissionCreateNestedManyWithoutTransactionInput
  }

  export type PaymentTransactionUncheckedCreateWithoutLedgerEntriesInput = {
    id?: string
    payerId: string
    purpose: $Enums.PurposeType
    gymId?: string | null
    ptId?: string | null
    membershipId?: string | null
    ptContractId?: string | null
    amount: Decimal | DecimalJsLike | number | string
    currency?: string
    status?: $Enums.PaymentStatus
    provider?: $Enums.PaymentProviderType
    providerTransactionId?: string | null
    paymentMethod?: string | null
    idempotencyKey: string
    requestFingerprint?: string | null
    extraData?: string | null
    paidAt?: Date | string | null
    failedAt?: Date | string | null
    refundedAt?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: string | null
    receiverWalletId?: string | null
    relatedEntityType?: $Enums.RelatedEntityType | null
    relatedEntityId?: string | null
    activationStatus?: $Enums.ActivationStatus
    activationRetryCount?: number
    lastActivationRetryAt?: Date | string | null
    initiatedBy?: string | null
    sourceService?: string | null
    refundOfTransactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    commissions?: PlatformCommissionUncheckedCreateNestedManyWithoutTransactionInput
  }

  export type PaymentTransactionCreateOrConnectWithoutLedgerEntriesInput = {
    where: PaymentTransactionWhereUniqueInput
    create: XOR<PaymentTransactionCreateWithoutLedgerEntriesInput, PaymentTransactionUncheckedCreateWithoutLedgerEntriesInput>
  }

  export type WalletUpsertWithoutLedgerEntriesInput = {
    update: XOR<WalletUpdateWithoutLedgerEntriesInput, WalletUncheckedUpdateWithoutLedgerEntriesInput>
    create: XOR<WalletCreateWithoutLedgerEntriesInput, WalletUncheckedCreateWithoutLedgerEntriesInput>
    where?: WalletWhereInput
  }

  export type WalletUpdateToOneWithWhereWithoutLedgerEntriesInput = {
    where?: WalletWhereInput
    data: XOR<WalletUpdateWithoutLedgerEntriesInput, WalletUncheckedUpdateWithoutLedgerEntriesInput>
  }

  export type WalletUpdateWithoutLedgerEntriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerType?: EnumWalletOwnerTypeFieldUpdateOperationsInput | $Enums.WalletOwnerType
    ownerId?: StringFieldUpdateOperationsInput | string
    availableBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    lockedBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumWalletStatusFieldUpdateOperationsInput | $Enums.WalletStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WalletUncheckedUpdateWithoutLedgerEntriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerType?: EnumWalletOwnerTypeFieldUpdateOperationsInput | $Enums.WalletOwnerType
    ownerId?: StringFieldUpdateOperationsInput | string
    availableBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    lockedBalance?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumWalletStatusFieldUpdateOperationsInput | $Enums.WalletStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentTransactionUpsertWithoutLedgerEntriesInput = {
    update: XOR<PaymentTransactionUpdateWithoutLedgerEntriesInput, PaymentTransactionUncheckedUpdateWithoutLedgerEntriesInput>
    create: XOR<PaymentTransactionCreateWithoutLedgerEntriesInput, PaymentTransactionUncheckedCreateWithoutLedgerEntriesInput>
    where?: PaymentTransactionWhereInput
  }

  export type PaymentTransactionUpdateToOneWithWhereWithoutLedgerEntriesInput = {
    where?: PaymentTransactionWhereInput
    data: XOR<PaymentTransactionUpdateWithoutLedgerEntriesInput, PaymentTransactionUncheckedUpdateWithoutLedgerEntriesInput>
  }

  export type PaymentTransactionUpdateWithoutLedgerEntriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    payerId?: StringFieldUpdateOperationsInput | string
    purpose?: EnumPurposeTypeFieldUpdateOperationsInput | $Enums.PurposeType
    gymId?: NullableStringFieldUpdateOperationsInput | string | null
    ptId?: NullableStringFieldUpdateOperationsInput | string | null
    membershipId?: NullableStringFieldUpdateOperationsInput | string | null
    ptContractId?: NullableStringFieldUpdateOperationsInput | string | null
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    currency?: StringFieldUpdateOperationsInput | string
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    paymentMethod?: NullableStringFieldUpdateOperationsInput | string | null
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    requestFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    extraData?: NullableStringFieldUpdateOperationsInput | string | null
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    receiverWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    relatedEntityType?: NullableEnumRelatedEntityTypeFieldUpdateOperationsInput | $Enums.RelatedEntityType | null
    relatedEntityId?: NullableStringFieldUpdateOperationsInput | string | null
    activationStatus?: EnumActivationStatusFieldUpdateOperationsInput | $Enums.ActivationStatus
    activationRetryCount?: IntFieldUpdateOperationsInput | number
    lastActivationRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    initiatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    sourceService?: NullableStringFieldUpdateOperationsInput | string | null
    refundOfTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    commissions?: PlatformCommissionUpdateManyWithoutTransactionNestedInput
  }

  export type PaymentTransactionUncheckedUpdateWithoutLedgerEntriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    payerId?: StringFieldUpdateOperationsInput | string
    purpose?: EnumPurposeTypeFieldUpdateOperationsInput | $Enums.PurposeType
    gymId?: NullableStringFieldUpdateOperationsInput | string | null
    ptId?: NullableStringFieldUpdateOperationsInput | string | null
    membershipId?: NullableStringFieldUpdateOperationsInput | string | null
    ptContractId?: NullableStringFieldUpdateOperationsInput | string | null
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    currency?: StringFieldUpdateOperationsInput | string
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    paymentMethod?: NullableStringFieldUpdateOperationsInput | string | null
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    requestFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    extraData?: NullableStringFieldUpdateOperationsInput | string | null
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    receiverWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    relatedEntityType?: NullableEnumRelatedEntityTypeFieldUpdateOperationsInput | $Enums.RelatedEntityType | null
    relatedEntityId?: NullableStringFieldUpdateOperationsInput | string | null
    activationStatus?: EnumActivationStatusFieldUpdateOperationsInput | $Enums.ActivationStatus
    activationRetryCount?: IntFieldUpdateOperationsInput | number
    lastActivationRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    initiatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    sourceService?: NullableStringFieldUpdateOperationsInput | string | null
    refundOfTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    commissions?: PlatformCommissionUncheckedUpdateManyWithoutTransactionNestedInput
  }

  export type PlatformCommissionCreateWithoutTransactionInput = {
    id?: string
    partnerType: $Enums.PartnerType
    partnerId: string
    grossAmount: Decimal | DecimalJsLike | number | string
    platformFeeAmount: Decimal | DecimalJsLike | number | string
    partnerPayoutAmount: Decimal | DecimalJsLike | number | string
    commissionRate: Decimal | DecimalJsLike | number | string
    status?: $Enums.CommissionStatus
    settledAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PlatformCommissionUncheckedCreateWithoutTransactionInput = {
    id?: string
    partnerType: $Enums.PartnerType
    partnerId: string
    grossAmount: Decimal | DecimalJsLike | number | string
    platformFeeAmount: Decimal | DecimalJsLike | number | string
    partnerPayoutAmount: Decimal | DecimalJsLike | number | string
    commissionRate: Decimal | DecimalJsLike | number | string
    status?: $Enums.CommissionStatus
    settledAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PlatformCommissionCreateOrConnectWithoutTransactionInput = {
    where: PlatformCommissionWhereUniqueInput
    create: XOR<PlatformCommissionCreateWithoutTransactionInput, PlatformCommissionUncheckedCreateWithoutTransactionInput>
  }

  export type PlatformCommissionCreateManyTransactionInputEnvelope = {
    data: PlatformCommissionCreateManyTransactionInput | PlatformCommissionCreateManyTransactionInput[]
    skipDuplicates?: boolean
  }

  export type WalletLedgerEntryCreateWithoutTransactionInput = {
    id?: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal | DecimalJsLike | number | string
    balanceBefore: Decimal | DecimalJsLike | number | string
    balanceAfter: Decimal | DecimalJsLike | number | string
    description?: string | null
    createdAt?: Date | string
    wallet: WalletCreateNestedOneWithoutLedgerEntriesInput
  }

  export type WalletLedgerEntryUncheckedCreateWithoutTransactionInput = {
    id?: string
    walletId: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal | DecimalJsLike | number | string
    balanceBefore: Decimal | DecimalJsLike | number | string
    balanceAfter: Decimal | DecimalJsLike | number | string
    description?: string | null
    createdAt?: Date | string
  }

  export type WalletLedgerEntryCreateOrConnectWithoutTransactionInput = {
    where: WalletLedgerEntryWhereUniqueInput
    create: XOR<WalletLedgerEntryCreateWithoutTransactionInput, WalletLedgerEntryUncheckedCreateWithoutTransactionInput>
  }

  export type WalletLedgerEntryCreateManyTransactionInputEnvelope = {
    data: WalletLedgerEntryCreateManyTransactionInput | WalletLedgerEntryCreateManyTransactionInput[]
    skipDuplicates?: boolean
  }

  export type PlatformCommissionUpsertWithWhereUniqueWithoutTransactionInput = {
    where: PlatformCommissionWhereUniqueInput
    update: XOR<PlatformCommissionUpdateWithoutTransactionInput, PlatformCommissionUncheckedUpdateWithoutTransactionInput>
    create: XOR<PlatformCommissionCreateWithoutTransactionInput, PlatformCommissionUncheckedCreateWithoutTransactionInput>
  }

  export type PlatformCommissionUpdateWithWhereUniqueWithoutTransactionInput = {
    where: PlatformCommissionWhereUniqueInput
    data: XOR<PlatformCommissionUpdateWithoutTransactionInput, PlatformCommissionUncheckedUpdateWithoutTransactionInput>
  }

  export type PlatformCommissionUpdateManyWithWhereWithoutTransactionInput = {
    where: PlatformCommissionScalarWhereInput
    data: XOR<PlatformCommissionUpdateManyMutationInput, PlatformCommissionUncheckedUpdateManyWithoutTransactionInput>
  }

  export type PlatformCommissionScalarWhereInput = {
    AND?: PlatformCommissionScalarWhereInput | PlatformCommissionScalarWhereInput[]
    OR?: PlatformCommissionScalarWhereInput[]
    NOT?: PlatformCommissionScalarWhereInput | PlatformCommissionScalarWhereInput[]
    id?: StringFilter<"PlatformCommission"> | string
    paymentTransactionId?: StringFilter<"PlatformCommission"> | string
    partnerType?: EnumPartnerTypeFilter<"PlatformCommission"> | $Enums.PartnerType
    partnerId?: StringFilter<"PlatformCommission"> | string
    grossAmount?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFilter<"PlatformCommission"> | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFilter<"PlatformCommission"> | $Enums.CommissionStatus
    settledAt?: DateTimeNullableFilter<"PlatformCommission"> | Date | string | null
    createdAt?: DateTimeFilter<"PlatformCommission"> | Date | string
  }

  export type WalletLedgerEntryUpsertWithWhereUniqueWithoutTransactionInput = {
    where: WalletLedgerEntryWhereUniqueInput
    update: XOR<WalletLedgerEntryUpdateWithoutTransactionInput, WalletLedgerEntryUncheckedUpdateWithoutTransactionInput>
    create: XOR<WalletLedgerEntryCreateWithoutTransactionInput, WalletLedgerEntryUncheckedCreateWithoutTransactionInput>
  }

  export type WalletLedgerEntryUpdateWithWhereUniqueWithoutTransactionInput = {
    where: WalletLedgerEntryWhereUniqueInput
    data: XOR<WalletLedgerEntryUpdateWithoutTransactionInput, WalletLedgerEntryUncheckedUpdateWithoutTransactionInput>
  }

  export type WalletLedgerEntryUpdateManyWithWhereWithoutTransactionInput = {
    where: WalletLedgerEntryScalarWhereInput
    data: XOR<WalletLedgerEntryUpdateManyMutationInput, WalletLedgerEntryUncheckedUpdateManyWithoutTransactionInput>
  }

  export type PaymentTransactionCreateWithoutCommissionsInput = {
    id?: string
    payerId: string
    purpose: $Enums.PurposeType
    gymId?: string | null
    ptId?: string | null
    membershipId?: string | null
    ptContractId?: string | null
    amount: Decimal | DecimalJsLike | number | string
    currency?: string
    status?: $Enums.PaymentStatus
    provider?: $Enums.PaymentProviderType
    providerTransactionId?: string | null
    paymentMethod?: string | null
    idempotencyKey: string
    requestFingerprint?: string | null
    extraData?: string | null
    paidAt?: Date | string | null
    failedAt?: Date | string | null
    refundedAt?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: string | null
    receiverWalletId?: string | null
    relatedEntityType?: $Enums.RelatedEntityType | null
    relatedEntityId?: string | null
    activationStatus?: $Enums.ActivationStatus
    activationRetryCount?: number
    lastActivationRetryAt?: Date | string | null
    initiatedBy?: string | null
    sourceService?: string | null
    refundOfTransactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    ledgerEntries?: WalletLedgerEntryCreateNestedManyWithoutTransactionInput
  }

  export type PaymentTransactionUncheckedCreateWithoutCommissionsInput = {
    id?: string
    payerId: string
    purpose: $Enums.PurposeType
    gymId?: string | null
    ptId?: string | null
    membershipId?: string | null
    ptContractId?: string | null
    amount: Decimal | DecimalJsLike | number | string
    currency?: string
    status?: $Enums.PaymentStatus
    provider?: $Enums.PaymentProviderType
    providerTransactionId?: string | null
    paymentMethod?: string | null
    idempotencyKey: string
    requestFingerprint?: string | null
    extraData?: string | null
    paidAt?: Date | string | null
    failedAt?: Date | string | null
    refundedAt?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: string | null
    receiverWalletId?: string | null
    relatedEntityType?: $Enums.RelatedEntityType | null
    relatedEntityId?: string | null
    activationStatus?: $Enums.ActivationStatus
    activationRetryCount?: number
    lastActivationRetryAt?: Date | string | null
    initiatedBy?: string | null
    sourceService?: string | null
    refundOfTransactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    ledgerEntries?: WalletLedgerEntryUncheckedCreateNestedManyWithoutTransactionInput
  }

  export type PaymentTransactionCreateOrConnectWithoutCommissionsInput = {
    where: PaymentTransactionWhereUniqueInput
    create: XOR<PaymentTransactionCreateWithoutCommissionsInput, PaymentTransactionUncheckedCreateWithoutCommissionsInput>
  }

  export type PaymentTransactionUpsertWithoutCommissionsInput = {
    update: XOR<PaymentTransactionUpdateWithoutCommissionsInput, PaymentTransactionUncheckedUpdateWithoutCommissionsInput>
    create: XOR<PaymentTransactionCreateWithoutCommissionsInput, PaymentTransactionUncheckedCreateWithoutCommissionsInput>
    where?: PaymentTransactionWhereInput
  }

  export type PaymentTransactionUpdateToOneWithWhereWithoutCommissionsInput = {
    where?: PaymentTransactionWhereInput
    data: XOR<PaymentTransactionUpdateWithoutCommissionsInput, PaymentTransactionUncheckedUpdateWithoutCommissionsInput>
  }

  export type PaymentTransactionUpdateWithoutCommissionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    payerId?: StringFieldUpdateOperationsInput | string
    purpose?: EnumPurposeTypeFieldUpdateOperationsInput | $Enums.PurposeType
    gymId?: NullableStringFieldUpdateOperationsInput | string | null
    ptId?: NullableStringFieldUpdateOperationsInput | string | null
    membershipId?: NullableStringFieldUpdateOperationsInput | string | null
    ptContractId?: NullableStringFieldUpdateOperationsInput | string | null
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    currency?: StringFieldUpdateOperationsInput | string
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    paymentMethod?: NullableStringFieldUpdateOperationsInput | string | null
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    requestFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    extraData?: NullableStringFieldUpdateOperationsInput | string | null
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    receiverWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    relatedEntityType?: NullableEnumRelatedEntityTypeFieldUpdateOperationsInput | $Enums.RelatedEntityType | null
    relatedEntityId?: NullableStringFieldUpdateOperationsInput | string | null
    activationStatus?: EnumActivationStatusFieldUpdateOperationsInput | $Enums.ActivationStatus
    activationRetryCount?: IntFieldUpdateOperationsInput | number
    lastActivationRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    initiatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    sourceService?: NullableStringFieldUpdateOperationsInput | string | null
    refundOfTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    ledgerEntries?: WalletLedgerEntryUpdateManyWithoutTransactionNestedInput
  }

  export type PaymentTransactionUncheckedUpdateWithoutCommissionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    payerId?: StringFieldUpdateOperationsInput | string
    purpose?: EnumPurposeTypeFieldUpdateOperationsInput | $Enums.PurposeType
    gymId?: NullableStringFieldUpdateOperationsInput | string | null
    ptId?: NullableStringFieldUpdateOperationsInput | string | null
    membershipId?: NullableStringFieldUpdateOperationsInput | string | null
    ptContractId?: NullableStringFieldUpdateOperationsInput | string | null
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    currency?: StringFieldUpdateOperationsInput | string
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    provider?: EnumPaymentProviderTypeFieldUpdateOperationsInput | $Enums.PaymentProviderType
    providerTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    paymentMethod?: NullableStringFieldUpdateOperationsInput | string | null
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    requestFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    extraData?: NullableStringFieldUpdateOperationsInput | string | null
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    payerWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    receiverWalletId?: NullableStringFieldUpdateOperationsInput | string | null
    relatedEntityType?: NullableEnumRelatedEntityTypeFieldUpdateOperationsInput | $Enums.RelatedEntityType | null
    relatedEntityId?: NullableStringFieldUpdateOperationsInput | string | null
    activationStatus?: EnumActivationStatusFieldUpdateOperationsInput | $Enums.ActivationStatus
    activationRetryCount?: IntFieldUpdateOperationsInput | number
    lastActivationRetryAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    initiatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    sourceService?: NullableStringFieldUpdateOperationsInput | string | null
    refundOfTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    ledgerEntries?: WalletLedgerEntryUncheckedUpdateManyWithoutTransactionNestedInput
  }

  export type WalletLedgerEntryCreateManyWalletInput = {
    id?: string
    transactionId: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal | DecimalJsLike | number | string
    balanceBefore: Decimal | DecimalJsLike | number | string
    balanceAfter: Decimal | DecimalJsLike | number | string
    description?: string | null
    createdAt?: Date | string
  }

  export type WalletLedgerEntryUpdateWithoutWalletInput = {
    id?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    transaction?: PaymentTransactionUpdateOneRequiredWithoutLedgerEntriesNestedInput
  }

  export type WalletLedgerEntryUncheckedUpdateWithoutWalletInput = {
    id?: StringFieldUpdateOperationsInput | string
    transactionId?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WalletLedgerEntryUncheckedUpdateManyWithoutWalletInput = {
    id?: StringFieldUpdateOperationsInput | string
    transactionId?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlatformCommissionCreateManyTransactionInput = {
    id?: string
    partnerType: $Enums.PartnerType
    partnerId: string
    grossAmount: Decimal | DecimalJsLike | number | string
    platformFeeAmount: Decimal | DecimalJsLike | number | string
    partnerPayoutAmount: Decimal | DecimalJsLike | number | string
    commissionRate: Decimal | DecimalJsLike | number | string
    status?: $Enums.CommissionStatus
    settledAt?: Date | string | null
    createdAt?: Date | string
  }

  export type WalletLedgerEntryCreateManyTransactionInput = {
    id?: string
    walletId: string
    entryType: $Enums.LedgerEntryType
    amount: Decimal | DecimalJsLike | number | string
    balanceBefore: Decimal | DecimalJsLike | number | string
    balanceAfter: Decimal | DecimalJsLike | number | string
    description?: string | null
    createdAt?: Date | string
  }

  export type PlatformCommissionUpdateWithoutTransactionInput = {
    id?: StringFieldUpdateOperationsInput | string
    partnerType?: EnumPartnerTypeFieldUpdateOperationsInput | $Enums.PartnerType
    partnerId?: StringFieldUpdateOperationsInput | string
    grossAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFieldUpdateOperationsInput | $Enums.CommissionStatus
    settledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlatformCommissionUncheckedUpdateWithoutTransactionInput = {
    id?: StringFieldUpdateOperationsInput | string
    partnerType?: EnumPartnerTypeFieldUpdateOperationsInput | $Enums.PartnerType
    partnerId?: StringFieldUpdateOperationsInput | string
    grossAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFieldUpdateOperationsInput | $Enums.CommissionStatus
    settledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlatformCommissionUncheckedUpdateManyWithoutTransactionInput = {
    id?: StringFieldUpdateOperationsInput | string
    partnerType?: EnumPartnerTypeFieldUpdateOperationsInput | $Enums.PartnerType
    partnerId?: StringFieldUpdateOperationsInput | string
    grossAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformFeeAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    partnerPayoutAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    commissionRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCommissionStatusFieldUpdateOperationsInput | $Enums.CommissionStatus
    settledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WalletLedgerEntryUpdateWithoutTransactionInput = {
    id?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    wallet?: WalletUpdateOneRequiredWithoutLedgerEntriesNestedInput
  }

  export type WalletLedgerEntryUncheckedUpdateWithoutTransactionInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletId?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WalletLedgerEntryUncheckedUpdateManyWithoutTransactionInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletId?: StringFieldUpdateOperationsInput | string
    entryType?: EnumLedgerEntryTypeFieldUpdateOperationsInput | $Enums.LedgerEntryType
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceBefore?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    balanceAfter?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use WalletCountOutputTypeDefaultArgs instead
     */
    export type WalletCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WalletCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PaymentTransactionCountOutputTypeDefaultArgs instead
     */
    export type PaymentTransactionCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PaymentTransactionCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WalletDefaultArgs instead
     */
    export type WalletArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WalletDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WalletLedgerEntryDefaultArgs instead
     */
    export type WalletLedgerEntryArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WalletLedgerEntryDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PaymentTransactionDefaultArgs instead
     */
    export type PaymentTransactionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PaymentTransactionDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PlatformCommissionDefaultArgs instead
     */
    export type PlatformCommissionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PlatformCommissionDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PaymentWebhookEventDefaultArgs instead
     */
    export type PaymentWebhookEventArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PaymentWebhookEventDefaultArgs<ExtArgs>

  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}