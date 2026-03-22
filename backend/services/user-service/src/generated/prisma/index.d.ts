
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
 * Model UserProfile
 * 
 */
export type UserProfile = $Result.DefaultSelection<Prisma.$UserProfilePayload>
/**
 * Model PTApplication
 * 
 */
export type PTApplication = $Result.DefaultSelection<Prisma.$PTApplicationPayload>
/**
 * Model PTApplicationCertificate
 * 
 */
export type PTApplicationCertificate = $Result.DefaultSelection<Prisma.$PTApplicationCertificatePayload>
/**
 * Model PTApplicationMedia
 * 
 */
export type PTApplicationMedia = $Result.DefaultSelection<Prisma.$PTApplicationMediaPayload>
/**
 * Model InBodyEntry
 * 
 */
export type InBodyEntry = $Result.DefaultSelection<Prisma.$InBodyEntryPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const Gender: {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER'
};

export type Gender = (typeof Gender)[keyof typeof Gender]


export const Goal: {
  WEIGHT_LOSS: 'WEIGHT_LOSS',
  MUSCLE_GAIN: 'MUSCLE_GAIN',
  MAINTENANCE: 'MAINTENANCE',
  ATHLETIC_PERFORMANCE: 'ATHLETIC_PERFORMANCE'
};

export type Goal = (typeof Goal)[keyof typeof Goal]


export const ActivityLevel: {
  SEDENTARY: 'SEDENTARY',
  LIGHTLY_ACTIVE: 'LIGHTLY_ACTIVE',
  MODERATELY_ACTIVE: 'MODERATELY_ACTIVE',
  VERY_ACTIVE: 'VERY_ACTIVE',
  EXTREMELY_ACTIVE: 'EXTREMELY_ACTIVE'
};

export type ActivityLevel = (typeof ActivityLevel)[keyof typeof ActivityLevel]


export const ExperienceLevel: {
  BEGINNER: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED'
};

export type ExperienceLevel = (typeof ExperienceLevel)[keyof typeof ExperienceLevel]


export const PTApplicationStatus: {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  NEEDS_MORE_INFO: 'NEEDS_MORE_INFO',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

export type PTApplicationStatus = (typeof PTApplicationStatus)[keyof typeof PTApplicationStatus]


export const ServiceMode: {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  HYBRID: 'HYBRID'
};

export type ServiceMode = (typeof ServiceMode)[keyof typeof ServiceMode]


export const MediaGroupType: {
  IDENTITY: 'IDENTITY',
  CERTIFICATE: 'CERTIFICATE',
  PORTFOLIO: 'PORTFOLIO'
};

export type MediaGroupType = (typeof MediaGroupType)[keyof typeof MediaGroupType]

}

export type Gender = $Enums.Gender

export const Gender: typeof $Enums.Gender

export type Goal = $Enums.Goal

export const Goal: typeof $Enums.Goal

export type ActivityLevel = $Enums.ActivityLevel

export const ActivityLevel: typeof $Enums.ActivityLevel

export type ExperienceLevel = $Enums.ExperienceLevel

export const ExperienceLevel: typeof $Enums.ExperienceLevel

export type PTApplicationStatus = $Enums.PTApplicationStatus

export const PTApplicationStatus: typeof $Enums.PTApplicationStatus

export type ServiceMode = $Enums.ServiceMode

export const ServiceMode: typeof $Enums.ServiceMode

export type MediaGroupType = $Enums.MediaGroupType

export const MediaGroupType: typeof $Enums.MediaGroupType

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more UserProfiles
 * const userProfiles = await prisma.userProfile.findMany()
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
   * // Fetch zero or more UserProfiles
   * const userProfiles = await prisma.userProfile.findMany()
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
   * `prisma.userProfile`: Exposes CRUD operations for the **UserProfile** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more UserProfiles
    * const userProfiles = await prisma.userProfile.findMany()
    * ```
    */
  get userProfile(): Prisma.UserProfileDelegate<ExtArgs>;

  /**
   * `prisma.pTApplication`: Exposes CRUD operations for the **PTApplication** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PTApplications
    * const pTApplications = await prisma.pTApplication.findMany()
    * ```
    */
  get pTApplication(): Prisma.PTApplicationDelegate<ExtArgs>;

  /**
   * `prisma.pTApplicationCertificate`: Exposes CRUD operations for the **PTApplicationCertificate** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PTApplicationCertificates
    * const pTApplicationCertificates = await prisma.pTApplicationCertificate.findMany()
    * ```
    */
  get pTApplicationCertificate(): Prisma.PTApplicationCertificateDelegate<ExtArgs>;

  /**
   * `prisma.pTApplicationMedia`: Exposes CRUD operations for the **PTApplicationMedia** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PTApplicationMedias
    * const pTApplicationMedias = await prisma.pTApplicationMedia.findMany()
    * ```
    */
  get pTApplicationMedia(): Prisma.PTApplicationMediaDelegate<ExtArgs>;

  /**
   * `prisma.inBodyEntry`: Exposes CRUD operations for the **InBodyEntry** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more InBodyEntries
    * const inBodyEntries = await prisma.inBodyEntry.findMany()
    * ```
    */
  get inBodyEntry(): Prisma.InBodyEntryDelegate<ExtArgs>;
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
    UserProfile: 'UserProfile',
    PTApplication: 'PTApplication',
    PTApplicationCertificate: 'PTApplicationCertificate',
    PTApplicationMedia: 'PTApplicationMedia',
    InBodyEntry: 'InBodyEntry'
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
      modelProps: "userProfile" | "pTApplication" | "pTApplicationCertificate" | "pTApplicationMedia" | "inBodyEntry"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      UserProfile: {
        payload: Prisma.$UserProfilePayload<ExtArgs>
        fields: Prisma.UserProfileFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserProfileFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserProfileFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload>
          }
          findFirst: {
            args: Prisma.UserProfileFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserProfileFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload>
          }
          findMany: {
            args: Prisma.UserProfileFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload>[]
          }
          create: {
            args: Prisma.UserProfileCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload>
          }
          createMany: {
            args: Prisma.UserProfileCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.UserProfileCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload>[]
          }
          delete: {
            args: Prisma.UserProfileDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload>
          }
          update: {
            args: Prisma.UserProfileUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload>
          }
          deleteMany: {
            args: Prisma.UserProfileDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.UserProfileUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.UserProfileUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserProfilePayload>
          }
          aggregate: {
            args: Prisma.UserProfileAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUserProfile>
          }
          groupBy: {
            args: Prisma.UserProfileGroupByArgs<ExtArgs>
            result: $Utils.Optional<UserProfileGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserProfileCountArgs<ExtArgs>
            result: $Utils.Optional<UserProfileCountAggregateOutputType> | number
          }
        }
      }
      PTApplication: {
        payload: Prisma.$PTApplicationPayload<ExtArgs>
        fields: Prisma.PTApplicationFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PTApplicationFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PTApplicationFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload>
          }
          findFirst: {
            args: Prisma.PTApplicationFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PTApplicationFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload>
          }
          findMany: {
            args: Prisma.PTApplicationFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload>[]
          }
          create: {
            args: Prisma.PTApplicationCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload>
          }
          createMany: {
            args: Prisma.PTApplicationCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PTApplicationCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload>[]
          }
          delete: {
            args: Prisma.PTApplicationDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload>
          }
          update: {
            args: Prisma.PTApplicationUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload>
          }
          deleteMany: {
            args: Prisma.PTApplicationDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PTApplicationUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PTApplicationUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationPayload>
          }
          aggregate: {
            args: Prisma.PTApplicationAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePTApplication>
          }
          groupBy: {
            args: Prisma.PTApplicationGroupByArgs<ExtArgs>
            result: $Utils.Optional<PTApplicationGroupByOutputType>[]
          }
          count: {
            args: Prisma.PTApplicationCountArgs<ExtArgs>
            result: $Utils.Optional<PTApplicationCountAggregateOutputType> | number
          }
        }
      }
      PTApplicationCertificate: {
        payload: Prisma.$PTApplicationCertificatePayload<ExtArgs>
        fields: Prisma.PTApplicationCertificateFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PTApplicationCertificateFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PTApplicationCertificateFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload>
          }
          findFirst: {
            args: Prisma.PTApplicationCertificateFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PTApplicationCertificateFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload>
          }
          findMany: {
            args: Prisma.PTApplicationCertificateFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload>[]
          }
          create: {
            args: Prisma.PTApplicationCertificateCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload>
          }
          createMany: {
            args: Prisma.PTApplicationCertificateCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PTApplicationCertificateCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload>[]
          }
          delete: {
            args: Prisma.PTApplicationCertificateDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload>
          }
          update: {
            args: Prisma.PTApplicationCertificateUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload>
          }
          deleteMany: {
            args: Prisma.PTApplicationCertificateDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PTApplicationCertificateUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PTApplicationCertificateUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationCertificatePayload>
          }
          aggregate: {
            args: Prisma.PTApplicationCertificateAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePTApplicationCertificate>
          }
          groupBy: {
            args: Prisma.PTApplicationCertificateGroupByArgs<ExtArgs>
            result: $Utils.Optional<PTApplicationCertificateGroupByOutputType>[]
          }
          count: {
            args: Prisma.PTApplicationCertificateCountArgs<ExtArgs>
            result: $Utils.Optional<PTApplicationCertificateCountAggregateOutputType> | number
          }
        }
      }
      PTApplicationMedia: {
        payload: Prisma.$PTApplicationMediaPayload<ExtArgs>
        fields: Prisma.PTApplicationMediaFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PTApplicationMediaFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PTApplicationMediaFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload>
          }
          findFirst: {
            args: Prisma.PTApplicationMediaFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PTApplicationMediaFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload>
          }
          findMany: {
            args: Prisma.PTApplicationMediaFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload>[]
          }
          create: {
            args: Prisma.PTApplicationMediaCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload>
          }
          createMany: {
            args: Prisma.PTApplicationMediaCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PTApplicationMediaCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload>[]
          }
          delete: {
            args: Prisma.PTApplicationMediaDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload>
          }
          update: {
            args: Prisma.PTApplicationMediaUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload>
          }
          deleteMany: {
            args: Prisma.PTApplicationMediaDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PTApplicationMediaUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PTApplicationMediaUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PTApplicationMediaPayload>
          }
          aggregate: {
            args: Prisma.PTApplicationMediaAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePTApplicationMedia>
          }
          groupBy: {
            args: Prisma.PTApplicationMediaGroupByArgs<ExtArgs>
            result: $Utils.Optional<PTApplicationMediaGroupByOutputType>[]
          }
          count: {
            args: Prisma.PTApplicationMediaCountArgs<ExtArgs>
            result: $Utils.Optional<PTApplicationMediaCountAggregateOutputType> | number
          }
        }
      }
      InBodyEntry: {
        payload: Prisma.$InBodyEntryPayload<ExtArgs>
        fields: Prisma.InBodyEntryFieldRefs
        operations: {
          findUnique: {
            args: Prisma.InBodyEntryFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.InBodyEntryFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload>
          }
          findFirst: {
            args: Prisma.InBodyEntryFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.InBodyEntryFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload>
          }
          findMany: {
            args: Prisma.InBodyEntryFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload>[]
          }
          create: {
            args: Prisma.InBodyEntryCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload>
          }
          createMany: {
            args: Prisma.InBodyEntryCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.InBodyEntryCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload>[]
          }
          delete: {
            args: Prisma.InBodyEntryDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload>
          }
          update: {
            args: Prisma.InBodyEntryUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload>
          }
          deleteMany: {
            args: Prisma.InBodyEntryDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.InBodyEntryUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.InBodyEntryUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$InBodyEntryPayload>
          }
          aggregate: {
            args: Prisma.InBodyEntryAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateInBodyEntry>
          }
          groupBy: {
            args: Prisma.InBodyEntryGroupByArgs<ExtArgs>
            result: $Utils.Optional<InBodyEntryGroupByOutputType>[]
          }
          count: {
            args: Prisma.InBodyEntryCountArgs<ExtArgs>
            result: $Utils.Optional<InBodyEntryCountAggregateOutputType> | number
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
   * Count Type PTApplicationCountOutputType
   */

  export type PTApplicationCountOutputType = {
    certificates: number
    media: number
  }

  export type PTApplicationCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    certificates?: boolean | PTApplicationCountOutputTypeCountCertificatesArgs
    media?: boolean | PTApplicationCountOutputTypeCountMediaArgs
  }

  // Custom InputTypes
  /**
   * PTApplicationCountOutputType without action
   */
  export type PTApplicationCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCountOutputType
     */
    select?: PTApplicationCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * PTApplicationCountOutputType without action
   */
  export type PTApplicationCountOutputTypeCountCertificatesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PTApplicationCertificateWhereInput
  }

  /**
   * PTApplicationCountOutputType without action
   */
  export type PTApplicationCountOutputTypeCountMediaArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PTApplicationMediaWhereInput
  }


  /**
   * Models
   */

  /**
   * Model UserProfile
   */

  export type AggregateUserProfile = {
    _count: UserProfileCountAggregateOutputType | null
    _avg: UserProfileAvgAggregateOutputType | null
    _sum: UserProfileSumAggregateOutputType | null
    _min: UserProfileMinAggregateOutputType | null
    _max: UserProfileMaxAggregateOutputType | null
  }

  export type UserProfileAvgAggregateOutputType = {
    age: number | null
    heightCm: number | null
    preferredTrainingDays: number | null
    currentWeight: number | null
    targetWeight: number | null
  }

  export type UserProfileSumAggregateOutputType = {
    age: number | null
    heightCm: number | null
    preferredTrainingDays: number[]
    currentWeight: number | null
    targetWeight: number | null
  }

  export type UserProfileMinAggregateOutputType = {
    id: string | null
    userId: string | null
    isPT: boolean | null
    firstName: string | null
    lastName: string | null
    age: number | null
    gender: $Enums.Gender | null
    heightCm: number | null
    goal: $Enums.Goal | null
    activityLevel: $Enums.ActivityLevel | null
    experienceLevel: $Enums.ExperienceLevel | null
    currentWeight: number | null
    targetWeight: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserProfileMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    isPT: boolean | null
    firstName: string | null
    lastName: string | null
    age: number | null
    gender: $Enums.Gender | null
    heightCm: number | null
    goal: $Enums.Goal | null
    activityLevel: $Enums.ActivityLevel | null
    experienceLevel: $Enums.ExperienceLevel | null
    currentWeight: number | null
    targetWeight: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserProfileCountAggregateOutputType = {
    id: number
    userId: number
    isPT: number
    firstName: number
    lastName: number
    age: number
    gender: number
    heightCm: number
    goal: number
    activityLevel: number
    experienceLevel: number
    preferredTrainingDays: number
    availableEquipment: number
    injuries: number
    currentWeight: number
    targetWeight: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type UserProfileAvgAggregateInputType = {
    age?: true
    heightCm?: true
    preferredTrainingDays?: true
    currentWeight?: true
    targetWeight?: true
  }

  export type UserProfileSumAggregateInputType = {
    age?: true
    heightCm?: true
    preferredTrainingDays?: true
    currentWeight?: true
    targetWeight?: true
  }

  export type UserProfileMinAggregateInputType = {
    id?: true
    userId?: true
    isPT?: true
    firstName?: true
    lastName?: true
    age?: true
    gender?: true
    heightCm?: true
    goal?: true
    activityLevel?: true
    experienceLevel?: true
    currentWeight?: true
    targetWeight?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserProfileMaxAggregateInputType = {
    id?: true
    userId?: true
    isPT?: true
    firstName?: true
    lastName?: true
    age?: true
    gender?: true
    heightCm?: true
    goal?: true
    activityLevel?: true
    experienceLevel?: true
    currentWeight?: true
    targetWeight?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserProfileCountAggregateInputType = {
    id?: true
    userId?: true
    isPT?: true
    firstName?: true
    lastName?: true
    age?: true
    gender?: true
    heightCm?: true
    goal?: true
    activityLevel?: true
    experienceLevel?: true
    preferredTrainingDays?: true
    availableEquipment?: true
    injuries?: true
    currentWeight?: true
    targetWeight?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type UserProfileAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which UserProfile to aggregate.
     */
    where?: UserProfileWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserProfiles to fetch.
     */
    orderBy?: UserProfileOrderByWithRelationInput | UserProfileOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserProfileWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserProfiles from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserProfiles.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned UserProfiles
    **/
    _count?: true | UserProfileCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: UserProfileAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: UserProfileSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserProfileMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserProfileMaxAggregateInputType
  }

  export type GetUserProfileAggregateType<T extends UserProfileAggregateArgs> = {
        [P in keyof T & keyof AggregateUserProfile]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUserProfile[P]>
      : GetScalarType<T[P], AggregateUserProfile[P]>
  }




  export type UserProfileGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserProfileWhereInput
    orderBy?: UserProfileOrderByWithAggregationInput | UserProfileOrderByWithAggregationInput[]
    by: UserProfileScalarFieldEnum[] | UserProfileScalarFieldEnum
    having?: UserProfileScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserProfileCountAggregateInputType | true
    _avg?: UserProfileAvgAggregateInputType
    _sum?: UserProfileSumAggregateInputType
    _min?: UserProfileMinAggregateInputType
    _max?: UserProfileMaxAggregateInputType
  }

  export type UserProfileGroupByOutputType = {
    id: string
    userId: string
    isPT: boolean
    firstName: string | null
    lastName: string | null
    age: number | null
    gender: $Enums.Gender | null
    heightCm: number | null
    goal: $Enums.Goal | null
    activityLevel: $Enums.ActivityLevel | null
    experienceLevel: $Enums.ExperienceLevel | null
    preferredTrainingDays: number[]
    availableEquipment: string[]
    injuries: string[]
    currentWeight: number | null
    targetWeight: number | null
    createdAt: Date
    updatedAt: Date
    _count: UserProfileCountAggregateOutputType | null
    _avg: UserProfileAvgAggregateOutputType | null
    _sum: UserProfileSumAggregateOutputType | null
    _min: UserProfileMinAggregateOutputType | null
    _max: UserProfileMaxAggregateOutputType | null
  }

  type GetUserProfileGroupByPayload<T extends UserProfileGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserProfileGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserProfileGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserProfileGroupByOutputType[P]>
            : GetScalarType<T[P], UserProfileGroupByOutputType[P]>
        }
      >
    >


  export type UserProfileSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    isPT?: boolean
    firstName?: boolean
    lastName?: boolean
    age?: boolean
    gender?: boolean
    heightCm?: boolean
    goal?: boolean
    activityLevel?: boolean
    experienceLevel?: boolean
    preferredTrainingDays?: boolean
    availableEquipment?: boolean
    injuries?: boolean
    currentWeight?: boolean
    targetWeight?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    ptApplication?: boolean | UserProfile$ptApplicationArgs<ExtArgs>
  }, ExtArgs["result"]["userProfile"]>

  export type UserProfileSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    isPT?: boolean
    firstName?: boolean
    lastName?: boolean
    age?: boolean
    gender?: boolean
    heightCm?: boolean
    goal?: boolean
    activityLevel?: boolean
    experienceLevel?: boolean
    preferredTrainingDays?: boolean
    availableEquipment?: boolean
    injuries?: boolean
    currentWeight?: boolean
    targetWeight?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["userProfile"]>

  export type UserProfileSelectScalar = {
    id?: boolean
    userId?: boolean
    isPT?: boolean
    firstName?: boolean
    lastName?: boolean
    age?: boolean
    gender?: boolean
    heightCm?: boolean
    goal?: boolean
    activityLevel?: boolean
    experienceLevel?: boolean
    preferredTrainingDays?: boolean
    availableEquipment?: boolean
    injuries?: boolean
    currentWeight?: boolean
    targetWeight?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type UserProfileInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    ptApplication?: boolean | UserProfile$ptApplicationArgs<ExtArgs>
  }
  export type UserProfileIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $UserProfilePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "UserProfile"
    objects: {
      ptApplication: Prisma.$PTApplicationPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      isPT: boolean
      firstName: string | null
      lastName: string | null
      age: number | null
      gender: $Enums.Gender | null
      heightCm: number | null
      goal: $Enums.Goal | null
      activityLevel: $Enums.ActivityLevel | null
      experienceLevel: $Enums.ExperienceLevel | null
      preferredTrainingDays: number[]
      availableEquipment: string[]
      injuries: string[]
      currentWeight: number | null
      targetWeight: number | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["userProfile"]>
    composites: {}
  }

  type UserProfileGetPayload<S extends boolean | null | undefined | UserProfileDefaultArgs> = $Result.GetResult<Prisma.$UserProfilePayload, S>

  type UserProfileCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<UserProfileFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: UserProfileCountAggregateInputType | true
    }

  export interface UserProfileDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['UserProfile'], meta: { name: 'UserProfile' } }
    /**
     * Find zero or one UserProfile that matches the filter.
     * @param {UserProfileFindUniqueArgs} args - Arguments to find a UserProfile
     * @example
     * // Get one UserProfile
     * const userProfile = await prisma.userProfile.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends UserProfileFindUniqueArgs>(args: SelectSubset<T, UserProfileFindUniqueArgs<ExtArgs>>): Prisma__UserProfileClient<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one UserProfile that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {UserProfileFindUniqueOrThrowArgs} args - Arguments to find a UserProfile
     * @example
     * // Get one UserProfile
     * const userProfile = await prisma.userProfile.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends UserProfileFindUniqueOrThrowArgs>(args: SelectSubset<T, UserProfileFindUniqueOrThrowArgs<ExtArgs>>): Prisma__UserProfileClient<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first UserProfile that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserProfileFindFirstArgs} args - Arguments to find a UserProfile
     * @example
     * // Get one UserProfile
     * const userProfile = await prisma.userProfile.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends UserProfileFindFirstArgs>(args?: SelectSubset<T, UserProfileFindFirstArgs<ExtArgs>>): Prisma__UserProfileClient<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first UserProfile that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserProfileFindFirstOrThrowArgs} args - Arguments to find a UserProfile
     * @example
     * // Get one UserProfile
     * const userProfile = await prisma.userProfile.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends UserProfileFindFirstOrThrowArgs>(args?: SelectSubset<T, UserProfileFindFirstOrThrowArgs<ExtArgs>>): Prisma__UserProfileClient<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more UserProfiles that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserProfileFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all UserProfiles
     * const userProfiles = await prisma.userProfile.findMany()
     * 
     * // Get first 10 UserProfiles
     * const userProfiles = await prisma.userProfile.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const userProfileWithIdOnly = await prisma.userProfile.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends UserProfileFindManyArgs>(args?: SelectSubset<T, UserProfileFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a UserProfile.
     * @param {UserProfileCreateArgs} args - Arguments to create a UserProfile.
     * @example
     * // Create one UserProfile
     * const UserProfile = await prisma.userProfile.create({
     *   data: {
     *     // ... data to create a UserProfile
     *   }
     * })
     * 
     */
    create<T extends UserProfileCreateArgs>(args: SelectSubset<T, UserProfileCreateArgs<ExtArgs>>): Prisma__UserProfileClient<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many UserProfiles.
     * @param {UserProfileCreateManyArgs} args - Arguments to create many UserProfiles.
     * @example
     * // Create many UserProfiles
     * const userProfile = await prisma.userProfile.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends UserProfileCreateManyArgs>(args?: SelectSubset<T, UserProfileCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many UserProfiles and returns the data saved in the database.
     * @param {UserProfileCreateManyAndReturnArgs} args - Arguments to create many UserProfiles.
     * @example
     * // Create many UserProfiles
     * const userProfile = await prisma.userProfile.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many UserProfiles and only return the `id`
     * const userProfileWithIdOnly = await prisma.userProfile.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends UserProfileCreateManyAndReturnArgs>(args?: SelectSubset<T, UserProfileCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a UserProfile.
     * @param {UserProfileDeleteArgs} args - Arguments to delete one UserProfile.
     * @example
     * // Delete one UserProfile
     * const UserProfile = await prisma.userProfile.delete({
     *   where: {
     *     // ... filter to delete one UserProfile
     *   }
     * })
     * 
     */
    delete<T extends UserProfileDeleteArgs>(args: SelectSubset<T, UserProfileDeleteArgs<ExtArgs>>): Prisma__UserProfileClient<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one UserProfile.
     * @param {UserProfileUpdateArgs} args - Arguments to update one UserProfile.
     * @example
     * // Update one UserProfile
     * const userProfile = await prisma.userProfile.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends UserProfileUpdateArgs>(args: SelectSubset<T, UserProfileUpdateArgs<ExtArgs>>): Prisma__UserProfileClient<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more UserProfiles.
     * @param {UserProfileDeleteManyArgs} args - Arguments to filter UserProfiles to delete.
     * @example
     * // Delete a few UserProfiles
     * const { count } = await prisma.userProfile.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends UserProfileDeleteManyArgs>(args?: SelectSubset<T, UserProfileDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more UserProfiles.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserProfileUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many UserProfiles
     * const userProfile = await prisma.userProfile.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends UserProfileUpdateManyArgs>(args: SelectSubset<T, UserProfileUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one UserProfile.
     * @param {UserProfileUpsertArgs} args - Arguments to update or create a UserProfile.
     * @example
     * // Update or create a UserProfile
     * const userProfile = await prisma.userProfile.upsert({
     *   create: {
     *     // ... data to create a UserProfile
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the UserProfile we want to update
     *   }
     * })
     */
    upsert<T extends UserProfileUpsertArgs>(args: SelectSubset<T, UserProfileUpsertArgs<ExtArgs>>): Prisma__UserProfileClient<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of UserProfiles.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserProfileCountArgs} args - Arguments to filter UserProfiles to count.
     * @example
     * // Count the number of UserProfiles
     * const count = await prisma.userProfile.count({
     *   where: {
     *     // ... the filter for the UserProfiles we want to count
     *   }
     * })
    **/
    count<T extends UserProfileCountArgs>(
      args?: Subset<T, UserProfileCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserProfileCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a UserProfile.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserProfileAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends UserProfileAggregateArgs>(args: Subset<T, UserProfileAggregateArgs>): Prisma.PrismaPromise<GetUserProfileAggregateType<T>>

    /**
     * Group by UserProfile.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserProfileGroupByArgs} args - Group by arguments.
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
      T extends UserProfileGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserProfileGroupByArgs['orderBy'] }
        : { orderBy?: UserProfileGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, UserProfileGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserProfileGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the UserProfile model
   */
  readonly fields: UserProfileFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for UserProfile.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserProfileClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    ptApplication<T extends UserProfile$ptApplicationArgs<ExtArgs> = {}>(args?: Subset<T, UserProfile$ptApplicationArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
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
   * Fields of the UserProfile model
   */ 
  interface UserProfileFieldRefs {
    readonly id: FieldRef<"UserProfile", 'String'>
    readonly userId: FieldRef<"UserProfile", 'String'>
    readonly isPT: FieldRef<"UserProfile", 'Boolean'>
    readonly firstName: FieldRef<"UserProfile", 'String'>
    readonly lastName: FieldRef<"UserProfile", 'String'>
    readonly age: FieldRef<"UserProfile", 'Int'>
    readonly gender: FieldRef<"UserProfile", 'Gender'>
    readonly heightCm: FieldRef<"UserProfile", 'Float'>
    readonly goal: FieldRef<"UserProfile", 'Goal'>
    readonly activityLevel: FieldRef<"UserProfile", 'ActivityLevel'>
    readonly experienceLevel: FieldRef<"UserProfile", 'ExperienceLevel'>
    readonly preferredTrainingDays: FieldRef<"UserProfile", 'Int[]'>
    readonly availableEquipment: FieldRef<"UserProfile", 'String[]'>
    readonly injuries: FieldRef<"UserProfile", 'String[]'>
    readonly currentWeight: FieldRef<"UserProfile", 'Float'>
    readonly targetWeight: FieldRef<"UserProfile", 'Float'>
    readonly createdAt: FieldRef<"UserProfile", 'DateTime'>
    readonly updatedAt: FieldRef<"UserProfile", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * UserProfile findUnique
   */
  export type UserProfileFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
    /**
     * Filter, which UserProfile to fetch.
     */
    where: UserProfileWhereUniqueInput
  }

  /**
   * UserProfile findUniqueOrThrow
   */
  export type UserProfileFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
    /**
     * Filter, which UserProfile to fetch.
     */
    where: UserProfileWhereUniqueInput
  }

  /**
   * UserProfile findFirst
   */
  export type UserProfileFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
    /**
     * Filter, which UserProfile to fetch.
     */
    where?: UserProfileWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserProfiles to fetch.
     */
    orderBy?: UserProfileOrderByWithRelationInput | UserProfileOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for UserProfiles.
     */
    cursor?: UserProfileWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserProfiles from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserProfiles.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of UserProfiles.
     */
    distinct?: UserProfileScalarFieldEnum | UserProfileScalarFieldEnum[]
  }

  /**
   * UserProfile findFirstOrThrow
   */
  export type UserProfileFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
    /**
     * Filter, which UserProfile to fetch.
     */
    where?: UserProfileWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserProfiles to fetch.
     */
    orderBy?: UserProfileOrderByWithRelationInput | UserProfileOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for UserProfiles.
     */
    cursor?: UserProfileWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserProfiles from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserProfiles.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of UserProfiles.
     */
    distinct?: UserProfileScalarFieldEnum | UserProfileScalarFieldEnum[]
  }

  /**
   * UserProfile findMany
   */
  export type UserProfileFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
    /**
     * Filter, which UserProfiles to fetch.
     */
    where?: UserProfileWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserProfiles to fetch.
     */
    orderBy?: UserProfileOrderByWithRelationInput | UserProfileOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing UserProfiles.
     */
    cursor?: UserProfileWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserProfiles from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserProfiles.
     */
    skip?: number
    distinct?: UserProfileScalarFieldEnum | UserProfileScalarFieldEnum[]
  }

  /**
   * UserProfile create
   */
  export type UserProfileCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
    /**
     * The data needed to create a UserProfile.
     */
    data: XOR<UserProfileCreateInput, UserProfileUncheckedCreateInput>
  }

  /**
   * UserProfile createMany
   */
  export type UserProfileCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many UserProfiles.
     */
    data: UserProfileCreateManyInput | UserProfileCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * UserProfile createManyAndReturn
   */
  export type UserProfileCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many UserProfiles.
     */
    data: UserProfileCreateManyInput | UserProfileCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * UserProfile update
   */
  export type UserProfileUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
    /**
     * The data needed to update a UserProfile.
     */
    data: XOR<UserProfileUpdateInput, UserProfileUncheckedUpdateInput>
    /**
     * Choose, which UserProfile to update.
     */
    where: UserProfileWhereUniqueInput
  }

  /**
   * UserProfile updateMany
   */
  export type UserProfileUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update UserProfiles.
     */
    data: XOR<UserProfileUpdateManyMutationInput, UserProfileUncheckedUpdateManyInput>
    /**
     * Filter which UserProfiles to update
     */
    where?: UserProfileWhereInput
  }

  /**
   * UserProfile upsert
   */
  export type UserProfileUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
    /**
     * The filter to search for the UserProfile to update in case it exists.
     */
    where: UserProfileWhereUniqueInput
    /**
     * In case the UserProfile found by the `where` argument doesn't exist, create a new UserProfile with this data.
     */
    create: XOR<UserProfileCreateInput, UserProfileUncheckedCreateInput>
    /**
     * In case the UserProfile was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserProfileUpdateInput, UserProfileUncheckedUpdateInput>
  }

  /**
   * UserProfile delete
   */
  export type UserProfileDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
    /**
     * Filter which UserProfile to delete.
     */
    where: UserProfileWhereUniqueInput
  }

  /**
   * UserProfile deleteMany
   */
  export type UserProfileDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which UserProfiles to delete
     */
    where?: UserProfileWhereInput
  }

  /**
   * UserProfile.ptApplication
   */
  export type UserProfile$ptApplicationArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    where?: PTApplicationWhereInput
  }

  /**
   * UserProfile without action
   */
  export type UserProfileDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserProfile
     */
    select?: UserProfileSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserProfileInclude<ExtArgs> | null
  }


  /**
   * Model PTApplication
   */

  export type AggregatePTApplication = {
    _count: PTApplicationCountAggregateOutputType | null
    _avg: PTApplicationAvgAggregateOutputType | null
    _sum: PTApplicationSumAggregateOutputType | null
    _min: PTApplicationMinAggregateOutputType | null
    _max: PTApplicationMaxAggregateOutputType | null
  }

  export type PTApplicationAvgAggregateOutputType = {
    desiredSessionPrice: number | null
  }

  export type PTApplicationSumAggregateOutputType = {
    desiredSessionPrice: number | null
  }

  export type PTApplicationMinAggregateOutputType = {
    id: string | null
    userProfileId: string | null
    status: $Enums.PTApplicationStatus | null
    phoneNumber: string | null
    nationalIdNumber: string | null
    currentAddress: string | null
    idCardFrontUrl: string | null
    idCardBackUrl: string | null
    portraitPhotoUrl: string | null
    yearsOfExperience: string | null
    educationBackground: string | null
    portfolioUrl: string | null
    linkedinUrl: string | null
    websiteUrl: string | null
    availabilityNotes: string | null
    serviceMode: $Enums.ServiceMode | null
    desiredSessionPrice: number | null
    adminNote: string | null
    rejectionReason: string | null
    submittedAt: Date | null
    reviewedAt: Date | null
    approvedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PTApplicationMaxAggregateOutputType = {
    id: string | null
    userProfileId: string | null
    status: $Enums.PTApplicationStatus | null
    phoneNumber: string | null
    nationalIdNumber: string | null
    currentAddress: string | null
    idCardFrontUrl: string | null
    idCardBackUrl: string | null
    portraitPhotoUrl: string | null
    yearsOfExperience: string | null
    educationBackground: string | null
    portfolioUrl: string | null
    linkedinUrl: string | null
    websiteUrl: string | null
    availabilityNotes: string | null
    serviceMode: $Enums.ServiceMode | null
    desiredSessionPrice: number | null
    adminNote: string | null
    rejectionReason: string | null
    submittedAt: Date | null
    reviewedAt: Date | null
    approvedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PTApplicationCountAggregateOutputType = {
    id: number
    userProfileId: number
    status: number
    phoneNumber: number
    nationalIdNumber: number
    currentAddress: number
    idCardFrontUrl: number
    idCardBackUrl: number
    portraitPhotoUrl: number
    yearsOfExperience: number
    educationBackground: number
    mainSpecialties: number
    targetClientGroups: number
    portfolioUrl: number
    linkedinUrl: number
    websiteUrl: number
    socialLinks: number
    availabilityNotes: number
    availableTimeSlots: number
    serviceMode: number
    operatingAreas: number
    desiredSessionPrice: number
    adminNote: number
    rejectionReason: number
    submittedAt: number
    reviewedAt: number
    approvedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type PTApplicationAvgAggregateInputType = {
    desiredSessionPrice?: true
  }

  export type PTApplicationSumAggregateInputType = {
    desiredSessionPrice?: true
  }

  export type PTApplicationMinAggregateInputType = {
    id?: true
    userProfileId?: true
    status?: true
    phoneNumber?: true
    nationalIdNumber?: true
    currentAddress?: true
    idCardFrontUrl?: true
    idCardBackUrl?: true
    portraitPhotoUrl?: true
    yearsOfExperience?: true
    educationBackground?: true
    portfolioUrl?: true
    linkedinUrl?: true
    websiteUrl?: true
    availabilityNotes?: true
    serviceMode?: true
    desiredSessionPrice?: true
    adminNote?: true
    rejectionReason?: true
    submittedAt?: true
    reviewedAt?: true
    approvedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PTApplicationMaxAggregateInputType = {
    id?: true
    userProfileId?: true
    status?: true
    phoneNumber?: true
    nationalIdNumber?: true
    currentAddress?: true
    idCardFrontUrl?: true
    idCardBackUrl?: true
    portraitPhotoUrl?: true
    yearsOfExperience?: true
    educationBackground?: true
    portfolioUrl?: true
    linkedinUrl?: true
    websiteUrl?: true
    availabilityNotes?: true
    serviceMode?: true
    desiredSessionPrice?: true
    adminNote?: true
    rejectionReason?: true
    submittedAt?: true
    reviewedAt?: true
    approvedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PTApplicationCountAggregateInputType = {
    id?: true
    userProfileId?: true
    status?: true
    phoneNumber?: true
    nationalIdNumber?: true
    currentAddress?: true
    idCardFrontUrl?: true
    idCardBackUrl?: true
    portraitPhotoUrl?: true
    yearsOfExperience?: true
    educationBackground?: true
    mainSpecialties?: true
    targetClientGroups?: true
    portfolioUrl?: true
    linkedinUrl?: true
    websiteUrl?: true
    socialLinks?: true
    availabilityNotes?: true
    availableTimeSlots?: true
    serviceMode?: true
    operatingAreas?: true
    desiredSessionPrice?: true
    adminNote?: true
    rejectionReason?: true
    submittedAt?: true
    reviewedAt?: true
    approvedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type PTApplicationAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PTApplication to aggregate.
     */
    where?: PTApplicationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplications to fetch.
     */
    orderBy?: PTApplicationOrderByWithRelationInput | PTApplicationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PTApplicationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplications from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplications.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PTApplications
    **/
    _count?: true | PTApplicationCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PTApplicationAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PTApplicationSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PTApplicationMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PTApplicationMaxAggregateInputType
  }

  export type GetPTApplicationAggregateType<T extends PTApplicationAggregateArgs> = {
        [P in keyof T & keyof AggregatePTApplication]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePTApplication[P]>
      : GetScalarType<T[P], AggregatePTApplication[P]>
  }




  export type PTApplicationGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PTApplicationWhereInput
    orderBy?: PTApplicationOrderByWithAggregationInput | PTApplicationOrderByWithAggregationInput[]
    by: PTApplicationScalarFieldEnum[] | PTApplicationScalarFieldEnum
    having?: PTApplicationScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PTApplicationCountAggregateInputType | true
    _avg?: PTApplicationAvgAggregateInputType
    _sum?: PTApplicationSumAggregateInputType
    _min?: PTApplicationMinAggregateInputType
    _max?: PTApplicationMaxAggregateInputType
  }

  export type PTApplicationGroupByOutputType = {
    id: string
    userProfileId: string
    status: $Enums.PTApplicationStatus
    phoneNumber: string | null
    nationalIdNumber: string | null
    currentAddress: string | null
    idCardFrontUrl: string | null
    idCardBackUrl: string | null
    portraitPhotoUrl: string | null
    yearsOfExperience: string | null
    educationBackground: string | null
    mainSpecialties: string[]
    targetClientGroups: string[]
    portfolioUrl: string | null
    linkedinUrl: string | null
    websiteUrl: string | null
    socialLinks: JsonValue | null
    availabilityNotes: string | null
    availableTimeSlots: JsonValue | null
    serviceMode: $Enums.ServiceMode | null
    operatingAreas: string[]
    desiredSessionPrice: number | null
    adminNote: string | null
    rejectionReason: string | null
    submittedAt: Date | null
    reviewedAt: Date | null
    approvedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: PTApplicationCountAggregateOutputType | null
    _avg: PTApplicationAvgAggregateOutputType | null
    _sum: PTApplicationSumAggregateOutputType | null
    _min: PTApplicationMinAggregateOutputType | null
    _max: PTApplicationMaxAggregateOutputType | null
  }

  type GetPTApplicationGroupByPayload<T extends PTApplicationGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PTApplicationGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PTApplicationGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PTApplicationGroupByOutputType[P]>
            : GetScalarType<T[P], PTApplicationGroupByOutputType[P]>
        }
      >
    >


  export type PTApplicationSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userProfileId?: boolean
    status?: boolean
    phoneNumber?: boolean
    nationalIdNumber?: boolean
    currentAddress?: boolean
    idCardFrontUrl?: boolean
    idCardBackUrl?: boolean
    portraitPhotoUrl?: boolean
    yearsOfExperience?: boolean
    educationBackground?: boolean
    mainSpecialties?: boolean
    targetClientGroups?: boolean
    portfolioUrl?: boolean
    linkedinUrl?: boolean
    websiteUrl?: boolean
    socialLinks?: boolean
    availabilityNotes?: boolean
    availableTimeSlots?: boolean
    serviceMode?: boolean
    operatingAreas?: boolean
    desiredSessionPrice?: boolean
    adminNote?: boolean
    rejectionReason?: boolean
    submittedAt?: boolean
    reviewedAt?: boolean
    approvedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    certificates?: boolean | PTApplication$certificatesArgs<ExtArgs>
    media?: boolean | PTApplication$mediaArgs<ExtArgs>
    userProfile?: boolean | UserProfileDefaultArgs<ExtArgs>
    _count?: boolean | PTApplicationCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["pTApplication"]>

  export type PTApplicationSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userProfileId?: boolean
    status?: boolean
    phoneNumber?: boolean
    nationalIdNumber?: boolean
    currentAddress?: boolean
    idCardFrontUrl?: boolean
    idCardBackUrl?: boolean
    portraitPhotoUrl?: boolean
    yearsOfExperience?: boolean
    educationBackground?: boolean
    mainSpecialties?: boolean
    targetClientGroups?: boolean
    portfolioUrl?: boolean
    linkedinUrl?: boolean
    websiteUrl?: boolean
    socialLinks?: boolean
    availabilityNotes?: boolean
    availableTimeSlots?: boolean
    serviceMode?: boolean
    operatingAreas?: boolean
    desiredSessionPrice?: boolean
    adminNote?: boolean
    rejectionReason?: boolean
    submittedAt?: boolean
    reviewedAt?: boolean
    approvedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    userProfile?: boolean | UserProfileDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["pTApplication"]>

  export type PTApplicationSelectScalar = {
    id?: boolean
    userProfileId?: boolean
    status?: boolean
    phoneNumber?: boolean
    nationalIdNumber?: boolean
    currentAddress?: boolean
    idCardFrontUrl?: boolean
    idCardBackUrl?: boolean
    portraitPhotoUrl?: boolean
    yearsOfExperience?: boolean
    educationBackground?: boolean
    mainSpecialties?: boolean
    targetClientGroups?: boolean
    portfolioUrl?: boolean
    linkedinUrl?: boolean
    websiteUrl?: boolean
    socialLinks?: boolean
    availabilityNotes?: boolean
    availableTimeSlots?: boolean
    serviceMode?: boolean
    operatingAreas?: boolean
    desiredSessionPrice?: boolean
    adminNote?: boolean
    rejectionReason?: boolean
    submittedAt?: boolean
    reviewedAt?: boolean
    approvedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type PTApplicationInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    certificates?: boolean | PTApplication$certificatesArgs<ExtArgs>
    media?: boolean | PTApplication$mediaArgs<ExtArgs>
    userProfile?: boolean | UserProfileDefaultArgs<ExtArgs>
    _count?: boolean | PTApplicationCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type PTApplicationIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    userProfile?: boolean | UserProfileDefaultArgs<ExtArgs>
  }

  export type $PTApplicationPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PTApplication"
    objects: {
      certificates: Prisma.$PTApplicationCertificatePayload<ExtArgs>[]
      media: Prisma.$PTApplicationMediaPayload<ExtArgs>[]
      userProfile: Prisma.$UserProfilePayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userProfileId: string
      status: $Enums.PTApplicationStatus
      phoneNumber: string | null
      nationalIdNumber: string | null
      currentAddress: string | null
      idCardFrontUrl: string | null
      idCardBackUrl: string | null
      portraitPhotoUrl: string | null
      yearsOfExperience: string | null
      educationBackground: string | null
      mainSpecialties: string[]
      targetClientGroups: string[]
      portfolioUrl: string | null
      linkedinUrl: string | null
      websiteUrl: string | null
      socialLinks: Prisma.JsonValue | null
      availabilityNotes: string | null
      availableTimeSlots: Prisma.JsonValue | null
      serviceMode: $Enums.ServiceMode | null
      operatingAreas: string[]
      desiredSessionPrice: number | null
      adminNote: string | null
      rejectionReason: string | null
      submittedAt: Date | null
      reviewedAt: Date | null
      approvedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["pTApplication"]>
    composites: {}
  }

  type PTApplicationGetPayload<S extends boolean | null | undefined | PTApplicationDefaultArgs> = $Result.GetResult<Prisma.$PTApplicationPayload, S>

  type PTApplicationCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PTApplicationFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PTApplicationCountAggregateInputType | true
    }

  export interface PTApplicationDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PTApplication'], meta: { name: 'PTApplication' } }
    /**
     * Find zero or one PTApplication that matches the filter.
     * @param {PTApplicationFindUniqueArgs} args - Arguments to find a PTApplication
     * @example
     * // Get one PTApplication
     * const pTApplication = await prisma.pTApplication.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PTApplicationFindUniqueArgs>(args: SelectSubset<T, PTApplicationFindUniqueArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PTApplication that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PTApplicationFindUniqueOrThrowArgs} args - Arguments to find a PTApplication
     * @example
     * // Get one PTApplication
     * const pTApplication = await prisma.pTApplication.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PTApplicationFindUniqueOrThrowArgs>(args: SelectSubset<T, PTApplicationFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PTApplication that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationFindFirstArgs} args - Arguments to find a PTApplication
     * @example
     * // Get one PTApplication
     * const pTApplication = await prisma.pTApplication.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PTApplicationFindFirstArgs>(args?: SelectSubset<T, PTApplicationFindFirstArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PTApplication that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationFindFirstOrThrowArgs} args - Arguments to find a PTApplication
     * @example
     * // Get one PTApplication
     * const pTApplication = await prisma.pTApplication.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PTApplicationFindFirstOrThrowArgs>(args?: SelectSubset<T, PTApplicationFindFirstOrThrowArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PTApplications that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PTApplications
     * const pTApplications = await prisma.pTApplication.findMany()
     * 
     * // Get first 10 PTApplications
     * const pTApplications = await prisma.pTApplication.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const pTApplicationWithIdOnly = await prisma.pTApplication.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PTApplicationFindManyArgs>(args?: SelectSubset<T, PTApplicationFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PTApplication.
     * @param {PTApplicationCreateArgs} args - Arguments to create a PTApplication.
     * @example
     * // Create one PTApplication
     * const PTApplication = await prisma.pTApplication.create({
     *   data: {
     *     // ... data to create a PTApplication
     *   }
     * })
     * 
     */
    create<T extends PTApplicationCreateArgs>(args: SelectSubset<T, PTApplicationCreateArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PTApplications.
     * @param {PTApplicationCreateManyArgs} args - Arguments to create many PTApplications.
     * @example
     * // Create many PTApplications
     * const pTApplication = await prisma.pTApplication.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PTApplicationCreateManyArgs>(args?: SelectSubset<T, PTApplicationCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PTApplications and returns the data saved in the database.
     * @param {PTApplicationCreateManyAndReturnArgs} args - Arguments to create many PTApplications.
     * @example
     * // Create many PTApplications
     * const pTApplication = await prisma.pTApplication.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PTApplications and only return the `id`
     * const pTApplicationWithIdOnly = await prisma.pTApplication.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PTApplicationCreateManyAndReturnArgs>(args?: SelectSubset<T, PTApplicationCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PTApplication.
     * @param {PTApplicationDeleteArgs} args - Arguments to delete one PTApplication.
     * @example
     * // Delete one PTApplication
     * const PTApplication = await prisma.pTApplication.delete({
     *   where: {
     *     // ... filter to delete one PTApplication
     *   }
     * })
     * 
     */
    delete<T extends PTApplicationDeleteArgs>(args: SelectSubset<T, PTApplicationDeleteArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PTApplication.
     * @param {PTApplicationUpdateArgs} args - Arguments to update one PTApplication.
     * @example
     * // Update one PTApplication
     * const pTApplication = await prisma.pTApplication.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PTApplicationUpdateArgs>(args: SelectSubset<T, PTApplicationUpdateArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PTApplications.
     * @param {PTApplicationDeleteManyArgs} args - Arguments to filter PTApplications to delete.
     * @example
     * // Delete a few PTApplications
     * const { count } = await prisma.pTApplication.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PTApplicationDeleteManyArgs>(args?: SelectSubset<T, PTApplicationDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PTApplications.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PTApplications
     * const pTApplication = await prisma.pTApplication.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PTApplicationUpdateManyArgs>(args: SelectSubset<T, PTApplicationUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PTApplication.
     * @param {PTApplicationUpsertArgs} args - Arguments to update or create a PTApplication.
     * @example
     * // Update or create a PTApplication
     * const pTApplication = await prisma.pTApplication.upsert({
     *   create: {
     *     // ... data to create a PTApplication
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PTApplication we want to update
     *   }
     * })
     */
    upsert<T extends PTApplicationUpsertArgs>(args: SelectSubset<T, PTApplicationUpsertArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PTApplications.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationCountArgs} args - Arguments to filter PTApplications to count.
     * @example
     * // Count the number of PTApplications
     * const count = await prisma.pTApplication.count({
     *   where: {
     *     // ... the filter for the PTApplications we want to count
     *   }
     * })
    **/
    count<T extends PTApplicationCountArgs>(
      args?: Subset<T, PTApplicationCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PTApplicationCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PTApplication.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends PTApplicationAggregateArgs>(args: Subset<T, PTApplicationAggregateArgs>): Prisma.PrismaPromise<GetPTApplicationAggregateType<T>>

    /**
     * Group by PTApplication.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationGroupByArgs} args - Group by arguments.
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
      T extends PTApplicationGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PTApplicationGroupByArgs['orderBy'] }
        : { orderBy?: PTApplicationGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, PTApplicationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPTApplicationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PTApplication model
   */
  readonly fields: PTApplicationFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PTApplication.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PTApplicationClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    certificates<T extends PTApplication$certificatesArgs<ExtArgs> = {}>(args?: Subset<T, PTApplication$certificatesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "findMany"> | Null>
    media<T extends PTApplication$mediaArgs<ExtArgs> = {}>(args?: Subset<T, PTApplication$mediaArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "findMany"> | Null>
    userProfile<T extends UserProfileDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserProfileDefaultArgs<ExtArgs>>): Prisma__UserProfileClient<$Result.GetResult<Prisma.$UserProfilePayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the PTApplication model
   */ 
  interface PTApplicationFieldRefs {
    readonly id: FieldRef<"PTApplication", 'String'>
    readonly userProfileId: FieldRef<"PTApplication", 'String'>
    readonly status: FieldRef<"PTApplication", 'PTApplicationStatus'>
    readonly phoneNumber: FieldRef<"PTApplication", 'String'>
    readonly nationalIdNumber: FieldRef<"PTApplication", 'String'>
    readonly currentAddress: FieldRef<"PTApplication", 'String'>
    readonly idCardFrontUrl: FieldRef<"PTApplication", 'String'>
    readonly idCardBackUrl: FieldRef<"PTApplication", 'String'>
    readonly portraitPhotoUrl: FieldRef<"PTApplication", 'String'>
    readonly yearsOfExperience: FieldRef<"PTApplication", 'String'>
    readonly educationBackground: FieldRef<"PTApplication", 'String'>
    readonly mainSpecialties: FieldRef<"PTApplication", 'String[]'>
    readonly targetClientGroups: FieldRef<"PTApplication", 'String[]'>
    readonly portfolioUrl: FieldRef<"PTApplication", 'String'>
    readonly linkedinUrl: FieldRef<"PTApplication", 'String'>
    readonly websiteUrl: FieldRef<"PTApplication", 'String'>
    readonly socialLinks: FieldRef<"PTApplication", 'Json'>
    readonly availabilityNotes: FieldRef<"PTApplication", 'String'>
    readonly availableTimeSlots: FieldRef<"PTApplication", 'Json'>
    readonly serviceMode: FieldRef<"PTApplication", 'ServiceMode'>
    readonly operatingAreas: FieldRef<"PTApplication", 'String[]'>
    readonly desiredSessionPrice: FieldRef<"PTApplication", 'Float'>
    readonly adminNote: FieldRef<"PTApplication", 'String'>
    readonly rejectionReason: FieldRef<"PTApplication", 'String'>
    readonly submittedAt: FieldRef<"PTApplication", 'DateTime'>
    readonly reviewedAt: FieldRef<"PTApplication", 'DateTime'>
    readonly approvedAt: FieldRef<"PTApplication", 'DateTime'>
    readonly createdAt: FieldRef<"PTApplication", 'DateTime'>
    readonly updatedAt: FieldRef<"PTApplication", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PTApplication findUnique
   */
  export type PTApplicationFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    /**
     * Filter, which PTApplication to fetch.
     */
    where: PTApplicationWhereUniqueInput
  }

  /**
   * PTApplication findUniqueOrThrow
   */
  export type PTApplicationFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    /**
     * Filter, which PTApplication to fetch.
     */
    where: PTApplicationWhereUniqueInput
  }

  /**
   * PTApplication findFirst
   */
  export type PTApplicationFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    /**
     * Filter, which PTApplication to fetch.
     */
    where?: PTApplicationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplications to fetch.
     */
    orderBy?: PTApplicationOrderByWithRelationInput | PTApplicationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PTApplications.
     */
    cursor?: PTApplicationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplications from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplications.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PTApplications.
     */
    distinct?: PTApplicationScalarFieldEnum | PTApplicationScalarFieldEnum[]
  }

  /**
   * PTApplication findFirstOrThrow
   */
  export type PTApplicationFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    /**
     * Filter, which PTApplication to fetch.
     */
    where?: PTApplicationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplications to fetch.
     */
    orderBy?: PTApplicationOrderByWithRelationInput | PTApplicationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PTApplications.
     */
    cursor?: PTApplicationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplications from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplications.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PTApplications.
     */
    distinct?: PTApplicationScalarFieldEnum | PTApplicationScalarFieldEnum[]
  }

  /**
   * PTApplication findMany
   */
  export type PTApplicationFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    /**
     * Filter, which PTApplications to fetch.
     */
    where?: PTApplicationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplications to fetch.
     */
    orderBy?: PTApplicationOrderByWithRelationInput | PTApplicationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PTApplications.
     */
    cursor?: PTApplicationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplications from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplications.
     */
    skip?: number
    distinct?: PTApplicationScalarFieldEnum | PTApplicationScalarFieldEnum[]
  }

  /**
   * PTApplication create
   */
  export type PTApplicationCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    /**
     * The data needed to create a PTApplication.
     */
    data: XOR<PTApplicationCreateInput, PTApplicationUncheckedCreateInput>
  }

  /**
   * PTApplication createMany
   */
  export type PTApplicationCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PTApplications.
     */
    data: PTApplicationCreateManyInput | PTApplicationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PTApplication createManyAndReturn
   */
  export type PTApplicationCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PTApplications.
     */
    data: PTApplicationCreateManyInput | PTApplicationCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * PTApplication update
   */
  export type PTApplicationUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    /**
     * The data needed to update a PTApplication.
     */
    data: XOR<PTApplicationUpdateInput, PTApplicationUncheckedUpdateInput>
    /**
     * Choose, which PTApplication to update.
     */
    where: PTApplicationWhereUniqueInput
  }

  /**
   * PTApplication updateMany
   */
  export type PTApplicationUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PTApplications.
     */
    data: XOR<PTApplicationUpdateManyMutationInput, PTApplicationUncheckedUpdateManyInput>
    /**
     * Filter which PTApplications to update
     */
    where?: PTApplicationWhereInput
  }

  /**
   * PTApplication upsert
   */
  export type PTApplicationUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    /**
     * The filter to search for the PTApplication to update in case it exists.
     */
    where: PTApplicationWhereUniqueInput
    /**
     * In case the PTApplication found by the `where` argument doesn't exist, create a new PTApplication with this data.
     */
    create: XOR<PTApplicationCreateInput, PTApplicationUncheckedCreateInput>
    /**
     * In case the PTApplication was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PTApplicationUpdateInput, PTApplicationUncheckedUpdateInput>
  }

  /**
   * PTApplication delete
   */
  export type PTApplicationDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
    /**
     * Filter which PTApplication to delete.
     */
    where: PTApplicationWhereUniqueInput
  }

  /**
   * PTApplication deleteMany
   */
  export type PTApplicationDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PTApplications to delete
     */
    where?: PTApplicationWhereInput
  }

  /**
   * PTApplication.certificates
   */
  export type PTApplication$certificatesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    where?: PTApplicationCertificateWhereInput
    orderBy?: PTApplicationCertificateOrderByWithRelationInput | PTApplicationCertificateOrderByWithRelationInput[]
    cursor?: PTApplicationCertificateWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PTApplicationCertificateScalarFieldEnum | PTApplicationCertificateScalarFieldEnum[]
  }

  /**
   * PTApplication.media
   */
  export type PTApplication$mediaArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    where?: PTApplicationMediaWhereInput
    orderBy?: PTApplicationMediaOrderByWithRelationInput | PTApplicationMediaOrderByWithRelationInput[]
    cursor?: PTApplicationMediaWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PTApplicationMediaScalarFieldEnum | PTApplicationMediaScalarFieldEnum[]
  }

  /**
   * PTApplication without action
   */
  export type PTApplicationDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplication
     */
    select?: PTApplicationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationInclude<ExtArgs> | null
  }


  /**
   * Model PTApplicationCertificate
   */

  export type AggregatePTApplicationCertificate = {
    _count: PTApplicationCertificateCountAggregateOutputType | null
    _min: PTApplicationCertificateMinAggregateOutputType | null
    _max: PTApplicationCertificateMaxAggregateOutputType | null
  }

  export type PTApplicationCertificateMinAggregateOutputType = {
    id: string | null
    applicationId: string | null
    certificateName: string | null
    issuingOrganization: string | null
    isCurrentlyValid: boolean | null
    expirationDate: Date | null
    certificateFileUrl: string | null
    createdAt: Date | null
  }

  export type PTApplicationCertificateMaxAggregateOutputType = {
    id: string | null
    applicationId: string | null
    certificateName: string | null
    issuingOrganization: string | null
    isCurrentlyValid: boolean | null
    expirationDate: Date | null
    certificateFileUrl: string | null
    createdAt: Date | null
  }

  export type PTApplicationCertificateCountAggregateOutputType = {
    id: number
    applicationId: number
    certificateName: number
    issuingOrganization: number
    isCurrentlyValid: number
    expirationDate: number
    certificateFileUrl: number
    createdAt: number
    _all: number
  }


  export type PTApplicationCertificateMinAggregateInputType = {
    id?: true
    applicationId?: true
    certificateName?: true
    issuingOrganization?: true
    isCurrentlyValid?: true
    expirationDate?: true
    certificateFileUrl?: true
    createdAt?: true
  }

  export type PTApplicationCertificateMaxAggregateInputType = {
    id?: true
    applicationId?: true
    certificateName?: true
    issuingOrganization?: true
    isCurrentlyValid?: true
    expirationDate?: true
    certificateFileUrl?: true
    createdAt?: true
  }

  export type PTApplicationCertificateCountAggregateInputType = {
    id?: true
    applicationId?: true
    certificateName?: true
    issuingOrganization?: true
    isCurrentlyValid?: true
    expirationDate?: true
    certificateFileUrl?: true
    createdAt?: true
    _all?: true
  }

  export type PTApplicationCertificateAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PTApplicationCertificate to aggregate.
     */
    where?: PTApplicationCertificateWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplicationCertificates to fetch.
     */
    orderBy?: PTApplicationCertificateOrderByWithRelationInput | PTApplicationCertificateOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PTApplicationCertificateWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplicationCertificates from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplicationCertificates.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PTApplicationCertificates
    **/
    _count?: true | PTApplicationCertificateCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PTApplicationCertificateMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PTApplicationCertificateMaxAggregateInputType
  }

  export type GetPTApplicationCertificateAggregateType<T extends PTApplicationCertificateAggregateArgs> = {
        [P in keyof T & keyof AggregatePTApplicationCertificate]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePTApplicationCertificate[P]>
      : GetScalarType<T[P], AggregatePTApplicationCertificate[P]>
  }




  export type PTApplicationCertificateGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PTApplicationCertificateWhereInput
    orderBy?: PTApplicationCertificateOrderByWithAggregationInput | PTApplicationCertificateOrderByWithAggregationInput[]
    by: PTApplicationCertificateScalarFieldEnum[] | PTApplicationCertificateScalarFieldEnum
    having?: PTApplicationCertificateScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PTApplicationCertificateCountAggregateInputType | true
    _min?: PTApplicationCertificateMinAggregateInputType
    _max?: PTApplicationCertificateMaxAggregateInputType
  }

  export type PTApplicationCertificateGroupByOutputType = {
    id: string
    applicationId: string
    certificateName: string
    issuingOrganization: string
    isCurrentlyValid: boolean
    expirationDate: Date | null
    certificateFileUrl: string | null
    createdAt: Date
    _count: PTApplicationCertificateCountAggregateOutputType | null
    _min: PTApplicationCertificateMinAggregateOutputType | null
    _max: PTApplicationCertificateMaxAggregateOutputType | null
  }

  type GetPTApplicationCertificateGroupByPayload<T extends PTApplicationCertificateGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PTApplicationCertificateGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PTApplicationCertificateGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PTApplicationCertificateGroupByOutputType[P]>
            : GetScalarType<T[P], PTApplicationCertificateGroupByOutputType[P]>
        }
      >
    >


  export type PTApplicationCertificateSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    applicationId?: boolean
    certificateName?: boolean
    issuingOrganization?: boolean
    isCurrentlyValid?: boolean
    expirationDate?: boolean
    certificateFileUrl?: boolean
    createdAt?: boolean
    application?: boolean | PTApplicationDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["pTApplicationCertificate"]>

  export type PTApplicationCertificateSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    applicationId?: boolean
    certificateName?: boolean
    issuingOrganization?: boolean
    isCurrentlyValid?: boolean
    expirationDate?: boolean
    certificateFileUrl?: boolean
    createdAt?: boolean
    application?: boolean | PTApplicationDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["pTApplicationCertificate"]>

  export type PTApplicationCertificateSelectScalar = {
    id?: boolean
    applicationId?: boolean
    certificateName?: boolean
    issuingOrganization?: boolean
    isCurrentlyValid?: boolean
    expirationDate?: boolean
    certificateFileUrl?: boolean
    createdAt?: boolean
  }

  export type PTApplicationCertificateInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    application?: boolean | PTApplicationDefaultArgs<ExtArgs>
  }
  export type PTApplicationCertificateIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    application?: boolean | PTApplicationDefaultArgs<ExtArgs>
  }

  export type $PTApplicationCertificatePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PTApplicationCertificate"
    objects: {
      application: Prisma.$PTApplicationPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      applicationId: string
      certificateName: string
      issuingOrganization: string
      isCurrentlyValid: boolean
      expirationDate: Date | null
      certificateFileUrl: string | null
      createdAt: Date
    }, ExtArgs["result"]["pTApplicationCertificate"]>
    composites: {}
  }

  type PTApplicationCertificateGetPayload<S extends boolean | null | undefined | PTApplicationCertificateDefaultArgs> = $Result.GetResult<Prisma.$PTApplicationCertificatePayload, S>

  type PTApplicationCertificateCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PTApplicationCertificateFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PTApplicationCertificateCountAggregateInputType | true
    }

  export interface PTApplicationCertificateDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PTApplicationCertificate'], meta: { name: 'PTApplicationCertificate' } }
    /**
     * Find zero or one PTApplicationCertificate that matches the filter.
     * @param {PTApplicationCertificateFindUniqueArgs} args - Arguments to find a PTApplicationCertificate
     * @example
     * // Get one PTApplicationCertificate
     * const pTApplicationCertificate = await prisma.pTApplicationCertificate.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PTApplicationCertificateFindUniqueArgs>(args: SelectSubset<T, PTApplicationCertificateFindUniqueArgs<ExtArgs>>): Prisma__PTApplicationCertificateClient<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PTApplicationCertificate that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PTApplicationCertificateFindUniqueOrThrowArgs} args - Arguments to find a PTApplicationCertificate
     * @example
     * // Get one PTApplicationCertificate
     * const pTApplicationCertificate = await prisma.pTApplicationCertificate.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PTApplicationCertificateFindUniqueOrThrowArgs>(args: SelectSubset<T, PTApplicationCertificateFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PTApplicationCertificateClient<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PTApplicationCertificate that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationCertificateFindFirstArgs} args - Arguments to find a PTApplicationCertificate
     * @example
     * // Get one PTApplicationCertificate
     * const pTApplicationCertificate = await prisma.pTApplicationCertificate.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PTApplicationCertificateFindFirstArgs>(args?: SelectSubset<T, PTApplicationCertificateFindFirstArgs<ExtArgs>>): Prisma__PTApplicationCertificateClient<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PTApplicationCertificate that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationCertificateFindFirstOrThrowArgs} args - Arguments to find a PTApplicationCertificate
     * @example
     * // Get one PTApplicationCertificate
     * const pTApplicationCertificate = await prisma.pTApplicationCertificate.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PTApplicationCertificateFindFirstOrThrowArgs>(args?: SelectSubset<T, PTApplicationCertificateFindFirstOrThrowArgs<ExtArgs>>): Prisma__PTApplicationCertificateClient<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PTApplicationCertificates that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationCertificateFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PTApplicationCertificates
     * const pTApplicationCertificates = await prisma.pTApplicationCertificate.findMany()
     * 
     * // Get first 10 PTApplicationCertificates
     * const pTApplicationCertificates = await prisma.pTApplicationCertificate.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const pTApplicationCertificateWithIdOnly = await prisma.pTApplicationCertificate.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PTApplicationCertificateFindManyArgs>(args?: SelectSubset<T, PTApplicationCertificateFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PTApplicationCertificate.
     * @param {PTApplicationCertificateCreateArgs} args - Arguments to create a PTApplicationCertificate.
     * @example
     * // Create one PTApplicationCertificate
     * const PTApplicationCertificate = await prisma.pTApplicationCertificate.create({
     *   data: {
     *     // ... data to create a PTApplicationCertificate
     *   }
     * })
     * 
     */
    create<T extends PTApplicationCertificateCreateArgs>(args: SelectSubset<T, PTApplicationCertificateCreateArgs<ExtArgs>>): Prisma__PTApplicationCertificateClient<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PTApplicationCertificates.
     * @param {PTApplicationCertificateCreateManyArgs} args - Arguments to create many PTApplicationCertificates.
     * @example
     * // Create many PTApplicationCertificates
     * const pTApplicationCertificate = await prisma.pTApplicationCertificate.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PTApplicationCertificateCreateManyArgs>(args?: SelectSubset<T, PTApplicationCertificateCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PTApplicationCertificates and returns the data saved in the database.
     * @param {PTApplicationCertificateCreateManyAndReturnArgs} args - Arguments to create many PTApplicationCertificates.
     * @example
     * // Create many PTApplicationCertificates
     * const pTApplicationCertificate = await prisma.pTApplicationCertificate.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PTApplicationCertificates and only return the `id`
     * const pTApplicationCertificateWithIdOnly = await prisma.pTApplicationCertificate.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PTApplicationCertificateCreateManyAndReturnArgs>(args?: SelectSubset<T, PTApplicationCertificateCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PTApplicationCertificate.
     * @param {PTApplicationCertificateDeleteArgs} args - Arguments to delete one PTApplicationCertificate.
     * @example
     * // Delete one PTApplicationCertificate
     * const PTApplicationCertificate = await prisma.pTApplicationCertificate.delete({
     *   where: {
     *     // ... filter to delete one PTApplicationCertificate
     *   }
     * })
     * 
     */
    delete<T extends PTApplicationCertificateDeleteArgs>(args: SelectSubset<T, PTApplicationCertificateDeleteArgs<ExtArgs>>): Prisma__PTApplicationCertificateClient<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PTApplicationCertificate.
     * @param {PTApplicationCertificateUpdateArgs} args - Arguments to update one PTApplicationCertificate.
     * @example
     * // Update one PTApplicationCertificate
     * const pTApplicationCertificate = await prisma.pTApplicationCertificate.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PTApplicationCertificateUpdateArgs>(args: SelectSubset<T, PTApplicationCertificateUpdateArgs<ExtArgs>>): Prisma__PTApplicationCertificateClient<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PTApplicationCertificates.
     * @param {PTApplicationCertificateDeleteManyArgs} args - Arguments to filter PTApplicationCertificates to delete.
     * @example
     * // Delete a few PTApplicationCertificates
     * const { count } = await prisma.pTApplicationCertificate.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PTApplicationCertificateDeleteManyArgs>(args?: SelectSubset<T, PTApplicationCertificateDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PTApplicationCertificates.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationCertificateUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PTApplicationCertificates
     * const pTApplicationCertificate = await prisma.pTApplicationCertificate.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PTApplicationCertificateUpdateManyArgs>(args: SelectSubset<T, PTApplicationCertificateUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PTApplicationCertificate.
     * @param {PTApplicationCertificateUpsertArgs} args - Arguments to update or create a PTApplicationCertificate.
     * @example
     * // Update or create a PTApplicationCertificate
     * const pTApplicationCertificate = await prisma.pTApplicationCertificate.upsert({
     *   create: {
     *     // ... data to create a PTApplicationCertificate
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PTApplicationCertificate we want to update
     *   }
     * })
     */
    upsert<T extends PTApplicationCertificateUpsertArgs>(args: SelectSubset<T, PTApplicationCertificateUpsertArgs<ExtArgs>>): Prisma__PTApplicationCertificateClient<$Result.GetResult<Prisma.$PTApplicationCertificatePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PTApplicationCertificates.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationCertificateCountArgs} args - Arguments to filter PTApplicationCertificates to count.
     * @example
     * // Count the number of PTApplicationCertificates
     * const count = await prisma.pTApplicationCertificate.count({
     *   where: {
     *     // ... the filter for the PTApplicationCertificates we want to count
     *   }
     * })
    **/
    count<T extends PTApplicationCertificateCountArgs>(
      args?: Subset<T, PTApplicationCertificateCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PTApplicationCertificateCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PTApplicationCertificate.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationCertificateAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends PTApplicationCertificateAggregateArgs>(args: Subset<T, PTApplicationCertificateAggregateArgs>): Prisma.PrismaPromise<GetPTApplicationCertificateAggregateType<T>>

    /**
     * Group by PTApplicationCertificate.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationCertificateGroupByArgs} args - Group by arguments.
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
      T extends PTApplicationCertificateGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PTApplicationCertificateGroupByArgs['orderBy'] }
        : { orderBy?: PTApplicationCertificateGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, PTApplicationCertificateGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPTApplicationCertificateGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PTApplicationCertificate model
   */
  readonly fields: PTApplicationCertificateFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PTApplicationCertificate.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PTApplicationCertificateClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    application<T extends PTApplicationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PTApplicationDefaultArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the PTApplicationCertificate model
   */ 
  interface PTApplicationCertificateFieldRefs {
    readonly id: FieldRef<"PTApplicationCertificate", 'String'>
    readonly applicationId: FieldRef<"PTApplicationCertificate", 'String'>
    readonly certificateName: FieldRef<"PTApplicationCertificate", 'String'>
    readonly issuingOrganization: FieldRef<"PTApplicationCertificate", 'String'>
    readonly isCurrentlyValid: FieldRef<"PTApplicationCertificate", 'Boolean'>
    readonly expirationDate: FieldRef<"PTApplicationCertificate", 'DateTime'>
    readonly certificateFileUrl: FieldRef<"PTApplicationCertificate", 'String'>
    readonly createdAt: FieldRef<"PTApplicationCertificate", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PTApplicationCertificate findUnique
   */
  export type PTApplicationCertificateFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationCertificate to fetch.
     */
    where: PTApplicationCertificateWhereUniqueInput
  }

  /**
   * PTApplicationCertificate findUniqueOrThrow
   */
  export type PTApplicationCertificateFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationCertificate to fetch.
     */
    where: PTApplicationCertificateWhereUniqueInput
  }

  /**
   * PTApplicationCertificate findFirst
   */
  export type PTApplicationCertificateFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationCertificate to fetch.
     */
    where?: PTApplicationCertificateWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplicationCertificates to fetch.
     */
    orderBy?: PTApplicationCertificateOrderByWithRelationInput | PTApplicationCertificateOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PTApplicationCertificates.
     */
    cursor?: PTApplicationCertificateWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplicationCertificates from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplicationCertificates.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PTApplicationCertificates.
     */
    distinct?: PTApplicationCertificateScalarFieldEnum | PTApplicationCertificateScalarFieldEnum[]
  }

  /**
   * PTApplicationCertificate findFirstOrThrow
   */
  export type PTApplicationCertificateFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationCertificate to fetch.
     */
    where?: PTApplicationCertificateWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplicationCertificates to fetch.
     */
    orderBy?: PTApplicationCertificateOrderByWithRelationInput | PTApplicationCertificateOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PTApplicationCertificates.
     */
    cursor?: PTApplicationCertificateWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplicationCertificates from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplicationCertificates.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PTApplicationCertificates.
     */
    distinct?: PTApplicationCertificateScalarFieldEnum | PTApplicationCertificateScalarFieldEnum[]
  }

  /**
   * PTApplicationCertificate findMany
   */
  export type PTApplicationCertificateFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationCertificates to fetch.
     */
    where?: PTApplicationCertificateWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplicationCertificates to fetch.
     */
    orderBy?: PTApplicationCertificateOrderByWithRelationInput | PTApplicationCertificateOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PTApplicationCertificates.
     */
    cursor?: PTApplicationCertificateWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplicationCertificates from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplicationCertificates.
     */
    skip?: number
    distinct?: PTApplicationCertificateScalarFieldEnum | PTApplicationCertificateScalarFieldEnum[]
  }

  /**
   * PTApplicationCertificate create
   */
  export type PTApplicationCertificateCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    /**
     * The data needed to create a PTApplicationCertificate.
     */
    data: XOR<PTApplicationCertificateCreateInput, PTApplicationCertificateUncheckedCreateInput>
  }

  /**
   * PTApplicationCertificate createMany
   */
  export type PTApplicationCertificateCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PTApplicationCertificates.
     */
    data: PTApplicationCertificateCreateManyInput | PTApplicationCertificateCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PTApplicationCertificate createManyAndReturn
   */
  export type PTApplicationCertificateCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PTApplicationCertificates.
     */
    data: PTApplicationCertificateCreateManyInput | PTApplicationCertificateCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * PTApplicationCertificate update
   */
  export type PTApplicationCertificateUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    /**
     * The data needed to update a PTApplicationCertificate.
     */
    data: XOR<PTApplicationCertificateUpdateInput, PTApplicationCertificateUncheckedUpdateInput>
    /**
     * Choose, which PTApplicationCertificate to update.
     */
    where: PTApplicationCertificateWhereUniqueInput
  }

  /**
   * PTApplicationCertificate updateMany
   */
  export type PTApplicationCertificateUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PTApplicationCertificates.
     */
    data: XOR<PTApplicationCertificateUpdateManyMutationInput, PTApplicationCertificateUncheckedUpdateManyInput>
    /**
     * Filter which PTApplicationCertificates to update
     */
    where?: PTApplicationCertificateWhereInput
  }

  /**
   * PTApplicationCertificate upsert
   */
  export type PTApplicationCertificateUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    /**
     * The filter to search for the PTApplicationCertificate to update in case it exists.
     */
    where: PTApplicationCertificateWhereUniqueInput
    /**
     * In case the PTApplicationCertificate found by the `where` argument doesn't exist, create a new PTApplicationCertificate with this data.
     */
    create: XOR<PTApplicationCertificateCreateInput, PTApplicationCertificateUncheckedCreateInput>
    /**
     * In case the PTApplicationCertificate was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PTApplicationCertificateUpdateInput, PTApplicationCertificateUncheckedUpdateInput>
  }

  /**
   * PTApplicationCertificate delete
   */
  export type PTApplicationCertificateDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
    /**
     * Filter which PTApplicationCertificate to delete.
     */
    where: PTApplicationCertificateWhereUniqueInput
  }

  /**
   * PTApplicationCertificate deleteMany
   */
  export type PTApplicationCertificateDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PTApplicationCertificates to delete
     */
    where?: PTApplicationCertificateWhereInput
  }

  /**
   * PTApplicationCertificate without action
   */
  export type PTApplicationCertificateDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationCertificate
     */
    select?: PTApplicationCertificateSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationCertificateInclude<ExtArgs> | null
  }


  /**
   * Model PTApplicationMedia
   */

  export type AggregatePTApplicationMedia = {
    _count: PTApplicationMediaCountAggregateOutputType | null
    _min: PTApplicationMediaMinAggregateOutputType | null
    _max: PTApplicationMediaMaxAggregateOutputType | null
  }

  export type PTApplicationMediaMinAggregateOutputType = {
    id: string | null
    applicationId: string | null
    groupType: $Enums.MediaGroupType | null
    fileUrl: string | null
    label: string | null
    createdAt: Date | null
  }

  export type PTApplicationMediaMaxAggregateOutputType = {
    id: string | null
    applicationId: string | null
    groupType: $Enums.MediaGroupType | null
    fileUrl: string | null
    label: string | null
    createdAt: Date | null
  }

  export type PTApplicationMediaCountAggregateOutputType = {
    id: number
    applicationId: number
    groupType: number
    fileUrl: number
    label: number
    createdAt: number
    _all: number
  }


  export type PTApplicationMediaMinAggregateInputType = {
    id?: true
    applicationId?: true
    groupType?: true
    fileUrl?: true
    label?: true
    createdAt?: true
  }

  export type PTApplicationMediaMaxAggregateInputType = {
    id?: true
    applicationId?: true
    groupType?: true
    fileUrl?: true
    label?: true
    createdAt?: true
  }

  export type PTApplicationMediaCountAggregateInputType = {
    id?: true
    applicationId?: true
    groupType?: true
    fileUrl?: true
    label?: true
    createdAt?: true
    _all?: true
  }

  export type PTApplicationMediaAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PTApplicationMedia to aggregate.
     */
    where?: PTApplicationMediaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplicationMedias to fetch.
     */
    orderBy?: PTApplicationMediaOrderByWithRelationInput | PTApplicationMediaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PTApplicationMediaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplicationMedias from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplicationMedias.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PTApplicationMedias
    **/
    _count?: true | PTApplicationMediaCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PTApplicationMediaMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PTApplicationMediaMaxAggregateInputType
  }

  export type GetPTApplicationMediaAggregateType<T extends PTApplicationMediaAggregateArgs> = {
        [P in keyof T & keyof AggregatePTApplicationMedia]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePTApplicationMedia[P]>
      : GetScalarType<T[P], AggregatePTApplicationMedia[P]>
  }




  export type PTApplicationMediaGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PTApplicationMediaWhereInput
    orderBy?: PTApplicationMediaOrderByWithAggregationInput | PTApplicationMediaOrderByWithAggregationInput[]
    by: PTApplicationMediaScalarFieldEnum[] | PTApplicationMediaScalarFieldEnum
    having?: PTApplicationMediaScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PTApplicationMediaCountAggregateInputType | true
    _min?: PTApplicationMediaMinAggregateInputType
    _max?: PTApplicationMediaMaxAggregateInputType
  }

  export type PTApplicationMediaGroupByOutputType = {
    id: string
    applicationId: string
    groupType: $Enums.MediaGroupType
    fileUrl: string
    label: string | null
    createdAt: Date
    _count: PTApplicationMediaCountAggregateOutputType | null
    _min: PTApplicationMediaMinAggregateOutputType | null
    _max: PTApplicationMediaMaxAggregateOutputType | null
  }

  type GetPTApplicationMediaGroupByPayload<T extends PTApplicationMediaGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PTApplicationMediaGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PTApplicationMediaGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PTApplicationMediaGroupByOutputType[P]>
            : GetScalarType<T[P], PTApplicationMediaGroupByOutputType[P]>
        }
      >
    >


  export type PTApplicationMediaSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    applicationId?: boolean
    groupType?: boolean
    fileUrl?: boolean
    label?: boolean
    createdAt?: boolean
    application?: boolean | PTApplicationDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["pTApplicationMedia"]>

  export type PTApplicationMediaSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    applicationId?: boolean
    groupType?: boolean
    fileUrl?: boolean
    label?: boolean
    createdAt?: boolean
    application?: boolean | PTApplicationDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["pTApplicationMedia"]>

  export type PTApplicationMediaSelectScalar = {
    id?: boolean
    applicationId?: boolean
    groupType?: boolean
    fileUrl?: boolean
    label?: boolean
    createdAt?: boolean
  }

  export type PTApplicationMediaInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    application?: boolean | PTApplicationDefaultArgs<ExtArgs>
  }
  export type PTApplicationMediaIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    application?: boolean | PTApplicationDefaultArgs<ExtArgs>
  }

  export type $PTApplicationMediaPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PTApplicationMedia"
    objects: {
      application: Prisma.$PTApplicationPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      applicationId: string
      groupType: $Enums.MediaGroupType
      fileUrl: string
      label: string | null
      createdAt: Date
    }, ExtArgs["result"]["pTApplicationMedia"]>
    composites: {}
  }

  type PTApplicationMediaGetPayload<S extends boolean | null | undefined | PTApplicationMediaDefaultArgs> = $Result.GetResult<Prisma.$PTApplicationMediaPayload, S>

  type PTApplicationMediaCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PTApplicationMediaFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PTApplicationMediaCountAggregateInputType | true
    }

  export interface PTApplicationMediaDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PTApplicationMedia'], meta: { name: 'PTApplicationMedia' } }
    /**
     * Find zero or one PTApplicationMedia that matches the filter.
     * @param {PTApplicationMediaFindUniqueArgs} args - Arguments to find a PTApplicationMedia
     * @example
     * // Get one PTApplicationMedia
     * const pTApplicationMedia = await prisma.pTApplicationMedia.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PTApplicationMediaFindUniqueArgs>(args: SelectSubset<T, PTApplicationMediaFindUniqueArgs<ExtArgs>>): Prisma__PTApplicationMediaClient<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PTApplicationMedia that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PTApplicationMediaFindUniqueOrThrowArgs} args - Arguments to find a PTApplicationMedia
     * @example
     * // Get one PTApplicationMedia
     * const pTApplicationMedia = await prisma.pTApplicationMedia.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PTApplicationMediaFindUniqueOrThrowArgs>(args: SelectSubset<T, PTApplicationMediaFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PTApplicationMediaClient<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PTApplicationMedia that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationMediaFindFirstArgs} args - Arguments to find a PTApplicationMedia
     * @example
     * // Get one PTApplicationMedia
     * const pTApplicationMedia = await prisma.pTApplicationMedia.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PTApplicationMediaFindFirstArgs>(args?: SelectSubset<T, PTApplicationMediaFindFirstArgs<ExtArgs>>): Prisma__PTApplicationMediaClient<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PTApplicationMedia that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationMediaFindFirstOrThrowArgs} args - Arguments to find a PTApplicationMedia
     * @example
     * // Get one PTApplicationMedia
     * const pTApplicationMedia = await prisma.pTApplicationMedia.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PTApplicationMediaFindFirstOrThrowArgs>(args?: SelectSubset<T, PTApplicationMediaFindFirstOrThrowArgs<ExtArgs>>): Prisma__PTApplicationMediaClient<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PTApplicationMedias that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationMediaFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PTApplicationMedias
     * const pTApplicationMedias = await prisma.pTApplicationMedia.findMany()
     * 
     * // Get first 10 PTApplicationMedias
     * const pTApplicationMedias = await prisma.pTApplicationMedia.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const pTApplicationMediaWithIdOnly = await prisma.pTApplicationMedia.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PTApplicationMediaFindManyArgs>(args?: SelectSubset<T, PTApplicationMediaFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PTApplicationMedia.
     * @param {PTApplicationMediaCreateArgs} args - Arguments to create a PTApplicationMedia.
     * @example
     * // Create one PTApplicationMedia
     * const PTApplicationMedia = await prisma.pTApplicationMedia.create({
     *   data: {
     *     // ... data to create a PTApplicationMedia
     *   }
     * })
     * 
     */
    create<T extends PTApplicationMediaCreateArgs>(args: SelectSubset<T, PTApplicationMediaCreateArgs<ExtArgs>>): Prisma__PTApplicationMediaClient<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PTApplicationMedias.
     * @param {PTApplicationMediaCreateManyArgs} args - Arguments to create many PTApplicationMedias.
     * @example
     * // Create many PTApplicationMedias
     * const pTApplicationMedia = await prisma.pTApplicationMedia.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PTApplicationMediaCreateManyArgs>(args?: SelectSubset<T, PTApplicationMediaCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PTApplicationMedias and returns the data saved in the database.
     * @param {PTApplicationMediaCreateManyAndReturnArgs} args - Arguments to create many PTApplicationMedias.
     * @example
     * // Create many PTApplicationMedias
     * const pTApplicationMedia = await prisma.pTApplicationMedia.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PTApplicationMedias and only return the `id`
     * const pTApplicationMediaWithIdOnly = await prisma.pTApplicationMedia.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PTApplicationMediaCreateManyAndReturnArgs>(args?: SelectSubset<T, PTApplicationMediaCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PTApplicationMedia.
     * @param {PTApplicationMediaDeleteArgs} args - Arguments to delete one PTApplicationMedia.
     * @example
     * // Delete one PTApplicationMedia
     * const PTApplicationMedia = await prisma.pTApplicationMedia.delete({
     *   where: {
     *     // ... filter to delete one PTApplicationMedia
     *   }
     * })
     * 
     */
    delete<T extends PTApplicationMediaDeleteArgs>(args: SelectSubset<T, PTApplicationMediaDeleteArgs<ExtArgs>>): Prisma__PTApplicationMediaClient<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PTApplicationMedia.
     * @param {PTApplicationMediaUpdateArgs} args - Arguments to update one PTApplicationMedia.
     * @example
     * // Update one PTApplicationMedia
     * const pTApplicationMedia = await prisma.pTApplicationMedia.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PTApplicationMediaUpdateArgs>(args: SelectSubset<T, PTApplicationMediaUpdateArgs<ExtArgs>>): Prisma__PTApplicationMediaClient<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PTApplicationMedias.
     * @param {PTApplicationMediaDeleteManyArgs} args - Arguments to filter PTApplicationMedias to delete.
     * @example
     * // Delete a few PTApplicationMedias
     * const { count } = await prisma.pTApplicationMedia.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PTApplicationMediaDeleteManyArgs>(args?: SelectSubset<T, PTApplicationMediaDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PTApplicationMedias.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationMediaUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PTApplicationMedias
     * const pTApplicationMedia = await prisma.pTApplicationMedia.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PTApplicationMediaUpdateManyArgs>(args: SelectSubset<T, PTApplicationMediaUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PTApplicationMedia.
     * @param {PTApplicationMediaUpsertArgs} args - Arguments to update or create a PTApplicationMedia.
     * @example
     * // Update or create a PTApplicationMedia
     * const pTApplicationMedia = await prisma.pTApplicationMedia.upsert({
     *   create: {
     *     // ... data to create a PTApplicationMedia
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PTApplicationMedia we want to update
     *   }
     * })
     */
    upsert<T extends PTApplicationMediaUpsertArgs>(args: SelectSubset<T, PTApplicationMediaUpsertArgs<ExtArgs>>): Prisma__PTApplicationMediaClient<$Result.GetResult<Prisma.$PTApplicationMediaPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PTApplicationMedias.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationMediaCountArgs} args - Arguments to filter PTApplicationMedias to count.
     * @example
     * // Count the number of PTApplicationMedias
     * const count = await prisma.pTApplicationMedia.count({
     *   where: {
     *     // ... the filter for the PTApplicationMedias we want to count
     *   }
     * })
    **/
    count<T extends PTApplicationMediaCountArgs>(
      args?: Subset<T, PTApplicationMediaCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PTApplicationMediaCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PTApplicationMedia.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationMediaAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends PTApplicationMediaAggregateArgs>(args: Subset<T, PTApplicationMediaAggregateArgs>): Prisma.PrismaPromise<GetPTApplicationMediaAggregateType<T>>

    /**
     * Group by PTApplicationMedia.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PTApplicationMediaGroupByArgs} args - Group by arguments.
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
      T extends PTApplicationMediaGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PTApplicationMediaGroupByArgs['orderBy'] }
        : { orderBy?: PTApplicationMediaGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, PTApplicationMediaGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPTApplicationMediaGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PTApplicationMedia model
   */
  readonly fields: PTApplicationMediaFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PTApplicationMedia.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PTApplicationMediaClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    application<T extends PTApplicationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PTApplicationDefaultArgs<ExtArgs>>): Prisma__PTApplicationClient<$Result.GetResult<Prisma.$PTApplicationPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the PTApplicationMedia model
   */ 
  interface PTApplicationMediaFieldRefs {
    readonly id: FieldRef<"PTApplicationMedia", 'String'>
    readonly applicationId: FieldRef<"PTApplicationMedia", 'String'>
    readonly groupType: FieldRef<"PTApplicationMedia", 'MediaGroupType'>
    readonly fileUrl: FieldRef<"PTApplicationMedia", 'String'>
    readonly label: FieldRef<"PTApplicationMedia", 'String'>
    readonly createdAt: FieldRef<"PTApplicationMedia", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PTApplicationMedia findUnique
   */
  export type PTApplicationMediaFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationMedia to fetch.
     */
    where: PTApplicationMediaWhereUniqueInput
  }

  /**
   * PTApplicationMedia findUniqueOrThrow
   */
  export type PTApplicationMediaFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationMedia to fetch.
     */
    where: PTApplicationMediaWhereUniqueInput
  }

  /**
   * PTApplicationMedia findFirst
   */
  export type PTApplicationMediaFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationMedia to fetch.
     */
    where?: PTApplicationMediaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplicationMedias to fetch.
     */
    orderBy?: PTApplicationMediaOrderByWithRelationInput | PTApplicationMediaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PTApplicationMedias.
     */
    cursor?: PTApplicationMediaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplicationMedias from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplicationMedias.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PTApplicationMedias.
     */
    distinct?: PTApplicationMediaScalarFieldEnum | PTApplicationMediaScalarFieldEnum[]
  }

  /**
   * PTApplicationMedia findFirstOrThrow
   */
  export type PTApplicationMediaFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationMedia to fetch.
     */
    where?: PTApplicationMediaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplicationMedias to fetch.
     */
    orderBy?: PTApplicationMediaOrderByWithRelationInput | PTApplicationMediaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PTApplicationMedias.
     */
    cursor?: PTApplicationMediaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplicationMedias from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplicationMedias.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PTApplicationMedias.
     */
    distinct?: PTApplicationMediaScalarFieldEnum | PTApplicationMediaScalarFieldEnum[]
  }

  /**
   * PTApplicationMedia findMany
   */
  export type PTApplicationMediaFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    /**
     * Filter, which PTApplicationMedias to fetch.
     */
    where?: PTApplicationMediaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PTApplicationMedias to fetch.
     */
    orderBy?: PTApplicationMediaOrderByWithRelationInput | PTApplicationMediaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PTApplicationMedias.
     */
    cursor?: PTApplicationMediaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PTApplicationMedias from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PTApplicationMedias.
     */
    skip?: number
    distinct?: PTApplicationMediaScalarFieldEnum | PTApplicationMediaScalarFieldEnum[]
  }

  /**
   * PTApplicationMedia create
   */
  export type PTApplicationMediaCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    /**
     * The data needed to create a PTApplicationMedia.
     */
    data: XOR<PTApplicationMediaCreateInput, PTApplicationMediaUncheckedCreateInput>
  }

  /**
   * PTApplicationMedia createMany
   */
  export type PTApplicationMediaCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PTApplicationMedias.
     */
    data: PTApplicationMediaCreateManyInput | PTApplicationMediaCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PTApplicationMedia createManyAndReturn
   */
  export type PTApplicationMediaCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PTApplicationMedias.
     */
    data: PTApplicationMediaCreateManyInput | PTApplicationMediaCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * PTApplicationMedia update
   */
  export type PTApplicationMediaUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    /**
     * The data needed to update a PTApplicationMedia.
     */
    data: XOR<PTApplicationMediaUpdateInput, PTApplicationMediaUncheckedUpdateInput>
    /**
     * Choose, which PTApplicationMedia to update.
     */
    where: PTApplicationMediaWhereUniqueInput
  }

  /**
   * PTApplicationMedia updateMany
   */
  export type PTApplicationMediaUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PTApplicationMedias.
     */
    data: XOR<PTApplicationMediaUpdateManyMutationInput, PTApplicationMediaUncheckedUpdateManyInput>
    /**
     * Filter which PTApplicationMedias to update
     */
    where?: PTApplicationMediaWhereInput
  }

  /**
   * PTApplicationMedia upsert
   */
  export type PTApplicationMediaUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    /**
     * The filter to search for the PTApplicationMedia to update in case it exists.
     */
    where: PTApplicationMediaWhereUniqueInput
    /**
     * In case the PTApplicationMedia found by the `where` argument doesn't exist, create a new PTApplicationMedia with this data.
     */
    create: XOR<PTApplicationMediaCreateInput, PTApplicationMediaUncheckedCreateInput>
    /**
     * In case the PTApplicationMedia was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PTApplicationMediaUpdateInput, PTApplicationMediaUncheckedUpdateInput>
  }

  /**
   * PTApplicationMedia delete
   */
  export type PTApplicationMediaDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
    /**
     * Filter which PTApplicationMedia to delete.
     */
    where: PTApplicationMediaWhereUniqueInput
  }

  /**
   * PTApplicationMedia deleteMany
   */
  export type PTApplicationMediaDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PTApplicationMedias to delete
     */
    where?: PTApplicationMediaWhereInput
  }

  /**
   * PTApplicationMedia without action
   */
  export type PTApplicationMediaDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PTApplicationMedia
     */
    select?: PTApplicationMediaSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PTApplicationMediaInclude<ExtArgs> | null
  }


  /**
   * Model InBodyEntry
   */

  export type AggregateInBodyEntry = {
    _count: InBodyEntryCountAggregateOutputType | null
    _avg: InBodyEntryAvgAggregateOutputType | null
    _sum: InBodyEntrySumAggregateOutputType | null
    _min: InBodyEntryMinAggregateOutputType | null
    _max: InBodyEntryMaxAggregateOutputType | null
  }

  export type InBodyEntryAvgAggregateOutputType = {
    weight: number | null
    height: number | null
    bmi: number | null
    bmr: number | null
    bodyFat: number | null
    bodyFatPct: number | null
    muscleMass: number | null
    rightArmMuscle: number | null
    leftArmMuscle: number | null
    trunkMuscle: number | null
    rightLegMuscle: number | null
    leftLegMuscle: number | null
    rightArmFat: number | null
    leftArmFat: number | null
    trunkFat: number | null
    rightLegFat: number | null
    leftLegFat: number | null
  }

  export type InBodyEntrySumAggregateOutputType = {
    weight: number | null
    height: number | null
    bmi: number | null
    bmr: number | null
    bodyFat: number | null
    bodyFatPct: number | null
    muscleMass: number | null
    rightArmMuscle: number | null
    leftArmMuscle: number | null
    trunkMuscle: number | null
    rightLegMuscle: number | null
    leftLegMuscle: number | null
    rightArmFat: number | null
    leftArmFat: number | null
    trunkFat: number | null
    rightLegFat: number | null
    leftLegFat: number | null
  }

  export type InBodyEntryMinAggregateOutputType = {
    id: string | null
    userId: string | null
    date: Date | null
    weight: number | null
    height: number | null
    bmi: number | null
    bmr: number | null
    bodyFat: number | null
    bodyFatPct: number | null
    muscleMass: number | null
    rightArmMuscle: number | null
    leftArmMuscle: number | null
    trunkMuscle: number | null
    rightLegMuscle: number | null
    leftLegMuscle: number | null
    rightArmFat: number | null
    leftArmFat: number | null
    trunkFat: number | null
    rightLegFat: number | null
    leftLegFat: number | null
    status: string | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type InBodyEntryMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    date: Date | null
    weight: number | null
    height: number | null
    bmi: number | null
    bmr: number | null
    bodyFat: number | null
    bodyFatPct: number | null
    muscleMass: number | null
    rightArmMuscle: number | null
    leftArmMuscle: number | null
    trunkMuscle: number | null
    rightLegMuscle: number | null
    leftLegMuscle: number | null
    rightArmFat: number | null
    leftArmFat: number | null
    trunkFat: number | null
    rightLegFat: number | null
    leftLegFat: number | null
    status: string | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type InBodyEntryCountAggregateOutputType = {
    id: number
    userId: number
    date: number
    weight: number
    height: number
    bmi: number
    bmr: number
    bodyFat: number
    bodyFatPct: number
    muscleMass: number
    rightArmMuscle: number
    leftArmMuscle: number
    trunkMuscle: number
    rightLegMuscle: number
    leftLegMuscle: number
    rightArmFat: number
    leftArmFat: number
    trunkFat: number
    rightLegFat: number
    leftLegFat: number
    status: number
    notes: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type InBodyEntryAvgAggregateInputType = {
    weight?: true
    height?: true
    bmi?: true
    bmr?: true
    bodyFat?: true
    bodyFatPct?: true
    muscleMass?: true
    rightArmMuscle?: true
    leftArmMuscle?: true
    trunkMuscle?: true
    rightLegMuscle?: true
    leftLegMuscle?: true
    rightArmFat?: true
    leftArmFat?: true
    trunkFat?: true
    rightLegFat?: true
    leftLegFat?: true
  }

  export type InBodyEntrySumAggregateInputType = {
    weight?: true
    height?: true
    bmi?: true
    bmr?: true
    bodyFat?: true
    bodyFatPct?: true
    muscleMass?: true
    rightArmMuscle?: true
    leftArmMuscle?: true
    trunkMuscle?: true
    rightLegMuscle?: true
    leftLegMuscle?: true
    rightArmFat?: true
    leftArmFat?: true
    trunkFat?: true
    rightLegFat?: true
    leftLegFat?: true
  }

  export type InBodyEntryMinAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    weight?: true
    height?: true
    bmi?: true
    bmr?: true
    bodyFat?: true
    bodyFatPct?: true
    muscleMass?: true
    rightArmMuscle?: true
    leftArmMuscle?: true
    trunkMuscle?: true
    rightLegMuscle?: true
    leftLegMuscle?: true
    rightArmFat?: true
    leftArmFat?: true
    trunkFat?: true
    rightLegFat?: true
    leftLegFat?: true
    status?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type InBodyEntryMaxAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    weight?: true
    height?: true
    bmi?: true
    bmr?: true
    bodyFat?: true
    bodyFatPct?: true
    muscleMass?: true
    rightArmMuscle?: true
    leftArmMuscle?: true
    trunkMuscle?: true
    rightLegMuscle?: true
    leftLegMuscle?: true
    rightArmFat?: true
    leftArmFat?: true
    trunkFat?: true
    rightLegFat?: true
    leftLegFat?: true
    status?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type InBodyEntryCountAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    weight?: true
    height?: true
    bmi?: true
    bmr?: true
    bodyFat?: true
    bodyFatPct?: true
    muscleMass?: true
    rightArmMuscle?: true
    leftArmMuscle?: true
    trunkMuscle?: true
    rightLegMuscle?: true
    leftLegMuscle?: true
    rightArmFat?: true
    leftArmFat?: true
    trunkFat?: true
    rightLegFat?: true
    leftLegFat?: true
    status?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type InBodyEntryAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which InBodyEntry to aggregate.
     */
    where?: InBodyEntryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of InBodyEntries to fetch.
     */
    orderBy?: InBodyEntryOrderByWithRelationInput | InBodyEntryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: InBodyEntryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` InBodyEntries from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` InBodyEntries.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned InBodyEntries
    **/
    _count?: true | InBodyEntryCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: InBodyEntryAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: InBodyEntrySumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: InBodyEntryMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: InBodyEntryMaxAggregateInputType
  }

  export type GetInBodyEntryAggregateType<T extends InBodyEntryAggregateArgs> = {
        [P in keyof T & keyof AggregateInBodyEntry]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateInBodyEntry[P]>
      : GetScalarType<T[P], AggregateInBodyEntry[P]>
  }




  export type InBodyEntryGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: InBodyEntryWhereInput
    orderBy?: InBodyEntryOrderByWithAggregationInput | InBodyEntryOrderByWithAggregationInput[]
    by: InBodyEntryScalarFieldEnum[] | InBodyEntryScalarFieldEnum
    having?: InBodyEntryScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: InBodyEntryCountAggregateInputType | true
    _avg?: InBodyEntryAvgAggregateInputType
    _sum?: InBodyEntrySumAggregateInputType
    _min?: InBodyEntryMinAggregateInputType
    _max?: InBodyEntryMaxAggregateInputType
  }

  export type InBodyEntryGroupByOutputType = {
    id: string
    userId: string
    date: Date
    weight: number
    height: number | null
    bmi: number | null
    bmr: number | null
    bodyFat: number
    bodyFatPct: number | null
    muscleMass: number
    rightArmMuscle: number | null
    leftArmMuscle: number | null
    trunkMuscle: number | null
    rightLegMuscle: number | null
    leftLegMuscle: number | null
    rightArmFat: number | null
    leftArmFat: number | null
    trunkFat: number | null
    rightLegFat: number | null
    leftLegFat: number | null
    status: string
    notes: string | null
    createdAt: Date
    updatedAt: Date
    _count: InBodyEntryCountAggregateOutputType | null
    _avg: InBodyEntryAvgAggregateOutputType | null
    _sum: InBodyEntrySumAggregateOutputType | null
    _min: InBodyEntryMinAggregateOutputType | null
    _max: InBodyEntryMaxAggregateOutputType | null
  }

  type GetInBodyEntryGroupByPayload<T extends InBodyEntryGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<InBodyEntryGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof InBodyEntryGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], InBodyEntryGroupByOutputType[P]>
            : GetScalarType<T[P], InBodyEntryGroupByOutputType[P]>
        }
      >
    >


  export type InBodyEntrySelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    date?: boolean
    weight?: boolean
    height?: boolean
    bmi?: boolean
    bmr?: boolean
    bodyFat?: boolean
    bodyFatPct?: boolean
    muscleMass?: boolean
    rightArmMuscle?: boolean
    leftArmMuscle?: boolean
    trunkMuscle?: boolean
    rightLegMuscle?: boolean
    leftLegMuscle?: boolean
    rightArmFat?: boolean
    leftArmFat?: boolean
    trunkFat?: boolean
    rightLegFat?: boolean
    leftLegFat?: boolean
    status?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["inBodyEntry"]>

  export type InBodyEntrySelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    date?: boolean
    weight?: boolean
    height?: boolean
    bmi?: boolean
    bmr?: boolean
    bodyFat?: boolean
    bodyFatPct?: boolean
    muscleMass?: boolean
    rightArmMuscle?: boolean
    leftArmMuscle?: boolean
    trunkMuscle?: boolean
    rightLegMuscle?: boolean
    leftLegMuscle?: boolean
    rightArmFat?: boolean
    leftArmFat?: boolean
    trunkFat?: boolean
    rightLegFat?: boolean
    leftLegFat?: boolean
    status?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["inBodyEntry"]>

  export type InBodyEntrySelectScalar = {
    id?: boolean
    userId?: boolean
    date?: boolean
    weight?: boolean
    height?: boolean
    bmi?: boolean
    bmr?: boolean
    bodyFat?: boolean
    bodyFatPct?: boolean
    muscleMass?: boolean
    rightArmMuscle?: boolean
    leftArmMuscle?: boolean
    trunkMuscle?: boolean
    rightLegMuscle?: boolean
    leftLegMuscle?: boolean
    rightArmFat?: boolean
    leftArmFat?: boolean
    trunkFat?: boolean
    rightLegFat?: boolean
    leftLegFat?: boolean
    status?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $InBodyEntryPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "InBodyEntry"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      date: Date
      weight: number
      height: number | null
      bmi: number | null
      bmr: number | null
      bodyFat: number
      bodyFatPct: number | null
      muscleMass: number
      rightArmMuscle: number | null
      leftArmMuscle: number | null
      trunkMuscle: number | null
      rightLegMuscle: number | null
      leftLegMuscle: number | null
      rightArmFat: number | null
      leftArmFat: number | null
      trunkFat: number | null
      rightLegFat: number | null
      leftLegFat: number | null
      status: string
      notes: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["inBodyEntry"]>
    composites: {}
  }

  type InBodyEntryGetPayload<S extends boolean | null | undefined | InBodyEntryDefaultArgs> = $Result.GetResult<Prisma.$InBodyEntryPayload, S>

  type InBodyEntryCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<InBodyEntryFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: InBodyEntryCountAggregateInputType | true
    }

  export interface InBodyEntryDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['InBodyEntry'], meta: { name: 'InBodyEntry' } }
    /**
     * Find zero or one InBodyEntry that matches the filter.
     * @param {InBodyEntryFindUniqueArgs} args - Arguments to find a InBodyEntry
     * @example
     * // Get one InBodyEntry
     * const inBodyEntry = await prisma.inBodyEntry.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends InBodyEntryFindUniqueArgs>(args: SelectSubset<T, InBodyEntryFindUniqueArgs<ExtArgs>>): Prisma__InBodyEntryClient<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one InBodyEntry that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {InBodyEntryFindUniqueOrThrowArgs} args - Arguments to find a InBodyEntry
     * @example
     * // Get one InBodyEntry
     * const inBodyEntry = await prisma.inBodyEntry.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends InBodyEntryFindUniqueOrThrowArgs>(args: SelectSubset<T, InBodyEntryFindUniqueOrThrowArgs<ExtArgs>>): Prisma__InBodyEntryClient<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first InBodyEntry that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {InBodyEntryFindFirstArgs} args - Arguments to find a InBodyEntry
     * @example
     * // Get one InBodyEntry
     * const inBodyEntry = await prisma.inBodyEntry.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends InBodyEntryFindFirstArgs>(args?: SelectSubset<T, InBodyEntryFindFirstArgs<ExtArgs>>): Prisma__InBodyEntryClient<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first InBodyEntry that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {InBodyEntryFindFirstOrThrowArgs} args - Arguments to find a InBodyEntry
     * @example
     * // Get one InBodyEntry
     * const inBodyEntry = await prisma.inBodyEntry.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends InBodyEntryFindFirstOrThrowArgs>(args?: SelectSubset<T, InBodyEntryFindFirstOrThrowArgs<ExtArgs>>): Prisma__InBodyEntryClient<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more InBodyEntries that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {InBodyEntryFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all InBodyEntries
     * const inBodyEntries = await prisma.inBodyEntry.findMany()
     * 
     * // Get first 10 InBodyEntries
     * const inBodyEntries = await prisma.inBodyEntry.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const inBodyEntryWithIdOnly = await prisma.inBodyEntry.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends InBodyEntryFindManyArgs>(args?: SelectSubset<T, InBodyEntryFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a InBodyEntry.
     * @param {InBodyEntryCreateArgs} args - Arguments to create a InBodyEntry.
     * @example
     * // Create one InBodyEntry
     * const InBodyEntry = await prisma.inBodyEntry.create({
     *   data: {
     *     // ... data to create a InBodyEntry
     *   }
     * })
     * 
     */
    create<T extends InBodyEntryCreateArgs>(args: SelectSubset<T, InBodyEntryCreateArgs<ExtArgs>>): Prisma__InBodyEntryClient<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many InBodyEntries.
     * @param {InBodyEntryCreateManyArgs} args - Arguments to create many InBodyEntries.
     * @example
     * // Create many InBodyEntries
     * const inBodyEntry = await prisma.inBodyEntry.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends InBodyEntryCreateManyArgs>(args?: SelectSubset<T, InBodyEntryCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many InBodyEntries and returns the data saved in the database.
     * @param {InBodyEntryCreateManyAndReturnArgs} args - Arguments to create many InBodyEntries.
     * @example
     * // Create many InBodyEntries
     * const inBodyEntry = await prisma.inBodyEntry.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many InBodyEntries and only return the `id`
     * const inBodyEntryWithIdOnly = await prisma.inBodyEntry.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends InBodyEntryCreateManyAndReturnArgs>(args?: SelectSubset<T, InBodyEntryCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a InBodyEntry.
     * @param {InBodyEntryDeleteArgs} args - Arguments to delete one InBodyEntry.
     * @example
     * // Delete one InBodyEntry
     * const InBodyEntry = await prisma.inBodyEntry.delete({
     *   where: {
     *     // ... filter to delete one InBodyEntry
     *   }
     * })
     * 
     */
    delete<T extends InBodyEntryDeleteArgs>(args: SelectSubset<T, InBodyEntryDeleteArgs<ExtArgs>>): Prisma__InBodyEntryClient<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one InBodyEntry.
     * @param {InBodyEntryUpdateArgs} args - Arguments to update one InBodyEntry.
     * @example
     * // Update one InBodyEntry
     * const inBodyEntry = await prisma.inBodyEntry.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends InBodyEntryUpdateArgs>(args: SelectSubset<T, InBodyEntryUpdateArgs<ExtArgs>>): Prisma__InBodyEntryClient<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more InBodyEntries.
     * @param {InBodyEntryDeleteManyArgs} args - Arguments to filter InBodyEntries to delete.
     * @example
     * // Delete a few InBodyEntries
     * const { count } = await prisma.inBodyEntry.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends InBodyEntryDeleteManyArgs>(args?: SelectSubset<T, InBodyEntryDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more InBodyEntries.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {InBodyEntryUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many InBodyEntries
     * const inBodyEntry = await prisma.inBodyEntry.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends InBodyEntryUpdateManyArgs>(args: SelectSubset<T, InBodyEntryUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one InBodyEntry.
     * @param {InBodyEntryUpsertArgs} args - Arguments to update or create a InBodyEntry.
     * @example
     * // Update or create a InBodyEntry
     * const inBodyEntry = await prisma.inBodyEntry.upsert({
     *   create: {
     *     // ... data to create a InBodyEntry
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the InBodyEntry we want to update
     *   }
     * })
     */
    upsert<T extends InBodyEntryUpsertArgs>(args: SelectSubset<T, InBodyEntryUpsertArgs<ExtArgs>>): Prisma__InBodyEntryClient<$Result.GetResult<Prisma.$InBodyEntryPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of InBodyEntries.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {InBodyEntryCountArgs} args - Arguments to filter InBodyEntries to count.
     * @example
     * // Count the number of InBodyEntries
     * const count = await prisma.inBodyEntry.count({
     *   where: {
     *     // ... the filter for the InBodyEntries we want to count
     *   }
     * })
    **/
    count<T extends InBodyEntryCountArgs>(
      args?: Subset<T, InBodyEntryCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], InBodyEntryCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a InBodyEntry.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {InBodyEntryAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends InBodyEntryAggregateArgs>(args: Subset<T, InBodyEntryAggregateArgs>): Prisma.PrismaPromise<GetInBodyEntryAggregateType<T>>

    /**
     * Group by InBodyEntry.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {InBodyEntryGroupByArgs} args - Group by arguments.
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
      T extends InBodyEntryGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: InBodyEntryGroupByArgs['orderBy'] }
        : { orderBy?: InBodyEntryGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, InBodyEntryGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetInBodyEntryGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the InBodyEntry model
   */
  readonly fields: InBodyEntryFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for InBodyEntry.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__InBodyEntryClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the InBodyEntry model
   */ 
  interface InBodyEntryFieldRefs {
    readonly id: FieldRef<"InBodyEntry", 'String'>
    readonly userId: FieldRef<"InBodyEntry", 'String'>
    readonly date: FieldRef<"InBodyEntry", 'DateTime'>
    readonly weight: FieldRef<"InBodyEntry", 'Float'>
    readonly height: FieldRef<"InBodyEntry", 'Float'>
    readonly bmi: FieldRef<"InBodyEntry", 'Float'>
    readonly bmr: FieldRef<"InBodyEntry", 'Float'>
    readonly bodyFat: FieldRef<"InBodyEntry", 'Float'>
    readonly bodyFatPct: FieldRef<"InBodyEntry", 'Float'>
    readonly muscleMass: FieldRef<"InBodyEntry", 'Float'>
    readonly rightArmMuscle: FieldRef<"InBodyEntry", 'Float'>
    readonly leftArmMuscle: FieldRef<"InBodyEntry", 'Float'>
    readonly trunkMuscle: FieldRef<"InBodyEntry", 'Float'>
    readonly rightLegMuscle: FieldRef<"InBodyEntry", 'Float'>
    readonly leftLegMuscle: FieldRef<"InBodyEntry", 'Float'>
    readonly rightArmFat: FieldRef<"InBodyEntry", 'Float'>
    readonly leftArmFat: FieldRef<"InBodyEntry", 'Float'>
    readonly trunkFat: FieldRef<"InBodyEntry", 'Float'>
    readonly rightLegFat: FieldRef<"InBodyEntry", 'Float'>
    readonly leftLegFat: FieldRef<"InBodyEntry", 'Float'>
    readonly status: FieldRef<"InBodyEntry", 'String'>
    readonly notes: FieldRef<"InBodyEntry", 'String'>
    readonly createdAt: FieldRef<"InBodyEntry", 'DateTime'>
    readonly updatedAt: FieldRef<"InBodyEntry", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * InBodyEntry findUnique
   */
  export type InBodyEntryFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
    /**
     * Filter, which InBodyEntry to fetch.
     */
    where: InBodyEntryWhereUniqueInput
  }

  /**
   * InBodyEntry findUniqueOrThrow
   */
  export type InBodyEntryFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
    /**
     * Filter, which InBodyEntry to fetch.
     */
    where: InBodyEntryWhereUniqueInput
  }

  /**
   * InBodyEntry findFirst
   */
  export type InBodyEntryFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
    /**
     * Filter, which InBodyEntry to fetch.
     */
    where?: InBodyEntryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of InBodyEntries to fetch.
     */
    orderBy?: InBodyEntryOrderByWithRelationInput | InBodyEntryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for InBodyEntries.
     */
    cursor?: InBodyEntryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` InBodyEntries from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` InBodyEntries.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of InBodyEntries.
     */
    distinct?: InBodyEntryScalarFieldEnum | InBodyEntryScalarFieldEnum[]
  }

  /**
   * InBodyEntry findFirstOrThrow
   */
  export type InBodyEntryFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
    /**
     * Filter, which InBodyEntry to fetch.
     */
    where?: InBodyEntryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of InBodyEntries to fetch.
     */
    orderBy?: InBodyEntryOrderByWithRelationInput | InBodyEntryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for InBodyEntries.
     */
    cursor?: InBodyEntryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` InBodyEntries from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` InBodyEntries.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of InBodyEntries.
     */
    distinct?: InBodyEntryScalarFieldEnum | InBodyEntryScalarFieldEnum[]
  }

  /**
   * InBodyEntry findMany
   */
  export type InBodyEntryFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
    /**
     * Filter, which InBodyEntries to fetch.
     */
    where?: InBodyEntryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of InBodyEntries to fetch.
     */
    orderBy?: InBodyEntryOrderByWithRelationInput | InBodyEntryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing InBodyEntries.
     */
    cursor?: InBodyEntryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` InBodyEntries from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` InBodyEntries.
     */
    skip?: number
    distinct?: InBodyEntryScalarFieldEnum | InBodyEntryScalarFieldEnum[]
  }

  /**
   * InBodyEntry create
   */
  export type InBodyEntryCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
    /**
     * The data needed to create a InBodyEntry.
     */
    data: XOR<InBodyEntryCreateInput, InBodyEntryUncheckedCreateInput>
  }

  /**
   * InBodyEntry createMany
   */
  export type InBodyEntryCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many InBodyEntries.
     */
    data: InBodyEntryCreateManyInput | InBodyEntryCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * InBodyEntry createManyAndReturn
   */
  export type InBodyEntryCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many InBodyEntries.
     */
    data: InBodyEntryCreateManyInput | InBodyEntryCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * InBodyEntry update
   */
  export type InBodyEntryUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
    /**
     * The data needed to update a InBodyEntry.
     */
    data: XOR<InBodyEntryUpdateInput, InBodyEntryUncheckedUpdateInput>
    /**
     * Choose, which InBodyEntry to update.
     */
    where: InBodyEntryWhereUniqueInput
  }

  /**
   * InBodyEntry updateMany
   */
  export type InBodyEntryUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update InBodyEntries.
     */
    data: XOR<InBodyEntryUpdateManyMutationInput, InBodyEntryUncheckedUpdateManyInput>
    /**
     * Filter which InBodyEntries to update
     */
    where?: InBodyEntryWhereInput
  }

  /**
   * InBodyEntry upsert
   */
  export type InBodyEntryUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
    /**
     * The filter to search for the InBodyEntry to update in case it exists.
     */
    where: InBodyEntryWhereUniqueInput
    /**
     * In case the InBodyEntry found by the `where` argument doesn't exist, create a new InBodyEntry with this data.
     */
    create: XOR<InBodyEntryCreateInput, InBodyEntryUncheckedCreateInput>
    /**
     * In case the InBodyEntry was found with the provided `where` argument, update it with this data.
     */
    update: XOR<InBodyEntryUpdateInput, InBodyEntryUncheckedUpdateInput>
  }

  /**
   * InBodyEntry delete
   */
  export type InBodyEntryDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
    /**
     * Filter which InBodyEntry to delete.
     */
    where: InBodyEntryWhereUniqueInput
  }

  /**
   * InBodyEntry deleteMany
   */
  export type InBodyEntryDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which InBodyEntries to delete
     */
    where?: InBodyEntryWhereInput
  }

  /**
   * InBodyEntry without action
   */
  export type InBodyEntryDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the InBodyEntry
     */
    select?: InBodyEntrySelect<ExtArgs> | null
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


  export const UserProfileScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    isPT: 'isPT',
    firstName: 'firstName',
    lastName: 'lastName',
    age: 'age',
    gender: 'gender',
    heightCm: 'heightCm',
    goal: 'goal',
    activityLevel: 'activityLevel',
    experienceLevel: 'experienceLevel',
    preferredTrainingDays: 'preferredTrainingDays',
    availableEquipment: 'availableEquipment',
    injuries: 'injuries',
    currentWeight: 'currentWeight',
    targetWeight: 'targetWeight',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type UserProfileScalarFieldEnum = (typeof UserProfileScalarFieldEnum)[keyof typeof UserProfileScalarFieldEnum]


  export const PTApplicationScalarFieldEnum: {
    id: 'id',
    userProfileId: 'userProfileId',
    status: 'status',
    phoneNumber: 'phoneNumber',
    nationalIdNumber: 'nationalIdNumber',
    currentAddress: 'currentAddress',
    idCardFrontUrl: 'idCardFrontUrl',
    idCardBackUrl: 'idCardBackUrl',
    portraitPhotoUrl: 'portraitPhotoUrl',
    yearsOfExperience: 'yearsOfExperience',
    educationBackground: 'educationBackground',
    mainSpecialties: 'mainSpecialties',
    targetClientGroups: 'targetClientGroups',
    portfolioUrl: 'portfolioUrl',
    linkedinUrl: 'linkedinUrl',
    websiteUrl: 'websiteUrl',
    socialLinks: 'socialLinks',
    availabilityNotes: 'availabilityNotes',
    availableTimeSlots: 'availableTimeSlots',
    serviceMode: 'serviceMode',
    operatingAreas: 'operatingAreas',
    desiredSessionPrice: 'desiredSessionPrice',
    adminNote: 'adminNote',
    rejectionReason: 'rejectionReason',
    submittedAt: 'submittedAt',
    reviewedAt: 'reviewedAt',
    approvedAt: 'approvedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type PTApplicationScalarFieldEnum = (typeof PTApplicationScalarFieldEnum)[keyof typeof PTApplicationScalarFieldEnum]


  export const PTApplicationCertificateScalarFieldEnum: {
    id: 'id',
    applicationId: 'applicationId',
    certificateName: 'certificateName',
    issuingOrganization: 'issuingOrganization',
    isCurrentlyValid: 'isCurrentlyValid',
    expirationDate: 'expirationDate',
    certificateFileUrl: 'certificateFileUrl',
    createdAt: 'createdAt'
  };

  export type PTApplicationCertificateScalarFieldEnum = (typeof PTApplicationCertificateScalarFieldEnum)[keyof typeof PTApplicationCertificateScalarFieldEnum]


  export const PTApplicationMediaScalarFieldEnum: {
    id: 'id',
    applicationId: 'applicationId',
    groupType: 'groupType',
    fileUrl: 'fileUrl',
    label: 'label',
    createdAt: 'createdAt'
  };

  export type PTApplicationMediaScalarFieldEnum = (typeof PTApplicationMediaScalarFieldEnum)[keyof typeof PTApplicationMediaScalarFieldEnum]


  export const InBodyEntryScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    date: 'date',
    weight: 'weight',
    height: 'height',
    bmi: 'bmi',
    bmr: 'bmr',
    bodyFat: 'bodyFat',
    bodyFatPct: 'bodyFatPct',
    muscleMass: 'muscleMass',
    rightArmMuscle: 'rightArmMuscle',
    leftArmMuscle: 'leftArmMuscle',
    trunkMuscle: 'trunkMuscle',
    rightLegMuscle: 'rightLegMuscle',
    leftLegMuscle: 'leftLegMuscle',
    rightArmFat: 'rightArmFat',
    leftArmFat: 'leftArmFat',
    trunkFat: 'trunkFat',
    rightLegFat: 'rightLegFat',
    leftLegFat: 'leftLegFat',
    status: 'status',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type InBodyEntryScalarFieldEnum = (typeof InBodyEntryScalarFieldEnum)[keyof typeof InBodyEntryScalarFieldEnum]


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
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'Gender'
   */
  export type EnumGenderFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Gender'>
    


  /**
   * Reference to a field of type 'Gender[]'
   */
  export type ListEnumGenderFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Gender[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    


  /**
   * Reference to a field of type 'Goal'
   */
  export type EnumGoalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Goal'>
    


  /**
   * Reference to a field of type 'Goal[]'
   */
  export type ListEnumGoalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Goal[]'>
    


  /**
   * Reference to a field of type 'ActivityLevel'
   */
  export type EnumActivityLevelFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ActivityLevel'>
    


  /**
   * Reference to a field of type 'ActivityLevel[]'
   */
  export type ListEnumActivityLevelFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ActivityLevel[]'>
    


  /**
   * Reference to a field of type 'ExperienceLevel'
   */
  export type EnumExperienceLevelFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ExperienceLevel'>
    


  /**
   * Reference to a field of type 'ExperienceLevel[]'
   */
  export type ListEnumExperienceLevelFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ExperienceLevel[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'PTApplicationStatus'
   */
  export type EnumPTApplicationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PTApplicationStatus'>
    


  /**
   * Reference to a field of type 'PTApplicationStatus[]'
   */
  export type ListEnumPTApplicationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PTApplicationStatus[]'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'ServiceMode'
   */
  export type EnumServiceModeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ServiceMode'>
    


  /**
   * Reference to a field of type 'ServiceMode[]'
   */
  export type ListEnumServiceModeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ServiceMode[]'>
    


  /**
   * Reference to a field of type 'MediaGroupType'
   */
  export type EnumMediaGroupTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'MediaGroupType'>
    


  /**
   * Reference to a field of type 'MediaGroupType[]'
   */
  export type ListEnumMediaGroupTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'MediaGroupType[]'>
    
  /**
   * Deep Input Types
   */


  export type UserProfileWhereInput = {
    AND?: UserProfileWhereInput | UserProfileWhereInput[]
    OR?: UserProfileWhereInput[]
    NOT?: UserProfileWhereInput | UserProfileWhereInput[]
    id?: StringFilter<"UserProfile"> | string
    userId?: StringFilter<"UserProfile"> | string
    isPT?: BoolFilter<"UserProfile"> | boolean
    firstName?: StringNullableFilter<"UserProfile"> | string | null
    lastName?: StringNullableFilter<"UserProfile"> | string | null
    age?: IntNullableFilter<"UserProfile"> | number | null
    gender?: EnumGenderNullableFilter<"UserProfile"> | $Enums.Gender | null
    heightCm?: FloatNullableFilter<"UserProfile"> | number | null
    goal?: EnumGoalNullableFilter<"UserProfile"> | $Enums.Goal | null
    activityLevel?: EnumActivityLevelNullableFilter<"UserProfile"> | $Enums.ActivityLevel | null
    experienceLevel?: EnumExperienceLevelNullableFilter<"UserProfile"> | $Enums.ExperienceLevel | null
    preferredTrainingDays?: IntNullableListFilter<"UserProfile">
    availableEquipment?: StringNullableListFilter<"UserProfile">
    injuries?: StringNullableListFilter<"UserProfile">
    currentWeight?: FloatNullableFilter<"UserProfile"> | number | null
    targetWeight?: FloatNullableFilter<"UserProfile"> | number | null
    createdAt?: DateTimeFilter<"UserProfile"> | Date | string
    updatedAt?: DateTimeFilter<"UserProfile"> | Date | string
    ptApplication?: XOR<PTApplicationNullableRelationFilter, PTApplicationWhereInput> | null
  }

  export type UserProfileOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    isPT?: SortOrder
    firstName?: SortOrderInput | SortOrder
    lastName?: SortOrderInput | SortOrder
    age?: SortOrderInput | SortOrder
    gender?: SortOrderInput | SortOrder
    heightCm?: SortOrderInput | SortOrder
    goal?: SortOrderInput | SortOrder
    activityLevel?: SortOrderInput | SortOrder
    experienceLevel?: SortOrderInput | SortOrder
    preferredTrainingDays?: SortOrder
    availableEquipment?: SortOrder
    injuries?: SortOrder
    currentWeight?: SortOrderInput | SortOrder
    targetWeight?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    ptApplication?: PTApplicationOrderByWithRelationInput
  }

  export type UserProfileWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    userId?: string
    AND?: UserProfileWhereInput | UserProfileWhereInput[]
    OR?: UserProfileWhereInput[]
    NOT?: UserProfileWhereInput | UserProfileWhereInput[]
    isPT?: BoolFilter<"UserProfile"> | boolean
    firstName?: StringNullableFilter<"UserProfile"> | string | null
    lastName?: StringNullableFilter<"UserProfile"> | string | null
    age?: IntNullableFilter<"UserProfile"> | number | null
    gender?: EnumGenderNullableFilter<"UserProfile"> | $Enums.Gender | null
    heightCm?: FloatNullableFilter<"UserProfile"> | number | null
    goal?: EnumGoalNullableFilter<"UserProfile"> | $Enums.Goal | null
    activityLevel?: EnumActivityLevelNullableFilter<"UserProfile"> | $Enums.ActivityLevel | null
    experienceLevel?: EnumExperienceLevelNullableFilter<"UserProfile"> | $Enums.ExperienceLevel | null
    preferredTrainingDays?: IntNullableListFilter<"UserProfile">
    availableEquipment?: StringNullableListFilter<"UserProfile">
    injuries?: StringNullableListFilter<"UserProfile">
    currentWeight?: FloatNullableFilter<"UserProfile"> | number | null
    targetWeight?: FloatNullableFilter<"UserProfile"> | number | null
    createdAt?: DateTimeFilter<"UserProfile"> | Date | string
    updatedAt?: DateTimeFilter<"UserProfile"> | Date | string
    ptApplication?: XOR<PTApplicationNullableRelationFilter, PTApplicationWhereInput> | null
  }, "id" | "userId">

  export type UserProfileOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    isPT?: SortOrder
    firstName?: SortOrderInput | SortOrder
    lastName?: SortOrderInput | SortOrder
    age?: SortOrderInput | SortOrder
    gender?: SortOrderInput | SortOrder
    heightCm?: SortOrderInput | SortOrder
    goal?: SortOrderInput | SortOrder
    activityLevel?: SortOrderInput | SortOrder
    experienceLevel?: SortOrderInput | SortOrder
    preferredTrainingDays?: SortOrder
    availableEquipment?: SortOrder
    injuries?: SortOrder
    currentWeight?: SortOrderInput | SortOrder
    targetWeight?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: UserProfileCountOrderByAggregateInput
    _avg?: UserProfileAvgOrderByAggregateInput
    _max?: UserProfileMaxOrderByAggregateInput
    _min?: UserProfileMinOrderByAggregateInput
    _sum?: UserProfileSumOrderByAggregateInput
  }

  export type UserProfileScalarWhereWithAggregatesInput = {
    AND?: UserProfileScalarWhereWithAggregatesInput | UserProfileScalarWhereWithAggregatesInput[]
    OR?: UserProfileScalarWhereWithAggregatesInput[]
    NOT?: UserProfileScalarWhereWithAggregatesInput | UserProfileScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"UserProfile"> | string
    userId?: StringWithAggregatesFilter<"UserProfile"> | string
    isPT?: BoolWithAggregatesFilter<"UserProfile"> | boolean
    firstName?: StringNullableWithAggregatesFilter<"UserProfile"> | string | null
    lastName?: StringNullableWithAggregatesFilter<"UserProfile"> | string | null
    age?: IntNullableWithAggregatesFilter<"UserProfile"> | number | null
    gender?: EnumGenderNullableWithAggregatesFilter<"UserProfile"> | $Enums.Gender | null
    heightCm?: FloatNullableWithAggregatesFilter<"UserProfile"> | number | null
    goal?: EnumGoalNullableWithAggregatesFilter<"UserProfile"> | $Enums.Goal | null
    activityLevel?: EnumActivityLevelNullableWithAggregatesFilter<"UserProfile"> | $Enums.ActivityLevel | null
    experienceLevel?: EnumExperienceLevelNullableWithAggregatesFilter<"UserProfile"> | $Enums.ExperienceLevel | null
    preferredTrainingDays?: IntNullableListFilter<"UserProfile">
    availableEquipment?: StringNullableListFilter<"UserProfile">
    injuries?: StringNullableListFilter<"UserProfile">
    currentWeight?: FloatNullableWithAggregatesFilter<"UserProfile"> | number | null
    targetWeight?: FloatNullableWithAggregatesFilter<"UserProfile"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"UserProfile"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"UserProfile"> | Date | string
  }

  export type PTApplicationWhereInput = {
    AND?: PTApplicationWhereInput | PTApplicationWhereInput[]
    OR?: PTApplicationWhereInput[]
    NOT?: PTApplicationWhereInput | PTApplicationWhereInput[]
    id?: StringFilter<"PTApplication"> | string
    userProfileId?: StringFilter<"PTApplication"> | string
    status?: EnumPTApplicationStatusFilter<"PTApplication"> | $Enums.PTApplicationStatus
    phoneNumber?: StringNullableFilter<"PTApplication"> | string | null
    nationalIdNumber?: StringNullableFilter<"PTApplication"> | string | null
    currentAddress?: StringNullableFilter<"PTApplication"> | string | null
    idCardFrontUrl?: StringNullableFilter<"PTApplication"> | string | null
    idCardBackUrl?: StringNullableFilter<"PTApplication"> | string | null
    portraitPhotoUrl?: StringNullableFilter<"PTApplication"> | string | null
    yearsOfExperience?: StringNullableFilter<"PTApplication"> | string | null
    educationBackground?: StringNullableFilter<"PTApplication"> | string | null
    mainSpecialties?: StringNullableListFilter<"PTApplication">
    targetClientGroups?: StringNullableListFilter<"PTApplication">
    portfolioUrl?: StringNullableFilter<"PTApplication"> | string | null
    linkedinUrl?: StringNullableFilter<"PTApplication"> | string | null
    websiteUrl?: StringNullableFilter<"PTApplication"> | string | null
    socialLinks?: JsonNullableFilter<"PTApplication">
    availabilityNotes?: StringNullableFilter<"PTApplication"> | string | null
    availableTimeSlots?: JsonNullableFilter<"PTApplication">
    serviceMode?: EnumServiceModeNullableFilter<"PTApplication"> | $Enums.ServiceMode | null
    operatingAreas?: StringNullableListFilter<"PTApplication">
    desiredSessionPrice?: FloatNullableFilter<"PTApplication"> | number | null
    adminNote?: StringNullableFilter<"PTApplication"> | string | null
    rejectionReason?: StringNullableFilter<"PTApplication"> | string | null
    submittedAt?: DateTimeNullableFilter<"PTApplication"> | Date | string | null
    reviewedAt?: DateTimeNullableFilter<"PTApplication"> | Date | string | null
    approvedAt?: DateTimeNullableFilter<"PTApplication"> | Date | string | null
    createdAt?: DateTimeFilter<"PTApplication"> | Date | string
    updatedAt?: DateTimeFilter<"PTApplication"> | Date | string
    certificates?: PTApplicationCertificateListRelationFilter
    media?: PTApplicationMediaListRelationFilter
    userProfile?: XOR<UserProfileRelationFilter, UserProfileWhereInput>
  }

  export type PTApplicationOrderByWithRelationInput = {
    id?: SortOrder
    userProfileId?: SortOrder
    status?: SortOrder
    phoneNumber?: SortOrderInput | SortOrder
    nationalIdNumber?: SortOrderInput | SortOrder
    currentAddress?: SortOrderInput | SortOrder
    idCardFrontUrl?: SortOrderInput | SortOrder
    idCardBackUrl?: SortOrderInput | SortOrder
    portraitPhotoUrl?: SortOrderInput | SortOrder
    yearsOfExperience?: SortOrderInput | SortOrder
    educationBackground?: SortOrderInput | SortOrder
    mainSpecialties?: SortOrder
    targetClientGroups?: SortOrder
    portfolioUrl?: SortOrderInput | SortOrder
    linkedinUrl?: SortOrderInput | SortOrder
    websiteUrl?: SortOrderInput | SortOrder
    socialLinks?: SortOrderInput | SortOrder
    availabilityNotes?: SortOrderInput | SortOrder
    availableTimeSlots?: SortOrderInput | SortOrder
    serviceMode?: SortOrderInput | SortOrder
    operatingAreas?: SortOrder
    desiredSessionPrice?: SortOrderInput | SortOrder
    adminNote?: SortOrderInput | SortOrder
    rejectionReason?: SortOrderInput | SortOrder
    submittedAt?: SortOrderInput | SortOrder
    reviewedAt?: SortOrderInput | SortOrder
    approvedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    certificates?: PTApplicationCertificateOrderByRelationAggregateInput
    media?: PTApplicationMediaOrderByRelationAggregateInput
    userProfile?: UserProfileOrderByWithRelationInput
  }

  export type PTApplicationWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    userProfileId?: string
    AND?: PTApplicationWhereInput | PTApplicationWhereInput[]
    OR?: PTApplicationWhereInput[]
    NOT?: PTApplicationWhereInput | PTApplicationWhereInput[]
    status?: EnumPTApplicationStatusFilter<"PTApplication"> | $Enums.PTApplicationStatus
    phoneNumber?: StringNullableFilter<"PTApplication"> | string | null
    nationalIdNumber?: StringNullableFilter<"PTApplication"> | string | null
    currentAddress?: StringNullableFilter<"PTApplication"> | string | null
    idCardFrontUrl?: StringNullableFilter<"PTApplication"> | string | null
    idCardBackUrl?: StringNullableFilter<"PTApplication"> | string | null
    portraitPhotoUrl?: StringNullableFilter<"PTApplication"> | string | null
    yearsOfExperience?: StringNullableFilter<"PTApplication"> | string | null
    educationBackground?: StringNullableFilter<"PTApplication"> | string | null
    mainSpecialties?: StringNullableListFilter<"PTApplication">
    targetClientGroups?: StringNullableListFilter<"PTApplication">
    portfolioUrl?: StringNullableFilter<"PTApplication"> | string | null
    linkedinUrl?: StringNullableFilter<"PTApplication"> | string | null
    websiteUrl?: StringNullableFilter<"PTApplication"> | string | null
    socialLinks?: JsonNullableFilter<"PTApplication">
    availabilityNotes?: StringNullableFilter<"PTApplication"> | string | null
    availableTimeSlots?: JsonNullableFilter<"PTApplication">
    serviceMode?: EnumServiceModeNullableFilter<"PTApplication"> | $Enums.ServiceMode | null
    operatingAreas?: StringNullableListFilter<"PTApplication">
    desiredSessionPrice?: FloatNullableFilter<"PTApplication"> | number | null
    adminNote?: StringNullableFilter<"PTApplication"> | string | null
    rejectionReason?: StringNullableFilter<"PTApplication"> | string | null
    submittedAt?: DateTimeNullableFilter<"PTApplication"> | Date | string | null
    reviewedAt?: DateTimeNullableFilter<"PTApplication"> | Date | string | null
    approvedAt?: DateTimeNullableFilter<"PTApplication"> | Date | string | null
    createdAt?: DateTimeFilter<"PTApplication"> | Date | string
    updatedAt?: DateTimeFilter<"PTApplication"> | Date | string
    certificates?: PTApplicationCertificateListRelationFilter
    media?: PTApplicationMediaListRelationFilter
    userProfile?: XOR<UserProfileRelationFilter, UserProfileWhereInput>
  }, "id" | "userProfileId">

  export type PTApplicationOrderByWithAggregationInput = {
    id?: SortOrder
    userProfileId?: SortOrder
    status?: SortOrder
    phoneNumber?: SortOrderInput | SortOrder
    nationalIdNumber?: SortOrderInput | SortOrder
    currentAddress?: SortOrderInput | SortOrder
    idCardFrontUrl?: SortOrderInput | SortOrder
    idCardBackUrl?: SortOrderInput | SortOrder
    portraitPhotoUrl?: SortOrderInput | SortOrder
    yearsOfExperience?: SortOrderInput | SortOrder
    educationBackground?: SortOrderInput | SortOrder
    mainSpecialties?: SortOrder
    targetClientGroups?: SortOrder
    portfolioUrl?: SortOrderInput | SortOrder
    linkedinUrl?: SortOrderInput | SortOrder
    websiteUrl?: SortOrderInput | SortOrder
    socialLinks?: SortOrderInput | SortOrder
    availabilityNotes?: SortOrderInput | SortOrder
    availableTimeSlots?: SortOrderInput | SortOrder
    serviceMode?: SortOrderInput | SortOrder
    operatingAreas?: SortOrder
    desiredSessionPrice?: SortOrderInput | SortOrder
    adminNote?: SortOrderInput | SortOrder
    rejectionReason?: SortOrderInput | SortOrder
    submittedAt?: SortOrderInput | SortOrder
    reviewedAt?: SortOrderInput | SortOrder
    approvedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: PTApplicationCountOrderByAggregateInput
    _avg?: PTApplicationAvgOrderByAggregateInput
    _max?: PTApplicationMaxOrderByAggregateInput
    _min?: PTApplicationMinOrderByAggregateInput
    _sum?: PTApplicationSumOrderByAggregateInput
  }

  export type PTApplicationScalarWhereWithAggregatesInput = {
    AND?: PTApplicationScalarWhereWithAggregatesInput | PTApplicationScalarWhereWithAggregatesInput[]
    OR?: PTApplicationScalarWhereWithAggregatesInput[]
    NOT?: PTApplicationScalarWhereWithAggregatesInput | PTApplicationScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PTApplication"> | string
    userProfileId?: StringWithAggregatesFilter<"PTApplication"> | string
    status?: EnumPTApplicationStatusWithAggregatesFilter<"PTApplication"> | $Enums.PTApplicationStatus
    phoneNumber?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    nationalIdNumber?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    currentAddress?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    idCardFrontUrl?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    idCardBackUrl?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    portraitPhotoUrl?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    yearsOfExperience?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    educationBackground?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    mainSpecialties?: StringNullableListFilter<"PTApplication">
    targetClientGroups?: StringNullableListFilter<"PTApplication">
    portfolioUrl?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    linkedinUrl?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    websiteUrl?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    socialLinks?: JsonNullableWithAggregatesFilter<"PTApplication">
    availabilityNotes?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    availableTimeSlots?: JsonNullableWithAggregatesFilter<"PTApplication">
    serviceMode?: EnumServiceModeNullableWithAggregatesFilter<"PTApplication"> | $Enums.ServiceMode | null
    operatingAreas?: StringNullableListFilter<"PTApplication">
    desiredSessionPrice?: FloatNullableWithAggregatesFilter<"PTApplication"> | number | null
    adminNote?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    rejectionReason?: StringNullableWithAggregatesFilter<"PTApplication"> | string | null
    submittedAt?: DateTimeNullableWithAggregatesFilter<"PTApplication"> | Date | string | null
    reviewedAt?: DateTimeNullableWithAggregatesFilter<"PTApplication"> | Date | string | null
    approvedAt?: DateTimeNullableWithAggregatesFilter<"PTApplication"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PTApplication"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"PTApplication"> | Date | string
  }

  export type PTApplicationCertificateWhereInput = {
    AND?: PTApplicationCertificateWhereInput | PTApplicationCertificateWhereInput[]
    OR?: PTApplicationCertificateWhereInput[]
    NOT?: PTApplicationCertificateWhereInput | PTApplicationCertificateWhereInput[]
    id?: StringFilter<"PTApplicationCertificate"> | string
    applicationId?: StringFilter<"PTApplicationCertificate"> | string
    certificateName?: StringFilter<"PTApplicationCertificate"> | string
    issuingOrganization?: StringFilter<"PTApplicationCertificate"> | string
    isCurrentlyValid?: BoolFilter<"PTApplicationCertificate"> | boolean
    expirationDate?: DateTimeNullableFilter<"PTApplicationCertificate"> | Date | string | null
    certificateFileUrl?: StringNullableFilter<"PTApplicationCertificate"> | string | null
    createdAt?: DateTimeFilter<"PTApplicationCertificate"> | Date | string
    application?: XOR<PTApplicationRelationFilter, PTApplicationWhereInput>
  }

  export type PTApplicationCertificateOrderByWithRelationInput = {
    id?: SortOrder
    applicationId?: SortOrder
    certificateName?: SortOrder
    issuingOrganization?: SortOrder
    isCurrentlyValid?: SortOrder
    expirationDate?: SortOrderInput | SortOrder
    certificateFileUrl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    application?: PTApplicationOrderByWithRelationInput
  }

  export type PTApplicationCertificateWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: PTApplicationCertificateWhereInput | PTApplicationCertificateWhereInput[]
    OR?: PTApplicationCertificateWhereInput[]
    NOT?: PTApplicationCertificateWhereInput | PTApplicationCertificateWhereInput[]
    applicationId?: StringFilter<"PTApplicationCertificate"> | string
    certificateName?: StringFilter<"PTApplicationCertificate"> | string
    issuingOrganization?: StringFilter<"PTApplicationCertificate"> | string
    isCurrentlyValid?: BoolFilter<"PTApplicationCertificate"> | boolean
    expirationDate?: DateTimeNullableFilter<"PTApplicationCertificate"> | Date | string | null
    certificateFileUrl?: StringNullableFilter<"PTApplicationCertificate"> | string | null
    createdAt?: DateTimeFilter<"PTApplicationCertificate"> | Date | string
    application?: XOR<PTApplicationRelationFilter, PTApplicationWhereInput>
  }, "id">

  export type PTApplicationCertificateOrderByWithAggregationInput = {
    id?: SortOrder
    applicationId?: SortOrder
    certificateName?: SortOrder
    issuingOrganization?: SortOrder
    isCurrentlyValid?: SortOrder
    expirationDate?: SortOrderInput | SortOrder
    certificateFileUrl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: PTApplicationCertificateCountOrderByAggregateInput
    _max?: PTApplicationCertificateMaxOrderByAggregateInput
    _min?: PTApplicationCertificateMinOrderByAggregateInput
  }

  export type PTApplicationCertificateScalarWhereWithAggregatesInput = {
    AND?: PTApplicationCertificateScalarWhereWithAggregatesInput | PTApplicationCertificateScalarWhereWithAggregatesInput[]
    OR?: PTApplicationCertificateScalarWhereWithAggregatesInput[]
    NOT?: PTApplicationCertificateScalarWhereWithAggregatesInput | PTApplicationCertificateScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PTApplicationCertificate"> | string
    applicationId?: StringWithAggregatesFilter<"PTApplicationCertificate"> | string
    certificateName?: StringWithAggregatesFilter<"PTApplicationCertificate"> | string
    issuingOrganization?: StringWithAggregatesFilter<"PTApplicationCertificate"> | string
    isCurrentlyValid?: BoolWithAggregatesFilter<"PTApplicationCertificate"> | boolean
    expirationDate?: DateTimeNullableWithAggregatesFilter<"PTApplicationCertificate"> | Date | string | null
    certificateFileUrl?: StringNullableWithAggregatesFilter<"PTApplicationCertificate"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PTApplicationCertificate"> | Date | string
  }

  export type PTApplicationMediaWhereInput = {
    AND?: PTApplicationMediaWhereInput | PTApplicationMediaWhereInput[]
    OR?: PTApplicationMediaWhereInput[]
    NOT?: PTApplicationMediaWhereInput | PTApplicationMediaWhereInput[]
    id?: StringFilter<"PTApplicationMedia"> | string
    applicationId?: StringFilter<"PTApplicationMedia"> | string
    groupType?: EnumMediaGroupTypeFilter<"PTApplicationMedia"> | $Enums.MediaGroupType
    fileUrl?: StringFilter<"PTApplicationMedia"> | string
    label?: StringNullableFilter<"PTApplicationMedia"> | string | null
    createdAt?: DateTimeFilter<"PTApplicationMedia"> | Date | string
    application?: XOR<PTApplicationRelationFilter, PTApplicationWhereInput>
  }

  export type PTApplicationMediaOrderByWithRelationInput = {
    id?: SortOrder
    applicationId?: SortOrder
    groupType?: SortOrder
    fileUrl?: SortOrder
    label?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    application?: PTApplicationOrderByWithRelationInput
  }

  export type PTApplicationMediaWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: PTApplicationMediaWhereInput | PTApplicationMediaWhereInput[]
    OR?: PTApplicationMediaWhereInput[]
    NOT?: PTApplicationMediaWhereInput | PTApplicationMediaWhereInput[]
    applicationId?: StringFilter<"PTApplicationMedia"> | string
    groupType?: EnumMediaGroupTypeFilter<"PTApplicationMedia"> | $Enums.MediaGroupType
    fileUrl?: StringFilter<"PTApplicationMedia"> | string
    label?: StringNullableFilter<"PTApplicationMedia"> | string | null
    createdAt?: DateTimeFilter<"PTApplicationMedia"> | Date | string
    application?: XOR<PTApplicationRelationFilter, PTApplicationWhereInput>
  }, "id">

  export type PTApplicationMediaOrderByWithAggregationInput = {
    id?: SortOrder
    applicationId?: SortOrder
    groupType?: SortOrder
    fileUrl?: SortOrder
    label?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: PTApplicationMediaCountOrderByAggregateInput
    _max?: PTApplicationMediaMaxOrderByAggregateInput
    _min?: PTApplicationMediaMinOrderByAggregateInput
  }

  export type PTApplicationMediaScalarWhereWithAggregatesInput = {
    AND?: PTApplicationMediaScalarWhereWithAggregatesInput | PTApplicationMediaScalarWhereWithAggregatesInput[]
    OR?: PTApplicationMediaScalarWhereWithAggregatesInput[]
    NOT?: PTApplicationMediaScalarWhereWithAggregatesInput | PTApplicationMediaScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PTApplicationMedia"> | string
    applicationId?: StringWithAggregatesFilter<"PTApplicationMedia"> | string
    groupType?: EnumMediaGroupTypeWithAggregatesFilter<"PTApplicationMedia"> | $Enums.MediaGroupType
    fileUrl?: StringWithAggregatesFilter<"PTApplicationMedia"> | string
    label?: StringNullableWithAggregatesFilter<"PTApplicationMedia"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PTApplicationMedia"> | Date | string
  }

  export type InBodyEntryWhereInput = {
    AND?: InBodyEntryWhereInput | InBodyEntryWhereInput[]
    OR?: InBodyEntryWhereInput[]
    NOT?: InBodyEntryWhereInput | InBodyEntryWhereInput[]
    id?: StringFilter<"InBodyEntry"> | string
    userId?: StringFilter<"InBodyEntry"> | string
    date?: DateTimeFilter<"InBodyEntry"> | Date | string
    weight?: FloatFilter<"InBodyEntry"> | number
    height?: FloatNullableFilter<"InBodyEntry"> | number | null
    bmi?: FloatNullableFilter<"InBodyEntry"> | number | null
    bmr?: FloatNullableFilter<"InBodyEntry"> | number | null
    bodyFat?: FloatFilter<"InBodyEntry"> | number
    bodyFatPct?: FloatNullableFilter<"InBodyEntry"> | number | null
    muscleMass?: FloatFilter<"InBodyEntry"> | number
    rightArmMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    leftArmMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    trunkMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    rightLegMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    leftLegMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    rightArmFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    leftArmFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    trunkFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    rightLegFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    leftLegFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    status?: StringFilter<"InBodyEntry"> | string
    notes?: StringNullableFilter<"InBodyEntry"> | string | null
    createdAt?: DateTimeFilter<"InBodyEntry"> | Date | string
    updatedAt?: DateTimeFilter<"InBodyEntry"> | Date | string
  }

  export type InBodyEntryOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrder
    height?: SortOrderInput | SortOrder
    bmi?: SortOrderInput | SortOrder
    bmr?: SortOrderInput | SortOrder
    bodyFat?: SortOrder
    bodyFatPct?: SortOrderInput | SortOrder
    muscleMass?: SortOrder
    rightArmMuscle?: SortOrderInput | SortOrder
    leftArmMuscle?: SortOrderInput | SortOrder
    trunkMuscle?: SortOrderInput | SortOrder
    rightLegMuscle?: SortOrderInput | SortOrder
    leftLegMuscle?: SortOrderInput | SortOrder
    rightArmFat?: SortOrderInput | SortOrder
    leftArmFat?: SortOrderInput | SortOrder
    trunkFat?: SortOrderInput | SortOrder
    rightLegFat?: SortOrderInput | SortOrder
    leftLegFat?: SortOrderInput | SortOrder
    status?: SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type InBodyEntryWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: InBodyEntryWhereInput | InBodyEntryWhereInput[]
    OR?: InBodyEntryWhereInput[]
    NOT?: InBodyEntryWhereInput | InBodyEntryWhereInput[]
    userId?: StringFilter<"InBodyEntry"> | string
    date?: DateTimeFilter<"InBodyEntry"> | Date | string
    weight?: FloatFilter<"InBodyEntry"> | number
    height?: FloatNullableFilter<"InBodyEntry"> | number | null
    bmi?: FloatNullableFilter<"InBodyEntry"> | number | null
    bmr?: FloatNullableFilter<"InBodyEntry"> | number | null
    bodyFat?: FloatFilter<"InBodyEntry"> | number
    bodyFatPct?: FloatNullableFilter<"InBodyEntry"> | number | null
    muscleMass?: FloatFilter<"InBodyEntry"> | number
    rightArmMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    leftArmMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    trunkMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    rightLegMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    leftLegMuscle?: FloatNullableFilter<"InBodyEntry"> | number | null
    rightArmFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    leftArmFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    trunkFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    rightLegFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    leftLegFat?: FloatNullableFilter<"InBodyEntry"> | number | null
    status?: StringFilter<"InBodyEntry"> | string
    notes?: StringNullableFilter<"InBodyEntry"> | string | null
    createdAt?: DateTimeFilter<"InBodyEntry"> | Date | string
    updatedAt?: DateTimeFilter<"InBodyEntry"> | Date | string
  }, "id">

  export type InBodyEntryOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrder
    height?: SortOrderInput | SortOrder
    bmi?: SortOrderInput | SortOrder
    bmr?: SortOrderInput | SortOrder
    bodyFat?: SortOrder
    bodyFatPct?: SortOrderInput | SortOrder
    muscleMass?: SortOrder
    rightArmMuscle?: SortOrderInput | SortOrder
    leftArmMuscle?: SortOrderInput | SortOrder
    trunkMuscle?: SortOrderInput | SortOrder
    rightLegMuscle?: SortOrderInput | SortOrder
    leftLegMuscle?: SortOrderInput | SortOrder
    rightArmFat?: SortOrderInput | SortOrder
    leftArmFat?: SortOrderInput | SortOrder
    trunkFat?: SortOrderInput | SortOrder
    rightLegFat?: SortOrderInput | SortOrder
    leftLegFat?: SortOrderInput | SortOrder
    status?: SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: InBodyEntryCountOrderByAggregateInput
    _avg?: InBodyEntryAvgOrderByAggregateInput
    _max?: InBodyEntryMaxOrderByAggregateInput
    _min?: InBodyEntryMinOrderByAggregateInput
    _sum?: InBodyEntrySumOrderByAggregateInput
  }

  export type InBodyEntryScalarWhereWithAggregatesInput = {
    AND?: InBodyEntryScalarWhereWithAggregatesInput | InBodyEntryScalarWhereWithAggregatesInput[]
    OR?: InBodyEntryScalarWhereWithAggregatesInput[]
    NOT?: InBodyEntryScalarWhereWithAggregatesInput | InBodyEntryScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"InBodyEntry"> | string
    userId?: StringWithAggregatesFilter<"InBodyEntry"> | string
    date?: DateTimeWithAggregatesFilter<"InBodyEntry"> | Date | string
    weight?: FloatWithAggregatesFilter<"InBodyEntry"> | number
    height?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    bmi?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    bmr?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    bodyFat?: FloatWithAggregatesFilter<"InBodyEntry"> | number
    bodyFatPct?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    muscleMass?: FloatWithAggregatesFilter<"InBodyEntry"> | number
    rightArmMuscle?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    leftArmMuscle?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    trunkMuscle?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    rightLegMuscle?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    leftLegMuscle?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    rightArmFat?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    leftArmFat?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    trunkFat?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    rightLegFat?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    leftLegFat?: FloatNullableWithAggregatesFilter<"InBodyEntry"> | number | null
    status?: StringWithAggregatesFilter<"InBodyEntry"> | string
    notes?: StringNullableWithAggregatesFilter<"InBodyEntry"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"InBodyEntry"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"InBodyEntry"> | Date | string
  }

  export type UserProfileCreateInput = {
    id?: string
    userId: string
    isPT?: boolean
    firstName?: string | null
    lastName?: string | null
    age?: number | null
    gender?: $Enums.Gender | null
    heightCm?: number | null
    goal?: $Enums.Goal | null
    activityLevel?: $Enums.ActivityLevel | null
    experienceLevel?: $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileCreatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileCreateavailableEquipmentInput | string[]
    injuries?: UserProfileCreateinjuriesInput | string[]
    currentWeight?: number | null
    targetWeight?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    ptApplication?: PTApplicationCreateNestedOneWithoutUserProfileInput
  }

  export type UserProfileUncheckedCreateInput = {
    id?: string
    userId: string
    isPT?: boolean
    firstName?: string | null
    lastName?: string | null
    age?: number | null
    gender?: $Enums.Gender | null
    heightCm?: number | null
    goal?: $Enums.Goal | null
    activityLevel?: $Enums.ActivityLevel | null
    experienceLevel?: $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileCreatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileCreateavailableEquipmentInput | string[]
    injuries?: UserProfileCreateinjuriesInput | string[]
    currentWeight?: number | null
    targetWeight?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    ptApplication?: PTApplicationUncheckedCreateNestedOneWithoutUserProfileInput
  }

  export type UserProfileUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    isPT?: BoolFieldUpdateOperationsInput | boolean
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    age?: NullableIntFieldUpdateOperationsInput | number | null
    gender?: NullableEnumGenderFieldUpdateOperationsInput | $Enums.Gender | null
    heightCm?: NullableFloatFieldUpdateOperationsInput | number | null
    goal?: NullableEnumGoalFieldUpdateOperationsInput | $Enums.Goal | null
    activityLevel?: NullableEnumActivityLevelFieldUpdateOperationsInput | $Enums.ActivityLevel | null
    experienceLevel?: NullableEnumExperienceLevelFieldUpdateOperationsInput | $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileUpdatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileUpdateavailableEquipmentInput | string[]
    injuries?: UserProfileUpdateinjuriesInput | string[]
    currentWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    targetWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    ptApplication?: PTApplicationUpdateOneWithoutUserProfileNestedInput
  }

  export type UserProfileUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    isPT?: BoolFieldUpdateOperationsInput | boolean
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    age?: NullableIntFieldUpdateOperationsInput | number | null
    gender?: NullableEnumGenderFieldUpdateOperationsInput | $Enums.Gender | null
    heightCm?: NullableFloatFieldUpdateOperationsInput | number | null
    goal?: NullableEnumGoalFieldUpdateOperationsInput | $Enums.Goal | null
    activityLevel?: NullableEnumActivityLevelFieldUpdateOperationsInput | $Enums.ActivityLevel | null
    experienceLevel?: NullableEnumExperienceLevelFieldUpdateOperationsInput | $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileUpdatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileUpdateavailableEquipmentInput | string[]
    injuries?: UserProfileUpdateinjuriesInput | string[]
    currentWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    targetWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    ptApplication?: PTApplicationUncheckedUpdateOneWithoutUserProfileNestedInput
  }

  export type UserProfileCreateManyInput = {
    id?: string
    userId: string
    isPT?: boolean
    firstName?: string | null
    lastName?: string | null
    age?: number | null
    gender?: $Enums.Gender | null
    heightCm?: number | null
    goal?: $Enums.Goal | null
    activityLevel?: $Enums.ActivityLevel | null
    experienceLevel?: $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileCreatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileCreateavailableEquipmentInput | string[]
    injuries?: UserProfileCreateinjuriesInput | string[]
    currentWeight?: number | null
    targetWeight?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserProfileUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    isPT?: BoolFieldUpdateOperationsInput | boolean
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    age?: NullableIntFieldUpdateOperationsInput | number | null
    gender?: NullableEnumGenderFieldUpdateOperationsInput | $Enums.Gender | null
    heightCm?: NullableFloatFieldUpdateOperationsInput | number | null
    goal?: NullableEnumGoalFieldUpdateOperationsInput | $Enums.Goal | null
    activityLevel?: NullableEnumActivityLevelFieldUpdateOperationsInput | $Enums.ActivityLevel | null
    experienceLevel?: NullableEnumExperienceLevelFieldUpdateOperationsInput | $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileUpdatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileUpdateavailableEquipmentInput | string[]
    injuries?: UserProfileUpdateinjuriesInput | string[]
    currentWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    targetWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserProfileUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    isPT?: BoolFieldUpdateOperationsInput | boolean
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    age?: NullableIntFieldUpdateOperationsInput | number | null
    gender?: NullableEnumGenderFieldUpdateOperationsInput | $Enums.Gender | null
    heightCm?: NullableFloatFieldUpdateOperationsInput | number | null
    goal?: NullableEnumGoalFieldUpdateOperationsInput | $Enums.Goal | null
    activityLevel?: NullableEnumActivityLevelFieldUpdateOperationsInput | $Enums.ActivityLevel | null
    experienceLevel?: NullableEnumExperienceLevelFieldUpdateOperationsInput | $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileUpdatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileUpdateavailableEquipmentInput | string[]
    injuries?: UserProfileUpdateinjuriesInput | string[]
    currentWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    targetWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationCreateInput = {
    id?: string
    status?: $Enums.PTApplicationStatus
    phoneNumber?: string | null
    nationalIdNumber?: string | null
    currentAddress?: string | null
    idCardFrontUrl?: string | null
    idCardBackUrl?: string | null
    portraitPhotoUrl?: string | null
    yearsOfExperience?: string | null
    educationBackground?: string | null
    mainSpecialties?: PTApplicationCreatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationCreatetargetClientGroupsInput | string[]
    portfolioUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: $Enums.ServiceMode | null
    operatingAreas?: PTApplicationCreateoperatingAreasInput | string[]
    desiredSessionPrice?: number | null
    adminNote?: string | null
    rejectionReason?: string | null
    submittedAt?: Date | string | null
    reviewedAt?: Date | string | null
    approvedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    certificates?: PTApplicationCertificateCreateNestedManyWithoutApplicationInput
    media?: PTApplicationMediaCreateNestedManyWithoutApplicationInput
    userProfile: UserProfileCreateNestedOneWithoutPtApplicationInput
  }

  export type PTApplicationUncheckedCreateInput = {
    id?: string
    userProfileId: string
    status?: $Enums.PTApplicationStatus
    phoneNumber?: string | null
    nationalIdNumber?: string | null
    currentAddress?: string | null
    idCardFrontUrl?: string | null
    idCardBackUrl?: string | null
    portraitPhotoUrl?: string | null
    yearsOfExperience?: string | null
    educationBackground?: string | null
    mainSpecialties?: PTApplicationCreatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationCreatetargetClientGroupsInput | string[]
    portfolioUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: $Enums.ServiceMode | null
    operatingAreas?: PTApplicationCreateoperatingAreasInput | string[]
    desiredSessionPrice?: number | null
    adminNote?: string | null
    rejectionReason?: string | null
    submittedAt?: Date | string | null
    reviewedAt?: Date | string | null
    approvedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    certificates?: PTApplicationCertificateUncheckedCreateNestedManyWithoutApplicationInput
    media?: PTApplicationMediaUncheckedCreateNestedManyWithoutApplicationInput
  }

  export type PTApplicationUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    certificates?: PTApplicationCertificateUpdateManyWithoutApplicationNestedInput
    media?: PTApplicationMediaUpdateManyWithoutApplicationNestedInput
    userProfile?: UserProfileUpdateOneRequiredWithoutPtApplicationNestedInput
  }

  export type PTApplicationUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userProfileId?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    certificates?: PTApplicationCertificateUncheckedUpdateManyWithoutApplicationNestedInput
    media?: PTApplicationMediaUncheckedUpdateManyWithoutApplicationNestedInput
  }

  export type PTApplicationCreateManyInput = {
    id?: string
    userProfileId: string
    status?: $Enums.PTApplicationStatus
    phoneNumber?: string | null
    nationalIdNumber?: string | null
    currentAddress?: string | null
    idCardFrontUrl?: string | null
    idCardBackUrl?: string | null
    portraitPhotoUrl?: string | null
    yearsOfExperience?: string | null
    educationBackground?: string | null
    mainSpecialties?: PTApplicationCreatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationCreatetargetClientGroupsInput | string[]
    portfolioUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: $Enums.ServiceMode | null
    operatingAreas?: PTApplicationCreateoperatingAreasInput | string[]
    desiredSessionPrice?: number | null
    adminNote?: string | null
    rejectionReason?: string | null
    submittedAt?: Date | string | null
    reviewedAt?: Date | string | null
    approvedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PTApplicationUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userProfileId?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationCertificateCreateInput = {
    id?: string
    certificateName: string
    issuingOrganization: string
    isCurrentlyValid: boolean
    expirationDate?: Date | string | null
    certificateFileUrl?: string | null
    createdAt?: Date | string
    application: PTApplicationCreateNestedOneWithoutCertificatesInput
  }

  export type PTApplicationCertificateUncheckedCreateInput = {
    id?: string
    applicationId: string
    certificateName: string
    issuingOrganization: string
    isCurrentlyValid: boolean
    expirationDate?: Date | string | null
    certificateFileUrl?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationCertificateUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    certificateName?: StringFieldUpdateOperationsInput | string
    issuingOrganization?: StringFieldUpdateOperationsInput | string
    isCurrentlyValid?: BoolFieldUpdateOperationsInput | boolean
    expirationDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    certificateFileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    application?: PTApplicationUpdateOneRequiredWithoutCertificatesNestedInput
  }

  export type PTApplicationCertificateUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    applicationId?: StringFieldUpdateOperationsInput | string
    certificateName?: StringFieldUpdateOperationsInput | string
    issuingOrganization?: StringFieldUpdateOperationsInput | string
    isCurrentlyValid?: BoolFieldUpdateOperationsInput | boolean
    expirationDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    certificateFileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationCertificateCreateManyInput = {
    id?: string
    applicationId: string
    certificateName: string
    issuingOrganization: string
    isCurrentlyValid: boolean
    expirationDate?: Date | string | null
    certificateFileUrl?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationCertificateUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    certificateName?: StringFieldUpdateOperationsInput | string
    issuingOrganization?: StringFieldUpdateOperationsInput | string
    isCurrentlyValid?: BoolFieldUpdateOperationsInput | boolean
    expirationDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    certificateFileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationCertificateUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    applicationId?: StringFieldUpdateOperationsInput | string
    certificateName?: StringFieldUpdateOperationsInput | string
    issuingOrganization?: StringFieldUpdateOperationsInput | string
    isCurrentlyValid?: BoolFieldUpdateOperationsInput | boolean
    expirationDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    certificateFileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationMediaCreateInput = {
    id?: string
    groupType: $Enums.MediaGroupType
    fileUrl: string
    label?: string | null
    createdAt?: Date | string
    application: PTApplicationCreateNestedOneWithoutMediaInput
  }

  export type PTApplicationMediaUncheckedCreateInput = {
    id?: string
    applicationId: string
    groupType: $Enums.MediaGroupType
    fileUrl: string
    label?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationMediaUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    groupType?: EnumMediaGroupTypeFieldUpdateOperationsInput | $Enums.MediaGroupType
    fileUrl?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    application?: PTApplicationUpdateOneRequiredWithoutMediaNestedInput
  }

  export type PTApplicationMediaUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    applicationId?: StringFieldUpdateOperationsInput | string
    groupType?: EnumMediaGroupTypeFieldUpdateOperationsInput | $Enums.MediaGroupType
    fileUrl?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationMediaCreateManyInput = {
    id?: string
    applicationId: string
    groupType: $Enums.MediaGroupType
    fileUrl: string
    label?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationMediaUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    groupType?: EnumMediaGroupTypeFieldUpdateOperationsInput | $Enums.MediaGroupType
    fileUrl?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationMediaUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    applicationId?: StringFieldUpdateOperationsInput | string
    groupType?: EnumMediaGroupTypeFieldUpdateOperationsInput | $Enums.MediaGroupType
    fileUrl?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type InBodyEntryCreateInput = {
    id?: string
    userId: string
    date?: Date | string
    weight: number
    height?: number | null
    bmi?: number | null
    bmr?: number | null
    bodyFat: number
    bodyFatPct?: number | null
    muscleMass: number
    rightArmMuscle?: number | null
    leftArmMuscle?: number | null
    trunkMuscle?: number | null
    rightLegMuscle?: number | null
    leftLegMuscle?: number | null
    rightArmFat?: number | null
    leftArmFat?: number | null
    trunkFat?: number | null
    rightLegFat?: number | null
    leftLegFat?: number | null
    status?: string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type InBodyEntryUncheckedCreateInput = {
    id?: string
    userId: string
    date?: Date | string
    weight: number
    height?: number | null
    bmi?: number | null
    bmr?: number | null
    bodyFat: number
    bodyFatPct?: number | null
    muscleMass: number
    rightArmMuscle?: number | null
    leftArmMuscle?: number | null
    trunkMuscle?: number | null
    rightLegMuscle?: number | null
    leftLegMuscle?: number | null
    rightArmFat?: number | null
    leftArmFat?: number | null
    trunkFat?: number | null
    rightLegFat?: number | null
    leftLegFat?: number | null
    status?: string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type InBodyEntryUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    weight?: FloatFieldUpdateOperationsInput | number
    height?: NullableFloatFieldUpdateOperationsInput | number | null
    bmi?: NullableFloatFieldUpdateOperationsInput | number | null
    bmr?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyFat?: FloatFieldUpdateOperationsInput | number
    bodyFatPct?: NullableFloatFieldUpdateOperationsInput | number | null
    muscleMass?: FloatFieldUpdateOperationsInput | number
    rightArmMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    leftArmMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    trunkMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    rightLegMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    leftLegMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    rightArmFat?: NullableFloatFieldUpdateOperationsInput | number | null
    leftArmFat?: NullableFloatFieldUpdateOperationsInput | number | null
    trunkFat?: NullableFloatFieldUpdateOperationsInput | number | null
    rightLegFat?: NullableFloatFieldUpdateOperationsInput | number | null
    leftLegFat?: NullableFloatFieldUpdateOperationsInput | number | null
    status?: StringFieldUpdateOperationsInput | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type InBodyEntryUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    weight?: FloatFieldUpdateOperationsInput | number
    height?: NullableFloatFieldUpdateOperationsInput | number | null
    bmi?: NullableFloatFieldUpdateOperationsInput | number | null
    bmr?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyFat?: FloatFieldUpdateOperationsInput | number
    bodyFatPct?: NullableFloatFieldUpdateOperationsInput | number | null
    muscleMass?: FloatFieldUpdateOperationsInput | number
    rightArmMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    leftArmMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    trunkMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    rightLegMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    leftLegMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    rightArmFat?: NullableFloatFieldUpdateOperationsInput | number | null
    leftArmFat?: NullableFloatFieldUpdateOperationsInput | number | null
    trunkFat?: NullableFloatFieldUpdateOperationsInput | number | null
    rightLegFat?: NullableFloatFieldUpdateOperationsInput | number | null
    leftLegFat?: NullableFloatFieldUpdateOperationsInput | number | null
    status?: StringFieldUpdateOperationsInput | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type InBodyEntryCreateManyInput = {
    id?: string
    userId: string
    date?: Date | string
    weight: number
    height?: number | null
    bmi?: number | null
    bmr?: number | null
    bodyFat: number
    bodyFatPct?: number | null
    muscleMass: number
    rightArmMuscle?: number | null
    leftArmMuscle?: number | null
    trunkMuscle?: number | null
    rightLegMuscle?: number | null
    leftLegMuscle?: number | null
    rightArmFat?: number | null
    leftArmFat?: number | null
    trunkFat?: number | null
    rightLegFat?: number | null
    leftLegFat?: number | null
    status?: string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type InBodyEntryUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    weight?: FloatFieldUpdateOperationsInput | number
    height?: NullableFloatFieldUpdateOperationsInput | number | null
    bmi?: NullableFloatFieldUpdateOperationsInput | number | null
    bmr?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyFat?: FloatFieldUpdateOperationsInput | number
    bodyFatPct?: NullableFloatFieldUpdateOperationsInput | number | null
    muscleMass?: FloatFieldUpdateOperationsInput | number
    rightArmMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    leftArmMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    trunkMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    rightLegMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    leftLegMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    rightArmFat?: NullableFloatFieldUpdateOperationsInput | number | null
    leftArmFat?: NullableFloatFieldUpdateOperationsInput | number | null
    trunkFat?: NullableFloatFieldUpdateOperationsInput | number | null
    rightLegFat?: NullableFloatFieldUpdateOperationsInput | number | null
    leftLegFat?: NullableFloatFieldUpdateOperationsInput | number | null
    status?: StringFieldUpdateOperationsInput | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type InBodyEntryUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    weight?: FloatFieldUpdateOperationsInput | number
    height?: NullableFloatFieldUpdateOperationsInput | number | null
    bmi?: NullableFloatFieldUpdateOperationsInput | number | null
    bmr?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyFat?: FloatFieldUpdateOperationsInput | number
    bodyFatPct?: NullableFloatFieldUpdateOperationsInput | number | null
    muscleMass?: FloatFieldUpdateOperationsInput | number
    rightArmMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    leftArmMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    trunkMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    rightLegMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    leftLegMuscle?: NullableFloatFieldUpdateOperationsInput | number | null
    rightArmFat?: NullableFloatFieldUpdateOperationsInput | number | null
    leftArmFat?: NullableFloatFieldUpdateOperationsInput | number | null
    trunkFat?: NullableFloatFieldUpdateOperationsInput | number | null
    rightLegFat?: NullableFloatFieldUpdateOperationsInput | number | null
    leftLegFat?: NullableFloatFieldUpdateOperationsInput | number | null
    status?: StringFieldUpdateOperationsInput | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
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

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
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

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type EnumGenderNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.Gender | EnumGenderFieldRefInput<$PrismaModel> | null
    in?: $Enums.Gender[] | ListEnumGenderFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Gender[] | ListEnumGenderFieldRefInput<$PrismaModel> | null
    not?: NestedEnumGenderNullableFilter<$PrismaModel> | $Enums.Gender | null
  }

  export type FloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type EnumGoalNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.Goal | EnumGoalFieldRefInput<$PrismaModel> | null
    in?: $Enums.Goal[] | ListEnumGoalFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Goal[] | ListEnumGoalFieldRefInput<$PrismaModel> | null
    not?: NestedEnumGoalNullableFilter<$PrismaModel> | $Enums.Goal | null
  }

  export type EnumActivityLevelNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.ActivityLevel | EnumActivityLevelFieldRefInput<$PrismaModel> | null
    in?: $Enums.ActivityLevel[] | ListEnumActivityLevelFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ActivityLevel[] | ListEnumActivityLevelFieldRefInput<$PrismaModel> | null
    not?: NestedEnumActivityLevelNullableFilter<$PrismaModel> | $Enums.ActivityLevel | null
  }

  export type EnumExperienceLevelNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.ExperienceLevel | EnumExperienceLevelFieldRefInput<$PrismaModel> | null
    in?: $Enums.ExperienceLevel[] | ListEnumExperienceLevelFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ExperienceLevel[] | ListEnumExperienceLevelFieldRefInput<$PrismaModel> | null
    not?: NestedEnumExperienceLevelNullableFilter<$PrismaModel> | $Enums.ExperienceLevel | null
  }

  export type IntNullableListFilter<$PrismaModel = never> = {
    equals?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    has?: number | IntFieldRefInput<$PrismaModel> | null
    hasEvery?: number[] | ListIntFieldRefInput<$PrismaModel>
    hasSome?: number[] | ListIntFieldRefInput<$PrismaModel>
    isEmpty?: boolean
  }

  export type StringNullableListFilter<$PrismaModel = never> = {
    equals?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    has?: string | StringFieldRefInput<$PrismaModel> | null
    hasEvery?: string[] | ListStringFieldRefInput<$PrismaModel>
    hasSome?: string[] | ListStringFieldRefInput<$PrismaModel>
    isEmpty?: boolean
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

  export type PTApplicationNullableRelationFilter = {
    is?: PTApplicationWhereInput | null
    isNot?: PTApplicationWhereInput | null
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type UserProfileCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    isPT?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    age?: SortOrder
    gender?: SortOrder
    heightCm?: SortOrder
    goal?: SortOrder
    activityLevel?: SortOrder
    experienceLevel?: SortOrder
    preferredTrainingDays?: SortOrder
    availableEquipment?: SortOrder
    injuries?: SortOrder
    currentWeight?: SortOrder
    targetWeight?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserProfileAvgOrderByAggregateInput = {
    age?: SortOrder
    heightCm?: SortOrder
    preferredTrainingDays?: SortOrder
    currentWeight?: SortOrder
    targetWeight?: SortOrder
  }

  export type UserProfileMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    isPT?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    age?: SortOrder
    gender?: SortOrder
    heightCm?: SortOrder
    goal?: SortOrder
    activityLevel?: SortOrder
    experienceLevel?: SortOrder
    currentWeight?: SortOrder
    targetWeight?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserProfileMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    isPT?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    age?: SortOrder
    gender?: SortOrder
    heightCm?: SortOrder
    goal?: SortOrder
    activityLevel?: SortOrder
    experienceLevel?: SortOrder
    currentWeight?: SortOrder
    targetWeight?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserProfileSumOrderByAggregateInput = {
    age?: SortOrder
    heightCm?: SortOrder
    preferredTrainingDays?: SortOrder
    currentWeight?: SortOrder
    targetWeight?: SortOrder
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

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
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

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type EnumGenderNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Gender | EnumGenderFieldRefInput<$PrismaModel> | null
    in?: $Enums.Gender[] | ListEnumGenderFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Gender[] | ListEnumGenderFieldRefInput<$PrismaModel> | null
    not?: NestedEnumGenderNullableWithAggregatesFilter<$PrismaModel> | $Enums.Gender | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumGenderNullableFilter<$PrismaModel>
    _max?: NestedEnumGenderNullableFilter<$PrismaModel>
  }

  export type FloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type EnumGoalNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Goal | EnumGoalFieldRefInput<$PrismaModel> | null
    in?: $Enums.Goal[] | ListEnumGoalFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Goal[] | ListEnumGoalFieldRefInput<$PrismaModel> | null
    not?: NestedEnumGoalNullableWithAggregatesFilter<$PrismaModel> | $Enums.Goal | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumGoalNullableFilter<$PrismaModel>
    _max?: NestedEnumGoalNullableFilter<$PrismaModel>
  }

  export type EnumActivityLevelNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ActivityLevel | EnumActivityLevelFieldRefInput<$PrismaModel> | null
    in?: $Enums.ActivityLevel[] | ListEnumActivityLevelFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ActivityLevel[] | ListEnumActivityLevelFieldRefInput<$PrismaModel> | null
    not?: NestedEnumActivityLevelNullableWithAggregatesFilter<$PrismaModel> | $Enums.ActivityLevel | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumActivityLevelNullableFilter<$PrismaModel>
    _max?: NestedEnumActivityLevelNullableFilter<$PrismaModel>
  }

  export type EnumExperienceLevelNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ExperienceLevel | EnumExperienceLevelFieldRefInput<$PrismaModel> | null
    in?: $Enums.ExperienceLevel[] | ListEnumExperienceLevelFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ExperienceLevel[] | ListEnumExperienceLevelFieldRefInput<$PrismaModel> | null
    not?: NestedEnumExperienceLevelNullableWithAggregatesFilter<$PrismaModel> | $Enums.ExperienceLevel | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumExperienceLevelNullableFilter<$PrismaModel>
    _max?: NestedEnumExperienceLevelNullableFilter<$PrismaModel>
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

  export type EnumPTApplicationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PTApplicationStatus | EnumPTApplicationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PTApplicationStatus[] | ListEnumPTApplicationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PTApplicationStatus[] | ListEnumPTApplicationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPTApplicationStatusFilter<$PrismaModel> | $Enums.PTApplicationStatus
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

  export type EnumServiceModeNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.ServiceMode | EnumServiceModeFieldRefInput<$PrismaModel> | null
    in?: $Enums.ServiceMode[] | ListEnumServiceModeFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ServiceMode[] | ListEnumServiceModeFieldRefInput<$PrismaModel> | null
    not?: NestedEnumServiceModeNullableFilter<$PrismaModel> | $Enums.ServiceMode | null
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

  export type PTApplicationCertificateListRelationFilter = {
    every?: PTApplicationCertificateWhereInput
    some?: PTApplicationCertificateWhereInput
    none?: PTApplicationCertificateWhereInput
  }

  export type PTApplicationMediaListRelationFilter = {
    every?: PTApplicationMediaWhereInput
    some?: PTApplicationMediaWhereInput
    none?: PTApplicationMediaWhereInput
  }

  export type UserProfileRelationFilter = {
    is?: UserProfileWhereInput
    isNot?: UserProfileWhereInput
  }

  export type PTApplicationCertificateOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PTApplicationMediaOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PTApplicationCountOrderByAggregateInput = {
    id?: SortOrder
    userProfileId?: SortOrder
    status?: SortOrder
    phoneNumber?: SortOrder
    nationalIdNumber?: SortOrder
    currentAddress?: SortOrder
    idCardFrontUrl?: SortOrder
    idCardBackUrl?: SortOrder
    portraitPhotoUrl?: SortOrder
    yearsOfExperience?: SortOrder
    educationBackground?: SortOrder
    mainSpecialties?: SortOrder
    targetClientGroups?: SortOrder
    portfolioUrl?: SortOrder
    linkedinUrl?: SortOrder
    websiteUrl?: SortOrder
    socialLinks?: SortOrder
    availabilityNotes?: SortOrder
    availableTimeSlots?: SortOrder
    serviceMode?: SortOrder
    operatingAreas?: SortOrder
    desiredSessionPrice?: SortOrder
    adminNote?: SortOrder
    rejectionReason?: SortOrder
    submittedAt?: SortOrder
    reviewedAt?: SortOrder
    approvedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PTApplicationAvgOrderByAggregateInput = {
    desiredSessionPrice?: SortOrder
  }

  export type PTApplicationMaxOrderByAggregateInput = {
    id?: SortOrder
    userProfileId?: SortOrder
    status?: SortOrder
    phoneNumber?: SortOrder
    nationalIdNumber?: SortOrder
    currentAddress?: SortOrder
    idCardFrontUrl?: SortOrder
    idCardBackUrl?: SortOrder
    portraitPhotoUrl?: SortOrder
    yearsOfExperience?: SortOrder
    educationBackground?: SortOrder
    portfolioUrl?: SortOrder
    linkedinUrl?: SortOrder
    websiteUrl?: SortOrder
    availabilityNotes?: SortOrder
    serviceMode?: SortOrder
    desiredSessionPrice?: SortOrder
    adminNote?: SortOrder
    rejectionReason?: SortOrder
    submittedAt?: SortOrder
    reviewedAt?: SortOrder
    approvedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PTApplicationMinOrderByAggregateInput = {
    id?: SortOrder
    userProfileId?: SortOrder
    status?: SortOrder
    phoneNumber?: SortOrder
    nationalIdNumber?: SortOrder
    currentAddress?: SortOrder
    idCardFrontUrl?: SortOrder
    idCardBackUrl?: SortOrder
    portraitPhotoUrl?: SortOrder
    yearsOfExperience?: SortOrder
    educationBackground?: SortOrder
    portfolioUrl?: SortOrder
    linkedinUrl?: SortOrder
    websiteUrl?: SortOrder
    availabilityNotes?: SortOrder
    serviceMode?: SortOrder
    desiredSessionPrice?: SortOrder
    adminNote?: SortOrder
    rejectionReason?: SortOrder
    submittedAt?: SortOrder
    reviewedAt?: SortOrder
    approvedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PTApplicationSumOrderByAggregateInput = {
    desiredSessionPrice?: SortOrder
  }

  export type EnumPTApplicationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PTApplicationStatus | EnumPTApplicationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PTApplicationStatus[] | ListEnumPTApplicationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PTApplicationStatus[] | ListEnumPTApplicationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPTApplicationStatusWithAggregatesFilter<$PrismaModel> | $Enums.PTApplicationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPTApplicationStatusFilter<$PrismaModel>
    _max?: NestedEnumPTApplicationStatusFilter<$PrismaModel>
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

  export type EnumServiceModeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ServiceMode | EnumServiceModeFieldRefInput<$PrismaModel> | null
    in?: $Enums.ServiceMode[] | ListEnumServiceModeFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ServiceMode[] | ListEnumServiceModeFieldRefInput<$PrismaModel> | null
    not?: NestedEnumServiceModeNullableWithAggregatesFilter<$PrismaModel> | $Enums.ServiceMode | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumServiceModeNullableFilter<$PrismaModel>
    _max?: NestedEnumServiceModeNullableFilter<$PrismaModel>
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

  export type PTApplicationRelationFilter = {
    is?: PTApplicationWhereInput
    isNot?: PTApplicationWhereInput
  }

  export type PTApplicationCertificateCountOrderByAggregateInput = {
    id?: SortOrder
    applicationId?: SortOrder
    certificateName?: SortOrder
    issuingOrganization?: SortOrder
    isCurrentlyValid?: SortOrder
    expirationDate?: SortOrder
    certificateFileUrl?: SortOrder
    createdAt?: SortOrder
  }

  export type PTApplicationCertificateMaxOrderByAggregateInput = {
    id?: SortOrder
    applicationId?: SortOrder
    certificateName?: SortOrder
    issuingOrganization?: SortOrder
    isCurrentlyValid?: SortOrder
    expirationDate?: SortOrder
    certificateFileUrl?: SortOrder
    createdAt?: SortOrder
  }

  export type PTApplicationCertificateMinOrderByAggregateInput = {
    id?: SortOrder
    applicationId?: SortOrder
    certificateName?: SortOrder
    issuingOrganization?: SortOrder
    isCurrentlyValid?: SortOrder
    expirationDate?: SortOrder
    certificateFileUrl?: SortOrder
    createdAt?: SortOrder
  }

  export type EnumMediaGroupTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.MediaGroupType | EnumMediaGroupTypeFieldRefInput<$PrismaModel>
    in?: $Enums.MediaGroupType[] | ListEnumMediaGroupTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.MediaGroupType[] | ListEnumMediaGroupTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumMediaGroupTypeFilter<$PrismaModel> | $Enums.MediaGroupType
  }

  export type PTApplicationMediaCountOrderByAggregateInput = {
    id?: SortOrder
    applicationId?: SortOrder
    groupType?: SortOrder
    fileUrl?: SortOrder
    label?: SortOrder
    createdAt?: SortOrder
  }

  export type PTApplicationMediaMaxOrderByAggregateInput = {
    id?: SortOrder
    applicationId?: SortOrder
    groupType?: SortOrder
    fileUrl?: SortOrder
    label?: SortOrder
    createdAt?: SortOrder
  }

  export type PTApplicationMediaMinOrderByAggregateInput = {
    id?: SortOrder
    applicationId?: SortOrder
    groupType?: SortOrder
    fileUrl?: SortOrder
    label?: SortOrder
    createdAt?: SortOrder
  }

  export type EnumMediaGroupTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.MediaGroupType | EnumMediaGroupTypeFieldRefInput<$PrismaModel>
    in?: $Enums.MediaGroupType[] | ListEnumMediaGroupTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.MediaGroupType[] | ListEnumMediaGroupTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumMediaGroupTypeWithAggregatesFilter<$PrismaModel> | $Enums.MediaGroupType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumMediaGroupTypeFilter<$PrismaModel>
    _max?: NestedEnumMediaGroupTypeFilter<$PrismaModel>
  }

  export type FloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type InBodyEntryCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrder
    height?: SortOrder
    bmi?: SortOrder
    bmr?: SortOrder
    bodyFat?: SortOrder
    bodyFatPct?: SortOrder
    muscleMass?: SortOrder
    rightArmMuscle?: SortOrder
    leftArmMuscle?: SortOrder
    trunkMuscle?: SortOrder
    rightLegMuscle?: SortOrder
    leftLegMuscle?: SortOrder
    rightArmFat?: SortOrder
    leftArmFat?: SortOrder
    trunkFat?: SortOrder
    rightLegFat?: SortOrder
    leftLegFat?: SortOrder
    status?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type InBodyEntryAvgOrderByAggregateInput = {
    weight?: SortOrder
    height?: SortOrder
    bmi?: SortOrder
    bmr?: SortOrder
    bodyFat?: SortOrder
    bodyFatPct?: SortOrder
    muscleMass?: SortOrder
    rightArmMuscle?: SortOrder
    leftArmMuscle?: SortOrder
    trunkMuscle?: SortOrder
    rightLegMuscle?: SortOrder
    leftLegMuscle?: SortOrder
    rightArmFat?: SortOrder
    leftArmFat?: SortOrder
    trunkFat?: SortOrder
    rightLegFat?: SortOrder
    leftLegFat?: SortOrder
  }

  export type InBodyEntryMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrder
    height?: SortOrder
    bmi?: SortOrder
    bmr?: SortOrder
    bodyFat?: SortOrder
    bodyFatPct?: SortOrder
    muscleMass?: SortOrder
    rightArmMuscle?: SortOrder
    leftArmMuscle?: SortOrder
    trunkMuscle?: SortOrder
    rightLegMuscle?: SortOrder
    leftLegMuscle?: SortOrder
    rightArmFat?: SortOrder
    leftArmFat?: SortOrder
    trunkFat?: SortOrder
    rightLegFat?: SortOrder
    leftLegFat?: SortOrder
    status?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type InBodyEntryMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrder
    height?: SortOrder
    bmi?: SortOrder
    bmr?: SortOrder
    bodyFat?: SortOrder
    bodyFatPct?: SortOrder
    muscleMass?: SortOrder
    rightArmMuscle?: SortOrder
    leftArmMuscle?: SortOrder
    trunkMuscle?: SortOrder
    rightLegMuscle?: SortOrder
    leftLegMuscle?: SortOrder
    rightArmFat?: SortOrder
    leftArmFat?: SortOrder
    trunkFat?: SortOrder
    rightLegFat?: SortOrder
    leftLegFat?: SortOrder
    status?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type InBodyEntrySumOrderByAggregateInput = {
    weight?: SortOrder
    height?: SortOrder
    bmi?: SortOrder
    bmr?: SortOrder
    bodyFat?: SortOrder
    bodyFatPct?: SortOrder
    muscleMass?: SortOrder
    rightArmMuscle?: SortOrder
    leftArmMuscle?: SortOrder
    trunkMuscle?: SortOrder
    rightLegMuscle?: SortOrder
    leftLegMuscle?: SortOrder
    rightArmFat?: SortOrder
    leftArmFat?: SortOrder
    trunkFat?: SortOrder
    rightLegFat?: SortOrder
    leftLegFat?: SortOrder
  }

  export type FloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type UserProfileCreatepreferredTrainingDaysInput = {
    set: number[]
  }

  export type UserProfileCreateavailableEquipmentInput = {
    set: string[]
  }

  export type UserProfileCreateinjuriesInput = {
    set: string[]
  }

  export type PTApplicationCreateNestedOneWithoutUserProfileInput = {
    create?: XOR<PTApplicationCreateWithoutUserProfileInput, PTApplicationUncheckedCreateWithoutUserProfileInput>
    connectOrCreate?: PTApplicationCreateOrConnectWithoutUserProfileInput
    connect?: PTApplicationWhereUniqueInput
  }

  export type PTApplicationUncheckedCreateNestedOneWithoutUserProfileInput = {
    create?: XOR<PTApplicationCreateWithoutUserProfileInput, PTApplicationUncheckedCreateWithoutUserProfileInput>
    connectOrCreate?: PTApplicationCreateOrConnectWithoutUserProfileInput
    connect?: PTApplicationWhereUniqueInput
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableEnumGenderFieldUpdateOperationsInput = {
    set?: $Enums.Gender | null
  }

  export type NullableFloatFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableEnumGoalFieldUpdateOperationsInput = {
    set?: $Enums.Goal | null
  }

  export type NullableEnumActivityLevelFieldUpdateOperationsInput = {
    set?: $Enums.ActivityLevel | null
  }

  export type NullableEnumExperienceLevelFieldUpdateOperationsInput = {
    set?: $Enums.ExperienceLevel | null
  }

  export type UserProfileUpdatepreferredTrainingDaysInput = {
    set?: number[]
    push?: number | number[]
  }

  export type UserProfileUpdateavailableEquipmentInput = {
    set?: string[]
    push?: string | string[]
  }

  export type UserProfileUpdateinjuriesInput = {
    set?: string[]
    push?: string | string[]
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type PTApplicationUpdateOneWithoutUserProfileNestedInput = {
    create?: XOR<PTApplicationCreateWithoutUserProfileInput, PTApplicationUncheckedCreateWithoutUserProfileInput>
    connectOrCreate?: PTApplicationCreateOrConnectWithoutUserProfileInput
    upsert?: PTApplicationUpsertWithoutUserProfileInput
    disconnect?: PTApplicationWhereInput | boolean
    delete?: PTApplicationWhereInput | boolean
    connect?: PTApplicationWhereUniqueInput
    update?: XOR<XOR<PTApplicationUpdateToOneWithWhereWithoutUserProfileInput, PTApplicationUpdateWithoutUserProfileInput>, PTApplicationUncheckedUpdateWithoutUserProfileInput>
  }

  export type PTApplicationUncheckedUpdateOneWithoutUserProfileNestedInput = {
    create?: XOR<PTApplicationCreateWithoutUserProfileInput, PTApplicationUncheckedCreateWithoutUserProfileInput>
    connectOrCreate?: PTApplicationCreateOrConnectWithoutUserProfileInput
    upsert?: PTApplicationUpsertWithoutUserProfileInput
    disconnect?: PTApplicationWhereInput | boolean
    delete?: PTApplicationWhereInput | boolean
    connect?: PTApplicationWhereUniqueInput
    update?: XOR<XOR<PTApplicationUpdateToOneWithWhereWithoutUserProfileInput, PTApplicationUpdateWithoutUserProfileInput>, PTApplicationUncheckedUpdateWithoutUserProfileInput>
  }

  export type PTApplicationCreatemainSpecialtiesInput = {
    set: string[]
  }

  export type PTApplicationCreatetargetClientGroupsInput = {
    set: string[]
  }

  export type PTApplicationCreateoperatingAreasInput = {
    set: string[]
  }

  export type PTApplicationCertificateCreateNestedManyWithoutApplicationInput = {
    create?: XOR<PTApplicationCertificateCreateWithoutApplicationInput, PTApplicationCertificateUncheckedCreateWithoutApplicationInput> | PTApplicationCertificateCreateWithoutApplicationInput[] | PTApplicationCertificateUncheckedCreateWithoutApplicationInput[]
    connectOrCreate?: PTApplicationCertificateCreateOrConnectWithoutApplicationInput | PTApplicationCertificateCreateOrConnectWithoutApplicationInput[]
    createMany?: PTApplicationCertificateCreateManyApplicationInputEnvelope
    connect?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
  }

  export type PTApplicationMediaCreateNestedManyWithoutApplicationInput = {
    create?: XOR<PTApplicationMediaCreateWithoutApplicationInput, PTApplicationMediaUncheckedCreateWithoutApplicationInput> | PTApplicationMediaCreateWithoutApplicationInput[] | PTApplicationMediaUncheckedCreateWithoutApplicationInput[]
    connectOrCreate?: PTApplicationMediaCreateOrConnectWithoutApplicationInput | PTApplicationMediaCreateOrConnectWithoutApplicationInput[]
    createMany?: PTApplicationMediaCreateManyApplicationInputEnvelope
    connect?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
  }

  export type UserProfileCreateNestedOneWithoutPtApplicationInput = {
    create?: XOR<UserProfileCreateWithoutPtApplicationInput, UserProfileUncheckedCreateWithoutPtApplicationInput>
    connectOrCreate?: UserProfileCreateOrConnectWithoutPtApplicationInput
    connect?: UserProfileWhereUniqueInput
  }

  export type PTApplicationCertificateUncheckedCreateNestedManyWithoutApplicationInput = {
    create?: XOR<PTApplicationCertificateCreateWithoutApplicationInput, PTApplicationCertificateUncheckedCreateWithoutApplicationInput> | PTApplicationCertificateCreateWithoutApplicationInput[] | PTApplicationCertificateUncheckedCreateWithoutApplicationInput[]
    connectOrCreate?: PTApplicationCertificateCreateOrConnectWithoutApplicationInput | PTApplicationCertificateCreateOrConnectWithoutApplicationInput[]
    createMany?: PTApplicationCertificateCreateManyApplicationInputEnvelope
    connect?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
  }

  export type PTApplicationMediaUncheckedCreateNestedManyWithoutApplicationInput = {
    create?: XOR<PTApplicationMediaCreateWithoutApplicationInput, PTApplicationMediaUncheckedCreateWithoutApplicationInput> | PTApplicationMediaCreateWithoutApplicationInput[] | PTApplicationMediaUncheckedCreateWithoutApplicationInput[]
    connectOrCreate?: PTApplicationMediaCreateOrConnectWithoutApplicationInput | PTApplicationMediaCreateOrConnectWithoutApplicationInput[]
    createMany?: PTApplicationMediaCreateManyApplicationInputEnvelope
    connect?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
  }

  export type EnumPTApplicationStatusFieldUpdateOperationsInput = {
    set?: $Enums.PTApplicationStatus
  }

  export type PTApplicationUpdatemainSpecialtiesInput = {
    set?: string[]
    push?: string | string[]
  }

  export type PTApplicationUpdatetargetClientGroupsInput = {
    set?: string[]
    push?: string | string[]
  }

  export type NullableEnumServiceModeFieldUpdateOperationsInput = {
    set?: $Enums.ServiceMode | null
  }

  export type PTApplicationUpdateoperatingAreasInput = {
    set?: string[]
    push?: string | string[]
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type PTApplicationCertificateUpdateManyWithoutApplicationNestedInput = {
    create?: XOR<PTApplicationCertificateCreateWithoutApplicationInput, PTApplicationCertificateUncheckedCreateWithoutApplicationInput> | PTApplicationCertificateCreateWithoutApplicationInput[] | PTApplicationCertificateUncheckedCreateWithoutApplicationInput[]
    connectOrCreate?: PTApplicationCertificateCreateOrConnectWithoutApplicationInput | PTApplicationCertificateCreateOrConnectWithoutApplicationInput[]
    upsert?: PTApplicationCertificateUpsertWithWhereUniqueWithoutApplicationInput | PTApplicationCertificateUpsertWithWhereUniqueWithoutApplicationInput[]
    createMany?: PTApplicationCertificateCreateManyApplicationInputEnvelope
    set?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
    disconnect?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
    delete?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
    connect?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
    update?: PTApplicationCertificateUpdateWithWhereUniqueWithoutApplicationInput | PTApplicationCertificateUpdateWithWhereUniqueWithoutApplicationInput[]
    updateMany?: PTApplicationCertificateUpdateManyWithWhereWithoutApplicationInput | PTApplicationCertificateUpdateManyWithWhereWithoutApplicationInput[]
    deleteMany?: PTApplicationCertificateScalarWhereInput | PTApplicationCertificateScalarWhereInput[]
  }

  export type PTApplicationMediaUpdateManyWithoutApplicationNestedInput = {
    create?: XOR<PTApplicationMediaCreateWithoutApplicationInput, PTApplicationMediaUncheckedCreateWithoutApplicationInput> | PTApplicationMediaCreateWithoutApplicationInput[] | PTApplicationMediaUncheckedCreateWithoutApplicationInput[]
    connectOrCreate?: PTApplicationMediaCreateOrConnectWithoutApplicationInput | PTApplicationMediaCreateOrConnectWithoutApplicationInput[]
    upsert?: PTApplicationMediaUpsertWithWhereUniqueWithoutApplicationInput | PTApplicationMediaUpsertWithWhereUniqueWithoutApplicationInput[]
    createMany?: PTApplicationMediaCreateManyApplicationInputEnvelope
    set?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
    disconnect?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
    delete?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
    connect?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
    update?: PTApplicationMediaUpdateWithWhereUniqueWithoutApplicationInput | PTApplicationMediaUpdateWithWhereUniqueWithoutApplicationInput[]
    updateMany?: PTApplicationMediaUpdateManyWithWhereWithoutApplicationInput | PTApplicationMediaUpdateManyWithWhereWithoutApplicationInput[]
    deleteMany?: PTApplicationMediaScalarWhereInput | PTApplicationMediaScalarWhereInput[]
  }

  export type UserProfileUpdateOneRequiredWithoutPtApplicationNestedInput = {
    create?: XOR<UserProfileCreateWithoutPtApplicationInput, UserProfileUncheckedCreateWithoutPtApplicationInput>
    connectOrCreate?: UserProfileCreateOrConnectWithoutPtApplicationInput
    upsert?: UserProfileUpsertWithoutPtApplicationInput
    connect?: UserProfileWhereUniqueInput
    update?: XOR<XOR<UserProfileUpdateToOneWithWhereWithoutPtApplicationInput, UserProfileUpdateWithoutPtApplicationInput>, UserProfileUncheckedUpdateWithoutPtApplicationInput>
  }

  export type PTApplicationCertificateUncheckedUpdateManyWithoutApplicationNestedInput = {
    create?: XOR<PTApplicationCertificateCreateWithoutApplicationInput, PTApplicationCertificateUncheckedCreateWithoutApplicationInput> | PTApplicationCertificateCreateWithoutApplicationInput[] | PTApplicationCertificateUncheckedCreateWithoutApplicationInput[]
    connectOrCreate?: PTApplicationCertificateCreateOrConnectWithoutApplicationInput | PTApplicationCertificateCreateOrConnectWithoutApplicationInput[]
    upsert?: PTApplicationCertificateUpsertWithWhereUniqueWithoutApplicationInput | PTApplicationCertificateUpsertWithWhereUniqueWithoutApplicationInput[]
    createMany?: PTApplicationCertificateCreateManyApplicationInputEnvelope
    set?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
    disconnect?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
    delete?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
    connect?: PTApplicationCertificateWhereUniqueInput | PTApplicationCertificateWhereUniqueInput[]
    update?: PTApplicationCertificateUpdateWithWhereUniqueWithoutApplicationInput | PTApplicationCertificateUpdateWithWhereUniqueWithoutApplicationInput[]
    updateMany?: PTApplicationCertificateUpdateManyWithWhereWithoutApplicationInput | PTApplicationCertificateUpdateManyWithWhereWithoutApplicationInput[]
    deleteMany?: PTApplicationCertificateScalarWhereInput | PTApplicationCertificateScalarWhereInput[]
  }

  export type PTApplicationMediaUncheckedUpdateManyWithoutApplicationNestedInput = {
    create?: XOR<PTApplicationMediaCreateWithoutApplicationInput, PTApplicationMediaUncheckedCreateWithoutApplicationInput> | PTApplicationMediaCreateWithoutApplicationInput[] | PTApplicationMediaUncheckedCreateWithoutApplicationInput[]
    connectOrCreate?: PTApplicationMediaCreateOrConnectWithoutApplicationInput | PTApplicationMediaCreateOrConnectWithoutApplicationInput[]
    upsert?: PTApplicationMediaUpsertWithWhereUniqueWithoutApplicationInput | PTApplicationMediaUpsertWithWhereUniqueWithoutApplicationInput[]
    createMany?: PTApplicationMediaCreateManyApplicationInputEnvelope
    set?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
    disconnect?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
    delete?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
    connect?: PTApplicationMediaWhereUniqueInput | PTApplicationMediaWhereUniqueInput[]
    update?: PTApplicationMediaUpdateWithWhereUniqueWithoutApplicationInput | PTApplicationMediaUpdateWithWhereUniqueWithoutApplicationInput[]
    updateMany?: PTApplicationMediaUpdateManyWithWhereWithoutApplicationInput | PTApplicationMediaUpdateManyWithWhereWithoutApplicationInput[]
    deleteMany?: PTApplicationMediaScalarWhereInput | PTApplicationMediaScalarWhereInput[]
  }

  export type PTApplicationCreateNestedOneWithoutCertificatesInput = {
    create?: XOR<PTApplicationCreateWithoutCertificatesInput, PTApplicationUncheckedCreateWithoutCertificatesInput>
    connectOrCreate?: PTApplicationCreateOrConnectWithoutCertificatesInput
    connect?: PTApplicationWhereUniqueInput
  }

  export type PTApplicationUpdateOneRequiredWithoutCertificatesNestedInput = {
    create?: XOR<PTApplicationCreateWithoutCertificatesInput, PTApplicationUncheckedCreateWithoutCertificatesInput>
    connectOrCreate?: PTApplicationCreateOrConnectWithoutCertificatesInput
    upsert?: PTApplicationUpsertWithoutCertificatesInput
    connect?: PTApplicationWhereUniqueInput
    update?: XOR<XOR<PTApplicationUpdateToOneWithWhereWithoutCertificatesInput, PTApplicationUpdateWithoutCertificatesInput>, PTApplicationUncheckedUpdateWithoutCertificatesInput>
  }

  export type PTApplicationCreateNestedOneWithoutMediaInput = {
    create?: XOR<PTApplicationCreateWithoutMediaInput, PTApplicationUncheckedCreateWithoutMediaInput>
    connectOrCreate?: PTApplicationCreateOrConnectWithoutMediaInput
    connect?: PTApplicationWhereUniqueInput
  }

  export type EnumMediaGroupTypeFieldUpdateOperationsInput = {
    set?: $Enums.MediaGroupType
  }

  export type PTApplicationUpdateOneRequiredWithoutMediaNestedInput = {
    create?: XOR<PTApplicationCreateWithoutMediaInput, PTApplicationUncheckedCreateWithoutMediaInput>
    connectOrCreate?: PTApplicationCreateOrConnectWithoutMediaInput
    upsert?: PTApplicationUpsertWithoutMediaInput
    connect?: PTApplicationWhereUniqueInput
    update?: XOR<XOR<PTApplicationUpdateToOneWithWhereWithoutMediaInput, PTApplicationUpdateWithoutMediaInput>, PTApplicationUncheckedUpdateWithoutMediaInput>
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
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

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
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

  export type NestedEnumGenderNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.Gender | EnumGenderFieldRefInput<$PrismaModel> | null
    in?: $Enums.Gender[] | ListEnumGenderFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Gender[] | ListEnumGenderFieldRefInput<$PrismaModel> | null
    not?: NestedEnumGenderNullableFilter<$PrismaModel> | $Enums.Gender | null
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedEnumGoalNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.Goal | EnumGoalFieldRefInput<$PrismaModel> | null
    in?: $Enums.Goal[] | ListEnumGoalFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Goal[] | ListEnumGoalFieldRefInput<$PrismaModel> | null
    not?: NestedEnumGoalNullableFilter<$PrismaModel> | $Enums.Goal | null
  }

  export type NestedEnumActivityLevelNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.ActivityLevel | EnumActivityLevelFieldRefInput<$PrismaModel> | null
    in?: $Enums.ActivityLevel[] | ListEnumActivityLevelFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ActivityLevel[] | ListEnumActivityLevelFieldRefInput<$PrismaModel> | null
    not?: NestedEnumActivityLevelNullableFilter<$PrismaModel> | $Enums.ActivityLevel | null
  }

  export type NestedEnumExperienceLevelNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.ExperienceLevel | EnumExperienceLevelFieldRefInput<$PrismaModel> | null
    in?: $Enums.ExperienceLevel[] | ListEnumExperienceLevelFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ExperienceLevel[] | ListEnumExperienceLevelFieldRefInput<$PrismaModel> | null
    not?: NestedEnumExperienceLevelNullableFilter<$PrismaModel> | $Enums.ExperienceLevel | null
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

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
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

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type NestedEnumGenderNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Gender | EnumGenderFieldRefInput<$PrismaModel> | null
    in?: $Enums.Gender[] | ListEnumGenderFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Gender[] | ListEnumGenderFieldRefInput<$PrismaModel> | null
    not?: NestedEnumGenderNullableWithAggregatesFilter<$PrismaModel> | $Enums.Gender | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumGenderNullableFilter<$PrismaModel>
    _max?: NestedEnumGenderNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type NestedEnumGoalNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Goal | EnumGoalFieldRefInput<$PrismaModel> | null
    in?: $Enums.Goal[] | ListEnumGoalFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Goal[] | ListEnumGoalFieldRefInput<$PrismaModel> | null
    not?: NestedEnumGoalNullableWithAggregatesFilter<$PrismaModel> | $Enums.Goal | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumGoalNullableFilter<$PrismaModel>
    _max?: NestedEnumGoalNullableFilter<$PrismaModel>
  }

  export type NestedEnumActivityLevelNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ActivityLevel | EnumActivityLevelFieldRefInput<$PrismaModel> | null
    in?: $Enums.ActivityLevel[] | ListEnumActivityLevelFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ActivityLevel[] | ListEnumActivityLevelFieldRefInput<$PrismaModel> | null
    not?: NestedEnumActivityLevelNullableWithAggregatesFilter<$PrismaModel> | $Enums.ActivityLevel | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumActivityLevelNullableFilter<$PrismaModel>
    _max?: NestedEnumActivityLevelNullableFilter<$PrismaModel>
  }

  export type NestedEnumExperienceLevelNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ExperienceLevel | EnumExperienceLevelFieldRefInput<$PrismaModel> | null
    in?: $Enums.ExperienceLevel[] | ListEnumExperienceLevelFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ExperienceLevel[] | ListEnumExperienceLevelFieldRefInput<$PrismaModel> | null
    not?: NestedEnumExperienceLevelNullableWithAggregatesFilter<$PrismaModel> | $Enums.ExperienceLevel | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumExperienceLevelNullableFilter<$PrismaModel>
    _max?: NestedEnumExperienceLevelNullableFilter<$PrismaModel>
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

  export type NestedEnumPTApplicationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PTApplicationStatus | EnumPTApplicationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PTApplicationStatus[] | ListEnumPTApplicationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PTApplicationStatus[] | ListEnumPTApplicationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPTApplicationStatusFilter<$PrismaModel> | $Enums.PTApplicationStatus
  }

  export type NestedEnumServiceModeNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.ServiceMode | EnumServiceModeFieldRefInput<$PrismaModel> | null
    in?: $Enums.ServiceMode[] | ListEnumServiceModeFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ServiceMode[] | ListEnumServiceModeFieldRefInput<$PrismaModel> | null
    not?: NestedEnumServiceModeNullableFilter<$PrismaModel> | $Enums.ServiceMode | null
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

  export type NestedEnumPTApplicationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PTApplicationStatus | EnumPTApplicationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PTApplicationStatus[] | ListEnumPTApplicationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PTApplicationStatus[] | ListEnumPTApplicationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPTApplicationStatusWithAggregatesFilter<$PrismaModel> | $Enums.PTApplicationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPTApplicationStatusFilter<$PrismaModel>
    _max?: NestedEnumPTApplicationStatusFilter<$PrismaModel>
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

  export type NestedEnumServiceModeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ServiceMode | EnumServiceModeFieldRefInput<$PrismaModel> | null
    in?: $Enums.ServiceMode[] | ListEnumServiceModeFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.ServiceMode[] | ListEnumServiceModeFieldRefInput<$PrismaModel> | null
    not?: NestedEnumServiceModeNullableWithAggregatesFilter<$PrismaModel> | $Enums.ServiceMode | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumServiceModeNullableFilter<$PrismaModel>
    _max?: NestedEnumServiceModeNullableFilter<$PrismaModel>
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

  export type NestedEnumMediaGroupTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.MediaGroupType | EnumMediaGroupTypeFieldRefInput<$PrismaModel>
    in?: $Enums.MediaGroupType[] | ListEnumMediaGroupTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.MediaGroupType[] | ListEnumMediaGroupTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumMediaGroupTypeFilter<$PrismaModel> | $Enums.MediaGroupType
  }

  export type NestedEnumMediaGroupTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.MediaGroupType | EnumMediaGroupTypeFieldRefInput<$PrismaModel>
    in?: $Enums.MediaGroupType[] | ListEnumMediaGroupTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.MediaGroupType[] | ListEnumMediaGroupTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumMediaGroupTypeWithAggregatesFilter<$PrismaModel> | $Enums.MediaGroupType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumMediaGroupTypeFilter<$PrismaModel>
    _max?: NestedEnumMediaGroupTypeFilter<$PrismaModel>
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

  export type NestedFloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type PTApplicationCreateWithoutUserProfileInput = {
    id?: string
    status?: $Enums.PTApplicationStatus
    phoneNumber?: string | null
    nationalIdNumber?: string | null
    currentAddress?: string | null
    idCardFrontUrl?: string | null
    idCardBackUrl?: string | null
    portraitPhotoUrl?: string | null
    yearsOfExperience?: string | null
    educationBackground?: string | null
    mainSpecialties?: PTApplicationCreatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationCreatetargetClientGroupsInput | string[]
    portfolioUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: $Enums.ServiceMode | null
    operatingAreas?: PTApplicationCreateoperatingAreasInput | string[]
    desiredSessionPrice?: number | null
    adminNote?: string | null
    rejectionReason?: string | null
    submittedAt?: Date | string | null
    reviewedAt?: Date | string | null
    approvedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    certificates?: PTApplicationCertificateCreateNestedManyWithoutApplicationInput
    media?: PTApplicationMediaCreateNestedManyWithoutApplicationInput
  }

  export type PTApplicationUncheckedCreateWithoutUserProfileInput = {
    id?: string
    status?: $Enums.PTApplicationStatus
    phoneNumber?: string | null
    nationalIdNumber?: string | null
    currentAddress?: string | null
    idCardFrontUrl?: string | null
    idCardBackUrl?: string | null
    portraitPhotoUrl?: string | null
    yearsOfExperience?: string | null
    educationBackground?: string | null
    mainSpecialties?: PTApplicationCreatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationCreatetargetClientGroupsInput | string[]
    portfolioUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: $Enums.ServiceMode | null
    operatingAreas?: PTApplicationCreateoperatingAreasInput | string[]
    desiredSessionPrice?: number | null
    adminNote?: string | null
    rejectionReason?: string | null
    submittedAt?: Date | string | null
    reviewedAt?: Date | string | null
    approvedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    certificates?: PTApplicationCertificateUncheckedCreateNestedManyWithoutApplicationInput
    media?: PTApplicationMediaUncheckedCreateNestedManyWithoutApplicationInput
  }

  export type PTApplicationCreateOrConnectWithoutUserProfileInput = {
    where: PTApplicationWhereUniqueInput
    create: XOR<PTApplicationCreateWithoutUserProfileInput, PTApplicationUncheckedCreateWithoutUserProfileInput>
  }

  export type PTApplicationUpsertWithoutUserProfileInput = {
    update: XOR<PTApplicationUpdateWithoutUserProfileInput, PTApplicationUncheckedUpdateWithoutUserProfileInput>
    create: XOR<PTApplicationCreateWithoutUserProfileInput, PTApplicationUncheckedCreateWithoutUserProfileInput>
    where?: PTApplicationWhereInput
  }

  export type PTApplicationUpdateToOneWithWhereWithoutUserProfileInput = {
    where?: PTApplicationWhereInput
    data: XOR<PTApplicationUpdateWithoutUserProfileInput, PTApplicationUncheckedUpdateWithoutUserProfileInput>
  }

  export type PTApplicationUpdateWithoutUserProfileInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    certificates?: PTApplicationCertificateUpdateManyWithoutApplicationNestedInput
    media?: PTApplicationMediaUpdateManyWithoutApplicationNestedInput
  }

  export type PTApplicationUncheckedUpdateWithoutUserProfileInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    certificates?: PTApplicationCertificateUncheckedUpdateManyWithoutApplicationNestedInput
    media?: PTApplicationMediaUncheckedUpdateManyWithoutApplicationNestedInput
  }

  export type PTApplicationCertificateCreateWithoutApplicationInput = {
    id?: string
    certificateName: string
    issuingOrganization: string
    isCurrentlyValid: boolean
    expirationDate?: Date | string | null
    certificateFileUrl?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationCertificateUncheckedCreateWithoutApplicationInput = {
    id?: string
    certificateName: string
    issuingOrganization: string
    isCurrentlyValid: boolean
    expirationDate?: Date | string | null
    certificateFileUrl?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationCertificateCreateOrConnectWithoutApplicationInput = {
    where: PTApplicationCertificateWhereUniqueInput
    create: XOR<PTApplicationCertificateCreateWithoutApplicationInput, PTApplicationCertificateUncheckedCreateWithoutApplicationInput>
  }

  export type PTApplicationCertificateCreateManyApplicationInputEnvelope = {
    data: PTApplicationCertificateCreateManyApplicationInput | PTApplicationCertificateCreateManyApplicationInput[]
    skipDuplicates?: boolean
  }

  export type PTApplicationMediaCreateWithoutApplicationInput = {
    id?: string
    groupType: $Enums.MediaGroupType
    fileUrl: string
    label?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationMediaUncheckedCreateWithoutApplicationInput = {
    id?: string
    groupType: $Enums.MediaGroupType
    fileUrl: string
    label?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationMediaCreateOrConnectWithoutApplicationInput = {
    where: PTApplicationMediaWhereUniqueInput
    create: XOR<PTApplicationMediaCreateWithoutApplicationInput, PTApplicationMediaUncheckedCreateWithoutApplicationInput>
  }

  export type PTApplicationMediaCreateManyApplicationInputEnvelope = {
    data: PTApplicationMediaCreateManyApplicationInput | PTApplicationMediaCreateManyApplicationInput[]
    skipDuplicates?: boolean
  }

  export type UserProfileCreateWithoutPtApplicationInput = {
    id?: string
    userId: string
    isPT?: boolean
    firstName?: string | null
    lastName?: string | null
    age?: number | null
    gender?: $Enums.Gender | null
    heightCm?: number | null
    goal?: $Enums.Goal | null
    activityLevel?: $Enums.ActivityLevel | null
    experienceLevel?: $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileCreatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileCreateavailableEquipmentInput | string[]
    injuries?: UserProfileCreateinjuriesInput | string[]
    currentWeight?: number | null
    targetWeight?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserProfileUncheckedCreateWithoutPtApplicationInput = {
    id?: string
    userId: string
    isPT?: boolean
    firstName?: string | null
    lastName?: string | null
    age?: number | null
    gender?: $Enums.Gender | null
    heightCm?: number | null
    goal?: $Enums.Goal | null
    activityLevel?: $Enums.ActivityLevel | null
    experienceLevel?: $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileCreatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileCreateavailableEquipmentInput | string[]
    injuries?: UserProfileCreateinjuriesInput | string[]
    currentWeight?: number | null
    targetWeight?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserProfileCreateOrConnectWithoutPtApplicationInput = {
    where: UserProfileWhereUniqueInput
    create: XOR<UserProfileCreateWithoutPtApplicationInput, UserProfileUncheckedCreateWithoutPtApplicationInput>
  }

  export type PTApplicationCertificateUpsertWithWhereUniqueWithoutApplicationInput = {
    where: PTApplicationCertificateWhereUniqueInput
    update: XOR<PTApplicationCertificateUpdateWithoutApplicationInput, PTApplicationCertificateUncheckedUpdateWithoutApplicationInput>
    create: XOR<PTApplicationCertificateCreateWithoutApplicationInput, PTApplicationCertificateUncheckedCreateWithoutApplicationInput>
  }

  export type PTApplicationCertificateUpdateWithWhereUniqueWithoutApplicationInput = {
    where: PTApplicationCertificateWhereUniqueInput
    data: XOR<PTApplicationCertificateUpdateWithoutApplicationInput, PTApplicationCertificateUncheckedUpdateWithoutApplicationInput>
  }

  export type PTApplicationCertificateUpdateManyWithWhereWithoutApplicationInput = {
    where: PTApplicationCertificateScalarWhereInput
    data: XOR<PTApplicationCertificateUpdateManyMutationInput, PTApplicationCertificateUncheckedUpdateManyWithoutApplicationInput>
  }

  export type PTApplicationCertificateScalarWhereInput = {
    AND?: PTApplicationCertificateScalarWhereInput | PTApplicationCertificateScalarWhereInput[]
    OR?: PTApplicationCertificateScalarWhereInput[]
    NOT?: PTApplicationCertificateScalarWhereInput | PTApplicationCertificateScalarWhereInput[]
    id?: StringFilter<"PTApplicationCertificate"> | string
    applicationId?: StringFilter<"PTApplicationCertificate"> | string
    certificateName?: StringFilter<"PTApplicationCertificate"> | string
    issuingOrganization?: StringFilter<"PTApplicationCertificate"> | string
    isCurrentlyValid?: BoolFilter<"PTApplicationCertificate"> | boolean
    expirationDate?: DateTimeNullableFilter<"PTApplicationCertificate"> | Date | string | null
    certificateFileUrl?: StringNullableFilter<"PTApplicationCertificate"> | string | null
    createdAt?: DateTimeFilter<"PTApplicationCertificate"> | Date | string
  }

  export type PTApplicationMediaUpsertWithWhereUniqueWithoutApplicationInput = {
    where: PTApplicationMediaWhereUniqueInput
    update: XOR<PTApplicationMediaUpdateWithoutApplicationInput, PTApplicationMediaUncheckedUpdateWithoutApplicationInput>
    create: XOR<PTApplicationMediaCreateWithoutApplicationInput, PTApplicationMediaUncheckedCreateWithoutApplicationInput>
  }

  export type PTApplicationMediaUpdateWithWhereUniqueWithoutApplicationInput = {
    where: PTApplicationMediaWhereUniqueInput
    data: XOR<PTApplicationMediaUpdateWithoutApplicationInput, PTApplicationMediaUncheckedUpdateWithoutApplicationInput>
  }

  export type PTApplicationMediaUpdateManyWithWhereWithoutApplicationInput = {
    where: PTApplicationMediaScalarWhereInput
    data: XOR<PTApplicationMediaUpdateManyMutationInput, PTApplicationMediaUncheckedUpdateManyWithoutApplicationInput>
  }

  export type PTApplicationMediaScalarWhereInput = {
    AND?: PTApplicationMediaScalarWhereInput | PTApplicationMediaScalarWhereInput[]
    OR?: PTApplicationMediaScalarWhereInput[]
    NOT?: PTApplicationMediaScalarWhereInput | PTApplicationMediaScalarWhereInput[]
    id?: StringFilter<"PTApplicationMedia"> | string
    applicationId?: StringFilter<"PTApplicationMedia"> | string
    groupType?: EnumMediaGroupTypeFilter<"PTApplicationMedia"> | $Enums.MediaGroupType
    fileUrl?: StringFilter<"PTApplicationMedia"> | string
    label?: StringNullableFilter<"PTApplicationMedia"> | string | null
    createdAt?: DateTimeFilter<"PTApplicationMedia"> | Date | string
  }

  export type UserProfileUpsertWithoutPtApplicationInput = {
    update: XOR<UserProfileUpdateWithoutPtApplicationInput, UserProfileUncheckedUpdateWithoutPtApplicationInput>
    create: XOR<UserProfileCreateWithoutPtApplicationInput, UserProfileUncheckedCreateWithoutPtApplicationInput>
    where?: UserProfileWhereInput
  }

  export type UserProfileUpdateToOneWithWhereWithoutPtApplicationInput = {
    where?: UserProfileWhereInput
    data: XOR<UserProfileUpdateWithoutPtApplicationInput, UserProfileUncheckedUpdateWithoutPtApplicationInput>
  }

  export type UserProfileUpdateWithoutPtApplicationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    isPT?: BoolFieldUpdateOperationsInput | boolean
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    age?: NullableIntFieldUpdateOperationsInput | number | null
    gender?: NullableEnumGenderFieldUpdateOperationsInput | $Enums.Gender | null
    heightCm?: NullableFloatFieldUpdateOperationsInput | number | null
    goal?: NullableEnumGoalFieldUpdateOperationsInput | $Enums.Goal | null
    activityLevel?: NullableEnumActivityLevelFieldUpdateOperationsInput | $Enums.ActivityLevel | null
    experienceLevel?: NullableEnumExperienceLevelFieldUpdateOperationsInput | $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileUpdatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileUpdateavailableEquipmentInput | string[]
    injuries?: UserProfileUpdateinjuriesInput | string[]
    currentWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    targetWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserProfileUncheckedUpdateWithoutPtApplicationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    isPT?: BoolFieldUpdateOperationsInput | boolean
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    age?: NullableIntFieldUpdateOperationsInput | number | null
    gender?: NullableEnumGenderFieldUpdateOperationsInput | $Enums.Gender | null
    heightCm?: NullableFloatFieldUpdateOperationsInput | number | null
    goal?: NullableEnumGoalFieldUpdateOperationsInput | $Enums.Goal | null
    activityLevel?: NullableEnumActivityLevelFieldUpdateOperationsInput | $Enums.ActivityLevel | null
    experienceLevel?: NullableEnumExperienceLevelFieldUpdateOperationsInput | $Enums.ExperienceLevel | null
    preferredTrainingDays?: UserProfileUpdatepreferredTrainingDaysInput | number[]
    availableEquipment?: UserProfileUpdateavailableEquipmentInput | string[]
    injuries?: UserProfileUpdateinjuriesInput | string[]
    currentWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    targetWeight?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationCreateWithoutCertificatesInput = {
    id?: string
    status?: $Enums.PTApplicationStatus
    phoneNumber?: string | null
    nationalIdNumber?: string | null
    currentAddress?: string | null
    idCardFrontUrl?: string | null
    idCardBackUrl?: string | null
    portraitPhotoUrl?: string | null
    yearsOfExperience?: string | null
    educationBackground?: string | null
    mainSpecialties?: PTApplicationCreatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationCreatetargetClientGroupsInput | string[]
    portfolioUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: $Enums.ServiceMode | null
    operatingAreas?: PTApplicationCreateoperatingAreasInput | string[]
    desiredSessionPrice?: number | null
    adminNote?: string | null
    rejectionReason?: string | null
    submittedAt?: Date | string | null
    reviewedAt?: Date | string | null
    approvedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    media?: PTApplicationMediaCreateNestedManyWithoutApplicationInput
    userProfile: UserProfileCreateNestedOneWithoutPtApplicationInput
  }

  export type PTApplicationUncheckedCreateWithoutCertificatesInput = {
    id?: string
    userProfileId: string
    status?: $Enums.PTApplicationStatus
    phoneNumber?: string | null
    nationalIdNumber?: string | null
    currentAddress?: string | null
    idCardFrontUrl?: string | null
    idCardBackUrl?: string | null
    portraitPhotoUrl?: string | null
    yearsOfExperience?: string | null
    educationBackground?: string | null
    mainSpecialties?: PTApplicationCreatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationCreatetargetClientGroupsInput | string[]
    portfolioUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: $Enums.ServiceMode | null
    operatingAreas?: PTApplicationCreateoperatingAreasInput | string[]
    desiredSessionPrice?: number | null
    adminNote?: string | null
    rejectionReason?: string | null
    submittedAt?: Date | string | null
    reviewedAt?: Date | string | null
    approvedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    media?: PTApplicationMediaUncheckedCreateNestedManyWithoutApplicationInput
  }

  export type PTApplicationCreateOrConnectWithoutCertificatesInput = {
    where: PTApplicationWhereUniqueInput
    create: XOR<PTApplicationCreateWithoutCertificatesInput, PTApplicationUncheckedCreateWithoutCertificatesInput>
  }

  export type PTApplicationUpsertWithoutCertificatesInput = {
    update: XOR<PTApplicationUpdateWithoutCertificatesInput, PTApplicationUncheckedUpdateWithoutCertificatesInput>
    create: XOR<PTApplicationCreateWithoutCertificatesInput, PTApplicationUncheckedCreateWithoutCertificatesInput>
    where?: PTApplicationWhereInput
  }

  export type PTApplicationUpdateToOneWithWhereWithoutCertificatesInput = {
    where?: PTApplicationWhereInput
    data: XOR<PTApplicationUpdateWithoutCertificatesInput, PTApplicationUncheckedUpdateWithoutCertificatesInput>
  }

  export type PTApplicationUpdateWithoutCertificatesInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    media?: PTApplicationMediaUpdateManyWithoutApplicationNestedInput
    userProfile?: UserProfileUpdateOneRequiredWithoutPtApplicationNestedInput
  }

  export type PTApplicationUncheckedUpdateWithoutCertificatesInput = {
    id?: StringFieldUpdateOperationsInput | string
    userProfileId?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    media?: PTApplicationMediaUncheckedUpdateManyWithoutApplicationNestedInput
  }

  export type PTApplicationCreateWithoutMediaInput = {
    id?: string
    status?: $Enums.PTApplicationStatus
    phoneNumber?: string | null
    nationalIdNumber?: string | null
    currentAddress?: string | null
    idCardFrontUrl?: string | null
    idCardBackUrl?: string | null
    portraitPhotoUrl?: string | null
    yearsOfExperience?: string | null
    educationBackground?: string | null
    mainSpecialties?: PTApplicationCreatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationCreatetargetClientGroupsInput | string[]
    portfolioUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: $Enums.ServiceMode | null
    operatingAreas?: PTApplicationCreateoperatingAreasInput | string[]
    desiredSessionPrice?: number | null
    adminNote?: string | null
    rejectionReason?: string | null
    submittedAt?: Date | string | null
    reviewedAt?: Date | string | null
    approvedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    certificates?: PTApplicationCertificateCreateNestedManyWithoutApplicationInput
    userProfile: UserProfileCreateNestedOneWithoutPtApplicationInput
  }

  export type PTApplicationUncheckedCreateWithoutMediaInput = {
    id?: string
    userProfileId: string
    status?: $Enums.PTApplicationStatus
    phoneNumber?: string | null
    nationalIdNumber?: string | null
    currentAddress?: string | null
    idCardFrontUrl?: string | null
    idCardBackUrl?: string | null
    portraitPhotoUrl?: string | null
    yearsOfExperience?: string | null
    educationBackground?: string | null
    mainSpecialties?: PTApplicationCreatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationCreatetargetClientGroupsInput | string[]
    portfolioUrl?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: $Enums.ServiceMode | null
    operatingAreas?: PTApplicationCreateoperatingAreasInput | string[]
    desiredSessionPrice?: number | null
    adminNote?: string | null
    rejectionReason?: string | null
    submittedAt?: Date | string | null
    reviewedAt?: Date | string | null
    approvedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    certificates?: PTApplicationCertificateUncheckedCreateNestedManyWithoutApplicationInput
  }

  export type PTApplicationCreateOrConnectWithoutMediaInput = {
    where: PTApplicationWhereUniqueInput
    create: XOR<PTApplicationCreateWithoutMediaInput, PTApplicationUncheckedCreateWithoutMediaInput>
  }

  export type PTApplicationUpsertWithoutMediaInput = {
    update: XOR<PTApplicationUpdateWithoutMediaInput, PTApplicationUncheckedUpdateWithoutMediaInput>
    create: XOR<PTApplicationCreateWithoutMediaInput, PTApplicationUncheckedCreateWithoutMediaInput>
    where?: PTApplicationWhereInput
  }

  export type PTApplicationUpdateToOneWithWhereWithoutMediaInput = {
    where?: PTApplicationWhereInput
    data: XOR<PTApplicationUpdateWithoutMediaInput, PTApplicationUncheckedUpdateWithoutMediaInput>
  }

  export type PTApplicationUpdateWithoutMediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    certificates?: PTApplicationCertificateUpdateManyWithoutApplicationNestedInput
    userProfile?: UserProfileUpdateOneRequiredWithoutPtApplicationNestedInput
  }

  export type PTApplicationUncheckedUpdateWithoutMediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    userProfileId?: StringFieldUpdateOperationsInput | string
    status?: EnumPTApplicationStatusFieldUpdateOperationsInput | $Enums.PTApplicationStatus
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    nationalIdNumber?: NullableStringFieldUpdateOperationsInput | string | null
    currentAddress?: NullableStringFieldUpdateOperationsInput | string | null
    idCardFrontUrl?: NullableStringFieldUpdateOperationsInput | string | null
    idCardBackUrl?: NullableStringFieldUpdateOperationsInput | string | null
    portraitPhotoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    yearsOfExperience?: NullableStringFieldUpdateOperationsInput | string | null
    educationBackground?: NullableStringFieldUpdateOperationsInput | string | null
    mainSpecialties?: PTApplicationUpdatemainSpecialtiesInput | string[]
    targetClientGroups?: PTApplicationUpdatetargetClientGroupsInput | string[]
    portfolioUrl?: NullableStringFieldUpdateOperationsInput | string | null
    linkedinUrl?: NullableStringFieldUpdateOperationsInput | string | null
    websiteUrl?: NullableStringFieldUpdateOperationsInput | string | null
    socialLinks?: NullableJsonNullValueInput | InputJsonValue
    availabilityNotes?: NullableStringFieldUpdateOperationsInput | string | null
    availableTimeSlots?: NullableJsonNullValueInput | InputJsonValue
    serviceMode?: NullableEnumServiceModeFieldUpdateOperationsInput | $Enums.ServiceMode | null
    operatingAreas?: PTApplicationUpdateoperatingAreasInput | string[]
    desiredSessionPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    adminNote?: NullableStringFieldUpdateOperationsInput | string | null
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    submittedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    approvedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    certificates?: PTApplicationCertificateUncheckedUpdateManyWithoutApplicationNestedInput
  }

  export type PTApplicationCertificateCreateManyApplicationInput = {
    id?: string
    certificateName: string
    issuingOrganization: string
    isCurrentlyValid: boolean
    expirationDate?: Date | string | null
    certificateFileUrl?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationMediaCreateManyApplicationInput = {
    id?: string
    groupType: $Enums.MediaGroupType
    fileUrl: string
    label?: string | null
    createdAt?: Date | string
  }

  export type PTApplicationCertificateUpdateWithoutApplicationInput = {
    id?: StringFieldUpdateOperationsInput | string
    certificateName?: StringFieldUpdateOperationsInput | string
    issuingOrganization?: StringFieldUpdateOperationsInput | string
    isCurrentlyValid?: BoolFieldUpdateOperationsInput | boolean
    expirationDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    certificateFileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationCertificateUncheckedUpdateWithoutApplicationInput = {
    id?: StringFieldUpdateOperationsInput | string
    certificateName?: StringFieldUpdateOperationsInput | string
    issuingOrganization?: StringFieldUpdateOperationsInput | string
    isCurrentlyValid?: BoolFieldUpdateOperationsInput | boolean
    expirationDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    certificateFileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationCertificateUncheckedUpdateManyWithoutApplicationInput = {
    id?: StringFieldUpdateOperationsInput | string
    certificateName?: StringFieldUpdateOperationsInput | string
    issuingOrganization?: StringFieldUpdateOperationsInput | string
    isCurrentlyValid?: BoolFieldUpdateOperationsInput | boolean
    expirationDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    certificateFileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationMediaUpdateWithoutApplicationInput = {
    id?: StringFieldUpdateOperationsInput | string
    groupType?: EnumMediaGroupTypeFieldUpdateOperationsInput | $Enums.MediaGroupType
    fileUrl?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationMediaUncheckedUpdateWithoutApplicationInput = {
    id?: StringFieldUpdateOperationsInput | string
    groupType?: EnumMediaGroupTypeFieldUpdateOperationsInput | $Enums.MediaGroupType
    fileUrl?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PTApplicationMediaUncheckedUpdateManyWithoutApplicationInput = {
    id?: StringFieldUpdateOperationsInput | string
    groupType?: EnumMediaGroupTypeFieldUpdateOperationsInput | $Enums.MediaGroupType
    fileUrl?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use PTApplicationCountOutputTypeDefaultArgs instead
     */
    export type PTApplicationCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PTApplicationCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use UserProfileDefaultArgs instead
     */
    export type UserProfileArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = UserProfileDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PTApplicationDefaultArgs instead
     */
    export type PTApplicationArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PTApplicationDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PTApplicationCertificateDefaultArgs instead
     */
    export type PTApplicationCertificateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PTApplicationCertificateDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PTApplicationMediaDefaultArgs instead
     */
    export type PTApplicationMediaArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PTApplicationMediaDefaultArgs<ExtArgs>
    /**
     * @deprecated Use InBodyEntryDefaultArgs instead
     */
    export type InBodyEntryArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = InBodyEntryDefaultArgs<ExtArgs>

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