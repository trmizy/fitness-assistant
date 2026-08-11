
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
 * Model Gym
 * 
 */
export type Gym = $Result.DefaultSelection<Prisma.$GymPayload>
/**
 * Model GymMembershipPlan
 * 
 */
export type GymMembershipPlan = $Result.DefaultSelection<Prisma.$GymMembershipPlanPayload>
/**
 * Model GymMembershipContract
 * 
 */
export type GymMembershipContract = $Result.DefaultSelection<Prisma.$GymMembershipContractPayload>
/**
 * Model GymTrainerAffiliation
 * 
 */
export type GymTrainerAffiliation = $Result.DefaultSelection<Prisma.$GymTrainerAffiliationPayload>
/**
 * Model GymCheckIn
 * 
 */
export type GymCheckIn = $Result.DefaultSelection<Prisma.$GymCheckInPayload>
/**
 * Model GymReview
 * 
 */
export type GymReview = $Result.DefaultSelection<Prisma.$GymReviewPayload>
/**
 * Model GymPtCollaboration
 * A revenue-share agreement between a trainer and a gym.
 * 
 * A PT affiliated with a gym trains clients on the gym's floor and checks in free; in return
 * the gym takes a cut of the contracts that PT signs there. Both sides have to agree on the
 * split, so this row carries the negotiation as well as the outcome — each counter-offer
 * overwrites the proposed rates and flips `proposedBy`, so whose turn it is is never
 * ambiguous.
 * 
 * The rates here are a TEMPLATE, not the source of truth for any contract. When a contract is
 * signed it copies them onto itself (see docs/money-flow.md §12); renegotiating afterwards
 * leaves existing contracts on the terms their parties actually agreed to.
 */
export type GymPtCollaboration = $Result.DefaultSelection<Prisma.$GymPtCollaborationPayload>
/**
 * Model GymMembershipReferral
 * Commission owed to a PT for introducing a client who bought a gym membership.
 * 
 * Paid out of the GYM's share, never the platform's — the platform did no introducing. The
 * `clawedBack` column exists because a refunded membership must reverse the commission in
 * proportion; a referral system that pays on purchase but forgets to reclaim on refund leaks
 * money on every cancellation.
 */
export type GymMembershipReferral = $Result.DefaultSelection<Prisma.$GymMembershipReferralPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const GymStatus: {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

export type GymStatus = (typeof GymStatus)[keyof typeof GymStatus]


export const GymMembershipPlanStatus: {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

export type GymMembershipPlanStatus = (typeof GymMembershipPlanStatus)[keyof typeof GymMembershipPlanStatus]


export const GymMembershipContractStatus: {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
};

export type GymMembershipContractStatus = (typeof GymMembershipContractStatus)[keyof typeof GymMembershipContractStatus]


export const AffiliationStatus: {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

export type AffiliationStatus = (typeof AffiliationStatus)[keyof typeof AffiliationStatus]


export const AffiliationEmployment: {
  IN_HOUSE: 'IN_HOUSE',
  FREELANCE: 'FREELANCE',
  PARTNER: 'PARTNER'
};

export type AffiliationEmployment = (typeof AffiliationEmployment)[keyof typeof AffiliationEmployment]


export const GymTrainerVisibility: {
  PUBLIC: 'PUBLIC',
  INTERNAL_ONLY: 'INTERNAL_ONLY'
};

export type GymTrainerVisibility = (typeof GymTrainerVisibility)[keyof typeof GymTrainerVisibility]


export const CollaborationStatus: {
  PENDING: 'PENDING',
  COUNTERED: 'COUNTERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  TERMINATED: 'TERMINATED'
};

export type CollaborationStatus = (typeof CollaborationStatus)[keyof typeof CollaborationStatus]


export const CollaborationParty: {
  PT: 'PT',
  GYM: 'GYM'
};

export type CollaborationParty = (typeof CollaborationParty)[keyof typeof CollaborationParty]

}

export type GymStatus = $Enums.GymStatus

export const GymStatus: typeof $Enums.GymStatus

export type GymMembershipPlanStatus = $Enums.GymMembershipPlanStatus

export const GymMembershipPlanStatus: typeof $Enums.GymMembershipPlanStatus

export type GymMembershipContractStatus = $Enums.GymMembershipContractStatus

export const GymMembershipContractStatus: typeof $Enums.GymMembershipContractStatus

export type AffiliationStatus = $Enums.AffiliationStatus

export const AffiliationStatus: typeof $Enums.AffiliationStatus

export type AffiliationEmployment = $Enums.AffiliationEmployment

export const AffiliationEmployment: typeof $Enums.AffiliationEmployment

export type GymTrainerVisibility = $Enums.GymTrainerVisibility

export const GymTrainerVisibility: typeof $Enums.GymTrainerVisibility

export type CollaborationStatus = $Enums.CollaborationStatus

export const CollaborationStatus: typeof $Enums.CollaborationStatus

export type CollaborationParty = $Enums.CollaborationParty

export const CollaborationParty: typeof $Enums.CollaborationParty

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Gyms
 * const gyms = await prisma.gym.findMany()
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
   * // Fetch zero or more Gyms
   * const gyms = await prisma.gym.findMany()
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
   * `prisma.gym`: Exposes CRUD operations for the **Gym** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Gyms
    * const gyms = await prisma.gym.findMany()
    * ```
    */
  get gym(): Prisma.GymDelegate<ExtArgs>;

  /**
   * `prisma.gymMembershipPlan`: Exposes CRUD operations for the **GymMembershipPlan** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GymMembershipPlans
    * const gymMembershipPlans = await prisma.gymMembershipPlan.findMany()
    * ```
    */
  get gymMembershipPlan(): Prisma.GymMembershipPlanDelegate<ExtArgs>;

  /**
   * `prisma.gymMembershipContract`: Exposes CRUD operations for the **GymMembershipContract** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GymMembershipContracts
    * const gymMembershipContracts = await prisma.gymMembershipContract.findMany()
    * ```
    */
  get gymMembershipContract(): Prisma.GymMembershipContractDelegate<ExtArgs>;

  /**
   * `prisma.gymTrainerAffiliation`: Exposes CRUD operations for the **GymTrainerAffiliation** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GymTrainerAffiliations
    * const gymTrainerAffiliations = await prisma.gymTrainerAffiliation.findMany()
    * ```
    */
  get gymTrainerAffiliation(): Prisma.GymTrainerAffiliationDelegate<ExtArgs>;

  /**
   * `prisma.gymCheckIn`: Exposes CRUD operations for the **GymCheckIn** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GymCheckIns
    * const gymCheckIns = await prisma.gymCheckIn.findMany()
    * ```
    */
  get gymCheckIn(): Prisma.GymCheckInDelegate<ExtArgs>;

  /**
   * `prisma.gymReview`: Exposes CRUD operations for the **GymReview** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GymReviews
    * const gymReviews = await prisma.gymReview.findMany()
    * ```
    */
  get gymReview(): Prisma.GymReviewDelegate<ExtArgs>;

  /**
   * `prisma.gymPtCollaboration`: Exposes CRUD operations for the **GymPtCollaboration** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GymPtCollaborations
    * const gymPtCollaborations = await prisma.gymPtCollaboration.findMany()
    * ```
    */
  get gymPtCollaboration(): Prisma.GymPtCollaborationDelegate<ExtArgs>;

  /**
   * `prisma.gymMembershipReferral`: Exposes CRUD operations for the **GymMembershipReferral** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GymMembershipReferrals
    * const gymMembershipReferrals = await prisma.gymMembershipReferral.findMany()
    * ```
    */
  get gymMembershipReferral(): Prisma.GymMembershipReferralDelegate<ExtArgs>;
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
    Gym: 'Gym',
    GymMembershipPlan: 'GymMembershipPlan',
    GymMembershipContract: 'GymMembershipContract',
    GymTrainerAffiliation: 'GymTrainerAffiliation',
    GymCheckIn: 'GymCheckIn',
    GymReview: 'GymReview',
    GymPtCollaboration: 'GymPtCollaboration',
    GymMembershipReferral: 'GymMembershipReferral'
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
      modelProps: "gym" | "gymMembershipPlan" | "gymMembershipContract" | "gymTrainerAffiliation" | "gymCheckIn" | "gymReview" | "gymPtCollaboration" | "gymMembershipReferral"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Gym: {
        payload: Prisma.$GymPayload<ExtArgs>
        fields: Prisma.GymFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GymFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GymFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload>
          }
          findFirst: {
            args: Prisma.GymFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GymFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload>
          }
          findMany: {
            args: Prisma.GymFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload>[]
          }
          create: {
            args: Prisma.GymCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload>
          }
          createMany: {
            args: Prisma.GymCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GymCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload>[]
          }
          delete: {
            args: Prisma.GymDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload>
          }
          update: {
            args: Prisma.GymUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload>
          }
          deleteMany: {
            args: Prisma.GymDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GymUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.GymUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPayload>
          }
          aggregate: {
            args: Prisma.GymAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGym>
          }
          groupBy: {
            args: Prisma.GymGroupByArgs<ExtArgs>
            result: $Utils.Optional<GymGroupByOutputType>[]
          }
          count: {
            args: Prisma.GymCountArgs<ExtArgs>
            result: $Utils.Optional<GymCountAggregateOutputType> | number
          }
        }
      }
      GymMembershipPlan: {
        payload: Prisma.$GymMembershipPlanPayload<ExtArgs>
        fields: Prisma.GymMembershipPlanFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GymMembershipPlanFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GymMembershipPlanFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload>
          }
          findFirst: {
            args: Prisma.GymMembershipPlanFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GymMembershipPlanFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload>
          }
          findMany: {
            args: Prisma.GymMembershipPlanFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload>[]
          }
          create: {
            args: Prisma.GymMembershipPlanCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload>
          }
          createMany: {
            args: Prisma.GymMembershipPlanCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GymMembershipPlanCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload>[]
          }
          delete: {
            args: Prisma.GymMembershipPlanDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload>
          }
          update: {
            args: Prisma.GymMembershipPlanUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload>
          }
          deleteMany: {
            args: Prisma.GymMembershipPlanDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GymMembershipPlanUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.GymMembershipPlanUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipPlanPayload>
          }
          aggregate: {
            args: Prisma.GymMembershipPlanAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGymMembershipPlan>
          }
          groupBy: {
            args: Prisma.GymMembershipPlanGroupByArgs<ExtArgs>
            result: $Utils.Optional<GymMembershipPlanGroupByOutputType>[]
          }
          count: {
            args: Prisma.GymMembershipPlanCountArgs<ExtArgs>
            result: $Utils.Optional<GymMembershipPlanCountAggregateOutputType> | number
          }
        }
      }
      GymMembershipContract: {
        payload: Prisma.$GymMembershipContractPayload<ExtArgs>
        fields: Prisma.GymMembershipContractFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GymMembershipContractFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GymMembershipContractFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload>
          }
          findFirst: {
            args: Prisma.GymMembershipContractFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GymMembershipContractFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload>
          }
          findMany: {
            args: Prisma.GymMembershipContractFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload>[]
          }
          create: {
            args: Prisma.GymMembershipContractCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload>
          }
          createMany: {
            args: Prisma.GymMembershipContractCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GymMembershipContractCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload>[]
          }
          delete: {
            args: Prisma.GymMembershipContractDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload>
          }
          update: {
            args: Prisma.GymMembershipContractUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload>
          }
          deleteMany: {
            args: Prisma.GymMembershipContractDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GymMembershipContractUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.GymMembershipContractUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipContractPayload>
          }
          aggregate: {
            args: Prisma.GymMembershipContractAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGymMembershipContract>
          }
          groupBy: {
            args: Prisma.GymMembershipContractGroupByArgs<ExtArgs>
            result: $Utils.Optional<GymMembershipContractGroupByOutputType>[]
          }
          count: {
            args: Prisma.GymMembershipContractCountArgs<ExtArgs>
            result: $Utils.Optional<GymMembershipContractCountAggregateOutputType> | number
          }
        }
      }
      GymTrainerAffiliation: {
        payload: Prisma.$GymTrainerAffiliationPayload<ExtArgs>
        fields: Prisma.GymTrainerAffiliationFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GymTrainerAffiliationFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GymTrainerAffiliationFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload>
          }
          findFirst: {
            args: Prisma.GymTrainerAffiliationFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GymTrainerAffiliationFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload>
          }
          findMany: {
            args: Prisma.GymTrainerAffiliationFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload>[]
          }
          create: {
            args: Prisma.GymTrainerAffiliationCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload>
          }
          createMany: {
            args: Prisma.GymTrainerAffiliationCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GymTrainerAffiliationCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload>[]
          }
          delete: {
            args: Prisma.GymTrainerAffiliationDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload>
          }
          update: {
            args: Prisma.GymTrainerAffiliationUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload>
          }
          deleteMany: {
            args: Prisma.GymTrainerAffiliationDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GymTrainerAffiliationUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.GymTrainerAffiliationUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymTrainerAffiliationPayload>
          }
          aggregate: {
            args: Prisma.GymTrainerAffiliationAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGymTrainerAffiliation>
          }
          groupBy: {
            args: Prisma.GymTrainerAffiliationGroupByArgs<ExtArgs>
            result: $Utils.Optional<GymTrainerAffiliationGroupByOutputType>[]
          }
          count: {
            args: Prisma.GymTrainerAffiliationCountArgs<ExtArgs>
            result: $Utils.Optional<GymTrainerAffiliationCountAggregateOutputType> | number
          }
        }
      }
      GymCheckIn: {
        payload: Prisma.$GymCheckInPayload<ExtArgs>
        fields: Prisma.GymCheckInFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GymCheckInFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GymCheckInFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload>
          }
          findFirst: {
            args: Prisma.GymCheckInFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GymCheckInFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload>
          }
          findMany: {
            args: Prisma.GymCheckInFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload>[]
          }
          create: {
            args: Prisma.GymCheckInCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload>
          }
          createMany: {
            args: Prisma.GymCheckInCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GymCheckInCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload>[]
          }
          delete: {
            args: Prisma.GymCheckInDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload>
          }
          update: {
            args: Prisma.GymCheckInUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload>
          }
          deleteMany: {
            args: Prisma.GymCheckInDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GymCheckInUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.GymCheckInUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymCheckInPayload>
          }
          aggregate: {
            args: Prisma.GymCheckInAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGymCheckIn>
          }
          groupBy: {
            args: Prisma.GymCheckInGroupByArgs<ExtArgs>
            result: $Utils.Optional<GymCheckInGroupByOutputType>[]
          }
          count: {
            args: Prisma.GymCheckInCountArgs<ExtArgs>
            result: $Utils.Optional<GymCheckInCountAggregateOutputType> | number
          }
        }
      }
      GymReview: {
        payload: Prisma.$GymReviewPayload<ExtArgs>
        fields: Prisma.GymReviewFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GymReviewFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GymReviewFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload>
          }
          findFirst: {
            args: Prisma.GymReviewFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GymReviewFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload>
          }
          findMany: {
            args: Prisma.GymReviewFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload>[]
          }
          create: {
            args: Prisma.GymReviewCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload>
          }
          createMany: {
            args: Prisma.GymReviewCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GymReviewCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload>[]
          }
          delete: {
            args: Prisma.GymReviewDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload>
          }
          update: {
            args: Prisma.GymReviewUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload>
          }
          deleteMany: {
            args: Prisma.GymReviewDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GymReviewUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.GymReviewUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymReviewPayload>
          }
          aggregate: {
            args: Prisma.GymReviewAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGymReview>
          }
          groupBy: {
            args: Prisma.GymReviewGroupByArgs<ExtArgs>
            result: $Utils.Optional<GymReviewGroupByOutputType>[]
          }
          count: {
            args: Prisma.GymReviewCountArgs<ExtArgs>
            result: $Utils.Optional<GymReviewCountAggregateOutputType> | number
          }
        }
      }
      GymPtCollaboration: {
        payload: Prisma.$GymPtCollaborationPayload<ExtArgs>
        fields: Prisma.GymPtCollaborationFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GymPtCollaborationFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GymPtCollaborationFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload>
          }
          findFirst: {
            args: Prisma.GymPtCollaborationFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GymPtCollaborationFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload>
          }
          findMany: {
            args: Prisma.GymPtCollaborationFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload>[]
          }
          create: {
            args: Prisma.GymPtCollaborationCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload>
          }
          createMany: {
            args: Prisma.GymPtCollaborationCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GymPtCollaborationCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload>[]
          }
          delete: {
            args: Prisma.GymPtCollaborationDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload>
          }
          update: {
            args: Prisma.GymPtCollaborationUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload>
          }
          deleteMany: {
            args: Prisma.GymPtCollaborationDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GymPtCollaborationUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.GymPtCollaborationUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymPtCollaborationPayload>
          }
          aggregate: {
            args: Prisma.GymPtCollaborationAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGymPtCollaboration>
          }
          groupBy: {
            args: Prisma.GymPtCollaborationGroupByArgs<ExtArgs>
            result: $Utils.Optional<GymPtCollaborationGroupByOutputType>[]
          }
          count: {
            args: Prisma.GymPtCollaborationCountArgs<ExtArgs>
            result: $Utils.Optional<GymPtCollaborationCountAggregateOutputType> | number
          }
        }
      }
      GymMembershipReferral: {
        payload: Prisma.$GymMembershipReferralPayload<ExtArgs>
        fields: Prisma.GymMembershipReferralFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GymMembershipReferralFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GymMembershipReferralFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload>
          }
          findFirst: {
            args: Prisma.GymMembershipReferralFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GymMembershipReferralFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload>
          }
          findMany: {
            args: Prisma.GymMembershipReferralFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload>[]
          }
          create: {
            args: Prisma.GymMembershipReferralCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload>
          }
          createMany: {
            args: Prisma.GymMembershipReferralCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GymMembershipReferralCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload>[]
          }
          delete: {
            args: Prisma.GymMembershipReferralDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload>
          }
          update: {
            args: Prisma.GymMembershipReferralUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload>
          }
          deleteMany: {
            args: Prisma.GymMembershipReferralDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GymMembershipReferralUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.GymMembershipReferralUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GymMembershipReferralPayload>
          }
          aggregate: {
            args: Prisma.GymMembershipReferralAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGymMembershipReferral>
          }
          groupBy: {
            args: Prisma.GymMembershipReferralGroupByArgs<ExtArgs>
            result: $Utils.Optional<GymMembershipReferralGroupByOutputType>[]
          }
          count: {
            args: Prisma.GymMembershipReferralCountArgs<ExtArgs>
            result: $Utils.Optional<GymMembershipReferralCountAggregateOutputType> | number
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
   * Count Type GymCountOutputType
   */

  export type GymCountOutputType = {
    plans: number
    memberships: number
    affiliations: number
    reviews: number
    collaborations: number
  }

  export type GymCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    plans?: boolean | GymCountOutputTypeCountPlansArgs
    memberships?: boolean | GymCountOutputTypeCountMembershipsArgs
    affiliations?: boolean | GymCountOutputTypeCountAffiliationsArgs
    reviews?: boolean | GymCountOutputTypeCountReviewsArgs
    collaborations?: boolean | GymCountOutputTypeCountCollaborationsArgs
  }

  // Custom InputTypes
  /**
   * GymCountOutputType without action
   */
  export type GymCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCountOutputType
     */
    select?: GymCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * GymCountOutputType without action
   */
  export type GymCountOutputTypeCountPlansArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymMembershipPlanWhereInput
  }

  /**
   * GymCountOutputType without action
   */
  export type GymCountOutputTypeCountMembershipsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymMembershipContractWhereInput
  }

  /**
   * GymCountOutputType without action
   */
  export type GymCountOutputTypeCountAffiliationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymTrainerAffiliationWhereInput
  }

  /**
   * GymCountOutputType without action
   */
  export type GymCountOutputTypeCountReviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymReviewWhereInput
  }

  /**
   * GymCountOutputType without action
   */
  export type GymCountOutputTypeCountCollaborationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymPtCollaborationWhereInput
  }


  /**
   * Count Type GymMembershipPlanCountOutputType
   */

  export type GymMembershipPlanCountOutputType = {
    memberships: number
  }

  export type GymMembershipPlanCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    memberships?: boolean | GymMembershipPlanCountOutputTypeCountMembershipsArgs
  }

  // Custom InputTypes
  /**
   * GymMembershipPlanCountOutputType without action
   */
  export type GymMembershipPlanCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlanCountOutputType
     */
    select?: GymMembershipPlanCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * GymMembershipPlanCountOutputType without action
   */
  export type GymMembershipPlanCountOutputTypeCountMembershipsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymMembershipContractWhereInput
  }


  /**
   * Count Type GymMembershipContractCountOutputType
   */

  export type GymMembershipContractCountOutputType = {
    checkIns: number
  }

  export type GymMembershipContractCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    checkIns?: boolean | GymMembershipContractCountOutputTypeCountCheckInsArgs
  }

  // Custom InputTypes
  /**
   * GymMembershipContractCountOutputType without action
   */
  export type GymMembershipContractCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContractCountOutputType
     */
    select?: GymMembershipContractCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * GymMembershipContractCountOutputType without action
   */
  export type GymMembershipContractCountOutputTypeCountCheckInsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymCheckInWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Gym
   */

  export type AggregateGym = {
    _count: GymCountAggregateOutputType | null
    _min: GymMinAggregateOutputType | null
    _max: GymMaxAggregateOutputType | null
  }

  export type GymMinAggregateOutputType = {
    id: string | null
    ownerId: string | null
    name: string | null
    description: string | null
    address: string | null
    city: string | null
    phone: string | null
    email: string | null
    status: $Enums.GymStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymMaxAggregateOutputType = {
    id: string | null
    ownerId: string | null
    name: string | null
    description: string | null
    address: string | null
    city: string | null
    phone: string | null
    email: string | null
    status: $Enums.GymStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymCountAggregateOutputType = {
    id: number
    ownerId: number
    name: number
    description: number
    address: number
    city: number
    phone: number
    email: number
    status: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type GymMinAggregateInputType = {
    id?: true
    ownerId?: true
    name?: true
    description?: true
    address?: true
    city?: true
    phone?: true
    email?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymMaxAggregateInputType = {
    id?: true
    ownerId?: true
    name?: true
    description?: true
    address?: true
    city?: true
    phone?: true
    email?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymCountAggregateInputType = {
    id?: true
    ownerId?: true
    name?: true
    description?: true
    address?: true
    city?: true
    phone?: true
    email?: true
    status?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type GymAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Gym to aggregate.
     */
    where?: GymWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Gyms to fetch.
     */
    orderBy?: GymOrderByWithRelationInput | GymOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GymWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Gyms from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Gyms.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Gyms
    **/
    _count?: true | GymCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GymMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GymMaxAggregateInputType
  }

  export type GetGymAggregateType<T extends GymAggregateArgs> = {
        [P in keyof T & keyof AggregateGym]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGym[P]>
      : GetScalarType<T[P], AggregateGym[P]>
  }




  export type GymGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymWhereInput
    orderBy?: GymOrderByWithAggregationInput | GymOrderByWithAggregationInput[]
    by: GymScalarFieldEnum[] | GymScalarFieldEnum
    having?: GymScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GymCountAggregateInputType | true
    _min?: GymMinAggregateInputType
    _max?: GymMaxAggregateInputType
  }

  export type GymGroupByOutputType = {
    id: string
    ownerId: string
    name: string
    description: string | null
    address: string
    city: string | null
    phone: string | null
    email: string | null
    status: $Enums.GymStatus
    createdAt: Date
    updatedAt: Date
    _count: GymCountAggregateOutputType | null
    _min: GymMinAggregateOutputType | null
    _max: GymMaxAggregateOutputType | null
  }

  type GetGymGroupByPayload<T extends GymGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GymGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GymGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GymGroupByOutputType[P]>
            : GetScalarType<T[P], GymGroupByOutputType[P]>
        }
      >
    >


  export type GymSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    ownerId?: boolean
    name?: boolean
    description?: boolean
    address?: boolean
    city?: boolean
    phone?: boolean
    email?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    plans?: boolean | Gym$plansArgs<ExtArgs>
    memberships?: boolean | Gym$membershipsArgs<ExtArgs>
    affiliations?: boolean | Gym$affiliationsArgs<ExtArgs>
    reviews?: boolean | Gym$reviewsArgs<ExtArgs>
    collaborations?: boolean | Gym$collaborationsArgs<ExtArgs>
    _count?: boolean | GymCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gym"]>

  export type GymSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    ownerId?: boolean
    name?: boolean
    description?: boolean
    address?: boolean
    city?: boolean
    phone?: boolean
    email?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["gym"]>

  export type GymSelectScalar = {
    id?: boolean
    ownerId?: boolean
    name?: boolean
    description?: boolean
    address?: boolean
    city?: boolean
    phone?: boolean
    email?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type GymInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    plans?: boolean | Gym$plansArgs<ExtArgs>
    memberships?: boolean | Gym$membershipsArgs<ExtArgs>
    affiliations?: boolean | Gym$affiliationsArgs<ExtArgs>
    reviews?: boolean | Gym$reviewsArgs<ExtArgs>
    collaborations?: boolean | Gym$collaborationsArgs<ExtArgs>
    _count?: boolean | GymCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type GymIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $GymPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Gym"
    objects: {
      plans: Prisma.$GymMembershipPlanPayload<ExtArgs>[]
      memberships: Prisma.$GymMembershipContractPayload<ExtArgs>[]
      affiliations: Prisma.$GymTrainerAffiliationPayload<ExtArgs>[]
      reviews: Prisma.$GymReviewPayload<ExtArgs>[]
      collaborations: Prisma.$GymPtCollaborationPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      ownerId: string
      name: string
      description: string | null
      address: string
      city: string | null
      phone: string | null
      email: string | null
      status: $Enums.GymStatus
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["gym"]>
    composites: {}
  }

  type GymGetPayload<S extends boolean | null | undefined | GymDefaultArgs> = $Result.GetResult<Prisma.$GymPayload, S>

  type GymCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<GymFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: GymCountAggregateInputType | true
    }

  export interface GymDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Gym'], meta: { name: 'Gym' } }
    /**
     * Find zero or one Gym that matches the filter.
     * @param {GymFindUniqueArgs} args - Arguments to find a Gym
     * @example
     * // Get one Gym
     * const gym = await prisma.gym.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GymFindUniqueArgs>(args: SelectSubset<T, GymFindUniqueArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Gym that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {GymFindUniqueOrThrowArgs} args - Arguments to find a Gym
     * @example
     * // Get one Gym
     * const gym = await prisma.gym.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GymFindUniqueOrThrowArgs>(args: SelectSubset<T, GymFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Gym that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymFindFirstArgs} args - Arguments to find a Gym
     * @example
     * // Get one Gym
     * const gym = await prisma.gym.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GymFindFirstArgs>(args?: SelectSubset<T, GymFindFirstArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Gym that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymFindFirstOrThrowArgs} args - Arguments to find a Gym
     * @example
     * // Get one Gym
     * const gym = await prisma.gym.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GymFindFirstOrThrowArgs>(args?: SelectSubset<T, GymFindFirstOrThrowArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Gyms that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Gyms
     * const gyms = await prisma.gym.findMany()
     * 
     * // Get first 10 Gyms
     * const gyms = await prisma.gym.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const gymWithIdOnly = await prisma.gym.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GymFindManyArgs>(args?: SelectSubset<T, GymFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Gym.
     * @param {GymCreateArgs} args - Arguments to create a Gym.
     * @example
     * // Create one Gym
     * const Gym = await prisma.gym.create({
     *   data: {
     *     // ... data to create a Gym
     *   }
     * })
     * 
     */
    create<T extends GymCreateArgs>(args: SelectSubset<T, GymCreateArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Gyms.
     * @param {GymCreateManyArgs} args - Arguments to create many Gyms.
     * @example
     * // Create many Gyms
     * const gym = await prisma.gym.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GymCreateManyArgs>(args?: SelectSubset<T, GymCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Gyms and returns the data saved in the database.
     * @param {GymCreateManyAndReturnArgs} args - Arguments to create many Gyms.
     * @example
     * // Create many Gyms
     * const gym = await prisma.gym.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Gyms and only return the `id`
     * const gymWithIdOnly = await prisma.gym.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GymCreateManyAndReturnArgs>(args?: SelectSubset<T, GymCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Gym.
     * @param {GymDeleteArgs} args - Arguments to delete one Gym.
     * @example
     * // Delete one Gym
     * const Gym = await prisma.gym.delete({
     *   where: {
     *     // ... filter to delete one Gym
     *   }
     * })
     * 
     */
    delete<T extends GymDeleteArgs>(args: SelectSubset<T, GymDeleteArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Gym.
     * @param {GymUpdateArgs} args - Arguments to update one Gym.
     * @example
     * // Update one Gym
     * const gym = await prisma.gym.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GymUpdateArgs>(args: SelectSubset<T, GymUpdateArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Gyms.
     * @param {GymDeleteManyArgs} args - Arguments to filter Gyms to delete.
     * @example
     * // Delete a few Gyms
     * const { count } = await prisma.gym.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GymDeleteManyArgs>(args?: SelectSubset<T, GymDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Gyms.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Gyms
     * const gym = await prisma.gym.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GymUpdateManyArgs>(args: SelectSubset<T, GymUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Gym.
     * @param {GymUpsertArgs} args - Arguments to update or create a Gym.
     * @example
     * // Update or create a Gym
     * const gym = await prisma.gym.upsert({
     *   create: {
     *     // ... data to create a Gym
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Gym we want to update
     *   }
     * })
     */
    upsert<T extends GymUpsertArgs>(args: SelectSubset<T, GymUpsertArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Gyms.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymCountArgs} args - Arguments to filter Gyms to count.
     * @example
     * // Count the number of Gyms
     * const count = await prisma.gym.count({
     *   where: {
     *     // ... the filter for the Gyms we want to count
     *   }
     * })
    **/
    count<T extends GymCountArgs>(
      args?: Subset<T, GymCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GymCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Gym.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends GymAggregateArgs>(args: Subset<T, GymAggregateArgs>): Prisma.PrismaPromise<GetGymAggregateType<T>>

    /**
     * Group by Gym.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymGroupByArgs} args - Group by arguments.
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
      T extends GymGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GymGroupByArgs['orderBy'] }
        : { orderBy?: GymGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, GymGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGymGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Gym model
   */
  readonly fields: GymFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Gym.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GymClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    plans<T extends Gym$plansArgs<ExtArgs> = {}>(args?: Subset<T, Gym$plansArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "findMany"> | Null>
    memberships<T extends Gym$membershipsArgs<ExtArgs> = {}>(args?: Subset<T, Gym$membershipsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "findMany"> | Null>
    affiliations<T extends Gym$affiliationsArgs<ExtArgs> = {}>(args?: Subset<T, Gym$affiliationsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "findMany"> | Null>
    reviews<T extends Gym$reviewsArgs<ExtArgs> = {}>(args?: Subset<T, Gym$reviewsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "findMany"> | Null>
    collaborations<T extends Gym$collaborationsArgs<ExtArgs> = {}>(args?: Subset<T, Gym$collaborationsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the Gym model
   */ 
  interface GymFieldRefs {
    readonly id: FieldRef<"Gym", 'String'>
    readonly ownerId: FieldRef<"Gym", 'String'>
    readonly name: FieldRef<"Gym", 'String'>
    readonly description: FieldRef<"Gym", 'String'>
    readonly address: FieldRef<"Gym", 'String'>
    readonly city: FieldRef<"Gym", 'String'>
    readonly phone: FieldRef<"Gym", 'String'>
    readonly email: FieldRef<"Gym", 'String'>
    readonly status: FieldRef<"Gym", 'GymStatus'>
    readonly createdAt: FieldRef<"Gym", 'DateTime'>
    readonly updatedAt: FieldRef<"Gym", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Gym findUnique
   */
  export type GymFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
    /**
     * Filter, which Gym to fetch.
     */
    where: GymWhereUniqueInput
  }

  /**
   * Gym findUniqueOrThrow
   */
  export type GymFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
    /**
     * Filter, which Gym to fetch.
     */
    where: GymWhereUniqueInput
  }

  /**
   * Gym findFirst
   */
  export type GymFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
    /**
     * Filter, which Gym to fetch.
     */
    where?: GymWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Gyms to fetch.
     */
    orderBy?: GymOrderByWithRelationInput | GymOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Gyms.
     */
    cursor?: GymWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Gyms from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Gyms.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Gyms.
     */
    distinct?: GymScalarFieldEnum | GymScalarFieldEnum[]
  }

  /**
   * Gym findFirstOrThrow
   */
  export type GymFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
    /**
     * Filter, which Gym to fetch.
     */
    where?: GymWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Gyms to fetch.
     */
    orderBy?: GymOrderByWithRelationInput | GymOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Gyms.
     */
    cursor?: GymWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Gyms from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Gyms.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Gyms.
     */
    distinct?: GymScalarFieldEnum | GymScalarFieldEnum[]
  }

  /**
   * Gym findMany
   */
  export type GymFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
    /**
     * Filter, which Gyms to fetch.
     */
    where?: GymWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Gyms to fetch.
     */
    orderBy?: GymOrderByWithRelationInput | GymOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Gyms.
     */
    cursor?: GymWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Gyms from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Gyms.
     */
    skip?: number
    distinct?: GymScalarFieldEnum | GymScalarFieldEnum[]
  }

  /**
   * Gym create
   */
  export type GymCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
    /**
     * The data needed to create a Gym.
     */
    data: XOR<GymCreateInput, GymUncheckedCreateInput>
  }

  /**
   * Gym createMany
   */
  export type GymCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Gyms.
     */
    data: GymCreateManyInput | GymCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Gym createManyAndReturn
   */
  export type GymCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Gyms.
     */
    data: GymCreateManyInput | GymCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Gym update
   */
  export type GymUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
    /**
     * The data needed to update a Gym.
     */
    data: XOR<GymUpdateInput, GymUncheckedUpdateInput>
    /**
     * Choose, which Gym to update.
     */
    where: GymWhereUniqueInput
  }

  /**
   * Gym updateMany
   */
  export type GymUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Gyms.
     */
    data: XOR<GymUpdateManyMutationInput, GymUncheckedUpdateManyInput>
    /**
     * Filter which Gyms to update
     */
    where?: GymWhereInput
  }

  /**
   * Gym upsert
   */
  export type GymUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
    /**
     * The filter to search for the Gym to update in case it exists.
     */
    where: GymWhereUniqueInput
    /**
     * In case the Gym found by the `where` argument doesn't exist, create a new Gym with this data.
     */
    create: XOR<GymCreateInput, GymUncheckedCreateInput>
    /**
     * In case the Gym was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GymUpdateInput, GymUncheckedUpdateInput>
  }

  /**
   * Gym delete
   */
  export type GymDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
    /**
     * Filter which Gym to delete.
     */
    where: GymWhereUniqueInput
  }

  /**
   * Gym deleteMany
   */
  export type GymDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Gyms to delete
     */
    where?: GymWhereInput
  }

  /**
   * Gym.plans
   */
  export type Gym$plansArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    where?: GymMembershipPlanWhereInput
    orderBy?: GymMembershipPlanOrderByWithRelationInput | GymMembershipPlanOrderByWithRelationInput[]
    cursor?: GymMembershipPlanWhereUniqueInput
    take?: number
    skip?: number
    distinct?: GymMembershipPlanScalarFieldEnum | GymMembershipPlanScalarFieldEnum[]
  }

  /**
   * Gym.memberships
   */
  export type Gym$membershipsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    where?: GymMembershipContractWhereInput
    orderBy?: GymMembershipContractOrderByWithRelationInput | GymMembershipContractOrderByWithRelationInput[]
    cursor?: GymMembershipContractWhereUniqueInput
    take?: number
    skip?: number
    distinct?: GymMembershipContractScalarFieldEnum | GymMembershipContractScalarFieldEnum[]
  }

  /**
   * Gym.affiliations
   */
  export type Gym$affiliationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    where?: GymTrainerAffiliationWhereInput
    orderBy?: GymTrainerAffiliationOrderByWithRelationInput | GymTrainerAffiliationOrderByWithRelationInput[]
    cursor?: GymTrainerAffiliationWhereUniqueInput
    take?: number
    skip?: number
    distinct?: GymTrainerAffiliationScalarFieldEnum | GymTrainerAffiliationScalarFieldEnum[]
  }

  /**
   * Gym.reviews
   */
  export type Gym$reviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    where?: GymReviewWhereInput
    orderBy?: GymReviewOrderByWithRelationInput | GymReviewOrderByWithRelationInput[]
    cursor?: GymReviewWhereUniqueInput
    take?: number
    skip?: number
    distinct?: GymReviewScalarFieldEnum | GymReviewScalarFieldEnum[]
  }

  /**
   * Gym.collaborations
   */
  export type Gym$collaborationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    where?: GymPtCollaborationWhereInput
    orderBy?: GymPtCollaborationOrderByWithRelationInput | GymPtCollaborationOrderByWithRelationInput[]
    cursor?: GymPtCollaborationWhereUniqueInput
    take?: number
    skip?: number
    distinct?: GymPtCollaborationScalarFieldEnum | GymPtCollaborationScalarFieldEnum[]
  }

  /**
   * Gym without action
   */
  export type GymDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Gym
     */
    select?: GymSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymInclude<ExtArgs> | null
  }


  /**
   * Model GymMembershipPlan
   */

  export type AggregateGymMembershipPlan = {
    _count: GymMembershipPlanCountAggregateOutputType | null
    _avg: GymMembershipPlanAvgAggregateOutputType | null
    _sum: GymMembershipPlanSumAggregateOutputType | null
    _min: GymMembershipPlanMinAggregateOutputType | null
    _max: GymMembershipPlanMaxAggregateOutputType | null
  }

  export type GymMembershipPlanAvgAggregateOutputType = {
    price: Decimal | null
    durationDays: number | null
    visitLimit: number | null
  }

  export type GymMembershipPlanSumAggregateOutputType = {
    price: Decimal | null
    durationDays: number | null
    visitLimit: number | null
  }

  export type GymMembershipPlanMinAggregateOutputType = {
    id: string | null
    gymId: string | null
    name: string | null
    description: string | null
    price: Decimal | null
    durationDays: number | null
    visitLimit: number | null
    status: $Enums.GymMembershipPlanStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymMembershipPlanMaxAggregateOutputType = {
    id: string | null
    gymId: string | null
    name: string | null
    description: string | null
    price: Decimal | null
    durationDays: number | null
    visitLimit: number | null
    status: $Enums.GymMembershipPlanStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymMembershipPlanCountAggregateOutputType = {
    id: number
    gymId: number
    name: number
    description: number
    price: number
    durationDays: number
    visitLimit: number
    status: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type GymMembershipPlanAvgAggregateInputType = {
    price?: true
    durationDays?: true
    visitLimit?: true
  }

  export type GymMembershipPlanSumAggregateInputType = {
    price?: true
    durationDays?: true
    visitLimit?: true
  }

  export type GymMembershipPlanMinAggregateInputType = {
    id?: true
    gymId?: true
    name?: true
    description?: true
    price?: true
    durationDays?: true
    visitLimit?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymMembershipPlanMaxAggregateInputType = {
    id?: true
    gymId?: true
    name?: true
    description?: true
    price?: true
    durationDays?: true
    visitLimit?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymMembershipPlanCountAggregateInputType = {
    id?: true
    gymId?: true
    name?: true
    description?: true
    price?: true
    durationDays?: true
    visitLimit?: true
    status?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type GymMembershipPlanAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymMembershipPlan to aggregate.
     */
    where?: GymMembershipPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipPlans to fetch.
     */
    orderBy?: GymMembershipPlanOrderByWithRelationInput | GymMembershipPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GymMembershipPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GymMembershipPlans
    **/
    _count?: true | GymMembershipPlanCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: GymMembershipPlanAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: GymMembershipPlanSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GymMembershipPlanMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GymMembershipPlanMaxAggregateInputType
  }

  export type GetGymMembershipPlanAggregateType<T extends GymMembershipPlanAggregateArgs> = {
        [P in keyof T & keyof AggregateGymMembershipPlan]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGymMembershipPlan[P]>
      : GetScalarType<T[P], AggregateGymMembershipPlan[P]>
  }




  export type GymMembershipPlanGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymMembershipPlanWhereInput
    orderBy?: GymMembershipPlanOrderByWithAggregationInput | GymMembershipPlanOrderByWithAggregationInput[]
    by: GymMembershipPlanScalarFieldEnum[] | GymMembershipPlanScalarFieldEnum
    having?: GymMembershipPlanScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GymMembershipPlanCountAggregateInputType | true
    _avg?: GymMembershipPlanAvgAggregateInputType
    _sum?: GymMembershipPlanSumAggregateInputType
    _min?: GymMembershipPlanMinAggregateInputType
    _max?: GymMembershipPlanMaxAggregateInputType
  }

  export type GymMembershipPlanGroupByOutputType = {
    id: string
    gymId: string
    name: string
    description: string | null
    price: Decimal
    durationDays: number
    visitLimit: number | null
    status: $Enums.GymMembershipPlanStatus
    createdAt: Date
    updatedAt: Date
    _count: GymMembershipPlanCountAggregateOutputType | null
    _avg: GymMembershipPlanAvgAggregateOutputType | null
    _sum: GymMembershipPlanSumAggregateOutputType | null
    _min: GymMembershipPlanMinAggregateOutputType | null
    _max: GymMembershipPlanMaxAggregateOutputType | null
  }

  type GetGymMembershipPlanGroupByPayload<T extends GymMembershipPlanGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GymMembershipPlanGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GymMembershipPlanGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GymMembershipPlanGroupByOutputType[P]>
            : GetScalarType<T[P], GymMembershipPlanGroupByOutputType[P]>
        }
      >
    >


  export type GymMembershipPlanSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    name?: boolean
    description?: boolean
    price?: boolean
    durationDays?: boolean
    visitLimit?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
    memberships?: boolean | GymMembershipPlan$membershipsArgs<ExtArgs>
    _count?: boolean | GymMembershipPlanCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymMembershipPlan"]>

  export type GymMembershipPlanSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    name?: boolean
    description?: boolean
    price?: boolean
    durationDays?: boolean
    visitLimit?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymMembershipPlan"]>

  export type GymMembershipPlanSelectScalar = {
    id?: boolean
    gymId?: boolean
    name?: boolean
    description?: boolean
    price?: boolean
    durationDays?: boolean
    visitLimit?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type GymMembershipPlanInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
    memberships?: boolean | GymMembershipPlan$membershipsArgs<ExtArgs>
    _count?: boolean | GymMembershipPlanCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type GymMembershipPlanIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }

  export type $GymMembershipPlanPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GymMembershipPlan"
    objects: {
      gym: Prisma.$GymPayload<ExtArgs>
      memberships: Prisma.$GymMembershipContractPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      gymId: string
      name: string
      description: string | null
      price: Prisma.Decimal
      durationDays: number
      visitLimit: number | null
      status: $Enums.GymMembershipPlanStatus
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["gymMembershipPlan"]>
    composites: {}
  }

  type GymMembershipPlanGetPayload<S extends boolean | null | undefined | GymMembershipPlanDefaultArgs> = $Result.GetResult<Prisma.$GymMembershipPlanPayload, S>

  type GymMembershipPlanCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<GymMembershipPlanFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: GymMembershipPlanCountAggregateInputType | true
    }

  export interface GymMembershipPlanDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GymMembershipPlan'], meta: { name: 'GymMembershipPlan' } }
    /**
     * Find zero or one GymMembershipPlan that matches the filter.
     * @param {GymMembershipPlanFindUniqueArgs} args - Arguments to find a GymMembershipPlan
     * @example
     * // Get one GymMembershipPlan
     * const gymMembershipPlan = await prisma.gymMembershipPlan.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GymMembershipPlanFindUniqueArgs>(args: SelectSubset<T, GymMembershipPlanFindUniqueArgs<ExtArgs>>): Prisma__GymMembershipPlanClient<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one GymMembershipPlan that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {GymMembershipPlanFindUniqueOrThrowArgs} args - Arguments to find a GymMembershipPlan
     * @example
     * // Get one GymMembershipPlan
     * const gymMembershipPlan = await prisma.gymMembershipPlan.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GymMembershipPlanFindUniqueOrThrowArgs>(args: SelectSubset<T, GymMembershipPlanFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GymMembershipPlanClient<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first GymMembershipPlan that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipPlanFindFirstArgs} args - Arguments to find a GymMembershipPlan
     * @example
     * // Get one GymMembershipPlan
     * const gymMembershipPlan = await prisma.gymMembershipPlan.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GymMembershipPlanFindFirstArgs>(args?: SelectSubset<T, GymMembershipPlanFindFirstArgs<ExtArgs>>): Prisma__GymMembershipPlanClient<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first GymMembershipPlan that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipPlanFindFirstOrThrowArgs} args - Arguments to find a GymMembershipPlan
     * @example
     * // Get one GymMembershipPlan
     * const gymMembershipPlan = await prisma.gymMembershipPlan.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GymMembershipPlanFindFirstOrThrowArgs>(args?: SelectSubset<T, GymMembershipPlanFindFirstOrThrowArgs<ExtArgs>>): Prisma__GymMembershipPlanClient<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more GymMembershipPlans that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipPlanFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GymMembershipPlans
     * const gymMembershipPlans = await prisma.gymMembershipPlan.findMany()
     * 
     * // Get first 10 GymMembershipPlans
     * const gymMembershipPlans = await prisma.gymMembershipPlan.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const gymMembershipPlanWithIdOnly = await prisma.gymMembershipPlan.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GymMembershipPlanFindManyArgs>(args?: SelectSubset<T, GymMembershipPlanFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a GymMembershipPlan.
     * @param {GymMembershipPlanCreateArgs} args - Arguments to create a GymMembershipPlan.
     * @example
     * // Create one GymMembershipPlan
     * const GymMembershipPlan = await prisma.gymMembershipPlan.create({
     *   data: {
     *     // ... data to create a GymMembershipPlan
     *   }
     * })
     * 
     */
    create<T extends GymMembershipPlanCreateArgs>(args: SelectSubset<T, GymMembershipPlanCreateArgs<ExtArgs>>): Prisma__GymMembershipPlanClient<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many GymMembershipPlans.
     * @param {GymMembershipPlanCreateManyArgs} args - Arguments to create many GymMembershipPlans.
     * @example
     * // Create many GymMembershipPlans
     * const gymMembershipPlan = await prisma.gymMembershipPlan.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GymMembershipPlanCreateManyArgs>(args?: SelectSubset<T, GymMembershipPlanCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GymMembershipPlans and returns the data saved in the database.
     * @param {GymMembershipPlanCreateManyAndReturnArgs} args - Arguments to create many GymMembershipPlans.
     * @example
     * // Create many GymMembershipPlans
     * const gymMembershipPlan = await prisma.gymMembershipPlan.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GymMembershipPlans and only return the `id`
     * const gymMembershipPlanWithIdOnly = await prisma.gymMembershipPlan.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GymMembershipPlanCreateManyAndReturnArgs>(args?: SelectSubset<T, GymMembershipPlanCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a GymMembershipPlan.
     * @param {GymMembershipPlanDeleteArgs} args - Arguments to delete one GymMembershipPlan.
     * @example
     * // Delete one GymMembershipPlan
     * const GymMembershipPlan = await prisma.gymMembershipPlan.delete({
     *   where: {
     *     // ... filter to delete one GymMembershipPlan
     *   }
     * })
     * 
     */
    delete<T extends GymMembershipPlanDeleteArgs>(args: SelectSubset<T, GymMembershipPlanDeleteArgs<ExtArgs>>): Prisma__GymMembershipPlanClient<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one GymMembershipPlan.
     * @param {GymMembershipPlanUpdateArgs} args - Arguments to update one GymMembershipPlan.
     * @example
     * // Update one GymMembershipPlan
     * const gymMembershipPlan = await prisma.gymMembershipPlan.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GymMembershipPlanUpdateArgs>(args: SelectSubset<T, GymMembershipPlanUpdateArgs<ExtArgs>>): Prisma__GymMembershipPlanClient<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more GymMembershipPlans.
     * @param {GymMembershipPlanDeleteManyArgs} args - Arguments to filter GymMembershipPlans to delete.
     * @example
     * // Delete a few GymMembershipPlans
     * const { count } = await prisma.gymMembershipPlan.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GymMembershipPlanDeleteManyArgs>(args?: SelectSubset<T, GymMembershipPlanDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GymMembershipPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipPlanUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GymMembershipPlans
     * const gymMembershipPlan = await prisma.gymMembershipPlan.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GymMembershipPlanUpdateManyArgs>(args: SelectSubset<T, GymMembershipPlanUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one GymMembershipPlan.
     * @param {GymMembershipPlanUpsertArgs} args - Arguments to update or create a GymMembershipPlan.
     * @example
     * // Update or create a GymMembershipPlan
     * const gymMembershipPlan = await prisma.gymMembershipPlan.upsert({
     *   create: {
     *     // ... data to create a GymMembershipPlan
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GymMembershipPlan we want to update
     *   }
     * })
     */
    upsert<T extends GymMembershipPlanUpsertArgs>(args: SelectSubset<T, GymMembershipPlanUpsertArgs<ExtArgs>>): Prisma__GymMembershipPlanClient<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of GymMembershipPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipPlanCountArgs} args - Arguments to filter GymMembershipPlans to count.
     * @example
     * // Count the number of GymMembershipPlans
     * const count = await prisma.gymMembershipPlan.count({
     *   where: {
     *     // ... the filter for the GymMembershipPlans we want to count
     *   }
     * })
    **/
    count<T extends GymMembershipPlanCountArgs>(
      args?: Subset<T, GymMembershipPlanCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GymMembershipPlanCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GymMembershipPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipPlanAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends GymMembershipPlanAggregateArgs>(args: Subset<T, GymMembershipPlanAggregateArgs>): Prisma.PrismaPromise<GetGymMembershipPlanAggregateType<T>>

    /**
     * Group by GymMembershipPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipPlanGroupByArgs} args - Group by arguments.
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
      T extends GymMembershipPlanGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GymMembershipPlanGroupByArgs['orderBy'] }
        : { orderBy?: GymMembershipPlanGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, GymMembershipPlanGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGymMembershipPlanGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GymMembershipPlan model
   */
  readonly fields: GymMembershipPlanFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GymMembershipPlan.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GymMembershipPlanClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    gym<T extends GymDefaultArgs<ExtArgs> = {}>(args?: Subset<T, GymDefaultArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    memberships<T extends GymMembershipPlan$membershipsArgs<ExtArgs> = {}>(args?: Subset<T, GymMembershipPlan$membershipsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the GymMembershipPlan model
   */ 
  interface GymMembershipPlanFieldRefs {
    readonly id: FieldRef<"GymMembershipPlan", 'String'>
    readonly gymId: FieldRef<"GymMembershipPlan", 'String'>
    readonly name: FieldRef<"GymMembershipPlan", 'String'>
    readonly description: FieldRef<"GymMembershipPlan", 'String'>
    readonly price: FieldRef<"GymMembershipPlan", 'Decimal'>
    readonly durationDays: FieldRef<"GymMembershipPlan", 'Int'>
    readonly visitLimit: FieldRef<"GymMembershipPlan", 'Int'>
    readonly status: FieldRef<"GymMembershipPlan", 'GymMembershipPlanStatus'>
    readonly createdAt: FieldRef<"GymMembershipPlan", 'DateTime'>
    readonly updatedAt: FieldRef<"GymMembershipPlan", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GymMembershipPlan findUnique
   */
  export type GymMembershipPlanFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipPlan to fetch.
     */
    where: GymMembershipPlanWhereUniqueInput
  }

  /**
   * GymMembershipPlan findUniqueOrThrow
   */
  export type GymMembershipPlanFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipPlan to fetch.
     */
    where: GymMembershipPlanWhereUniqueInput
  }

  /**
   * GymMembershipPlan findFirst
   */
  export type GymMembershipPlanFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipPlan to fetch.
     */
    where?: GymMembershipPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipPlans to fetch.
     */
    orderBy?: GymMembershipPlanOrderByWithRelationInput | GymMembershipPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymMembershipPlans.
     */
    cursor?: GymMembershipPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymMembershipPlans.
     */
    distinct?: GymMembershipPlanScalarFieldEnum | GymMembershipPlanScalarFieldEnum[]
  }

  /**
   * GymMembershipPlan findFirstOrThrow
   */
  export type GymMembershipPlanFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipPlan to fetch.
     */
    where?: GymMembershipPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipPlans to fetch.
     */
    orderBy?: GymMembershipPlanOrderByWithRelationInput | GymMembershipPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymMembershipPlans.
     */
    cursor?: GymMembershipPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymMembershipPlans.
     */
    distinct?: GymMembershipPlanScalarFieldEnum | GymMembershipPlanScalarFieldEnum[]
  }

  /**
   * GymMembershipPlan findMany
   */
  export type GymMembershipPlanFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipPlans to fetch.
     */
    where?: GymMembershipPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipPlans to fetch.
     */
    orderBy?: GymMembershipPlanOrderByWithRelationInput | GymMembershipPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GymMembershipPlans.
     */
    cursor?: GymMembershipPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipPlans.
     */
    skip?: number
    distinct?: GymMembershipPlanScalarFieldEnum | GymMembershipPlanScalarFieldEnum[]
  }

  /**
   * GymMembershipPlan create
   */
  export type GymMembershipPlanCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    /**
     * The data needed to create a GymMembershipPlan.
     */
    data: XOR<GymMembershipPlanCreateInput, GymMembershipPlanUncheckedCreateInput>
  }

  /**
   * GymMembershipPlan createMany
   */
  export type GymMembershipPlanCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GymMembershipPlans.
     */
    data: GymMembershipPlanCreateManyInput | GymMembershipPlanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GymMembershipPlan createManyAndReturn
   */
  export type GymMembershipPlanCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many GymMembershipPlans.
     */
    data: GymMembershipPlanCreateManyInput | GymMembershipPlanCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * GymMembershipPlan update
   */
  export type GymMembershipPlanUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    /**
     * The data needed to update a GymMembershipPlan.
     */
    data: XOR<GymMembershipPlanUpdateInput, GymMembershipPlanUncheckedUpdateInput>
    /**
     * Choose, which GymMembershipPlan to update.
     */
    where: GymMembershipPlanWhereUniqueInput
  }

  /**
   * GymMembershipPlan updateMany
   */
  export type GymMembershipPlanUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GymMembershipPlans.
     */
    data: XOR<GymMembershipPlanUpdateManyMutationInput, GymMembershipPlanUncheckedUpdateManyInput>
    /**
     * Filter which GymMembershipPlans to update
     */
    where?: GymMembershipPlanWhereInput
  }

  /**
   * GymMembershipPlan upsert
   */
  export type GymMembershipPlanUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    /**
     * The filter to search for the GymMembershipPlan to update in case it exists.
     */
    where: GymMembershipPlanWhereUniqueInput
    /**
     * In case the GymMembershipPlan found by the `where` argument doesn't exist, create a new GymMembershipPlan with this data.
     */
    create: XOR<GymMembershipPlanCreateInput, GymMembershipPlanUncheckedCreateInput>
    /**
     * In case the GymMembershipPlan was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GymMembershipPlanUpdateInput, GymMembershipPlanUncheckedUpdateInput>
  }

  /**
   * GymMembershipPlan delete
   */
  export type GymMembershipPlanDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
    /**
     * Filter which GymMembershipPlan to delete.
     */
    where: GymMembershipPlanWhereUniqueInput
  }

  /**
   * GymMembershipPlan deleteMany
   */
  export type GymMembershipPlanDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymMembershipPlans to delete
     */
    where?: GymMembershipPlanWhereInput
  }

  /**
   * GymMembershipPlan.memberships
   */
  export type GymMembershipPlan$membershipsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    where?: GymMembershipContractWhereInput
    orderBy?: GymMembershipContractOrderByWithRelationInput | GymMembershipContractOrderByWithRelationInput[]
    cursor?: GymMembershipContractWhereUniqueInput
    take?: number
    skip?: number
    distinct?: GymMembershipContractScalarFieldEnum | GymMembershipContractScalarFieldEnum[]
  }

  /**
   * GymMembershipPlan without action
   */
  export type GymMembershipPlanDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipPlan
     */
    select?: GymMembershipPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipPlanInclude<ExtArgs> | null
  }


  /**
   * Model GymMembershipContract
   */

  export type AggregateGymMembershipContract = {
    _count: GymMembershipContractCountAggregateOutputType | null
    _avg: GymMembershipContractAvgAggregateOutputType | null
    _sum: GymMembershipContractSumAggregateOutputType | null
    _min: GymMembershipContractMinAggregateOutputType | null
    _max: GymMembershipContractMaxAggregateOutputType | null
  }

  export type GymMembershipContractAvgAggregateOutputType = {
    priceAtPurchase: Decimal | null
    durationDaysSnapshot: number | null
    totalVisits: number | null
    usedVisits: number | null
  }

  export type GymMembershipContractSumAggregateOutputType = {
    priceAtPurchase: Decimal | null
    durationDaysSnapshot: number | null
    totalVisits: number | null
    usedVisits: number | null
  }

  export type GymMembershipContractMinAggregateOutputType = {
    id: string | null
    gymId: string | null
    planId: string | null
    clientId: string | null
    status: $Enums.GymMembershipContractStatus | null
    paymentTxnId: string | null
    startDate: Date | null
    endDate: Date | null
    priceAtPurchase: Decimal | null
    durationDaysSnapshot: number | null
    totalVisits: number | null
    usedVisits: number | null
    payoutReleasedAt: Date | null
    multiGymWarned: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymMembershipContractMaxAggregateOutputType = {
    id: string | null
    gymId: string | null
    planId: string | null
    clientId: string | null
    status: $Enums.GymMembershipContractStatus | null
    paymentTxnId: string | null
    startDate: Date | null
    endDate: Date | null
    priceAtPurchase: Decimal | null
    durationDaysSnapshot: number | null
    totalVisits: number | null
    usedVisits: number | null
    payoutReleasedAt: Date | null
    multiGymWarned: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymMembershipContractCountAggregateOutputType = {
    id: number
    gymId: number
    planId: number
    clientId: number
    status: number
    paymentTxnId: number
    startDate: number
    endDate: number
    priceAtPurchase: number
    durationDaysSnapshot: number
    totalVisits: number
    usedVisits: number
    payoutReleasedAt: number
    multiGymWarned: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type GymMembershipContractAvgAggregateInputType = {
    priceAtPurchase?: true
    durationDaysSnapshot?: true
    totalVisits?: true
    usedVisits?: true
  }

  export type GymMembershipContractSumAggregateInputType = {
    priceAtPurchase?: true
    durationDaysSnapshot?: true
    totalVisits?: true
    usedVisits?: true
  }

  export type GymMembershipContractMinAggregateInputType = {
    id?: true
    gymId?: true
    planId?: true
    clientId?: true
    status?: true
    paymentTxnId?: true
    startDate?: true
    endDate?: true
    priceAtPurchase?: true
    durationDaysSnapshot?: true
    totalVisits?: true
    usedVisits?: true
    payoutReleasedAt?: true
    multiGymWarned?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymMembershipContractMaxAggregateInputType = {
    id?: true
    gymId?: true
    planId?: true
    clientId?: true
    status?: true
    paymentTxnId?: true
    startDate?: true
    endDate?: true
    priceAtPurchase?: true
    durationDaysSnapshot?: true
    totalVisits?: true
    usedVisits?: true
    payoutReleasedAt?: true
    multiGymWarned?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymMembershipContractCountAggregateInputType = {
    id?: true
    gymId?: true
    planId?: true
    clientId?: true
    status?: true
    paymentTxnId?: true
    startDate?: true
    endDate?: true
    priceAtPurchase?: true
    durationDaysSnapshot?: true
    totalVisits?: true
    usedVisits?: true
    payoutReleasedAt?: true
    multiGymWarned?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type GymMembershipContractAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymMembershipContract to aggregate.
     */
    where?: GymMembershipContractWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipContracts to fetch.
     */
    orderBy?: GymMembershipContractOrderByWithRelationInput | GymMembershipContractOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GymMembershipContractWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipContracts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipContracts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GymMembershipContracts
    **/
    _count?: true | GymMembershipContractCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: GymMembershipContractAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: GymMembershipContractSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GymMembershipContractMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GymMembershipContractMaxAggregateInputType
  }

  export type GetGymMembershipContractAggregateType<T extends GymMembershipContractAggregateArgs> = {
        [P in keyof T & keyof AggregateGymMembershipContract]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGymMembershipContract[P]>
      : GetScalarType<T[P], AggregateGymMembershipContract[P]>
  }




  export type GymMembershipContractGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymMembershipContractWhereInput
    orderBy?: GymMembershipContractOrderByWithAggregationInput | GymMembershipContractOrderByWithAggregationInput[]
    by: GymMembershipContractScalarFieldEnum[] | GymMembershipContractScalarFieldEnum
    having?: GymMembershipContractScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GymMembershipContractCountAggregateInputType | true
    _avg?: GymMembershipContractAvgAggregateInputType
    _sum?: GymMembershipContractSumAggregateInputType
    _min?: GymMembershipContractMinAggregateInputType
    _max?: GymMembershipContractMaxAggregateInputType
  }

  export type GymMembershipContractGroupByOutputType = {
    id: string
    gymId: string
    planId: string
    clientId: string
    status: $Enums.GymMembershipContractStatus
    paymentTxnId: string | null
    startDate: Date | null
    endDate: Date | null
    priceAtPurchase: Decimal
    durationDaysSnapshot: number
    totalVisits: number | null
    usedVisits: number
    payoutReleasedAt: Date | null
    multiGymWarned: boolean
    createdAt: Date
    updatedAt: Date
    _count: GymMembershipContractCountAggregateOutputType | null
    _avg: GymMembershipContractAvgAggregateOutputType | null
    _sum: GymMembershipContractSumAggregateOutputType | null
    _min: GymMembershipContractMinAggregateOutputType | null
    _max: GymMembershipContractMaxAggregateOutputType | null
  }

  type GetGymMembershipContractGroupByPayload<T extends GymMembershipContractGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GymMembershipContractGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GymMembershipContractGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GymMembershipContractGroupByOutputType[P]>
            : GetScalarType<T[P], GymMembershipContractGroupByOutputType[P]>
        }
      >
    >


  export type GymMembershipContractSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    planId?: boolean
    clientId?: boolean
    status?: boolean
    paymentTxnId?: boolean
    startDate?: boolean
    endDate?: boolean
    priceAtPurchase?: boolean
    durationDaysSnapshot?: boolean
    totalVisits?: boolean
    usedVisits?: boolean
    payoutReleasedAt?: boolean
    multiGymWarned?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
    plan?: boolean | GymMembershipPlanDefaultArgs<ExtArgs>
    checkIns?: boolean | GymMembershipContract$checkInsArgs<ExtArgs>
    referral?: boolean | GymMembershipContract$referralArgs<ExtArgs>
    _count?: boolean | GymMembershipContractCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymMembershipContract"]>

  export type GymMembershipContractSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    planId?: boolean
    clientId?: boolean
    status?: boolean
    paymentTxnId?: boolean
    startDate?: boolean
    endDate?: boolean
    priceAtPurchase?: boolean
    durationDaysSnapshot?: boolean
    totalVisits?: boolean
    usedVisits?: boolean
    payoutReleasedAt?: boolean
    multiGymWarned?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
    plan?: boolean | GymMembershipPlanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymMembershipContract"]>

  export type GymMembershipContractSelectScalar = {
    id?: boolean
    gymId?: boolean
    planId?: boolean
    clientId?: boolean
    status?: boolean
    paymentTxnId?: boolean
    startDate?: boolean
    endDate?: boolean
    priceAtPurchase?: boolean
    durationDaysSnapshot?: boolean
    totalVisits?: boolean
    usedVisits?: boolean
    payoutReleasedAt?: boolean
    multiGymWarned?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type GymMembershipContractInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
    plan?: boolean | GymMembershipPlanDefaultArgs<ExtArgs>
    checkIns?: boolean | GymMembershipContract$checkInsArgs<ExtArgs>
    referral?: boolean | GymMembershipContract$referralArgs<ExtArgs>
    _count?: boolean | GymMembershipContractCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type GymMembershipContractIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
    plan?: boolean | GymMembershipPlanDefaultArgs<ExtArgs>
  }

  export type $GymMembershipContractPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GymMembershipContract"
    objects: {
      gym: Prisma.$GymPayload<ExtArgs>
      plan: Prisma.$GymMembershipPlanPayload<ExtArgs>
      checkIns: Prisma.$GymCheckInPayload<ExtArgs>[]
      referral: Prisma.$GymMembershipReferralPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      gymId: string
      planId: string
      clientId: string
      status: $Enums.GymMembershipContractStatus
      paymentTxnId: string | null
      startDate: Date | null
      endDate: Date | null
      priceAtPurchase: Prisma.Decimal
      durationDaysSnapshot: number
      totalVisits: number | null
      usedVisits: number
      /**
       * Stamped once the pending-bucket payout (gym + platform + any un-clawed referral
       * commission) has been released to AVAILABLE. Set by the payout sweep on natural
       * expiry, or immediately on client self-cancel / admin refund — see docs/money-flow.md.
       * Guards membership-release against double-releasing the same membership.
       */
      payoutReleasedAt: Date | null
      /**
       * True when the client confirmed purchase after being shown a warning that they already
       * hold an active membership at a different gym — evidence against "I didn't know I still
       * had one elsewhere" disputes.
       */
      multiGymWarned: boolean
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["gymMembershipContract"]>
    composites: {}
  }

  type GymMembershipContractGetPayload<S extends boolean | null | undefined | GymMembershipContractDefaultArgs> = $Result.GetResult<Prisma.$GymMembershipContractPayload, S>

  type GymMembershipContractCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<GymMembershipContractFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: GymMembershipContractCountAggregateInputType | true
    }

  export interface GymMembershipContractDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GymMembershipContract'], meta: { name: 'GymMembershipContract' } }
    /**
     * Find zero or one GymMembershipContract that matches the filter.
     * @param {GymMembershipContractFindUniqueArgs} args - Arguments to find a GymMembershipContract
     * @example
     * // Get one GymMembershipContract
     * const gymMembershipContract = await prisma.gymMembershipContract.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GymMembershipContractFindUniqueArgs>(args: SelectSubset<T, GymMembershipContractFindUniqueArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one GymMembershipContract that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {GymMembershipContractFindUniqueOrThrowArgs} args - Arguments to find a GymMembershipContract
     * @example
     * // Get one GymMembershipContract
     * const gymMembershipContract = await prisma.gymMembershipContract.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GymMembershipContractFindUniqueOrThrowArgs>(args: SelectSubset<T, GymMembershipContractFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first GymMembershipContract that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipContractFindFirstArgs} args - Arguments to find a GymMembershipContract
     * @example
     * // Get one GymMembershipContract
     * const gymMembershipContract = await prisma.gymMembershipContract.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GymMembershipContractFindFirstArgs>(args?: SelectSubset<T, GymMembershipContractFindFirstArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first GymMembershipContract that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipContractFindFirstOrThrowArgs} args - Arguments to find a GymMembershipContract
     * @example
     * // Get one GymMembershipContract
     * const gymMembershipContract = await prisma.gymMembershipContract.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GymMembershipContractFindFirstOrThrowArgs>(args?: SelectSubset<T, GymMembershipContractFindFirstOrThrowArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more GymMembershipContracts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipContractFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GymMembershipContracts
     * const gymMembershipContracts = await prisma.gymMembershipContract.findMany()
     * 
     * // Get first 10 GymMembershipContracts
     * const gymMembershipContracts = await prisma.gymMembershipContract.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const gymMembershipContractWithIdOnly = await prisma.gymMembershipContract.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GymMembershipContractFindManyArgs>(args?: SelectSubset<T, GymMembershipContractFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a GymMembershipContract.
     * @param {GymMembershipContractCreateArgs} args - Arguments to create a GymMembershipContract.
     * @example
     * // Create one GymMembershipContract
     * const GymMembershipContract = await prisma.gymMembershipContract.create({
     *   data: {
     *     // ... data to create a GymMembershipContract
     *   }
     * })
     * 
     */
    create<T extends GymMembershipContractCreateArgs>(args: SelectSubset<T, GymMembershipContractCreateArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many GymMembershipContracts.
     * @param {GymMembershipContractCreateManyArgs} args - Arguments to create many GymMembershipContracts.
     * @example
     * // Create many GymMembershipContracts
     * const gymMembershipContract = await prisma.gymMembershipContract.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GymMembershipContractCreateManyArgs>(args?: SelectSubset<T, GymMembershipContractCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GymMembershipContracts and returns the data saved in the database.
     * @param {GymMembershipContractCreateManyAndReturnArgs} args - Arguments to create many GymMembershipContracts.
     * @example
     * // Create many GymMembershipContracts
     * const gymMembershipContract = await prisma.gymMembershipContract.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GymMembershipContracts and only return the `id`
     * const gymMembershipContractWithIdOnly = await prisma.gymMembershipContract.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GymMembershipContractCreateManyAndReturnArgs>(args?: SelectSubset<T, GymMembershipContractCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a GymMembershipContract.
     * @param {GymMembershipContractDeleteArgs} args - Arguments to delete one GymMembershipContract.
     * @example
     * // Delete one GymMembershipContract
     * const GymMembershipContract = await prisma.gymMembershipContract.delete({
     *   where: {
     *     // ... filter to delete one GymMembershipContract
     *   }
     * })
     * 
     */
    delete<T extends GymMembershipContractDeleteArgs>(args: SelectSubset<T, GymMembershipContractDeleteArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one GymMembershipContract.
     * @param {GymMembershipContractUpdateArgs} args - Arguments to update one GymMembershipContract.
     * @example
     * // Update one GymMembershipContract
     * const gymMembershipContract = await prisma.gymMembershipContract.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GymMembershipContractUpdateArgs>(args: SelectSubset<T, GymMembershipContractUpdateArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more GymMembershipContracts.
     * @param {GymMembershipContractDeleteManyArgs} args - Arguments to filter GymMembershipContracts to delete.
     * @example
     * // Delete a few GymMembershipContracts
     * const { count } = await prisma.gymMembershipContract.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GymMembershipContractDeleteManyArgs>(args?: SelectSubset<T, GymMembershipContractDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GymMembershipContracts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipContractUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GymMembershipContracts
     * const gymMembershipContract = await prisma.gymMembershipContract.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GymMembershipContractUpdateManyArgs>(args: SelectSubset<T, GymMembershipContractUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one GymMembershipContract.
     * @param {GymMembershipContractUpsertArgs} args - Arguments to update or create a GymMembershipContract.
     * @example
     * // Update or create a GymMembershipContract
     * const gymMembershipContract = await prisma.gymMembershipContract.upsert({
     *   create: {
     *     // ... data to create a GymMembershipContract
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GymMembershipContract we want to update
     *   }
     * })
     */
    upsert<T extends GymMembershipContractUpsertArgs>(args: SelectSubset<T, GymMembershipContractUpsertArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of GymMembershipContracts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipContractCountArgs} args - Arguments to filter GymMembershipContracts to count.
     * @example
     * // Count the number of GymMembershipContracts
     * const count = await prisma.gymMembershipContract.count({
     *   where: {
     *     // ... the filter for the GymMembershipContracts we want to count
     *   }
     * })
    **/
    count<T extends GymMembershipContractCountArgs>(
      args?: Subset<T, GymMembershipContractCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GymMembershipContractCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GymMembershipContract.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipContractAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends GymMembershipContractAggregateArgs>(args: Subset<T, GymMembershipContractAggregateArgs>): Prisma.PrismaPromise<GetGymMembershipContractAggregateType<T>>

    /**
     * Group by GymMembershipContract.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipContractGroupByArgs} args - Group by arguments.
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
      T extends GymMembershipContractGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GymMembershipContractGroupByArgs['orderBy'] }
        : { orderBy?: GymMembershipContractGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, GymMembershipContractGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGymMembershipContractGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GymMembershipContract model
   */
  readonly fields: GymMembershipContractFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GymMembershipContract.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GymMembershipContractClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    gym<T extends GymDefaultArgs<ExtArgs> = {}>(args?: Subset<T, GymDefaultArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    plan<T extends GymMembershipPlanDefaultArgs<ExtArgs> = {}>(args?: Subset<T, GymMembershipPlanDefaultArgs<ExtArgs>>): Prisma__GymMembershipPlanClient<$Result.GetResult<Prisma.$GymMembershipPlanPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    checkIns<T extends GymMembershipContract$checkInsArgs<ExtArgs> = {}>(args?: Subset<T, GymMembershipContract$checkInsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "findMany"> | Null>
    referral<T extends GymMembershipContract$referralArgs<ExtArgs> = {}>(args?: Subset<T, GymMembershipContract$referralArgs<ExtArgs>>): Prisma__GymMembershipReferralClient<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
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
   * Fields of the GymMembershipContract model
   */ 
  interface GymMembershipContractFieldRefs {
    readonly id: FieldRef<"GymMembershipContract", 'String'>
    readonly gymId: FieldRef<"GymMembershipContract", 'String'>
    readonly planId: FieldRef<"GymMembershipContract", 'String'>
    readonly clientId: FieldRef<"GymMembershipContract", 'String'>
    readonly status: FieldRef<"GymMembershipContract", 'GymMembershipContractStatus'>
    readonly paymentTxnId: FieldRef<"GymMembershipContract", 'String'>
    readonly startDate: FieldRef<"GymMembershipContract", 'DateTime'>
    readonly endDate: FieldRef<"GymMembershipContract", 'DateTime'>
    readonly priceAtPurchase: FieldRef<"GymMembershipContract", 'Decimal'>
    readonly durationDaysSnapshot: FieldRef<"GymMembershipContract", 'Int'>
    readonly totalVisits: FieldRef<"GymMembershipContract", 'Int'>
    readonly usedVisits: FieldRef<"GymMembershipContract", 'Int'>
    readonly payoutReleasedAt: FieldRef<"GymMembershipContract", 'DateTime'>
    readonly multiGymWarned: FieldRef<"GymMembershipContract", 'Boolean'>
    readonly createdAt: FieldRef<"GymMembershipContract", 'DateTime'>
    readonly updatedAt: FieldRef<"GymMembershipContract", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GymMembershipContract findUnique
   */
  export type GymMembershipContractFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipContract to fetch.
     */
    where: GymMembershipContractWhereUniqueInput
  }

  /**
   * GymMembershipContract findUniqueOrThrow
   */
  export type GymMembershipContractFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipContract to fetch.
     */
    where: GymMembershipContractWhereUniqueInput
  }

  /**
   * GymMembershipContract findFirst
   */
  export type GymMembershipContractFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipContract to fetch.
     */
    where?: GymMembershipContractWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipContracts to fetch.
     */
    orderBy?: GymMembershipContractOrderByWithRelationInput | GymMembershipContractOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymMembershipContracts.
     */
    cursor?: GymMembershipContractWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipContracts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipContracts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymMembershipContracts.
     */
    distinct?: GymMembershipContractScalarFieldEnum | GymMembershipContractScalarFieldEnum[]
  }

  /**
   * GymMembershipContract findFirstOrThrow
   */
  export type GymMembershipContractFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipContract to fetch.
     */
    where?: GymMembershipContractWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipContracts to fetch.
     */
    orderBy?: GymMembershipContractOrderByWithRelationInput | GymMembershipContractOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymMembershipContracts.
     */
    cursor?: GymMembershipContractWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipContracts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipContracts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymMembershipContracts.
     */
    distinct?: GymMembershipContractScalarFieldEnum | GymMembershipContractScalarFieldEnum[]
  }

  /**
   * GymMembershipContract findMany
   */
  export type GymMembershipContractFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipContracts to fetch.
     */
    where?: GymMembershipContractWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipContracts to fetch.
     */
    orderBy?: GymMembershipContractOrderByWithRelationInput | GymMembershipContractOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GymMembershipContracts.
     */
    cursor?: GymMembershipContractWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipContracts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipContracts.
     */
    skip?: number
    distinct?: GymMembershipContractScalarFieldEnum | GymMembershipContractScalarFieldEnum[]
  }

  /**
   * GymMembershipContract create
   */
  export type GymMembershipContractCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    /**
     * The data needed to create a GymMembershipContract.
     */
    data: XOR<GymMembershipContractCreateInput, GymMembershipContractUncheckedCreateInput>
  }

  /**
   * GymMembershipContract createMany
   */
  export type GymMembershipContractCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GymMembershipContracts.
     */
    data: GymMembershipContractCreateManyInput | GymMembershipContractCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GymMembershipContract createManyAndReturn
   */
  export type GymMembershipContractCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many GymMembershipContracts.
     */
    data: GymMembershipContractCreateManyInput | GymMembershipContractCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * GymMembershipContract update
   */
  export type GymMembershipContractUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    /**
     * The data needed to update a GymMembershipContract.
     */
    data: XOR<GymMembershipContractUpdateInput, GymMembershipContractUncheckedUpdateInput>
    /**
     * Choose, which GymMembershipContract to update.
     */
    where: GymMembershipContractWhereUniqueInput
  }

  /**
   * GymMembershipContract updateMany
   */
  export type GymMembershipContractUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GymMembershipContracts.
     */
    data: XOR<GymMembershipContractUpdateManyMutationInput, GymMembershipContractUncheckedUpdateManyInput>
    /**
     * Filter which GymMembershipContracts to update
     */
    where?: GymMembershipContractWhereInput
  }

  /**
   * GymMembershipContract upsert
   */
  export type GymMembershipContractUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    /**
     * The filter to search for the GymMembershipContract to update in case it exists.
     */
    where: GymMembershipContractWhereUniqueInput
    /**
     * In case the GymMembershipContract found by the `where` argument doesn't exist, create a new GymMembershipContract with this data.
     */
    create: XOR<GymMembershipContractCreateInput, GymMembershipContractUncheckedCreateInput>
    /**
     * In case the GymMembershipContract was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GymMembershipContractUpdateInput, GymMembershipContractUncheckedUpdateInput>
  }

  /**
   * GymMembershipContract delete
   */
  export type GymMembershipContractDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
    /**
     * Filter which GymMembershipContract to delete.
     */
    where: GymMembershipContractWhereUniqueInput
  }

  /**
   * GymMembershipContract deleteMany
   */
  export type GymMembershipContractDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymMembershipContracts to delete
     */
    where?: GymMembershipContractWhereInput
  }

  /**
   * GymMembershipContract.checkIns
   */
  export type GymMembershipContract$checkInsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    where?: GymCheckInWhereInput
    orderBy?: GymCheckInOrderByWithRelationInput | GymCheckInOrderByWithRelationInput[]
    cursor?: GymCheckInWhereUniqueInput
    take?: number
    skip?: number
    distinct?: GymCheckInScalarFieldEnum | GymCheckInScalarFieldEnum[]
  }

  /**
   * GymMembershipContract.referral
   */
  export type GymMembershipContract$referralArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    where?: GymMembershipReferralWhereInput
  }

  /**
   * GymMembershipContract without action
   */
  export type GymMembershipContractDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipContract
     */
    select?: GymMembershipContractSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipContractInclude<ExtArgs> | null
  }


  /**
   * Model GymTrainerAffiliation
   */

  export type AggregateGymTrainerAffiliation = {
    _count: GymTrainerAffiliationCountAggregateOutputType | null
    _avg: GymTrainerAffiliationAvgAggregateOutputType | null
    _sum: GymTrainerAffiliationSumAggregateOutputType | null
    _min: GymTrainerAffiliationMinAggregateOutputType | null
    _max: GymTrainerAffiliationMaxAggregateOutputType | null
  }

  export type GymTrainerAffiliationAvgAggregateOutputType = {
    commissionRate: Decimal | null
  }

  export type GymTrainerAffiliationSumAggregateOutputType = {
    commissionRate: Decimal | null
  }

  export type GymTrainerAffiliationMinAggregateOutputType = {
    id: string | null
    gymId: string | null
    ptId: string | null
    status: $Enums.AffiliationStatus | null
    employmentType: $Enums.AffiliationEmployment | null
    visibility: $Enums.GymTrainerVisibility | null
    commissionRate: Decimal | null
    invitedBy: string | null
    joinedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymTrainerAffiliationMaxAggregateOutputType = {
    id: string | null
    gymId: string | null
    ptId: string | null
    status: $Enums.AffiliationStatus | null
    employmentType: $Enums.AffiliationEmployment | null
    visibility: $Enums.GymTrainerVisibility | null
    commissionRate: Decimal | null
    invitedBy: string | null
    joinedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymTrainerAffiliationCountAggregateOutputType = {
    id: number
    gymId: number
    ptId: number
    status: number
    employmentType: number
    visibility: number
    commissionRate: number
    invitedBy: number
    joinedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type GymTrainerAffiliationAvgAggregateInputType = {
    commissionRate?: true
  }

  export type GymTrainerAffiliationSumAggregateInputType = {
    commissionRate?: true
  }

  export type GymTrainerAffiliationMinAggregateInputType = {
    id?: true
    gymId?: true
    ptId?: true
    status?: true
    employmentType?: true
    visibility?: true
    commissionRate?: true
    invitedBy?: true
    joinedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymTrainerAffiliationMaxAggregateInputType = {
    id?: true
    gymId?: true
    ptId?: true
    status?: true
    employmentType?: true
    visibility?: true
    commissionRate?: true
    invitedBy?: true
    joinedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymTrainerAffiliationCountAggregateInputType = {
    id?: true
    gymId?: true
    ptId?: true
    status?: true
    employmentType?: true
    visibility?: true
    commissionRate?: true
    invitedBy?: true
    joinedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type GymTrainerAffiliationAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymTrainerAffiliation to aggregate.
     */
    where?: GymTrainerAffiliationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymTrainerAffiliations to fetch.
     */
    orderBy?: GymTrainerAffiliationOrderByWithRelationInput | GymTrainerAffiliationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GymTrainerAffiliationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymTrainerAffiliations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymTrainerAffiliations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GymTrainerAffiliations
    **/
    _count?: true | GymTrainerAffiliationCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: GymTrainerAffiliationAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: GymTrainerAffiliationSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GymTrainerAffiliationMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GymTrainerAffiliationMaxAggregateInputType
  }

  export type GetGymTrainerAffiliationAggregateType<T extends GymTrainerAffiliationAggregateArgs> = {
        [P in keyof T & keyof AggregateGymTrainerAffiliation]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGymTrainerAffiliation[P]>
      : GetScalarType<T[P], AggregateGymTrainerAffiliation[P]>
  }




  export type GymTrainerAffiliationGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymTrainerAffiliationWhereInput
    orderBy?: GymTrainerAffiliationOrderByWithAggregationInput | GymTrainerAffiliationOrderByWithAggregationInput[]
    by: GymTrainerAffiliationScalarFieldEnum[] | GymTrainerAffiliationScalarFieldEnum
    having?: GymTrainerAffiliationScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GymTrainerAffiliationCountAggregateInputType | true
    _avg?: GymTrainerAffiliationAvgAggregateInputType
    _sum?: GymTrainerAffiliationSumAggregateInputType
    _min?: GymTrainerAffiliationMinAggregateInputType
    _max?: GymTrainerAffiliationMaxAggregateInputType
  }

  export type GymTrainerAffiliationGroupByOutputType = {
    id: string
    gymId: string
    ptId: string
    status: $Enums.AffiliationStatus
    employmentType: $Enums.AffiliationEmployment
    visibility: $Enums.GymTrainerVisibility
    commissionRate: Decimal | null
    invitedBy: string | null
    joinedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: GymTrainerAffiliationCountAggregateOutputType | null
    _avg: GymTrainerAffiliationAvgAggregateOutputType | null
    _sum: GymTrainerAffiliationSumAggregateOutputType | null
    _min: GymTrainerAffiliationMinAggregateOutputType | null
    _max: GymTrainerAffiliationMaxAggregateOutputType | null
  }

  type GetGymTrainerAffiliationGroupByPayload<T extends GymTrainerAffiliationGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GymTrainerAffiliationGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GymTrainerAffiliationGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GymTrainerAffiliationGroupByOutputType[P]>
            : GetScalarType<T[P], GymTrainerAffiliationGroupByOutputType[P]>
        }
      >
    >


  export type GymTrainerAffiliationSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    ptId?: boolean
    status?: boolean
    employmentType?: boolean
    visibility?: boolean
    commissionRate?: boolean
    invitedBy?: boolean
    joinedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymTrainerAffiliation"]>

  export type GymTrainerAffiliationSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    ptId?: boolean
    status?: boolean
    employmentType?: boolean
    visibility?: boolean
    commissionRate?: boolean
    invitedBy?: boolean
    joinedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymTrainerAffiliation"]>

  export type GymTrainerAffiliationSelectScalar = {
    id?: boolean
    gymId?: boolean
    ptId?: boolean
    status?: boolean
    employmentType?: boolean
    visibility?: boolean
    commissionRate?: boolean
    invitedBy?: boolean
    joinedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type GymTrainerAffiliationInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }
  export type GymTrainerAffiliationIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }

  export type $GymTrainerAffiliationPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GymTrainerAffiliation"
    objects: {
      gym: Prisma.$GymPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      gymId: string
      ptId: string
      status: $Enums.AffiliationStatus
      employmentType: $Enums.AffiliationEmployment
      visibility: $Enums.GymTrainerVisibility
      commissionRate: Prisma.Decimal | null
      invitedBy: string | null
      joinedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["gymTrainerAffiliation"]>
    composites: {}
  }

  type GymTrainerAffiliationGetPayload<S extends boolean | null | undefined | GymTrainerAffiliationDefaultArgs> = $Result.GetResult<Prisma.$GymTrainerAffiliationPayload, S>

  type GymTrainerAffiliationCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<GymTrainerAffiliationFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: GymTrainerAffiliationCountAggregateInputType | true
    }

  export interface GymTrainerAffiliationDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GymTrainerAffiliation'], meta: { name: 'GymTrainerAffiliation' } }
    /**
     * Find zero or one GymTrainerAffiliation that matches the filter.
     * @param {GymTrainerAffiliationFindUniqueArgs} args - Arguments to find a GymTrainerAffiliation
     * @example
     * // Get one GymTrainerAffiliation
     * const gymTrainerAffiliation = await prisma.gymTrainerAffiliation.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GymTrainerAffiliationFindUniqueArgs>(args: SelectSubset<T, GymTrainerAffiliationFindUniqueArgs<ExtArgs>>): Prisma__GymTrainerAffiliationClient<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one GymTrainerAffiliation that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {GymTrainerAffiliationFindUniqueOrThrowArgs} args - Arguments to find a GymTrainerAffiliation
     * @example
     * // Get one GymTrainerAffiliation
     * const gymTrainerAffiliation = await prisma.gymTrainerAffiliation.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GymTrainerAffiliationFindUniqueOrThrowArgs>(args: SelectSubset<T, GymTrainerAffiliationFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GymTrainerAffiliationClient<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first GymTrainerAffiliation that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymTrainerAffiliationFindFirstArgs} args - Arguments to find a GymTrainerAffiliation
     * @example
     * // Get one GymTrainerAffiliation
     * const gymTrainerAffiliation = await prisma.gymTrainerAffiliation.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GymTrainerAffiliationFindFirstArgs>(args?: SelectSubset<T, GymTrainerAffiliationFindFirstArgs<ExtArgs>>): Prisma__GymTrainerAffiliationClient<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first GymTrainerAffiliation that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymTrainerAffiliationFindFirstOrThrowArgs} args - Arguments to find a GymTrainerAffiliation
     * @example
     * // Get one GymTrainerAffiliation
     * const gymTrainerAffiliation = await prisma.gymTrainerAffiliation.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GymTrainerAffiliationFindFirstOrThrowArgs>(args?: SelectSubset<T, GymTrainerAffiliationFindFirstOrThrowArgs<ExtArgs>>): Prisma__GymTrainerAffiliationClient<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more GymTrainerAffiliations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymTrainerAffiliationFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GymTrainerAffiliations
     * const gymTrainerAffiliations = await prisma.gymTrainerAffiliation.findMany()
     * 
     * // Get first 10 GymTrainerAffiliations
     * const gymTrainerAffiliations = await prisma.gymTrainerAffiliation.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const gymTrainerAffiliationWithIdOnly = await prisma.gymTrainerAffiliation.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GymTrainerAffiliationFindManyArgs>(args?: SelectSubset<T, GymTrainerAffiliationFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a GymTrainerAffiliation.
     * @param {GymTrainerAffiliationCreateArgs} args - Arguments to create a GymTrainerAffiliation.
     * @example
     * // Create one GymTrainerAffiliation
     * const GymTrainerAffiliation = await prisma.gymTrainerAffiliation.create({
     *   data: {
     *     // ... data to create a GymTrainerAffiliation
     *   }
     * })
     * 
     */
    create<T extends GymTrainerAffiliationCreateArgs>(args: SelectSubset<T, GymTrainerAffiliationCreateArgs<ExtArgs>>): Prisma__GymTrainerAffiliationClient<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many GymTrainerAffiliations.
     * @param {GymTrainerAffiliationCreateManyArgs} args - Arguments to create many GymTrainerAffiliations.
     * @example
     * // Create many GymTrainerAffiliations
     * const gymTrainerAffiliation = await prisma.gymTrainerAffiliation.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GymTrainerAffiliationCreateManyArgs>(args?: SelectSubset<T, GymTrainerAffiliationCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GymTrainerAffiliations and returns the data saved in the database.
     * @param {GymTrainerAffiliationCreateManyAndReturnArgs} args - Arguments to create many GymTrainerAffiliations.
     * @example
     * // Create many GymTrainerAffiliations
     * const gymTrainerAffiliation = await prisma.gymTrainerAffiliation.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GymTrainerAffiliations and only return the `id`
     * const gymTrainerAffiliationWithIdOnly = await prisma.gymTrainerAffiliation.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GymTrainerAffiliationCreateManyAndReturnArgs>(args?: SelectSubset<T, GymTrainerAffiliationCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a GymTrainerAffiliation.
     * @param {GymTrainerAffiliationDeleteArgs} args - Arguments to delete one GymTrainerAffiliation.
     * @example
     * // Delete one GymTrainerAffiliation
     * const GymTrainerAffiliation = await prisma.gymTrainerAffiliation.delete({
     *   where: {
     *     // ... filter to delete one GymTrainerAffiliation
     *   }
     * })
     * 
     */
    delete<T extends GymTrainerAffiliationDeleteArgs>(args: SelectSubset<T, GymTrainerAffiliationDeleteArgs<ExtArgs>>): Prisma__GymTrainerAffiliationClient<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one GymTrainerAffiliation.
     * @param {GymTrainerAffiliationUpdateArgs} args - Arguments to update one GymTrainerAffiliation.
     * @example
     * // Update one GymTrainerAffiliation
     * const gymTrainerAffiliation = await prisma.gymTrainerAffiliation.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GymTrainerAffiliationUpdateArgs>(args: SelectSubset<T, GymTrainerAffiliationUpdateArgs<ExtArgs>>): Prisma__GymTrainerAffiliationClient<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more GymTrainerAffiliations.
     * @param {GymTrainerAffiliationDeleteManyArgs} args - Arguments to filter GymTrainerAffiliations to delete.
     * @example
     * // Delete a few GymTrainerAffiliations
     * const { count } = await prisma.gymTrainerAffiliation.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GymTrainerAffiliationDeleteManyArgs>(args?: SelectSubset<T, GymTrainerAffiliationDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GymTrainerAffiliations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymTrainerAffiliationUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GymTrainerAffiliations
     * const gymTrainerAffiliation = await prisma.gymTrainerAffiliation.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GymTrainerAffiliationUpdateManyArgs>(args: SelectSubset<T, GymTrainerAffiliationUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one GymTrainerAffiliation.
     * @param {GymTrainerAffiliationUpsertArgs} args - Arguments to update or create a GymTrainerAffiliation.
     * @example
     * // Update or create a GymTrainerAffiliation
     * const gymTrainerAffiliation = await prisma.gymTrainerAffiliation.upsert({
     *   create: {
     *     // ... data to create a GymTrainerAffiliation
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GymTrainerAffiliation we want to update
     *   }
     * })
     */
    upsert<T extends GymTrainerAffiliationUpsertArgs>(args: SelectSubset<T, GymTrainerAffiliationUpsertArgs<ExtArgs>>): Prisma__GymTrainerAffiliationClient<$Result.GetResult<Prisma.$GymTrainerAffiliationPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of GymTrainerAffiliations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymTrainerAffiliationCountArgs} args - Arguments to filter GymTrainerAffiliations to count.
     * @example
     * // Count the number of GymTrainerAffiliations
     * const count = await prisma.gymTrainerAffiliation.count({
     *   where: {
     *     // ... the filter for the GymTrainerAffiliations we want to count
     *   }
     * })
    **/
    count<T extends GymTrainerAffiliationCountArgs>(
      args?: Subset<T, GymTrainerAffiliationCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GymTrainerAffiliationCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GymTrainerAffiliation.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymTrainerAffiliationAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends GymTrainerAffiliationAggregateArgs>(args: Subset<T, GymTrainerAffiliationAggregateArgs>): Prisma.PrismaPromise<GetGymTrainerAffiliationAggregateType<T>>

    /**
     * Group by GymTrainerAffiliation.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymTrainerAffiliationGroupByArgs} args - Group by arguments.
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
      T extends GymTrainerAffiliationGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GymTrainerAffiliationGroupByArgs['orderBy'] }
        : { orderBy?: GymTrainerAffiliationGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, GymTrainerAffiliationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGymTrainerAffiliationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GymTrainerAffiliation model
   */
  readonly fields: GymTrainerAffiliationFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GymTrainerAffiliation.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GymTrainerAffiliationClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    gym<T extends GymDefaultArgs<ExtArgs> = {}>(args?: Subset<T, GymDefaultArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the GymTrainerAffiliation model
   */ 
  interface GymTrainerAffiliationFieldRefs {
    readonly id: FieldRef<"GymTrainerAffiliation", 'String'>
    readonly gymId: FieldRef<"GymTrainerAffiliation", 'String'>
    readonly ptId: FieldRef<"GymTrainerAffiliation", 'String'>
    readonly status: FieldRef<"GymTrainerAffiliation", 'AffiliationStatus'>
    readonly employmentType: FieldRef<"GymTrainerAffiliation", 'AffiliationEmployment'>
    readonly visibility: FieldRef<"GymTrainerAffiliation", 'GymTrainerVisibility'>
    readonly commissionRate: FieldRef<"GymTrainerAffiliation", 'Decimal'>
    readonly invitedBy: FieldRef<"GymTrainerAffiliation", 'String'>
    readonly joinedAt: FieldRef<"GymTrainerAffiliation", 'DateTime'>
    readonly createdAt: FieldRef<"GymTrainerAffiliation", 'DateTime'>
    readonly updatedAt: FieldRef<"GymTrainerAffiliation", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GymTrainerAffiliation findUnique
   */
  export type GymTrainerAffiliationFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    /**
     * Filter, which GymTrainerAffiliation to fetch.
     */
    where: GymTrainerAffiliationWhereUniqueInput
  }

  /**
   * GymTrainerAffiliation findUniqueOrThrow
   */
  export type GymTrainerAffiliationFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    /**
     * Filter, which GymTrainerAffiliation to fetch.
     */
    where: GymTrainerAffiliationWhereUniqueInput
  }

  /**
   * GymTrainerAffiliation findFirst
   */
  export type GymTrainerAffiliationFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    /**
     * Filter, which GymTrainerAffiliation to fetch.
     */
    where?: GymTrainerAffiliationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymTrainerAffiliations to fetch.
     */
    orderBy?: GymTrainerAffiliationOrderByWithRelationInput | GymTrainerAffiliationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymTrainerAffiliations.
     */
    cursor?: GymTrainerAffiliationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymTrainerAffiliations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymTrainerAffiliations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymTrainerAffiliations.
     */
    distinct?: GymTrainerAffiliationScalarFieldEnum | GymTrainerAffiliationScalarFieldEnum[]
  }

  /**
   * GymTrainerAffiliation findFirstOrThrow
   */
  export type GymTrainerAffiliationFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    /**
     * Filter, which GymTrainerAffiliation to fetch.
     */
    where?: GymTrainerAffiliationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymTrainerAffiliations to fetch.
     */
    orderBy?: GymTrainerAffiliationOrderByWithRelationInput | GymTrainerAffiliationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymTrainerAffiliations.
     */
    cursor?: GymTrainerAffiliationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymTrainerAffiliations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymTrainerAffiliations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymTrainerAffiliations.
     */
    distinct?: GymTrainerAffiliationScalarFieldEnum | GymTrainerAffiliationScalarFieldEnum[]
  }

  /**
   * GymTrainerAffiliation findMany
   */
  export type GymTrainerAffiliationFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    /**
     * Filter, which GymTrainerAffiliations to fetch.
     */
    where?: GymTrainerAffiliationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymTrainerAffiliations to fetch.
     */
    orderBy?: GymTrainerAffiliationOrderByWithRelationInput | GymTrainerAffiliationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GymTrainerAffiliations.
     */
    cursor?: GymTrainerAffiliationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymTrainerAffiliations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymTrainerAffiliations.
     */
    skip?: number
    distinct?: GymTrainerAffiliationScalarFieldEnum | GymTrainerAffiliationScalarFieldEnum[]
  }

  /**
   * GymTrainerAffiliation create
   */
  export type GymTrainerAffiliationCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    /**
     * The data needed to create a GymTrainerAffiliation.
     */
    data: XOR<GymTrainerAffiliationCreateInput, GymTrainerAffiliationUncheckedCreateInput>
  }

  /**
   * GymTrainerAffiliation createMany
   */
  export type GymTrainerAffiliationCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GymTrainerAffiliations.
     */
    data: GymTrainerAffiliationCreateManyInput | GymTrainerAffiliationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GymTrainerAffiliation createManyAndReturn
   */
  export type GymTrainerAffiliationCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many GymTrainerAffiliations.
     */
    data: GymTrainerAffiliationCreateManyInput | GymTrainerAffiliationCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * GymTrainerAffiliation update
   */
  export type GymTrainerAffiliationUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    /**
     * The data needed to update a GymTrainerAffiliation.
     */
    data: XOR<GymTrainerAffiliationUpdateInput, GymTrainerAffiliationUncheckedUpdateInput>
    /**
     * Choose, which GymTrainerAffiliation to update.
     */
    where: GymTrainerAffiliationWhereUniqueInput
  }

  /**
   * GymTrainerAffiliation updateMany
   */
  export type GymTrainerAffiliationUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GymTrainerAffiliations.
     */
    data: XOR<GymTrainerAffiliationUpdateManyMutationInput, GymTrainerAffiliationUncheckedUpdateManyInput>
    /**
     * Filter which GymTrainerAffiliations to update
     */
    where?: GymTrainerAffiliationWhereInput
  }

  /**
   * GymTrainerAffiliation upsert
   */
  export type GymTrainerAffiliationUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    /**
     * The filter to search for the GymTrainerAffiliation to update in case it exists.
     */
    where: GymTrainerAffiliationWhereUniqueInput
    /**
     * In case the GymTrainerAffiliation found by the `where` argument doesn't exist, create a new GymTrainerAffiliation with this data.
     */
    create: XOR<GymTrainerAffiliationCreateInput, GymTrainerAffiliationUncheckedCreateInput>
    /**
     * In case the GymTrainerAffiliation was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GymTrainerAffiliationUpdateInput, GymTrainerAffiliationUncheckedUpdateInput>
  }

  /**
   * GymTrainerAffiliation delete
   */
  export type GymTrainerAffiliationDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
    /**
     * Filter which GymTrainerAffiliation to delete.
     */
    where: GymTrainerAffiliationWhereUniqueInput
  }

  /**
   * GymTrainerAffiliation deleteMany
   */
  export type GymTrainerAffiliationDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymTrainerAffiliations to delete
     */
    where?: GymTrainerAffiliationWhereInput
  }

  /**
   * GymTrainerAffiliation without action
   */
  export type GymTrainerAffiliationDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymTrainerAffiliation
     */
    select?: GymTrainerAffiliationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymTrainerAffiliationInclude<ExtArgs> | null
  }


  /**
   * Model GymCheckIn
   */

  export type AggregateGymCheckIn = {
    _count: GymCheckInCountAggregateOutputType | null
    _min: GymCheckInMinAggregateOutputType | null
    _max: GymCheckInMaxAggregateOutputType | null
  }

  export type GymCheckInMinAggregateOutputType = {
    id: string | null
    membershipId: string | null
    gymId: string | null
    clientId: string | null
    checkedInBy: string | null
    createdAt: Date | null
  }

  export type GymCheckInMaxAggregateOutputType = {
    id: string | null
    membershipId: string | null
    gymId: string | null
    clientId: string | null
    checkedInBy: string | null
    createdAt: Date | null
  }

  export type GymCheckInCountAggregateOutputType = {
    id: number
    membershipId: number
    gymId: number
    clientId: number
    checkedInBy: number
    createdAt: number
    _all: number
  }


  export type GymCheckInMinAggregateInputType = {
    id?: true
    membershipId?: true
    gymId?: true
    clientId?: true
    checkedInBy?: true
    createdAt?: true
  }

  export type GymCheckInMaxAggregateInputType = {
    id?: true
    membershipId?: true
    gymId?: true
    clientId?: true
    checkedInBy?: true
    createdAt?: true
  }

  export type GymCheckInCountAggregateInputType = {
    id?: true
    membershipId?: true
    gymId?: true
    clientId?: true
    checkedInBy?: true
    createdAt?: true
    _all?: true
  }

  export type GymCheckInAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymCheckIn to aggregate.
     */
    where?: GymCheckInWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymCheckIns to fetch.
     */
    orderBy?: GymCheckInOrderByWithRelationInput | GymCheckInOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GymCheckInWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymCheckIns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymCheckIns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GymCheckIns
    **/
    _count?: true | GymCheckInCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GymCheckInMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GymCheckInMaxAggregateInputType
  }

  export type GetGymCheckInAggregateType<T extends GymCheckInAggregateArgs> = {
        [P in keyof T & keyof AggregateGymCheckIn]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGymCheckIn[P]>
      : GetScalarType<T[P], AggregateGymCheckIn[P]>
  }




  export type GymCheckInGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymCheckInWhereInput
    orderBy?: GymCheckInOrderByWithAggregationInput | GymCheckInOrderByWithAggregationInput[]
    by: GymCheckInScalarFieldEnum[] | GymCheckInScalarFieldEnum
    having?: GymCheckInScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GymCheckInCountAggregateInputType | true
    _min?: GymCheckInMinAggregateInputType
    _max?: GymCheckInMaxAggregateInputType
  }

  export type GymCheckInGroupByOutputType = {
    id: string
    membershipId: string
    gymId: string
    clientId: string
    checkedInBy: string
    createdAt: Date
    _count: GymCheckInCountAggregateOutputType | null
    _min: GymCheckInMinAggregateOutputType | null
    _max: GymCheckInMaxAggregateOutputType | null
  }

  type GetGymCheckInGroupByPayload<T extends GymCheckInGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GymCheckInGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GymCheckInGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GymCheckInGroupByOutputType[P]>
            : GetScalarType<T[P], GymCheckInGroupByOutputType[P]>
        }
      >
    >


  export type GymCheckInSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    membershipId?: boolean
    gymId?: boolean
    clientId?: boolean
    checkedInBy?: boolean
    createdAt?: boolean
    membership?: boolean | GymMembershipContractDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymCheckIn"]>

  export type GymCheckInSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    membershipId?: boolean
    gymId?: boolean
    clientId?: boolean
    checkedInBy?: boolean
    createdAt?: boolean
    membership?: boolean | GymMembershipContractDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymCheckIn"]>

  export type GymCheckInSelectScalar = {
    id?: boolean
    membershipId?: boolean
    gymId?: boolean
    clientId?: boolean
    checkedInBy?: boolean
    createdAt?: boolean
  }

  export type GymCheckInInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    membership?: boolean | GymMembershipContractDefaultArgs<ExtArgs>
  }
  export type GymCheckInIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    membership?: boolean | GymMembershipContractDefaultArgs<ExtArgs>
  }

  export type $GymCheckInPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GymCheckIn"
    objects: {
      membership: Prisma.$GymMembershipContractPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      membershipId: string
      gymId: string
      clientId: string
      checkedInBy: string
      createdAt: Date
    }, ExtArgs["result"]["gymCheckIn"]>
    composites: {}
  }

  type GymCheckInGetPayload<S extends boolean | null | undefined | GymCheckInDefaultArgs> = $Result.GetResult<Prisma.$GymCheckInPayload, S>

  type GymCheckInCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<GymCheckInFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: GymCheckInCountAggregateInputType | true
    }

  export interface GymCheckInDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GymCheckIn'], meta: { name: 'GymCheckIn' } }
    /**
     * Find zero or one GymCheckIn that matches the filter.
     * @param {GymCheckInFindUniqueArgs} args - Arguments to find a GymCheckIn
     * @example
     * // Get one GymCheckIn
     * const gymCheckIn = await prisma.gymCheckIn.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GymCheckInFindUniqueArgs>(args: SelectSubset<T, GymCheckInFindUniqueArgs<ExtArgs>>): Prisma__GymCheckInClient<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one GymCheckIn that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {GymCheckInFindUniqueOrThrowArgs} args - Arguments to find a GymCheckIn
     * @example
     * // Get one GymCheckIn
     * const gymCheckIn = await prisma.gymCheckIn.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GymCheckInFindUniqueOrThrowArgs>(args: SelectSubset<T, GymCheckInFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GymCheckInClient<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first GymCheckIn that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymCheckInFindFirstArgs} args - Arguments to find a GymCheckIn
     * @example
     * // Get one GymCheckIn
     * const gymCheckIn = await prisma.gymCheckIn.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GymCheckInFindFirstArgs>(args?: SelectSubset<T, GymCheckInFindFirstArgs<ExtArgs>>): Prisma__GymCheckInClient<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first GymCheckIn that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymCheckInFindFirstOrThrowArgs} args - Arguments to find a GymCheckIn
     * @example
     * // Get one GymCheckIn
     * const gymCheckIn = await prisma.gymCheckIn.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GymCheckInFindFirstOrThrowArgs>(args?: SelectSubset<T, GymCheckInFindFirstOrThrowArgs<ExtArgs>>): Prisma__GymCheckInClient<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more GymCheckIns that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymCheckInFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GymCheckIns
     * const gymCheckIns = await prisma.gymCheckIn.findMany()
     * 
     * // Get first 10 GymCheckIns
     * const gymCheckIns = await prisma.gymCheckIn.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const gymCheckInWithIdOnly = await prisma.gymCheckIn.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GymCheckInFindManyArgs>(args?: SelectSubset<T, GymCheckInFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a GymCheckIn.
     * @param {GymCheckInCreateArgs} args - Arguments to create a GymCheckIn.
     * @example
     * // Create one GymCheckIn
     * const GymCheckIn = await prisma.gymCheckIn.create({
     *   data: {
     *     // ... data to create a GymCheckIn
     *   }
     * })
     * 
     */
    create<T extends GymCheckInCreateArgs>(args: SelectSubset<T, GymCheckInCreateArgs<ExtArgs>>): Prisma__GymCheckInClient<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many GymCheckIns.
     * @param {GymCheckInCreateManyArgs} args - Arguments to create many GymCheckIns.
     * @example
     * // Create many GymCheckIns
     * const gymCheckIn = await prisma.gymCheckIn.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GymCheckInCreateManyArgs>(args?: SelectSubset<T, GymCheckInCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GymCheckIns and returns the data saved in the database.
     * @param {GymCheckInCreateManyAndReturnArgs} args - Arguments to create many GymCheckIns.
     * @example
     * // Create many GymCheckIns
     * const gymCheckIn = await prisma.gymCheckIn.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GymCheckIns and only return the `id`
     * const gymCheckInWithIdOnly = await prisma.gymCheckIn.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GymCheckInCreateManyAndReturnArgs>(args?: SelectSubset<T, GymCheckInCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a GymCheckIn.
     * @param {GymCheckInDeleteArgs} args - Arguments to delete one GymCheckIn.
     * @example
     * // Delete one GymCheckIn
     * const GymCheckIn = await prisma.gymCheckIn.delete({
     *   where: {
     *     // ... filter to delete one GymCheckIn
     *   }
     * })
     * 
     */
    delete<T extends GymCheckInDeleteArgs>(args: SelectSubset<T, GymCheckInDeleteArgs<ExtArgs>>): Prisma__GymCheckInClient<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one GymCheckIn.
     * @param {GymCheckInUpdateArgs} args - Arguments to update one GymCheckIn.
     * @example
     * // Update one GymCheckIn
     * const gymCheckIn = await prisma.gymCheckIn.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GymCheckInUpdateArgs>(args: SelectSubset<T, GymCheckInUpdateArgs<ExtArgs>>): Prisma__GymCheckInClient<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more GymCheckIns.
     * @param {GymCheckInDeleteManyArgs} args - Arguments to filter GymCheckIns to delete.
     * @example
     * // Delete a few GymCheckIns
     * const { count } = await prisma.gymCheckIn.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GymCheckInDeleteManyArgs>(args?: SelectSubset<T, GymCheckInDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GymCheckIns.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymCheckInUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GymCheckIns
     * const gymCheckIn = await prisma.gymCheckIn.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GymCheckInUpdateManyArgs>(args: SelectSubset<T, GymCheckInUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one GymCheckIn.
     * @param {GymCheckInUpsertArgs} args - Arguments to update or create a GymCheckIn.
     * @example
     * // Update or create a GymCheckIn
     * const gymCheckIn = await prisma.gymCheckIn.upsert({
     *   create: {
     *     // ... data to create a GymCheckIn
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GymCheckIn we want to update
     *   }
     * })
     */
    upsert<T extends GymCheckInUpsertArgs>(args: SelectSubset<T, GymCheckInUpsertArgs<ExtArgs>>): Prisma__GymCheckInClient<$Result.GetResult<Prisma.$GymCheckInPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of GymCheckIns.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymCheckInCountArgs} args - Arguments to filter GymCheckIns to count.
     * @example
     * // Count the number of GymCheckIns
     * const count = await prisma.gymCheckIn.count({
     *   where: {
     *     // ... the filter for the GymCheckIns we want to count
     *   }
     * })
    **/
    count<T extends GymCheckInCountArgs>(
      args?: Subset<T, GymCheckInCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GymCheckInCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GymCheckIn.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymCheckInAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends GymCheckInAggregateArgs>(args: Subset<T, GymCheckInAggregateArgs>): Prisma.PrismaPromise<GetGymCheckInAggregateType<T>>

    /**
     * Group by GymCheckIn.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymCheckInGroupByArgs} args - Group by arguments.
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
      T extends GymCheckInGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GymCheckInGroupByArgs['orderBy'] }
        : { orderBy?: GymCheckInGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, GymCheckInGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGymCheckInGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GymCheckIn model
   */
  readonly fields: GymCheckInFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GymCheckIn.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GymCheckInClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    membership<T extends GymMembershipContractDefaultArgs<ExtArgs> = {}>(args?: Subset<T, GymMembershipContractDefaultArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the GymCheckIn model
   */ 
  interface GymCheckInFieldRefs {
    readonly id: FieldRef<"GymCheckIn", 'String'>
    readonly membershipId: FieldRef<"GymCheckIn", 'String'>
    readonly gymId: FieldRef<"GymCheckIn", 'String'>
    readonly clientId: FieldRef<"GymCheckIn", 'String'>
    readonly checkedInBy: FieldRef<"GymCheckIn", 'String'>
    readonly createdAt: FieldRef<"GymCheckIn", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GymCheckIn findUnique
   */
  export type GymCheckInFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    /**
     * Filter, which GymCheckIn to fetch.
     */
    where: GymCheckInWhereUniqueInput
  }

  /**
   * GymCheckIn findUniqueOrThrow
   */
  export type GymCheckInFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    /**
     * Filter, which GymCheckIn to fetch.
     */
    where: GymCheckInWhereUniqueInput
  }

  /**
   * GymCheckIn findFirst
   */
  export type GymCheckInFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    /**
     * Filter, which GymCheckIn to fetch.
     */
    where?: GymCheckInWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymCheckIns to fetch.
     */
    orderBy?: GymCheckInOrderByWithRelationInput | GymCheckInOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymCheckIns.
     */
    cursor?: GymCheckInWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymCheckIns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymCheckIns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymCheckIns.
     */
    distinct?: GymCheckInScalarFieldEnum | GymCheckInScalarFieldEnum[]
  }

  /**
   * GymCheckIn findFirstOrThrow
   */
  export type GymCheckInFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    /**
     * Filter, which GymCheckIn to fetch.
     */
    where?: GymCheckInWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymCheckIns to fetch.
     */
    orderBy?: GymCheckInOrderByWithRelationInput | GymCheckInOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymCheckIns.
     */
    cursor?: GymCheckInWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymCheckIns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymCheckIns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymCheckIns.
     */
    distinct?: GymCheckInScalarFieldEnum | GymCheckInScalarFieldEnum[]
  }

  /**
   * GymCheckIn findMany
   */
  export type GymCheckInFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    /**
     * Filter, which GymCheckIns to fetch.
     */
    where?: GymCheckInWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymCheckIns to fetch.
     */
    orderBy?: GymCheckInOrderByWithRelationInput | GymCheckInOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GymCheckIns.
     */
    cursor?: GymCheckInWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymCheckIns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymCheckIns.
     */
    skip?: number
    distinct?: GymCheckInScalarFieldEnum | GymCheckInScalarFieldEnum[]
  }

  /**
   * GymCheckIn create
   */
  export type GymCheckInCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    /**
     * The data needed to create a GymCheckIn.
     */
    data: XOR<GymCheckInCreateInput, GymCheckInUncheckedCreateInput>
  }

  /**
   * GymCheckIn createMany
   */
  export type GymCheckInCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GymCheckIns.
     */
    data: GymCheckInCreateManyInput | GymCheckInCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GymCheckIn createManyAndReturn
   */
  export type GymCheckInCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many GymCheckIns.
     */
    data: GymCheckInCreateManyInput | GymCheckInCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * GymCheckIn update
   */
  export type GymCheckInUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    /**
     * The data needed to update a GymCheckIn.
     */
    data: XOR<GymCheckInUpdateInput, GymCheckInUncheckedUpdateInput>
    /**
     * Choose, which GymCheckIn to update.
     */
    where: GymCheckInWhereUniqueInput
  }

  /**
   * GymCheckIn updateMany
   */
  export type GymCheckInUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GymCheckIns.
     */
    data: XOR<GymCheckInUpdateManyMutationInput, GymCheckInUncheckedUpdateManyInput>
    /**
     * Filter which GymCheckIns to update
     */
    where?: GymCheckInWhereInput
  }

  /**
   * GymCheckIn upsert
   */
  export type GymCheckInUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    /**
     * The filter to search for the GymCheckIn to update in case it exists.
     */
    where: GymCheckInWhereUniqueInput
    /**
     * In case the GymCheckIn found by the `where` argument doesn't exist, create a new GymCheckIn with this data.
     */
    create: XOR<GymCheckInCreateInput, GymCheckInUncheckedCreateInput>
    /**
     * In case the GymCheckIn was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GymCheckInUpdateInput, GymCheckInUncheckedUpdateInput>
  }

  /**
   * GymCheckIn delete
   */
  export type GymCheckInDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
    /**
     * Filter which GymCheckIn to delete.
     */
    where: GymCheckInWhereUniqueInput
  }

  /**
   * GymCheckIn deleteMany
   */
  export type GymCheckInDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymCheckIns to delete
     */
    where?: GymCheckInWhereInput
  }

  /**
   * GymCheckIn without action
   */
  export type GymCheckInDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymCheckIn
     */
    select?: GymCheckInSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymCheckInInclude<ExtArgs> | null
  }


  /**
   * Model GymReview
   */

  export type AggregateGymReview = {
    _count: GymReviewCountAggregateOutputType | null
    _avg: GymReviewAvgAggregateOutputType | null
    _sum: GymReviewSumAggregateOutputType | null
    _min: GymReviewMinAggregateOutputType | null
    _max: GymReviewMaxAggregateOutputType | null
  }

  export type GymReviewAvgAggregateOutputType = {
    rating: number | null
  }

  export type GymReviewSumAggregateOutputType = {
    rating: number | null
  }

  export type GymReviewMinAggregateOutputType = {
    id: string | null
    gymId: string | null
    clientId: string | null
    rating: number | null
    comment: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymReviewMaxAggregateOutputType = {
    id: string | null
    gymId: string | null
    clientId: string | null
    rating: number | null
    comment: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymReviewCountAggregateOutputType = {
    id: number
    gymId: number
    clientId: number
    rating: number
    comment: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type GymReviewAvgAggregateInputType = {
    rating?: true
  }

  export type GymReviewSumAggregateInputType = {
    rating?: true
  }

  export type GymReviewMinAggregateInputType = {
    id?: true
    gymId?: true
    clientId?: true
    rating?: true
    comment?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymReviewMaxAggregateInputType = {
    id?: true
    gymId?: true
    clientId?: true
    rating?: true
    comment?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymReviewCountAggregateInputType = {
    id?: true
    gymId?: true
    clientId?: true
    rating?: true
    comment?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type GymReviewAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymReview to aggregate.
     */
    where?: GymReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymReviews to fetch.
     */
    orderBy?: GymReviewOrderByWithRelationInput | GymReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GymReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymReviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymReviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GymReviews
    **/
    _count?: true | GymReviewCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: GymReviewAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: GymReviewSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GymReviewMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GymReviewMaxAggregateInputType
  }

  export type GetGymReviewAggregateType<T extends GymReviewAggregateArgs> = {
        [P in keyof T & keyof AggregateGymReview]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGymReview[P]>
      : GetScalarType<T[P], AggregateGymReview[P]>
  }




  export type GymReviewGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymReviewWhereInput
    orderBy?: GymReviewOrderByWithAggregationInput | GymReviewOrderByWithAggregationInput[]
    by: GymReviewScalarFieldEnum[] | GymReviewScalarFieldEnum
    having?: GymReviewScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GymReviewCountAggregateInputType | true
    _avg?: GymReviewAvgAggregateInputType
    _sum?: GymReviewSumAggregateInputType
    _min?: GymReviewMinAggregateInputType
    _max?: GymReviewMaxAggregateInputType
  }

  export type GymReviewGroupByOutputType = {
    id: string
    gymId: string
    clientId: string
    rating: number
    comment: string | null
    createdAt: Date
    updatedAt: Date
    _count: GymReviewCountAggregateOutputType | null
    _avg: GymReviewAvgAggregateOutputType | null
    _sum: GymReviewSumAggregateOutputType | null
    _min: GymReviewMinAggregateOutputType | null
    _max: GymReviewMaxAggregateOutputType | null
  }

  type GetGymReviewGroupByPayload<T extends GymReviewGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GymReviewGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GymReviewGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GymReviewGroupByOutputType[P]>
            : GetScalarType<T[P], GymReviewGroupByOutputType[P]>
        }
      >
    >


  export type GymReviewSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    clientId?: boolean
    rating?: boolean
    comment?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymReview"]>

  export type GymReviewSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    clientId?: boolean
    rating?: boolean
    comment?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymReview"]>

  export type GymReviewSelectScalar = {
    id?: boolean
    gymId?: boolean
    clientId?: boolean
    rating?: boolean
    comment?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type GymReviewInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }
  export type GymReviewIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }

  export type $GymReviewPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GymReview"
    objects: {
      gym: Prisma.$GymPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      gymId: string
      clientId: string
      rating: number
      comment: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["gymReview"]>
    composites: {}
  }

  type GymReviewGetPayload<S extends boolean | null | undefined | GymReviewDefaultArgs> = $Result.GetResult<Prisma.$GymReviewPayload, S>

  type GymReviewCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<GymReviewFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: GymReviewCountAggregateInputType | true
    }

  export interface GymReviewDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GymReview'], meta: { name: 'GymReview' } }
    /**
     * Find zero or one GymReview that matches the filter.
     * @param {GymReviewFindUniqueArgs} args - Arguments to find a GymReview
     * @example
     * // Get one GymReview
     * const gymReview = await prisma.gymReview.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GymReviewFindUniqueArgs>(args: SelectSubset<T, GymReviewFindUniqueArgs<ExtArgs>>): Prisma__GymReviewClient<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one GymReview that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {GymReviewFindUniqueOrThrowArgs} args - Arguments to find a GymReview
     * @example
     * // Get one GymReview
     * const gymReview = await prisma.gymReview.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GymReviewFindUniqueOrThrowArgs>(args: SelectSubset<T, GymReviewFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GymReviewClient<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first GymReview that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymReviewFindFirstArgs} args - Arguments to find a GymReview
     * @example
     * // Get one GymReview
     * const gymReview = await prisma.gymReview.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GymReviewFindFirstArgs>(args?: SelectSubset<T, GymReviewFindFirstArgs<ExtArgs>>): Prisma__GymReviewClient<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first GymReview that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymReviewFindFirstOrThrowArgs} args - Arguments to find a GymReview
     * @example
     * // Get one GymReview
     * const gymReview = await prisma.gymReview.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GymReviewFindFirstOrThrowArgs>(args?: SelectSubset<T, GymReviewFindFirstOrThrowArgs<ExtArgs>>): Prisma__GymReviewClient<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more GymReviews that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymReviewFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GymReviews
     * const gymReviews = await prisma.gymReview.findMany()
     * 
     * // Get first 10 GymReviews
     * const gymReviews = await prisma.gymReview.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const gymReviewWithIdOnly = await prisma.gymReview.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GymReviewFindManyArgs>(args?: SelectSubset<T, GymReviewFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a GymReview.
     * @param {GymReviewCreateArgs} args - Arguments to create a GymReview.
     * @example
     * // Create one GymReview
     * const GymReview = await prisma.gymReview.create({
     *   data: {
     *     // ... data to create a GymReview
     *   }
     * })
     * 
     */
    create<T extends GymReviewCreateArgs>(args: SelectSubset<T, GymReviewCreateArgs<ExtArgs>>): Prisma__GymReviewClient<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many GymReviews.
     * @param {GymReviewCreateManyArgs} args - Arguments to create many GymReviews.
     * @example
     * // Create many GymReviews
     * const gymReview = await prisma.gymReview.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GymReviewCreateManyArgs>(args?: SelectSubset<T, GymReviewCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GymReviews and returns the data saved in the database.
     * @param {GymReviewCreateManyAndReturnArgs} args - Arguments to create many GymReviews.
     * @example
     * // Create many GymReviews
     * const gymReview = await prisma.gymReview.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GymReviews and only return the `id`
     * const gymReviewWithIdOnly = await prisma.gymReview.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GymReviewCreateManyAndReturnArgs>(args?: SelectSubset<T, GymReviewCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a GymReview.
     * @param {GymReviewDeleteArgs} args - Arguments to delete one GymReview.
     * @example
     * // Delete one GymReview
     * const GymReview = await prisma.gymReview.delete({
     *   where: {
     *     // ... filter to delete one GymReview
     *   }
     * })
     * 
     */
    delete<T extends GymReviewDeleteArgs>(args: SelectSubset<T, GymReviewDeleteArgs<ExtArgs>>): Prisma__GymReviewClient<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one GymReview.
     * @param {GymReviewUpdateArgs} args - Arguments to update one GymReview.
     * @example
     * // Update one GymReview
     * const gymReview = await prisma.gymReview.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GymReviewUpdateArgs>(args: SelectSubset<T, GymReviewUpdateArgs<ExtArgs>>): Prisma__GymReviewClient<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more GymReviews.
     * @param {GymReviewDeleteManyArgs} args - Arguments to filter GymReviews to delete.
     * @example
     * // Delete a few GymReviews
     * const { count } = await prisma.gymReview.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GymReviewDeleteManyArgs>(args?: SelectSubset<T, GymReviewDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GymReviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymReviewUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GymReviews
     * const gymReview = await prisma.gymReview.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GymReviewUpdateManyArgs>(args: SelectSubset<T, GymReviewUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one GymReview.
     * @param {GymReviewUpsertArgs} args - Arguments to update or create a GymReview.
     * @example
     * // Update or create a GymReview
     * const gymReview = await prisma.gymReview.upsert({
     *   create: {
     *     // ... data to create a GymReview
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GymReview we want to update
     *   }
     * })
     */
    upsert<T extends GymReviewUpsertArgs>(args: SelectSubset<T, GymReviewUpsertArgs<ExtArgs>>): Prisma__GymReviewClient<$Result.GetResult<Prisma.$GymReviewPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of GymReviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymReviewCountArgs} args - Arguments to filter GymReviews to count.
     * @example
     * // Count the number of GymReviews
     * const count = await prisma.gymReview.count({
     *   where: {
     *     // ... the filter for the GymReviews we want to count
     *   }
     * })
    **/
    count<T extends GymReviewCountArgs>(
      args?: Subset<T, GymReviewCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GymReviewCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GymReview.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymReviewAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends GymReviewAggregateArgs>(args: Subset<T, GymReviewAggregateArgs>): Prisma.PrismaPromise<GetGymReviewAggregateType<T>>

    /**
     * Group by GymReview.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymReviewGroupByArgs} args - Group by arguments.
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
      T extends GymReviewGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GymReviewGroupByArgs['orderBy'] }
        : { orderBy?: GymReviewGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, GymReviewGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGymReviewGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GymReview model
   */
  readonly fields: GymReviewFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GymReview.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GymReviewClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    gym<T extends GymDefaultArgs<ExtArgs> = {}>(args?: Subset<T, GymDefaultArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the GymReview model
   */ 
  interface GymReviewFieldRefs {
    readonly id: FieldRef<"GymReview", 'String'>
    readonly gymId: FieldRef<"GymReview", 'String'>
    readonly clientId: FieldRef<"GymReview", 'String'>
    readonly rating: FieldRef<"GymReview", 'Int'>
    readonly comment: FieldRef<"GymReview", 'String'>
    readonly createdAt: FieldRef<"GymReview", 'DateTime'>
    readonly updatedAt: FieldRef<"GymReview", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GymReview findUnique
   */
  export type GymReviewFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    /**
     * Filter, which GymReview to fetch.
     */
    where: GymReviewWhereUniqueInput
  }

  /**
   * GymReview findUniqueOrThrow
   */
  export type GymReviewFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    /**
     * Filter, which GymReview to fetch.
     */
    where: GymReviewWhereUniqueInput
  }

  /**
   * GymReview findFirst
   */
  export type GymReviewFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    /**
     * Filter, which GymReview to fetch.
     */
    where?: GymReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymReviews to fetch.
     */
    orderBy?: GymReviewOrderByWithRelationInput | GymReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymReviews.
     */
    cursor?: GymReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymReviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymReviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymReviews.
     */
    distinct?: GymReviewScalarFieldEnum | GymReviewScalarFieldEnum[]
  }

  /**
   * GymReview findFirstOrThrow
   */
  export type GymReviewFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    /**
     * Filter, which GymReview to fetch.
     */
    where?: GymReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymReviews to fetch.
     */
    orderBy?: GymReviewOrderByWithRelationInput | GymReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymReviews.
     */
    cursor?: GymReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymReviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymReviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymReviews.
     */
    distinct?: GymReviewScalarFieldEnum | GymReviewScalarFieldEnum[]
  }

  /**
   * GymReview findMany
   */
  export type GymReviewFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    /**
     * Filter, which GymReviews to fetch.
     */
    where?: GymReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymReviews to fetch.
     */
    orderBy?: GymReviewOrderByWithRelationInput | GymReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GymReviews.
     */
    cursor?: GymReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymReviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymReviews.
     */
    skip?: number
    distinct?: GymReviewScalarFieldEnum | GymReviewScalarFieldEnum[]
  }

  /**
   * GymReview create
   */
  export type GymReviewCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    /**
     * The data needed to create a GymReview.
     */
    data: XOR<GymReviewCreateInput, GymReviewUncheckedCreateInput>
  }

  /**
   * GymReview createMany
   */
  export type GymReviewCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GymReviews.
     */
    data: GymReviewCreateManyInput | GymReviewCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GymReview createManyAndReturn
   */
  export type GymReviewCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many GymReviews.
     */
    data: GymReviewCreateManyInput | GymReviewCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * GymReview update
   */
  export type GymReviewUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    /**
     * The data needed to update a GymReview.
     */
    data: XOR<GymReviewUpdateInput, GymReviewUncheckedUpdateInput>
    /**
     * Choose, which GymReview to update.
     */
    where: GymReviewWhereUniqueInput
  }

  /**
   * GymReview updateMany
   */
  export type GymReviewUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GymReviews.
     */
    data: XOR<GymReviewUpdateManyMutationInput, GymReviewUncheckedUpdateManyInput>
    /**
     * Filter which GymReviews to update
     */
    where?: GymReviewWhereInput
  }

  /**
   * GymReview upsert
   */
  export type GymReviewUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    /**
     * The filter to search for the GymReview to update in case it exists.
     */
    where: GymReviewWhereUniqueInput
    /**
     * In case the GymReview found by the `where` argument doesn't exist, create a new GymReview with this data.
     */
    create: XOR<GymReviewCreateInput, GymReviewUncheckedCreateInput>
    /**
     * In case the GymReview was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GymReviewUpdateInput, GymReviewUncheckedUpdateInput>
  }

  /**
   * GymReview delete
   */
  export type GymReviewDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
    /**
     * Filter which GymReview to delete.
     */
    where: GymReviewWhereUniqueInput
  }

  /**
   * GymReview deleteMany
   */
  export type GymReviewDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymReviews to delete
     */
    where?: GymReviewWhereInput
  }

  /**
   * GymReview without action
   */
  export type GymReviewDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymReview
     */
    select?: GymReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymReviewInclude<ExtArgs> | null
  }


  /**
   * Model GymPtCollaboration
   */

  export type AggregateGymPtCollaboration = {
    _count: GymPtCollaborationCountAggregateOutputType | null
    _avg: GymPtCollaborationAvgAggregateOutputType | null
    _sum: GymPtCollaborationSumAggregateOutputType | null
    _min: GymPtCollaborationMinAggregateOutputType | null
    _max: GymPtCollaborationMaxAggregateOutputType | null
  }

  export type GymPtCollaborationAvgAggregateOutputType = {
    proposedPtRate: Decimal | null
    proposedGymRate: Decimal | null
    platformRate: Decimal | null
    round: number | null
  }

  export type GymPtCollaborationSumAggregateOutputType = {
    proposedPtRate: Decimal | null
    proposedGymRate: Decimal | null
    platformRate: Decimal | null
    round: number | null
  }

  export type GymPtCollaborationMinAggregateOutputType = {
    id: string | null
    gymId: string | null
    ptUserId: string | null
    proposedPtRate: Decimal | null
    proposedGymRate: Decimal | null
    platformRate: Decimal | null
    status: $Enums.CollaborationStatus | null
    proposedBy: $Enums.CollaborationParty | null
    round: number | null
    expiresAt: Date | null
    acceptedAt: Date | null
    terminatedAt: Date | null
    terminatedBy: string | null
    note: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymPtCollaborationMaxAggregateOutputType = {
    id: string | null
    gymId: string | null
    ptUserId: string | null
    proposedPtRate: Decimal | null
    proposedGymRate: Decimal | null
    platformRate: Decimal | null
    status: $Enums.CollaborationStatus | null
    proposedBy: $Enums.CollaborationParty | null
    round: number | null
    expiresAt: Date | null
    acceptedAt: Date | null
    terminatedAt: Date | null
    terminatedBy: string | null
    note: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymPtCollaborationCountAggregateOutputType = {
    id: number
    gymId: number
    ptUserId: number
    proposedPtRate: number
    proposedGymRate: number
    platformRate: number
    status: number
    proposedBy: number
    round: number
    expiresAt: number
    acceptedAt: number
    terminatedAt: number
    terminatedBy: number
    note: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type GymPtCollaborationAvgAggregateInputType = {
    proposedPtRate?: true
    proposedGymRate?: true
    platformRate?: true
    round?: true
  }

  export type GymPtCollaborationSumAggregateInputType = {
    proposedPtRate?: true
    proposedGymRate?: true
    platformRate?: true
    round?: true
  }

  export type GymPtCollaborationMinAggregateInputType = {
    id?: true
    gymId?: true
    ptUserId?: true
    proposedPtRate?: true
    proposedGymRate?: true
    platformRate?: true
    status?: true
    proposedBy?: true
    round?: true
    expiresAt?: true
    acceptedAt?: true
    terminatedAt?: true
    terminatedBy?: true
    note?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymPtCollaborationMaxAggregateInputType = {
    id?: true
    gymId?: true
    ptUserId?: true
    proposedPtRate?: true
    proposedGymRate?: true
    platformRate?: true
    status?: true
    proposedBy?: true
    round?: true
    expiresAt?: true
    acceptedAt?: true
    terminatedAt?: true
    terminatedBy?: true
    note?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymPtCollaborationCountAggregateInputType = {
    id?: true
    gymId?: true
    ptUserId?: true
    proposedPtRate?: true
    proposedGymRate?: true
    platformRate?: true
    status?: true
    proposedBy?: true
    round?: true
    expiresAt?: true
    acceptedAt?: true
    terminatedAt?: true
    terminatedBy?: true
    note?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type GymPtCollaborationAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymPtCollaboration to aggregate.
     */
    where?: GymPtCollaborationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymPtCollaborations to fetch.
     */
    orderBy?: GymPtCollaborationOrderByWithRelationInput | GymPtCollaborationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GymPtCollaborationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymPtCollaborations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymPtCollaborations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GymPtCollaborations
    **/
    _count?: true | GymPtCollaborationCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: GymPtCollaborationAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: GymPtCollaborationSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GymPtCollaborationMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GymPtCollaborationMaxAggregateInputType
  }

  export type GetGymPtCollaborationAggregateType<T extends GymPtCollaborationAggregateArgs> = {
        [P in keyof T & keyof AggregateGymPtCollaboration]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGymPtCollaboration[P]>
      : GetScalarType<T[P], AggregateGymPtCollaboration[P]>
  }




  export type GymPtCollaborationGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymPtCollaborationWhereInput
    orderBy?: GymPtCollaborationOrderByWithAggregationInput | GymPtCollaborationOrderByWithAggregationInput[]
    by: GymPtCollaborationScalarFieldEnum[] | GymPtCollaborationScalarFieldEnum
    having?: GymPtCollaborationScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GymPtCollaborationCountAggregateInputType | true
    _avg?: GymPtCollaborationAvgAggregateInputType
    _sum?: GymPtCollaborationSumAggregateInputType
    _min?: GymPtCollaborationMinAggregateInputType
    _max?: GymPtCollaborationMaxAggregateInputType
  }

  export type GymPtCollaborationGroupByOutputType = {
    id: string
    gymId: string
    ptUserId: string
    proposedPtRate: Decimal
    proposedGymRate: Decimal
    platformRate: Decimal
    status: $Enums.CollaborationStatus
    proposedBy: $Enums.CollaborationParty
    round: number
    expiresAt: Date
    acceptedAt: Date | null
    terminatedAt: Date | null
    terminatedBy: string | null
    note: string | null
    createdAt: Date
    updatedAt: Date
    _count: GymPtCollaborationCountAggregateOutputType | null
    _avg: GymPtCollaborationAvgAggregateOutputType | null
    _sum: GymPtCollaborationSumAggregateOutputType | null
    _min: GymPtCollaborationMinAggregateOutputType | null
    _max: GymPtCollaborationMaxAggregateOutputType | null
  }

  type GetGymPtCollaborationGroupByPayload<T extends GymPtCollaborationGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GymPtCollaborationGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GymPtCollaborationGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GymPtCollaborationGroupByOutputType[P]>
            : GetScalarType<T[P], GymPtCollaborationGroupByOutputType[P]>
        }
      >
    >


  export type GymPtCollaborationSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    ptUserId?: boolean
    proposedPtRate?: boolean
    proposedGymRate?: boolean
    platformRate?: boolean
    status?: boolean
    proposedBy?: boolean
    round?: boolean
    expiresAt?: boolean
    acceptedAt?: boolean
    terminatedAt?: boolean
    terminatedBy?: boolean
    note?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymPtCollaboration"]>

  export type GymPtCollaborationSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    gymId?: boolean
    ptUserId?: boolean
    proposedPtRate?: boolean
    proposedGymRate?: boolean
    platformRate?: boolean
    status?: boolean
    proposedBy?: boolean
    round?: boolean
    expiresAt?: boolean
    acceptedAt?: boolean
    terminatedAt?: boolean
    terminatedBy?: boolean
    note?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymPtCollaboration"]>

  export type GymPtCollaborationSelectScalar = {
    id?: boolean
    gymId?: boolean
    ptUserId?: boolean
    proposedPtRate?: boolean
    proposedGymRate?: boolean
    platformRate?: boolean
    status?: boolean
    proposedBy?: boolean
    round?: boolean
    expiresAt?: boolean
    acceptedAt?: boolean
    terminatedAt?: boolean
    terminatedBy?: boolean
    note?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type GymPtCollaborationInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }
  export type GymPtCollaborationIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    gym?: boolean | GymDefaultArgs<ExtArgs>
  }

  export type $GymPtCollaborationPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GymPtCollaboration"
    objects: {
      gym: Prisma.$GymPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      gymId: string
      ptUserId: string
      /**
       * Currently on the table. Must satisfy proposedPtRate + proposedGymRate + platformRate = 1.
       */
      proposedPtRate: Prisma.Decimal
      proposedGymRate: Prisma.Decimal
      /**
       * Stored so the accepted row is a complete snapshot rather than half a rate table.
       */
      platformRate: Prisma.Decimal
      status: $Enums.CollaborationStatus
      /**
       * Who made the offer currently on the table — i.e. whose turn it is NOT.
       */
      proposedBy: $Enums.CollaborationParty
      /**
       * Counter-offers so far. Capped so a negotiation cannot run forever.
       */
      round: number
      expiresAt: Date
      acceptedAt: Date | null
      terminatedAt: Date | null
      terminatedBy: string | null
      note: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["gymPtCollaboration"]>
    composites: {}
  }

  type GymPtCollaborationGetPayload<S extends boolean | null | undefined | GymPtCollaborationDefaultArgs> = $Result.GetResult<Prisma.$GymPtCollaborationPayload, S>

  type GymPtCollaborationCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<GymPtCollaborationFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: GymPtCollaborationCountAggregateInputType | true
    }

  export interface GymPtCollaborationDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GymPtCollaboration'], meta: { name: 'GymPtCollaboration' } }
    /**
     * Find zero or one GymPtCollaboration that matches the filter.
     * @param {GymPtCollaborationFindUniqueArgs} args - Arguments to find a GymPtCollaboration
     * @example
     * // Get one GymPtCollaboration
     * const gymPtCollaboration = await prisma.gymPtCollaboration.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GymPtCollaborationFindUniqueArgs>(args: SelectSubset<T, GymPtCollaborationFindUniqueArgs<ExtArgs>>): Prisma__GymPtCollaborationClient<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one GymPtCollaboration that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {GymPtCollaborationFindUniqueOrThrowArgs} args - Arguments to find a GymPtCollaboration
     * @example
     * // Get one GymPtCollaboration
     * const gymPtCollaboration = await prisma.gymPtCollaboration.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GymPtCollaborationFindUniqueOrThrowArgs>(args: SelectSubset<T, GymPtCollaborationFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GymPtCollaborationClient<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first GymPtCollaboration that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymPtCollaborationFindFirstArgs} args - Arguments to find a GymPtCollaboration
     * @example
     * // Get one GymPtCollaboration
     * const gymPtCollaboration = await prisma.gymPtCollaboration.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GymPtCollaborationFindFirstArgs>(args?: SelectSubset<T, GymPtCollaborationFindFirstArgs<ExtArgs>>): Prisma__GymPtCollaborationClient<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first GymPtCollaboration that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymPtCollaborationFindFirstOrThrowArgs} args - Arguments to find a GymPtCollaboration
     * @example
     * // Get one GymPtCollaboration
     * const gymPtCollaboration = await prisma.gymPtCollaboration.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GymPtCollaborationFindFirstOrThrowArgs>(args?: SelectSubset<T, GymPtCollaborationFindFirstOrThrowArgs<ExtArgs>>): Prisma__GymPtCollaborationClient<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more GymPtCollaborations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymPtCollaborationFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GymPtCollaborations
     * const gymPtCollaborations = await prisma.gymPtCollaboration.findMany()
     * 
     * // Get first 10 GymPtCollaborations
     * const gymPtCollaborations = await prisma.gymPtCollaboration.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const gymPtCollaborationWithIdOnly = await prisma.gymPtCollaboration.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GymPtCollaborationFindManyArgs>(args?: SelectSubset<T, GymPtCollaborationFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a GymPtCollaboration.
     * @param {GymPtCollaborationCreateArgs} args - Arguments to create a GymPtCollaboration.
     * @example
     * // Create one GymPtCollaboration
     * const GymPtCollaboration = await prisma.gymPtCollaboration.create({
     *   data: {
     *     // ... data to create a GymPtCollaboration
     *   }
     * })
     * 
     */
    create<T extends GymPtCollaborationCreateArgs>(args: SelectSubset<T, GymPtCollaborationCreateArgs<ExtArgs>>): Prisma__GymPtCollaborationClient<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many GymPtCollaborations.
     * @param {GymPtCollaborationCreateManyArgs} args - Arguments to create many GymPtCollaborations.
     * @example
     * // Create many GymPtCollaborations
     * const gymPtCollaboration = await prisma.gymPtCollaboration.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GymPtCollaborationCreateManyArgs>(args?: SelectSubset<T, GymPtCollaborationCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GymPtCollaborations and returns the data saved in the database.
     * @param {GymPtCollaborationCreateManyAndReturnArgs} args - Arguments to create many GymPtCollaborations.
     * @example
     * // Create many GymPtCollaborations
     * const gymPtCollaboration = await prisma.gymPtCollaboration.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GymPtCollaborations and only return the `id`
     * const gymPtCollaborationWithIdOnly = await prisma.gymPtCollaboration.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GymPtCollaborationCreateManyAndReturnArgs>(args?: SelectSubset<T, GymPtCollaborationCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a GymPtCollaboration.
     * @param {GymPtCollaborationDeleteArgs} args - Arguments to delete one GymPtCollaboration.
     * @example
     * // Delete one GymPtCollaboration
     * const GymPtCollaboration = await prisma.gymPtCollaboration.delete({
     *   where: {
     *     // ... filter to delete one GymPtCollaboration
     *   }
     * })
     * 
     */
    delete<T extends GymPtCollaborationDeleteArgs>(args: SelectSubset<T, GymPtCollaborationDeleteArgs<ExtArgs>>): Prisma__GymPtCollaborationClient<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one GymPtCollaboration.
     * @param {GymPtCollaborationUpdateArgs} args - Arguments to update one GymPtCollaboration.
     * @example
     * // Update one GymPtCollaboration
     * const gymPtCollaboration = await prisma.gymPtCollaboration.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GymPtCollaborationUpdateArgs>(args: SelectSubset<T, GymPtCollaborationUpdateArgs<ExtArgs>>): Prisma__GymPtCollaborationClient<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more GymPtCollaborations.
     * @param {GymPtCollaborationDeleteManyArgs} args - Arguments to filter GymPtCollaborations to delete.
     * @example
     * // Delete a few GymPtCollaborations
     * const { count } = await prisma.gymPtCollaboration.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GymPtCollaborationDeleteManyArgs>(args?: SelectSubset<T, GymPtCollaborationDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GymPtCollaborations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymPtCollaborationUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GymPtCollaborations
     * const gymPtCollaboration = await prisma.gymPtCollaboration.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GymPtCollaborationUpdateManyArgs>(args: SelectSubset<T, GymPtCollaborationUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one GymPtCollaboration.
     * @param {GymPtCollaborationUpsertArgs} args - Arguments to update or create a GymPtCollaboration.
     * @example
     * // Update or create a GymPtCollaboration
     * const gymPtCollaboration = await prisma.gymPtCollaboration.upsert({
     *   create: {
     *     // ... data to create a GymPtCollaboration
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GymPtCollaboration we want to update
     *   }
     * })
     */
    upsert<T extends GymPtCollaborationUpsertArgs>(args: SelectSubset<T, GymPtCollaborationUpsertArgs<ExtArgs>>): Prisma__GymPtCollaborationClient<$Result.GetResult<Prisma.$GymPtCollaborationPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of GymPtCollaborations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymPtCollaborationCountArgs} args - Arguments to filter GymPtCollaborations to count.
     * @example
     * // Count the number of GymPtCollaborations
     * const count = await prisma.gymPtCollaboration.count({
     *   where: {
     *     // ... the filter for the GymPtCollaborations we want to count
     *   }
     * })
    **/
    count<T extends GymPtCollaborationCountArgs>(
      args?: Subset<T, GymPtCollaborationCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GymPtCollaborationCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GymPtCollaboration.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymPtCollaborationAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends GymPtCollaborationAggregateArgs>(args: Subset<T, GymPtCollaborationAggregateArgs>): Prisma.PrismaPromise<GetGymPtCollaborationAggregateType<T>>

    /**
     * Group by GymPtCollaboration.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymPtCollaborationGroupByArgs} args - Group by arguments.
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
      T extends GymPtCollaborationGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GymPtCollaborationGroupByArgs['orderBy'] }
        : { orderBy?: GymPtCollaborationGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, GymPtCollaborationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGymPtCollaborationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GymPtCollaboration model
   */
  readonly fields: GymPtCollaborationFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GymPtCollaboration.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GymPtCollaborationClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    gym<T extends GymDefaultArgs<ExtArgs> = {}>(args?: Subset<T, GymDefaultArgs<ExtArgs>>): Prisma__GymClient<$Result.GetResult<Prisma.$GymPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the GymPtCollaboration model
   */ 
  interface GymPtCollaborationFieldRefs {
    readonly id: FieldRef<"GymPtCollaboration", 'String'>
    readonly gymId: FieldRef<"GymPtCollaboration", 'String'>
    readonly ptUserId: FieldRef<"GymPtCollaboration", 'String'>
    readonly proposedPtRate: FieldRef<"GymPtCollaboration", 'Decimal'>
    readonly proposedGymRate: FieldRef<"GymPtCollaboration", 'Decimal'>
    readonly platformRate: FieldRef<"GymPtCollaboration", 'Decimal'>
    readonly status: FieldRef<"GymPtCollaboration", 'CollaborationStatus'>
    readonly proposedBy: FieldRef<"GymPtCollaboration", 'CollaborationParty'>
    readonly round: FieldRef<"GymPtCollaboration", 'Int'>
    readonly expiresAt: FieldRef<"GymPtCollaboration", 'DateTime'>
    readonly acceptedAt: FieldRef<"GymPtCollaboration", 'DateTime'>
    readonly terminatedAt: FieldRef<"GymPtCollaboration", 'DateTime'>
    readonly terminatedBy: FieldRef<"GymPtCollaboration", 'String'>
    readonly note: FieldRef<"GymPtCollaboration", 'String'>
    readonly createdAt: FieldRef<"GymPtCollaboration", 'DateTime'>
    readonly updatedAt: FieldRef<"GymPtCollaboration", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GymPtCollaboration findUnique
   */
  export type GymPtCollaborationFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    /**
     * Filter, which GymPtCollaboration to fetch.
     */
    where: GymPtCollaborationWhereUniqueInput
  }

  /**
   * GymPtCollaboration findUniqueOrThrow
   */
  export type GymPtCollaborationFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    /**
     * Filter, which GymPtCollaboration to fetch.
     */
    where: GymPtCollaborationWhereUniqueInput
  }

  /**
   * GymPtCollaboration findFirst
   */
  export type GymPtCollaborationFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    /**
     * Filter, which GymPtCollaboration to fetch.
     */
    where?: GymPtCollaborationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymPtCollaborations to fetch.
     */
    orderBy?: GymPtCollaborationOrderByWithRelationInput | GymPtCollaborationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymPtCollaborations.
     */
    cursor?: GymPtCollaborationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymPtCollaborations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymPtCollaborations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymPtCollaborations.
     */
    distinct?: GymPtCollaborationScalarFieldEnum | GymPtCollaborationScalarFieldEnum[]
  }

  /**
   * GymPtCollaboration findFirstOrThrow
   */
  export type GymPtCollaborationFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    /**
     * Filter, which GymPtCollaboration to fetch.
     */
    where?: GymPtCollaborationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymPtCollaborations to fetch.
     */
    orderBy?: GymPtCollaborationOrderByWithRelationInput | GymPtCollaborationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymPtCollaborations.
     */
    cursor?: GymPtCollaborationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymPtCollaborations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymPtCollaborations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymPtCollaborations.
     */
    distinct?: GymPtCollaborationScalarFieldEnum | GymPtCollaborationScalarFieldEnum[]
  }

  /**
   * GymPtCollaboration findMany
   */
  export type GymPtCollaborationFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    /**
     * Filter, which GymPtCollaborations to fetch.
     */
    where?: GymPtCollaborationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymPtCollaborations to fetch.
     */
    orderBy?: GymPtCollaborationOrderByWithRelationInput | GymPtCollaborationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GymPtCollaborations.
     */
    cursor?: GymPtCollaborationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymPtCollaborations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymPtCollaborations.
     */
    skip?: number
    distinct?: GymPtCollaborationScalarFieldEnum | GymPtCollaborationScalarFieldEnum[]
  }

  /**
   * GymPtCollaboration create
   */
  export type GymPtCollaborationCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    /**
     * The data needed to create a GymPtCollaboration.
     */
    data: XOR<GymPtCollaborationCreateInput, GymPtCollaborationUncheckedCreateInput>
  }

  /**
   * GymPtCollaboration createMany
   */
  export type GymPtCollaborationCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GymPtCollaborations.
     */
    data: GymPtCollaborationCreateManyInput | GymPtCollaborationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GymPtCollaboration createManyAndReturn
   */
  export type GymPtCollaborationCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many GymPtCollaborations.
     */
    data: GymPtCollaborationCreateManyInput | GymPtCollaborationCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * GymPtCollaboration update
   */
  export type GymPtCollaborationUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    /**
     * The data needed to update a GymPtCollaboration.
     */
    data: XOR<GymPtCollaborationUpdateInput, GymPtCollaborationUncheckedUpdateInput>
    /**
     * Choose, which GymPtCollaboration to update.
     */
    where: GymPtCollaborationWhereUniqueInput
  }

  /**
   * GymPtCollaboration updateMany
   */
  export type GymPtCollaborationUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GymPtCollaborations.
     */
    data: XOR<GymPtCollaborationUpdateManyMutationInput, GymPtCollaborationUncheckedUpdateManyInput>
    /**
     * Filter which GymPtCollaborations to update
     */
    where?: GymPtCollaborationWhereInput
  }

  /**
   * GymPtCollaboration upsert
   */
  export type GymPtCollaborationUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    /**
     * The filter to search for the GymPtCollaboration to update in case it exists.
     */
    where: GymPtCollaborationWhereUniqueInput
    /**
     * In case the GymPtCollaboration found by the `where` argument doesn't exist, create a new GymPtCollaboration with this data.
     */
    create: XOR<GymPtCollaborationCreateInput, GymPtCollaborationUncheckedCreateInput>
    /**
     * In case the GymPtCollaboration was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GymPtCollaborationUpdateInput, GymPtCollaborationUncheckedUpdateInput>
  }

  /**
   * GymPtCollaboration delete
   */
  export type GymPtCollaborationDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
    /**
     * Filter which GymPtCollaboration to delete.
     */
    where: GymPtCollaborationWhereUniqueInput
  }

  /**
   * GymPtCollaboration deleteMany
   */
  export type GymPtCollaborationDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymPtCollaborations to delete
     */
    where?: GymPtCollaborationWhereInput
  }

  /**
   * GymPtCollaboration without action
   */
  export type GymPtCollaborationDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymPtCollaboration
     */
    select?: GymPtCollaborationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymPtCollaborationInclude<ExtArgs> | null
  }


  /**
   * Model GymMembershipReferral
   */

  export type AggregateGymMembershipReferral = {
    _count: GymMembershipReferralCountAggregateOutputType | null
    _avg: GymMembershipReferralAvgAggregateOutputType | null
    _sum: GymMembershipReferralSumAggregateOutputType | null
    _min: GymMembershipReferralMinAggregateOutputType | null
    _max: GymMembershipReferralMaxAggregateOutputType | null
  }

  export type GymMembershipReferralAvgAggregateOutputType = {
    rate: Decimal | null
    amount: Decimal | null
    clawedBack: Decimal | null
  }

  export type GymMembershipReferralSumAggregateOutputType = {
    rate: Decimal | null
    amount: Decimal | null
    clawedBack: Decimal | null
  }

  export type GymMembershipReferralMinAggregateOutputType = {
    id: string | null
    membershipContractId: string | null
    gymId: string | null
    referrerPtUserId: string | null
    rate: Decimal | null
    amount: Decimal | null
    clawedBack: Decimal | null
    status: string | null
    releasedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymMembershipReferralMaxAggregateOutputType = {
    id: string | null
    membershipContractId: string | null
    gymId: string | null
    referrerPtUserId: string | null
    rate: Decimal | null
    amount: Decimal | null
    clawedBack: Decimal | null
    status: string | null
    releasedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type GymMembershipReferralCountAggregateOutputType = {
    id: number
    membershipContractId: number
    gymId: number
    referrerPtUserId: number
    rate: number
    amount: number
    clawedBack: number
    status: number
    releasedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type GymMembershipReferralAvgAggregateInputType = {
    rate?: true
    amount?: true
    clawedBack?: true
  }

  export type GymMembershipReferralSumAggregateInputType = {
    rate?: true
    amount?: true
    clawedBack?: true
  }

  export type GymMembershipReferralMinAggregateInputType = {
    id?: true
    membershipContractId?: true
    gymId?: true
    referrerPtUserId?: true
    rate?: true
    amount?: true
    clawedBack?: true
    status?: true
    releasedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymMembershipReferralMaxAggregateInputType = {
    id?: true
    membershipContractId?: true
    gymId?: true
    referrerPtUserId?: true
    rate?: true
    amount?: true
    clawedBack?: true
    status?: true
    releasedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type GymMembershipReferralCountAggregateInputType = {
    id?: true
    membershipContractId?: true
    gymId?: true
    referrerPtUserId?: true
    rate?: true
    amount?: true
    clawedBack?: true
    status?: true
    releasedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type GymMembershipReferralAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymMembershipReferral to aggregate.
     */
    where?: GymMembershipReferralWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipReferrals to fetch.
     */
    orderBy?: GymMembershipReferralOrderByWithRelationInput | GymMembershipReferralOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GymMembershipReferralWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipReferrals from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipReferrals.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GymMembershipReferrals
    **/
    _count?: true | GymMembershipReferralCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: GymMembershipReferralAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: GymMembershipReferralSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GymMembershipReferralMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GymMembershipReferralMaxAggregateInputType
  }

  export type GetGymMembershipReferralAggregateType<T extends GymMembershipReferralAggregateArgs> = {
        [P in keyof T & keyof AggregateGymMembershipReferral]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGymMembershipReferral[P]>
      : GetScalarType<T[P], AggregateGymMembershipReferral[P]>
  }




  export type GymMembershipReferralGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GymMembershipReferralWhereInput
    orderBy?: GymMembershipReferralOrderByWithAggregationInput | GymMembershipReferralOrderByWithAggregationInput[]
    by: GymMembershipReferralScalarFieldEnum[] | GymMembershipReferralScalarFieldEnum
    having?: GymMembershipReferralScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GymMembershipReferralCountAggregateInputType | true
    _avg?: GymMembershipReferralAvgAggregateInputType
    _sum?: GymMembershipReferralSumAggregateInputType
    _min?: GymMembershipReferralMinAggregateInputType
    _max?: GymMembershipReferralMaxAggregateInputType
  }

  export type GymMembershipReferralGroupByOutputType = {
    id: string
    membershipContractId: string
    gymId: string
    referrerPtUserId: string
    rate: Decimal
    amount: Decimal
    clawedBack: Decimal
    status: string
    releasedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: GymMembershipReferralCountAggregateOutputType | null
    _avg: GymMembershipReferralAvgAggregateOutputType | null
    _sum: GymMembershipReferralSumAggregateOutputType | null
    _min: GymMembershipReferralMinAggregateOutputType | null
    _max: GymMembershipReferralMaxAggregateOutputType | null
  }

  type GetGymMembershipReferralGroupByPayload<T extends GymMembershipReferralGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GymMembershipReferralGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GymMembershipReferralGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GymMembershipReferralGroupByOutputType[P]>
            : GetScalarType<T[P], GymMembershipReferralGroupByOutputType[P]>
        }
      >
    >


  export type GymMembershipReferralSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    membershipContractId?: boolean
    gymId?: boolean
    referrerPtUserId?: boolean
    rate?: boolean
    amount?: boolean
    clawedBack?: boolean
    status?: boolean
    releasedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    membershipContract?: boolean | GymMembershipContractDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymMembershipReferral"]>

  export type GymMembershipReferralSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    membershipContractId?: boolean
    gymId?: boolean
    referrerPtUserId?: boolean
    rate?: boolean
    amount?: boolean
    clawedBack?: boolean
    status?: boolean
    releasedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    membershipContract?: boolean | GymMembershipContractDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["gymMembershipReferral"]>

  export type GymMembershipReferralSelectScalar = {
    id?: boolean
    membershipContractId?: boolean
    gymId?: boolean
    referrerPtUserId?: boolean
    rate?: boolean
    amount?: boolean
    clawedBack?: boolean
    status?: boolean
    releasedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type GymMembershipReferralInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    membershipContract?: boolean | GymMembershipContractDefaultArgs<ExtArgs>
  }
  export type GymMembershipReferralIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    membershipContract?: boolean | GymMembershipContractDefaultArgs<ExtArgs>
  }

  export type $GymMembershipReferralPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GymMembershipReferral"
    objects: {
      membershipContract: Prisma.$GymMembershipContractPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      membershipContractId: string
      gymId: string
      referrerPtUserId: string
      rate: Prisma.Decimal
      /**
       * Gross commission earned at purchase time.
       */
      amount: Prisma.Decimal
      /**
       * Reversed so far, following partial refunds of the membership.
       */
      clawedBack: Prisma.Decimal
      status: string
      releasedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["gymMembershipReferral"]>
    composites: {}
  }

  type GymMembershipReferralGetPayload<S extends boolean | null | undefined | GymMembershipReferralDefaultArgs> = $Result.GetResult<Prisma.$GymMembershipReferralPayload, S>

  type GymMembershipReferralCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<GymMembershipReferralFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: GymMembershipReferralCountAggregateInputType | true
    }

  export interface GymMembershipReferralDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GymMembershipReferral'], meta: { name: 'GymMembershipReferral' } }
    /**
     * Find zero or one GymMembershipReferral that matches the filter.
     * @param {GymMembershipReferralFindUniqueArgs} args - Arguments to find a GymMembershipReferral
     * @example
     * // Get one GymMembershipReferral
     * const gymMembershipReferral = await prisma.gymMembershipReferral.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GymMembershipReferralFindUniqueArgs>(args: SelectSubset<T, GymMembershipReferralFindUniqueArgs<ExtArgs>>): Prisma__GymMembershipReferralClient<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one GymMembershipReferral that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {GymMembershipReferralFindUniqueOrThrowArgs} args - Arguments to find a GymMembershipReferral
     * @example
     * // Get one GymMembershipReferral
     * const gymMembershipReferral = await prisma.gymMembershipReferral.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GymMembershipReferralFindUniqueOrThrowArgs>(args: SelectSubset<T, GymMembershipReferralFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GymMembershipReferralClient<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first GymMembershipReferral that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipReferralFindFirstArgs} args - Arguments to find a GymMembershipReferral
     * @example
     * // Get one GymMembershipReferral
     * const gymMembershipReferral = await prisma.gymMembershipReferral.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GymMembershipReferralFindFirstArgs>(args?: SelectSubset<T, GymMembershipReferralFindFirstArgs<ExtArgs>>): Prisma__GymMembershipReferralClient<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first GymMembershipReferral that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipReferralFindFirstOrThrowArgs} args - Arguments to find a GymMembershipReferral
     * @example
     * // Get one GymMembershipReferral
     * const gymMembershipReferral = await prisma.gymMembershipReferral.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GymMembershipReferralFindFirstOrThrowArgs>(args?: SelectSubset<T, GymMembershipReferralFindFirstOrThrowArgs<ExtArgs>>): Prisma__GymMembershipReferralClient<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more GymMembershipReferrals that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipReferralFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GymMembershipReferrals
     * const gymMembershipReferrals = await prisma.gymMembershipReferral.findMany()
     * 
     * // Get first 10 GymMembershipReferrals
     * const gymMembershipReferrals = await prisma.gymMembershipReferral.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const gymMembershipReferralWithIdOnly = await prisma.gymMembershipReferral.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GymMembershipReferralFindManyArgs>(args?: SelectSubset<T, GymMembershipReferralFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a GymMembershipReferral.
     * @param {GymMembershipReferralCreateArgs} args - Arguments to create a GymMembershipReferral.
     * @example
     * // Create one GymMembershipReferral
     * const GymMembershipReferral = await prisma.gymMembershipReferral.create({
     *   data: {
     *     // ... data to create a GymMembershipReferral
     *   }
     * })
     * 
     */
    create<T extends GymMembershipReferralCreateArgs>(args: SelectSubset<T, GymMembershipReferralCreateArgs<ExtArgs>>): Prisma__GymMembershipReferralClient<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many GymMembershipReferrals.
     * @param {GymMembershipReferralCreateManyArgs} args - Arguments to create many GymMembershipReferrals.
     * @example
     * // Create many GymMembershipReferrals
     * const gymMembershipReferral = await prisma.gymMembershipReferral.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GymMembershipReferralCreateManyArgs>(args?: SelectSubset<T, GymMembershipReferralCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GymMembershipReferrals and returns the data saved in the database.
     * @param {GymMembershipReferralCreateManyAndReturnArgs} args - Arguments to create many GymMembershipReferrals.
     * @example
     * // Create many GymMembershipReferrals
     * const gymMembershipReferral = await prisma.gymMembershipReferral.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GymMembershipReferrals and only return the `id`
     * const gymMembershipReferralWithIdOnly = await prisma.gymMembershipReferral.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GymMembershipReferralCreateManyAndReturnArgs>(args?: SelectSubset<T, GymMembershipReferralCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a GymMembershipReferral.
     * @param {GymMembershipReferralDeleteArgs} args - Arguments to delete one GymMembershipReferral.
     * @example
     * // Delete one GymMembershipReferral
     * const GymMembershipReferral = await prisma.gymMembershipReferral.delete({
     *   where: {
     *     // ... filter to delete one GymMembershipReferral
     *   }
     * })
     * 
     */
    delete<T extends GymMembershipReferralDeleteArgs>(args: SelectSubset<T, GymMembershipReferralDeleteArgs<ExtArgs>>): Prisma__GymMembershipReferralClient<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one GymMembershipReferral.
     * @param {GymMembershipReferralUpdateArgs} args - Arguments to update one GymMembershipReferral.
     * @example
     * // Update one GymMembershipReferral
     * const gymMembershipReferral = await prisma.gymMembershipReferral.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GymMembershipReferralUpdateArgs>(args: SelectSubset<T, GymMembershipReferralUpdateArgs<ExtArgs>>): Prisma__GymMembershipReferralClient<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more GymMembershipReferrals.
     * @param {GymMembershipReferralDeleteManyArgs} args - Arguments to filter GymMembershipReferrals to delete.
     * @example
     * // Delete a few GymMembershipReferrals
     * const { count } = await prisma.gymMembershipReferral.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GymMembershipReferralDeleteManyArgs>(args?: SelectSubset<T, GymMembershipReferralDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GymMembershipReferrals.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipReferralUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GymMembershipReferrals
     * const gymMembershipReferral = await prisma.gymMembershipReferral.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GymMembershipReferralUpdateManyArgs>(args: SelectSubset<T, GymMembershipReferralUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one GymMembershipReferral.
     * @param {GymMembershipReferralUpsertArgs} args - Arguments to update or create a GymMembershipReferral.
     * @example
     * // Update or create a GymMembershipReferral
     * const gymMembershipReferral = await prisma.gymMembershipReferral.upsert({
     *   create: {
     *     // ... data to create a GymMembershipReferral
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GymMembershipReferral we want to update
     *   }
     * })
     */
    upsert<T extends GymMembershipReferralUpsertArgs>(args: SelectSubset<T, GymMembershipReferralUpsertArgs<ExtArgs>>): Prisma__GymMembershipReferralClient<$Result.GetResult<Prisma.$GymMembershipReferralPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of GymMembershipReferrals.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipReferralCountArgs} args - Arguments to filter GymMembershipReferrals to count.
     * @example
     * // Count the number of GymMembershipReferrals
     * const count = await prisma.gymMembershipReferral.count({
     *   where: {
     *     // ... the filter for the GymMembershipReferrals we want to count
     *   }
     * })
    **/
    count<T extends GymMembershipReferralCountArgs>(
      args?: Subset<T, GymMembershipReferralCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GymMembershipReferralCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GymMembershipReferral.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipReferralAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends GymMembershipReferralAggregateArgs>(args: Subset<T, GymMembershipReferralAggregateArgs>): Prisma.PrismaPromise<GetGymMembershipReferralAggregateType<T>>

    /**
     * Group by GymMembershipReferral.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GymMembershipReferralGroupByArgs} args - Group by arguments.
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
      T extends GymMembershipReferralGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GymMembershipReferralGroupByArgs['orderBy'] }
        : { orderBy?: GymMembershipReferralGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, GymMembershipReferralGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGymMembershipReferralGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GymMembershipReferral model
   */
  readonly fields: GymMembershipReferralFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GymMembershipReferral.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GymMembershipReferralClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    membershipContract<T extends GymMembershipContractDefaultArgs<ExtArgs> = {}>(args?: Subset<T, GymMembershipContractDefaultArgs<ExtArgs>>): Prisma__GymMembershipContractClient<$Result.GetResult<Prisma.$GymMembershipContractPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the GymMembershipReferral model
   */ 
  interface GymMembershipReferralFieldRefs {
    readonly id: FieldRef<"GymMembershipReferral", 'String'>
    readonly membershipContractId: FieldRef<"GymMembershipReferral", 'String'>
    readonly gymId: FieldRef<"GymMembershipReferral", 'String'>
    readonly referrerPtUserId: FieldRef<"GymMembershipReferral", 'String'>
    readonly rate: FieldRef<"GymMembershipReferral", 'Decimal'>
    readonly amount: FieldRef<"GymMembershipReferral", 'Decimal'>
    readonly clawedBack: FieldRef<"GymMembershipReferral", 'Decimal'>
    readonly status: FieldRef<"GymMembershipReferral", 'String'>
    readonly releasedAt: FieldRef<"GymMembershipReferral", 'DateTime'>
    readonly createdAt: FieldRef<"GymMembershipReferral", 'DateTime'>
    readonly updatedAt: FieldRef<"GymMembershipReferral", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GymMembershipReferral findUnique
   */
  export type GymMembershipReferralFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipReferral to fetch.
     */
    where: GymMembershipReferralWhereUniqueInput
  }

  /**
   * GymMembershipReferral findUniqueOrThrow
   */
  export type GymMembershipReferralFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipReferral to fetch.
     */
    where: GymMembershipReferralWhereUniqueInput
  }

  /**
   * GymMembershipReferral findFirst
   */
  export type GymMembershipReferralFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipReferral to fetch.
     */
    where?: GymMembershipReferralWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipReferrals to fetch.
     */
    orderBy?: GymMembershipReferralOrderByWithRelationInput | GymMembershipReferralOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymMembershipReferrals.
     */
    cursor?: GymMembershipReferralWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipReferrals from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipReferrals.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymMembershipReferrals.
     */
    distinct?: GymMembershipReferralScalarFieldEnum | GymMembershipReferralScalarFieldEnum[]
  }

  /**
   * GymMembershipReferral findFirstOrThrow
   */
  export type GymMembershipReferralFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipReferral to fetch.
     */
    where?: GymMembershipReferralWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipReferrals to fetch.
     */
    orderBy?: GymMembershipReferralOrderByWithRelationInput | GymMembershipReferralOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GymMembershipReferrals.
     */
    cursor?: GymMembershipReferralWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipReferrals from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipReferrals.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GymMembershipReferrals.
     */
    distinct?: GymMembershipReferralScalarFieldEnum | GymMembershipReferralScalarFieldEnum[]
  }

  /**
   * GymMembershipReferral findMany
   */
  export type GymMembershipReferralFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    /**
     * Filter, which GymMembershipReferrals to fetch.
     */
    where?: GymMembershipReferralWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GymMembershipReferrals to fetch.
     */
    orderBy?: GymMembershipReferralOrderByWithRelationInput | GymMembershipReferralOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GymMembershipReferrals.
     */
    cursor?: GymMembershipReferralWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GymMembershipReferrals from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GymMembershipReferrals.
     */
    skip?: number
    distinct?: GymMembershipReferralScalarFieldEnum | GymMembershipReferralScalarFieldEnum[]
  }

  /**
   * GymMembershipReferral create
   */
  export type GymMembershipReferralCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    /**
     * The data needed to create a GymMembershipReferral.
     */
    data: XOR<GymMembershipReferralCreateInput, GymMembershipReferralUncheckedCreateInput>
  }

  /**
   * GymMembershipReferral createMany
   */
  export type GymMembershipReferralCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GymMembershipReferrals.
     */
    data: GymMembershipReferralCreateManyInput | GymMembershipReferralCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GymMembershipReferral createManyAndReturn
   */
  export type GymMembershipReferralCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many GymMembershipReferrals.
     */
    data: GymMembershipReferralCreateManyInput | GymMembershipReferralCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * GymMembershipReferral update
   */
  export type GymMembershipReferralUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    /**
     * The data needed to update a GymMembershipReferral.
     */
    data: XOR<GymMembershipReferralUpdateInput, GymMembershipReferralUncheckedUpdateInput>
    /**
     * Choose, which GymMembershipReferral to update.
     */
    where: GymMembershipReferralWhereUniqueInput
  }

  /**
   * GymMembershipReferral updateMany
   */
  export type GymMembershipReferralUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GymMembershipReferrals.
     */
    data: XOR<GymMembershipReferralUpdateManyMutationInput, GymMembershipReferralUncheckedUpdateManyInput>
    /**
     * Filter which GymMembershipReferrals to update
     */
    where?: GymMembershipReferralWhereInput
  }

  /**
   * GymMembershipReferral upsert
   */
  export type GymMembershipReferralUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    /**
     * The filter to search for the GymMembershipReferral to update in case it exists.
     */
    where: GymMembershipReferralWhereUniqueInput
    /**
     * In case the GymMembershipReferral found by the `where` argument doesn't exist, create a new GymMembershipReferral with this data.
     */
    create: XOR<GymMembershipReferralCreateInput, GymMembershipReferralUncheckedCreateInput>
    /**
     * In case the GymMembershipReferral was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GymMembershipReferralUpdateInput, GymMembershipReferralUncheckedUpdateInput>
  }

  /**
   * GymMembershipReferral delete
   */
  export type GymMembershipReferralDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
    /**
     * Filter which GymMembershipReferral to delete.
     */
    where: GymMembershipReferralWhereUniqueInput
  }

  /**
   * GymMembershipReferral deleteMany
   */
  export type GymMembershipReferralDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GymMembershipReferrals to delete
     */
    where?: GymMembershipReferralWhereInput
  }

  /**
   * GymMembershipReferral without action
   */
  export type GymMembershipReferralDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GymMembershipReferral
     */
    select?: GymMembershipReferralSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GymMembershipReferralInclude<ExtArgs> | null
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


  export const GymScalarFieldEnum: {
    id: 'id',
    ownerId: 'ownerId',
    name: 'name',
    description: 'description',
    address: 'address',
    city: 'city',
    phone: 'phone',
    email: 'email',
    status: 'status',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type GymScalarFieldEnum = (typeof GymScalarFieldEnum)[keyof typeof GymScalarFieldEnum]


  export const GymMembershipPlanScalarFieldEnum: {
    id: 'id',
    gymId: 'gymId',
    name: 'name',
    description: 'description',
    price: 'price',
    durationDays: 'durationDays',
    visitLimit: 'visitLimit',
    status: 'status',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type GymMembershipPlanScalarFieldEnum = (typeof GymMembershipPlanScalarFieldEnum)[keyof typeof GymMembershipPlanScalarFieldEnum]


  export const GymMembershipContractScalarFieldEnum: {
    id: 'id',
    gymId: 'gymId',
    planId: 'planId',
    clientId: 'clientId',
    status: 'status',
    paymentTxnId: 'paymentTxnId',
    startDate: 'startDate',
    endDate: 'endDate',
    priceAtPurchase: 'priceAtPurchase',
    durationDaysSnapshot: 'durationDaysSnapshot',
    totalVisits: 'totalVisits',
    usedVisits: 'usedVisits',
    payoutReleasedAt: 'payoutReleasedAt',
    multiGymWarned: 'multiGymWarned',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type GymMembershipContractScalarFieldEnum = (typeof GymMembershipContractScalarFieldEnum)[keyof typeof GymMembershipContractScalarFieldEnum]


  export const GymTrainerAffiliationScalarFieldEnum: {
    id: 'id',
    gymId: 'gymId',
    ptId: 'ptId',
    status: 'status',
    employmentType: 'employmentType',
    visibility: 'visibility',
    commissionRate: 'commissionRate',
    invitedBy: 'invitedBy',
    joinedAt: 'joinedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type GymTrainerAffiliationScalarFieldEnum = (typeof GymTrainerAffiliationScalarFieldEnum)[keyof typeof GymTrainerAffiliationScalarFieldEnum]


  export const GymCheckInScalarFieldEnum: {
    id: 'id',
    membershipId: 'membershipId',
    gymId: 'gymId',
    clientId: 'clientId',
    checkedInBy: 'checkedInBy',
    createdAt: 'createdAt'
  };

  export type GymCheckInScalarFieldEnum = (typeof GymCheckInScalarFieldEnum)[keyof typeof GymCheckInScalarFieldEnum]


  export const GymReviewScalarFieldEnum: {
    id: 'id',
    gymId: 'gymId',
    clientId: 'clientId',
    rating: 'rating',
    comment: 'comment',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type GymReviewScalarFieldEnum = (typeof GymReviewScalarFieldEnum)[keyof typeof GymReviewScalarFieldEnum]


  export const GymPtCollaborationScalarFieldEnum: {
    id: 'id',
    gymId: 'gymId',
    ptUserId: 'ptUserId',
    proposedPtRate: 'proposedPtRate',
    proposedGymRate: 'proposedGymRate',
    platformRate: 'platformRate',
    status: 'status',
    proposedBy: 'proposedBy',
    round: 'round',
    expiresAt: 'expiresAt',
    acceptedAt: 'acceptedAt',
    terminatedAt: 'terminatedAt',
    terminatedBy: 'terminatedBy',
    note: 'note',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type GymPtCollaborationScalarFieldEnum = (typeof GymPtCollaborationScalarFieldEnum)[keyof typeof GymPtCollaborationScalarFieldEnum]


  export const GymMembershipReferralScalarFieldEnum: {
    id: 'id',
    membershipContractId: 'membershipContractId',
    gymId: 'gymId',
    referrerPtUserId: 'referrerPtUserId',
    rate: 'rate',
    amount: 'amount',
    clawedBack: 'clawedBack',
    status: 'status',
    releasedAt: 'releasedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type GymMembershipReferralScalarFieldEnum = (typeof GymMembershipReferralScalarFieldEnum)[keyof typeof GymMembershipReferralScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


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
   * Reference to a field of type 'GymStatus'
   */
  export type EnumGymStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'GymStatus'>
    


  /**
   * Reference to a field of type 'GymStatus[]'
   */
  export type ListEnumGymStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'GymStatus[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Decimal'
   */
  export type DecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal'>
    


  /**
   * Reference to a field of type 'Decimal[]'
   */
  export type ListDecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'GymMembershipPlanStatus'
   */
  export type EnumGymMembershipPlanStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'GymMembershipPlanStatus'>
    


  /**
   * Reference to a field of type 'GymMembershipPlanStatus[]'
   */
  export type ListEnumGymMembershipPlanStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'GymMembershipPlanStatus[]'>
    


  /**
   * Reference to a field of type 'GymMembershipContractStatus'
   */
  export type EnumGymMembershipContractStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'GymMembershipContractStatus'>
    


  /**
   * Reference to a field of type 'GymMembershipContractStatus[]'
   */
  export type ListEnumGymMembershipContractStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'GymMembershipContractStatus[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'AffiliationStatus'
   */
  export type EnumAffiliationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AffiliationStatus'>
    


  /**
   * Reference to a field of type 'AffiliationStatus[]'
   */
  export type ListEnumAffiliationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AffiliationStatus[]'>
    


  /**
   * Reference to a field of type 'AffiliationEmployment'
   */
  export type EnumAffiliationEmploymentFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AffiliationEmployment'>
    


  /**
   * Reference to a field of type 'AffiliationEmployment[]'
   */
  export type ListEnumAffiliationEmploymentFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AffiliationEmployment[]'>
    


  /**
   * Reference to a field of type 'GymTrainerVisibility'
   */
  export type EnumGymTrainerVisibilityFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'GymTrainerVisibility'>
    


  /**
   * Reference to a field of type 'GymTrainerVisibility[]'
   */
  export type ListEnumGymTrainerVisibilityFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'GymTrainerVisibility[]'>
    


  /**
   * Reference to a field of type 'CollaborationStatus'
   */
  export type EnumCollaborationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'CollaborationStatus'>
    


  /**
   * Reference to a field of type 'CollaborationStatus[]'
   */
  export type ListEnumCollaborationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'CollaborationStatus[]'>
    


  /**
   * Reference to a field of type 'CollaborationParty'
   */
  export type EnumCollaborationPartyFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'CollaborationParty'>
    


  /**
   * Reference to a field of type 'CollaborationParty[]'
   */
  export type ListEnumCollaborationPartyFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'CollaborationParty[]'>
    


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


  export type GymWhereInput = {
    AND?: GymWhereInput | GymWhereInput[]
    OR?: GymWhereInput[]
    NOT?: GymWhereInput | GymWhereInput[]
    id?: StringFilter<"Gym"> | string
    ownerId?: StringFilter<"Gym"> | string
    name?: StringFilter<"Gym"> | string
    description?: StringNullableFilter<"Gym"> | string | null
    address?: StringFilter<"Gym"> | string
    city?: StringNullableFilter<"Gym"> | string | null
    phone?: StringNullableFilter<"Gym"> | string | null
    email?: StringNullableFilter<"Gym"> | string | null
    status?: EnumGymStatusFilter<"Gym"> | $Enums.GymStatus
    createdAt?: DateTimeFilter<"Gym"> | Date | string
    updatedAt?: DateTimeFilter<"Gym"> | Date | string
    plans?: GymMembershipPlanListRelationFilter
    memberships?: GymMembershipContractListRelationFilter
    affiliations?: GymTrainerAffiliationListRelationFilter
    reviews?: GymReviewListRelationFilter
    collaborations?: GymPtCollaborationListRelationFilter
  }

  export type GymOrderByWithRelationInput = {
    id?: SortOrder
    ownerId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    address?: SortOrder
    city?: SortOrderInput | SortOrder
    phone?: SortOrderInput | SortOrder
    email?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    plans?: GymMembershipPlanOrderByRelationAggregateInput
    memberships?: GymMembershipContractOrderByRelationAggregateInput
    affiliations?: GymTrainerAffiliationOrderByRelationAggregateInput
    reviews?: GymReviewOrderByRelationAggregateInput
    collaborations?: GymPtCollaborationOrderByRelationAggregateInput
  }

  export type GymWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: GymWhereInput | GymWhereInput[]
    OR?: GymWhereInput[]
    NOT?: GymWhereInput | GymWhereInput[]
    ownerId?: StringFilter<"Gym"> | string
    name?: StringFilter<"Gym"> | string
    description?: StringNullableFilter<"Gym"> | string | null
    address?: StringFilter<"Gym"> | string
    city?: StringNullableFilter<"Gym"> | string | null
    phone?: StringNullableFilter<"Gym"> | string | null
    email?: StringNullableFilter<"Gym"> | string | null
    status?: EnumGymStatusFilter<"Gym"> | $Enums.GymStatus
    createdAt?: DateTimeFilter<"Gym"> | Date | string
    updatedAt?: DateTimeFilter<"Gym"> | Date | string
    plans?: GymMembershipPlanListRelationFilter
    memberships?: GymMembershipContractListRelationFilter
    affiliations?: GymTrainerAffiliationListRelationFilter
    reviews?: GymReviewListRelationFilter
    collaborations?: GymPtCollaborationListRelationFilter
  }, "id">

  export type GymOrderByWithAggregationInput = {
    id?: SortOrder
    ownerId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    address?: SortOrder
    city?: SortOrderInput | SortOrder
    phone?: SortOrderInput | SortOrder
    email?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: GymCountOrderByAggregateInput
    _max?: GymMaxOrderByAggregateInput
    _min?: GymMinOrderByAggregateInput
  }

  export type GymScalarWhereWithAggregatesInput = {
    AND?: GymScalarWhereWithAggregatesInput | GymScalarWhereWithAggregatesInput[]
    OR?: GymScalarWhereWithAggregatesInput[]
    NOT?: GymScalarWhereWithAggregatesInput | GymScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Gym"> | string
    ownerId?: StringWithAggregatesFilter<"Gym"> | string
    name?: StringWithAggregatesFilter<"Gym"> | string
    description?: StringNullableWithAggregatesFilter<"Gym"> | string | null
    address?: StringWithAggregatesFilter<"Gym"> | string
    city?: StringNullableWithAggregatesFilter<"Gym"> | string | null
    phone?: StringNullableWithAggregatesFilter<"Gym"> | string | null
    email?: StringNullableWithAggregatesFilter<"Gym"> | string | null
    status?: EnumGymStatusWithAggregatesFilter<"Gym"> | $Enums.GymStatus
    createdAt?: DateTimeWithAggregatesFilter<"Gym"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Gym"> | Date | string
  }

  export type GymMembershipPlanWhereInput = {
    AND?: GymMembershipPlanWhereInput | GymMembershipPlanWhereInput[]
    OR?: GymMembershipPlanWhereInput[]
    NOT?: GymMembershipPlanWhereInput | GymMembershipPlanWhereInput[]
    id?: StringFilter<"GymMembershipPlan"> | string
    gymId?: StringFilter<"GymMembershipPlan"> | string
    name?: StringFilter<"GymMembershipPlan"> | string
    description?: StringNullableFilter<"GymMembershipPlan"> | string | null
    price?: DecimalFilter<"GymMembershipPlan"> | Decimal | DecimalJsLike | number | string
    durationDays?: IntFilter<"GymMembershipPlan"> | number
    visitLimit?: IntNullableFilter<"GymMembershipPlan"> | number | null
    status?: EnumGymMembershipPlanStatusFilter<"GymMembershipPlan"> | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFilter<"GymMembershipPlan"> | Date | string
    updatedAt?: DateTimeFilter<"GymMembershipPlan"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
    memberships?: GymMembershipContractListRelationFilter
  }

  export type GymMembershipPlanOrderByWithRelationInput = {
    id?: SortOrder
    gymId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    price?: SortOrder
    durationDays?: SortOrder
    visitLimit?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    gym?: GymOrderByWithRelationInput
    memberships?: GymMembershipContractOrderByRelationAggregateInput
  }

  export type GymMembershipPlanWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: GymMembershipPlanWhereInput | GymMembershipPlanWhereInput[]
    OR?: GymMembershipPlanWhereInput[]
    NOT?: GymMembershipPlanWhereInput | GymMembershipPlanWhereInput[]
    gymId?: StringFilter<"GymMembershipPlan"> | string
    name?: StringFilter<"GymMembershipPlan"> | string
    description?: StringNullableFilter<"GymMembershipPlan"> | string | null
    price?: DecimalFilter<"GymMembershipPlan"> | Decimal | DecimalJsLike | number | string
    durationDays?: IntFilter<"GymMembershipPlan"> | number
    visitLimit?: IntNullableFilter<"GymMembershipPlan"> | number | null
    status?: EnumGymMembershipPlanStatusFilter<"GymMembershipPlan"> | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFilter<"GymMembershipPlan"> | Date | string
    updatedAt?: DateTimeFilter<"GymMembershipPlan"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
    memberships?: GymMembershipContractListRelationFilter
  }, "id">

  export type GymMembershipPlanOrderByWithAggregationInput = {
    id?: SortOrder
    gymId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    price?: SortOrder
    durationDays?: SortOrder
    visitLimit?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: GymMembershipPlanCountOrderByAggregateInput
    _avg?: GymMembershipPlanAvgOrderByAggregateInput
    _max?: GymMembershipPlanMaxOrderByAggregateInput
    _min?: GymMembershipPlanMinOrderByAggregateInput
    _sum?: GymMembershipPlanSumOrderByAggregateInput
  }

  export type GymMembershipPlanScalarWhereWithAggregatesInput = {
    AND?: GymMembershipPlanScalarWhereWithAggregatesInput | GymMembershipPlanScalarWhereWithAggregatesInput[]
    OR?: GymMembershipPlanScalarWhereWithAggregatesInput[]
    NOT?: GymMembershipPlanScalarWhereWithAggregatesInput | GymMembershipPlanScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"GymMembershipPlan"> | string
    gymId?: StringWithAggregatesFilter<"GymMembershipPlan"> | string
    name?: StringWithAggregatesFilter<"GymMembershipPlan"> | string
    description?: StringNullableWithAggregatesFilter<"GymMembershipPlan"> | string | null
    price?: DecimalWithAggregatesFilter<"GymMembershipPlan"> | Decimal | DecimalJsLike | number | string
    durationDays?: IntWithAggregatesFilter<"GymMembershipPlan"> | number
    visitLimit?: IntNullableWithAggregatesFilter<"GymMembershipPlan"> | number | null
    status?: EnumGymMembershipPlanStatusWithAggregatesFilter<"GymMembershipPlan"> | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeWithAggregatesFilter<"GymMembershipPlan"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"GymMembershipPlan"> | Date | string
  }

  export type GymMembershipContractWhereInput = {
    AND?: GymMembershipContractWhereInput | GymMembershipContractWhereInput[]
    OR?: GymMembershipContractWhereInput[]
    NOT?: GymMembershipContractWhereInput | GymMembershipContractWhereInput[]
    id?: StringFilter<"GymMembershipContract"> | string
    gymId?: StringFilter<"GymMembershipContract"> | string
    planId?: StringFilter<"GymMembershipContract"> | string
    clientId?: StringFilter<"GymMembershipContract"> | string
    status?: EnumGymMembershipContractStatusFilter<"GymMembershipContract"> | $Enums.GymMembershipContractStatus
    paymentTxnId?: StringNullableFilter<"GymMembershipContract"> | string | null
    startDate?: DateTimeNullableFilter<"GymMembershipContract"> | Date | string | null
    endDate?: DateTimeNullableFilter<"GymMembershipContract"> | Date | string | null
    priceAtPurchase?: DecimalFilter<"GymMembershipContract"> | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFilter<"GymMembershipContract"> | number
    totalVisits?: IntNullableFilter<"GymMembershipContract"> | number | null
    usedVisits?: IntFilter<"GymMembershipContract"> | number
    payoutReleasedAt?: DateTimeNullableFilter<"GymMembershipContract"> | Date | string | null
    multiGymWarned?: BoolFilter<"GymMembershipContract"> | boolean
    createdAt?: DateTimeFilter<"GymMembershipContract"> | Date | string
    updatedAt?: DateTimeFilter<"GymMembershipContract"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
    plan?: XOR<GymMembershipPlanRelationFilter, GymMembershipPlanWhereInput>
    checkIns?: GymCheckInListRelationFilter
    referral?: XOR<GymMembershipReferralNullableRelationFilter, GymMembershipReferralWhereInput> | null
  }

  export type GymMembershipContractOrderByWithRelationInput = {
    id?: SortOrder
    gymId?: SortOrder
    planId?: SortOrder
    clientId?: SortOrder
    status?: SortOrder
    paymentTxnId?: SortOrderInput | SortOrder
    startDate?: SortOrderInput | SortOrder
    endDate?: SortOrderInput | SortOrder
    priceAtPurchase?: SortOrder
    durationDaysSnapshot?: SortOrder
    totalVisits?: SortOrderInput | SortOrder
    usedVisits?: SortOrder
    payoutReleasedAt?: SortOrderInput | SortOrder
    multiGymWarned?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    gym?: GymOrderByWithRelationInput
    plan?: GymMembershipPlanOrderByWithRelationInput
    checkIns?: GymCheckInOrderByRelationAggregateInput
    referral?: GymMembershipReferralOrderByWithRelationInput
  }

  export type GymMembershipContractWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: GymMembershipContractWhereInput | GymMembershipContractWhereInput[]
    OR?: GymMembershipContractWhereInput[]
    NOT?: GymMembershipContractWhereInput | GymMembershipContractWhereInput[]
    gymId?: StringFilter<"GymMembershipContract"> | string
    planId?: StringFilter<"GymMembershipContract"> | string
    clientId?: StringFilter<"GymMembershipContract"> | string
    status?: EnumGymMembershipContractStatusFilter<"GymMembershipContract"> | $Enums.GymMembershipContractStatus
    paymentTxnId?: StringNullableFilter<"GymMembershipContract"> | string | null
    startDate?: DateTimeNullableFilter<"GymMembershipContract"> | Date | string | null
    endDate?: DateTimeNullableFilter<"GymMembershipContract"> | Date | string | null
    priceAtPurchase?: DecimalFilter<"GymMembershipContract"> | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFilter<"GymMembershipContract"> | number
    totalVisits?: IntNullableFilter<"GymMembershipContract"> | number | null
    usedVisits?: IntFilter<"GymMembershipContract"> | number
    payoutReleasedAt?: DateTimeNullableFilter<"GymMembershipContract"> | Date | string | null
    multiGymWarned?: BoolFilter<"GymMembershipContract"> | boolean
    createdAt?: DateTimeFilter<"GymMembershipContract"> | Date | string
    updatedAt?: DateTimeFilter<"GymMembershipContract"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
    plan?: XOR<GymMembershipPlanRelationFilter, GymMembershipPlanWhereInput>
    checkIns?: GymCheckInListRelationFilter
    referral?: XOR<GymMembershipReferralNullableRelationFilter, GymMembershipReferralWhereInput> | null
  }, "id">

  export type GymMembershipContractOrderByWithAggregationInput = {
    id?: SortOrder
    gymId?: SortOrder
    planId?: SortOrder
    clientId?: SortOrder
    status?: SortOrder
    paymentTxnId?: SortOrderInput | SortOrder
    startDate?: SortOrderInput | SortOrder
    endDate?: SortOrderInput | SortOrder
    priceAtPurchase?: SortOrder
    durationDaysSnapshot?: SortOrder
    totalVisits?: SortOrderInput | SortOrder
    usedVisits?: SortOrder
    payoutReleasedAt?: SortOrderInput | SortOrder
    multiGymWarned?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: GymMembershipContractCountOrderByAggregateInput
    _avg?: GymMembershipContractAvgOrderByAggregateInput
    _max?: GymMembershipContractMaxOrderByAggregateInput
    _min?: GymMembershipContractMinOrderByAggregateInput
    _sum?: GymMembershipContractSumOrderByAggregateInput
  }

  export type GymMembershipContractScalarWhereWithAggregatesInput = {
    AND?: GymMembershipContractScalarWhereWithAggregatesInput | GymMembershipContractScalarWhereWithAggregatesInput[]
    OR?: GymMembershipContractScalarWhereWithAggregatesInput[]
    NOT?: GymMembershipContractScalarWhereWithAggregatesInput | GymMembershipContractScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"GymMembershipContract"> | string
    gymId?: StringWithAggregatesFilter<"GymMembershipContract"> | string
    planId?: StringWithAggregatesFilter<"GymMembershipContract"> | string
    clientId?: StringWithAggregatesFilter<"GymMembershipContract"> | string
    status?: EnumGymMembershipContractStatusWithAggregatesFilter<"GymMembershipContract"> | $Enums.GymMembershipContractStatus
    paymentTxnId?: StringNullableWithAggregatesFilter<"GymMembershipContract"> | string | null
    startDate?: DateTimeNullableWithAggregatesFilter<"GymMembershipContract"> | Date | string | null
    endDate?: DateTimeNullableWithAggregatesFilter<"GymMembershipContract"> | Date | string | null
    priceAtPurchase?: DecimalWithAggregatesFilter<"GymMembershipContract"> | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntWithAggregatesFilter<"GymMembershipContract"> | number
    totalVisits?: IntNullableWithAggregatesFilter<"GymMembershipContract"> | number | null
    usedVisits?: IntWithAggregatesFilter<"GymMembershipContract"> | number
    payoutReleasedAt?: DateTimeNullableWithAggregatesFilter<"GymMembershipContract"> | Date | string | null
    multiGymWarned?: BoolWithAggregatesFilter<"GymMembershipContract"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"GymMembershipContract"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"GymMembershipContract"> | Date | string
  }

  export type GymTrainerAffiliationWhereInput = {
    AND?: GymTrainerAffiliationWhereInput | GymTrainerAffiliationWhereInput[]
    OR?: GymTrainerAffiliationWhereInput[]
    NOT?: GymTrainerAffiliationWhereInput | GymTrainerAffiliationWhereInput[]
    id?: StringFilter<"GymTrainerAffiliation"> | string
    gymId?: StringFilter<"GymTrainerAffiliation"> | string
    ptId?: StringFilter<"GymTrainerAffiliation"> | string
    status?: EnumAffiliationStatusFilter<"GymTrainerAffiliation"> | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFilter<"GymTrainerAffiliation"> | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFilter<"GymTrainerAffiliation"> | $Enums.GymTrainerVisibility
    commissionRate?: DecimalNullableFilter<"GymTrainerAffiliation"> | Decimal | DecimalJsLike | number | string | null
    invitedBy?: StringNullableFilter<"GymTrainerAffiliation"> | string | null
    joinedAt?: DateTimeNullableFilter<"GymTrainerAffiliation"> | Date | string | null
    createdAt?: DateTimeFilter<"GymTrainerAffiliation"> | Date | string
    updatedAt?: DateTimeFilter<"GymTrainerAffiliation"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
  }

  export type GymTrainerAffiliationOrderByWithRelationInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptId?: SortOrder
    status?: SortOrder
    employmentType?: SortOrder
    visibility?: SortOrder
    commissionRate?: SortOrderInput | SortOrder
    invitedBy?: SortOrderInput | SortOrder
    joinedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    gym?: GymOrderByWithRelationInput
  }

  export type GymTrainerAffiliationWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    gymId_ptId?: GymTrainerAffiliationGymIdPtIdCompoundUniqueInput
    AND?: GymTrainerAffiliationWhereInput | GymTrainerAffiliationWhereInput[]
    OR?: GymTrainerAffiliationWhereInput[]
    NOT?: GymTrainerAffiliationWhereInput | GymTrainerAffiliationWhereInput[]
    gymId?: StringFilter<"GymTrainerAffiliation"> | string
    ptId?: StringFilter<"GymTrainerAffiliation"> | string
    status?: EnumAffiliationStatusFilter<"GymTrainerAffiliation"> | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFilter<"GymTrainerAffiliation"> | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFilter<"GymTrainerAffiliation"> | $Enums.GymTrainerVisibility
    commissionRate?: DecimalNullableFilter<"GymTrainerAffiliation"> | Decimal | DecimalJsLike | number | string | null
    invitedBy?: StringNullableFilter<"GymTrainerAffiliation"> | string | null
    joinedAt?: DateTimeNullableFilter<"GymTrainerAffiliation"> | Date | string | null
    createdAt?: DateTimeFilter<"GymTrainerAffiliation"> | Date | string
    updatedAt?: DateTimeFilter<"GymTrainerAffiliation"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
  }, "id" | "gymId_ptId">

  export type GymTrainerAffiliationOrderByWithAggregationInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptId?: SortOrder
    status?: SortOrder
    employmentType?: SortOrder
    visibility?: SortOrder
    commissionRate?: SortOrderInput | SortOrder
    invitedBy?: SortOrderInput | SortOrder
    joinedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: GymTrainerAffiliationCountOrderByAggregateInput
    _avg?: GymTrainerAffiliationAvgOrderByAggregateInput
    _max?: GymTrainerAffiliationMaxOrderByAggregateInput
    _min?: GymTrainerAffiliationMinOrderByAggregateInput
    _sum?: GymTrainerAffiliationSumOrderByAggregateInput
  }

  export type GymTrainerAffiliationScalarWhereWithAggregatesInput = {
    AND?: GymTrainerAffiliationScalarWhereWithAggregatesInput | GymTrainerAffiliationScalarWhereWithAggregatesInput[]
    OR?: GymTrainerAffiliationScalarWhereWithAggregatesInput[]
    NOT?: GymTrainerAffiliationScalarWhereWithAggregatesInput | GymTrainerAffiliationScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"GymTrainerAffiliation"> | string
    gymId?: StringWithAggregatesFilter<"GymTrainerAffiliation"> | string
    ptId?: StringWithAggregatesFilter<"GymTrainerAffiliation"> | string
    status?: EnumAffiliationStatusWithAggregatesFilter<"GymTrainerAffiliation"> | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentWithAggregatesFilter<"GymTrainerAffiliation"> | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityWithAggregatesFilter<"GymTrainerAffiliation"> | $Enums.GymTrainerVisibility
    commissionRate?: DecimalNullableWithAggregatesFilter<"GymTrainerAffiliation"> | Decimal | DecimalJsLike | number | string | null
    invitedBy?: StringNullableWithAggregatesFilter<"GymTrainerAffiliation"> | string | null
    joinedAt?: DateTimeNullableWithAggregatesFilter<"GymTrainerAffiliation"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"GymTrainerAffiliation"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"GymTrainerAffiliation"> | Date | string
  }

  export type GymCheckInWhereInput = {
    AND?: GymCheckInWhereInput | GymCheckInWhereInput[]
    OR?: GymCheckInWhereInput[]
    NOT?: GymCheckInWhereInput | GymCheckInWhereInput[]
    id?: StringFilter<"GymCheckIn"> | string
    membershipId?: StringFilter<"GymCheckIn"> | string
    gymId?: StringFilter<"GymCheckIn"> | string
    clientId?: StringFilter<"GymCheckIn"> | string
    checkedInBy?: StringFilter<"GymCheckIn"> | string
    createdAt?: DateTimeFilter<"GymCheckIn"> | Date | string
    membership?: XOR<GymMembershipContractRelationFilter, GymMembershipContractWhereInput>
  }

  export type GymCheckInOrderByWithRelationInput = {
    id?: SortOrder
    membershipId?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    checkedInBy?: SortOrder
    createdAt?: SortOrder
    membership?: GymMembershipContractOrderByWithRelationInput
  }

  export type GymCheckInWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: GymCheckInWhereInput | GymCheckInWhereInput[]
    OR?: GymCheckInWhereInput[]
    NOT?: GymCheckInWhereInput | GymCheckInWhereInput[]
    membershipId?: StringFilter<"GymCheckIn"> | string
    gymId?: StringFilter<"GymCheckIn"> | string
    clientId?: StringFilter<"GymCheckIn"> | string
    checkedInBy?: StringFilter<"GymCheckIn"> | string
    createdAt?: DateTimeFilter<"GymCheckIn"> | Date | string
    membership?: XOR<GymMembershipContractRelationFilter, GymMembershipContractWhereInput>
  }, "id">

  export type GymCheckInOrderByWithAggregationInput = {
    id?: SortOrder
    membershipId?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    checkedInBy?: SortOrder
    createdAt?: SortOrder
    _count?: GymCheckInCountOrderByAggregateInput
    _max?: GymCheckInMaxOrderByAggregateInput
    _min?: GymCheckInMinOrderByAggregateInput
  }

  export type GymCheckInScalarWhereWithAggregatesInput = {
    AND?: GymCheckInScalarWhereWithAggregatesInput | GymCheckInScalarWhereWithAggregatesInput[]
    OR?: GymCheckInScalarWhereWithAggregatesInput[]
    NOT?: GymCheckInScalarWhereWithAggregatesInput | GymCheckInScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"GymCheckIn"> | string
    membershipId?: StringWithAggregatesFilter<"GymCheckIn"> | string
    gymId?: StringWithAggregatesFilter<"GymCheckIn"> | string
    clientId?: StringWithAggregatesFilter<"GymCheckIn"> | string
    checkedInBy?: StringWithAggregatesFilter<"GymCheckIn"> | string
    createdAt?: DateTimeWithAggregatesFilter<"GymCheckIn"> | Date | string
  }

  export type GymReviewWhereInput = {
    AND?: GymReviewWhereInput | GymReviewWhereInput[]
    OR?: GymReviewWhereInput[]
    NOT?: GymReviewWhereInput | GymReviewWhereInput[]
    id?: StringFilter<"GymReview"> | string
    gymId?: StringFilter<"GymReview"> | string
    clientId?: StringFilter<"GymReview"> | string
    rating?: IntFilter<"GymReview"> | number
    comment?: StringNullableFilter<"GymReview"> | string | null
    createdAt?: DateTimeFilter<"GymReview"> | Date | string
    updatedAt?: DateTimeFilter<"GymReview"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
  }

  export type GymReviewOrderByWithRelationInput = {
    id?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    rating?: SortOrder
    comment?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    gym?: GymOrderByWithRelationInput
  }

  export type GymReviewWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    gymId_clientId?: GymReviewGymIdClientIdCompoundUniqueInput
    AND?: GymReviewWhereInput | GymReviewWhereInput[]
    OR?: GymReviewWhereInput[]
    NOT?: GymReviewWhereInput | GymReviewWhereInput[]
    gymId?: StringFilter<"GymReview"> | string
    clientId?: StringFilter<"GymReview"> | string
    rating?: IntFilter<"GymReview"> | number
    comment?: StringNullableFilter<"GymReview"> | string | null
    createdAt?: DateTimeFilter<"GymReview"> | Date | string
    updatedAt?: DateTimeFilter<"GymReview"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
  }, "id" | "gymId_clientId">

  export type GymReviewOrderByWithAggregationInput = {
    id?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    rating?: SortOrder
    comment?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: GymReviewCountOrderByAggregateInput
    _avg?: GymReviewAvgOrderByAggregateInput
    _max?: GymReviewMaxOrderByAggregateInput
    _min?: GymReviewMinOrderByAggregateInput
    _sum?: GymReviewSumOrderByAggregateInput
  }

  export type GymReviewScalarWhereWithAggregatesInput = {
    AND?: GymReviewScalarWhereWithAggregatesInput | GymReviewScalarWhereWithAggregatesInput[]
    OR?: GymReviewScalarWhereWithAggregatesInput[]
    NOT?: GymReviewScalarWhereWithAggregatesInput | GymReviewScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"GymReview"> | string
    gymId?: StringWithAggregatesFilter<"GymReview"> | string
    clientId?: StringWithAggregatesFilter<"GymReview"> | string
    rating?: IntWithAggregatesFilter<"GymReview"> | number
    comment?: StringNullableWithAggregatesFilter<"GymReview"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"GymReview"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"GymReview"> | Date | string
  }

  export type GymPtCollaborationWhereInput = {
    AND?: GymPtCollaborationWhereInput | GymPtCollaborationWhereInput[]
    OR?: GymPtCollaborationWhereInput[]
    NOT?: GymPtCollaborationWhereInput | GymPtCollaborationWhereInput[]
    id?: StringFilter<"GymPtCollaboration"> | string
    gymId?: StringFilter<"GymPtCollaboration"> | string
    ptUserId?: StringFilter<"GymPtCollaboration"> | string
    proposedPtRate?: DecimalFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFilter<"GymPtCollaboration"> | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFilter<"GymPtCollaboration"> | $Enums.CollaborationParty
    round?: IntFilter<"GymPtCollaboration"> | number
    expiresAt?: DateTimeFilter<"GymPtCollaboration"> | Date | string
    acceptedAt?: DateTimeNullableFilter<"GymPtCollaboration"> | Date | string | null
    terminatedAt?: DateTimeNullableFilter<"GymPtCollaboration"> | Date | string | null
    terminatedBy?: StringNullableFilter<"GymPtCollaboration"> | string | null
    note?: StringNullableFilter<"GymPtCollaboration"> | string | null
    createdAt?: DateTimeFilter<"GymPtCollaboration"> | Date | string
    updatedAt?: DateTimeFilter<"GymPtCollaboration"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
  }

  export type GymPtCollaborationOrderByWithRelationInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptUserId?: SortOrder
    proposedPtRate?: SortOrder
    proposedGymRate?: SortOrder
    platformRate?: SortOrder
    status?: SortOrder
    proposedBy?: SortOrder
    round?: SortOrder
    expiresAt?: SortOrder
    acceptedAt?: SortOrderInput | SortOrder
    terminatedAt?: SortOrderInput | SortOrder
    terminatedBy?: SortOrderInput | SortOrder
    note?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    gym?: GymOrderByWithRelationInput
  }

  export type GymPtCollaborationWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: GymPtCollaborationWhereInput | GymPtCollaborationWhereInput[]
    OR?: GymPtCollaborationWhereInput[]
    NOT?: GymPtCollaborationWhereInput | GymPtCollaborationWhereInput[]
    gymId?: StringFilter<"GymPtCollaboration"> | string
    ptUserId?: StringFilter<"GymPtCollaboration"> | string
    proposedPtRate?: DecimalFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFilter<"GymPtCollaboration"> | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFilter<"GymPtCollaboration"> | $Enums.CollaborationParty
    round?: IntFilter<"GymPtCollaboration"> | number
    expiresAt?: DateTimeFilter<"GymPtCollaboration"> | Date | string
    acceptedAt?: DateTimeNullableFilter<"GymPtCollaboration"> | Date | string | null
    terminatedAt?: DateTimeNullableFilter<"GymPtCollaboration"> | Date | string | null
    terminatedBy?: StringNullableFilter<"GymPtCollaboration"> | string | null
    note?: StringNullableFilter<"GymPtCollaboration"> | string | null
    createdAt?: DateTimeFilter<"GymPtCollaboration"> | Date | string
    updatedAt?: DateTimeFilter<"GymPtCollaboration"> | Date | string
    gym?: XOR<GymRelationFilter, GymWhereInput>
  }, "id">

  export type GymPtCollaborationOrderByWithAggregationInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptUserId?: SortOrder
    proposedPtRate?: SortOrder
    proposedGymRate?: SortOrder
    platformRate?: SortOrder
    status?: SortOrder
    proposedBy?: SortOrder
    round?: SortOrder
    expiresAt?: SortOrder
    acceptedAt?: SortOrderInput | SortOrder
    terminatedAt?: SortOrderInput | SortOrder
    terminatedBy?: SortOrderInput | SortOrder
    note?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: GymPtCollaborationCountOrderByAggregateInput
    _avg?: GymPtCollaborationAvgOrderByAggregateInput
    _max?: GymPtCollaborationMaxOrderByAggregateInput
    _min?: GymPtCollaborationMinOrderByAggregateInput
    _sum?: GymPtCollaborationSumOrderByAggregateInput
  }

  export type GymPtCollaborationScalarWhereWithAggregatesInput = {
    AND?: GymPtCollaborationScalarWhereWithAggregatesInput | GymPtCollaborationScalarWhereWithAggregatesInput[]
    OR?: GymPtCollaborationScalarWhereWithAggregatesInput[]
    NOT?: GymPtCollaborationScalarWhereWithAggregatesInput | GymPtCollaborationScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"GymPtCollaboration"> | string
    gymId?: StringWithAggregatesFilter<"GymPtCollaboration"> | string
    ptUserId?: StringWithAggregatesFilter<"GymPtCollaboration"> | string
    proposedPtRate?: DecimalWithAggregatesFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalWithAggregatesFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalWithAggregatesFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusWithAggregatesFilter<"GymPtCollaboration"> | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyWithAggregatesFilter<"GymPtCollaboration"> | $Enums.CollaborationParty
    round?: IntWithAggregatesFilter<"GymPtCollaboration"> | number
    expiresAt?: DateTimeWithAggregatesFilter<"GymPtCollaboration"> | Date | string
    acceptedAt?: DateTimeNullableWithAggregatesFilter<"GymPtCollaboration"> | Date | string | null
    terminatedAt?: DateTimeNullableWithAggregatesFilter<"GymPtCollaboration"> | Date | string | null
    terminatedBy?: StringNullableWithAggregatesFilter<"GymPtCollaboration"> | string | null
    note?: StringNullableWithAggregatesFilter<"GymPtCollaboration"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"GymPtCollaboration"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"GymPtCollaboration"> | Date | string
  }

  export type GymMembershipReferralWhereInput = {
    AND?: GymMembershipReferralWhereInput | GymMembershipReferralWhereInput[]
    OR?: GymMembershipReferralWhereInput[]
    NOT?: GymMembershipReferralWhereInput | GymMembershipReferralWhereInput[]
    id?: StringFilter<"GymMembershipReferral"> | string
    membershipContractId?: StringFilter<"GymMembershipReferral"> | string
    gymId?: StringFilter<"GymMembershipReferral"> | string
    referrerPtUserId?: StringFilter<"GymMembershipReferral"> | string
    rate?: DecimalFilter<"GymMembershipReferral"> | Decimal | DecimalJsLike | number | string
    amount?: DecimalFilter<"GymMembershipReferral"> | Decimal | DecimalJsLike | number | string
    clawedBack?: DecimalFilter<"GymMembershipReferral"> | Decimal | DecimalJsLike | number | string
    status?: StringFilter<"GymMembershipReferral"> | string
    releasedAt?: DateTimeNullableFilter<"GymMembershipReferral"> | Date | string | null
    createdAt?: DateTimeFilter<"GymMembershipReferral"> | Date | string
    updatedAt?: DateTimeFilter<"GymMembershipReferral"> | Date | string
    membershipContract?: XOR<GymMembershipContractRelationFilter, GymMembershipContractWhereInput>
  }

  export type GymMembershipReferralOrderByWithRelationInput = {
    id?: SortOrder
    membershipContractId?: SortOrder
    gymId?: SortOrder
    referrerPtUserId?: SortOrder
    rate?: SortOrder
    amount?: SortOrder
    clawedBack?: SortOrder
    status?: SortOrder
    releasedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    membershipContract?: GymMembershipContractOrderByWithRelationInput
  }

  export type GymMembershipReferralWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    membershipContractId?: string
    AND?: GymMembershipReferralWhereInput | GymMembershipReferralWhereInput[]
    OR?: GymMembershipReferralWhereInput[]
    NOT?: GymMembershipReferralWhereInput | GymMembershipReferralWhereInput[]
    gymId?: StringFilter<"GymMembershipReferral"> | string
    referrerPtUserId?: StringFilter<"GymMembershipReferral"> | string
    rate?: DecimalFilter<"GymMembershipReferral"> | Decimal | DecimalJsLike | number | string
    amount?: DecimalFilter<"GymMembershipReferral"> | Decimal | DecimalJsLike | number | string
    clawedBack?: DecimalFilter<"GymMembershipReferral"> | Decimal | DecimalJsLike | number | string
    status?: StringFilter<"GymMembershipReferral"> | string
    releasedAt?: DateTimeNullableFilter<"GymMembershipReferral"> | Date | string | null
    createdAt?: DateTimeFilter<"GymMembershipReferral"> | Date | string
    updatedAt?: DateTimeFilter<"GymMembershipReferral"> | Date | string
    membershipContract?: XOR<GymMembershipContractRelationFilter, GymMembershipContractWhereInput>
  }, "id" | "membershipContractId">

  export type GymMembershipReferralOrderByWithAggregationInput = {
    id?: SortOrder
    membershipContractId?: SortOrder
    gymId?: SortOrder
    referrerPtUserId?: SortOrder
    rate?: SortOrder
    amount?: SortOrder
    clawedBack?: SortOrder
    status?: SortOrder
    releasedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: GymMembershipReferralCountOrderByAggregateInput
    _avg?: GymMembershipReferralAvgOrderByAggregateInput
    _max?: GymMembershipReferralMaxOrderByAggregateInput
    _min?: GymMembershipReferralMinOrderByAggregateInput
    _sum?: GymMembershipReferralSumOrderByAggregateInput
  }

  export type GymMembershipReferralScalarWhereWithAggregatesInput = {
    AND?: GymMembershipReferralScalarWhereWithAggregatesInput | GymMembershipReferralScalarWhereWithAggregatesInput[]
    OR?: GymMembershipReferralScalarWhereWithAggregatesInput[]
    NOT?: GymMembershipReferralScalarWhereWithAggregatesInput | GymMembershipReferralScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"GymMembershipReferral"> | string
    membershipContractId?: StringWithAggregatesFilter<"GymMembershipReferral"> | string
    gymId?: StringWithAggregatesFilter<"GymMembershipReferral"> | string
    referrerPtUserId?: StringWithAggregatesFilter<"GymMembershipReferral"> | string
    rate?: DecimalWithAggregatesFilter<"GymMembershipReferral"> | Decimal | DecimalJsLike | number | string
    amount?: DecimalWithAggregatesFilter<"GymMembershipReferral"> | Decimal | DecimalJsLike | number | string
    clawedBack?: DecimalWithAggregatesFilter<"GymMembershipReferral"> | Decimal | DecimalJsLike | number | string
    status?: StringWithAggregatesFilter<"GymMembershipReferral"> | string
    releasedAt?: DateTimeNullableWithAggregatesFilter<"GymMembershipReferral"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"GymMembershipReferral"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"GymMembershipReferral"> | Date | string
  }

  export type GymCreateInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanCreateNestedManyWithoutGymInput
    memberships?: GymMembershipContractCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationCreateNestedManyWithoutGymInput
    reviews?: GymReviewCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationCreateNestedManyWithoutGymInput
  }

  export type GymUncheckedCreateInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanUncheckedCreateNestedManyWithoutGymInput
    memberships?: GymMembershipContractUncheckedCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationUncheckedCreateNestedManyWithoutGymInput
    reviews?: GymReviewUncheckedCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationUncheckedCreateNestedManyWithoutGymInput
  }

  export type GymUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUpdateManyWithoutGymNestedInput
    memberships?: GymMembershipContractUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUpdateManyWithoutGymNestedInput
  }

  export type GymUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUncheckedUpdateManyWithoutGymNestedInput
    memberships?: GymMembershipContractUncheckedUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUncheckedUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUncheckedUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUncheckedUpdateManyWithoutGymNestedInput
  }

  export type GymCreateManyInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipPlanCreateInput = {
    id?: string
    name: string
    description?: string | null
    price: Decimal | DecimalJsLike | number | string
    durationDays: number
    visitLimit?: number | null
    status?: $Enums.GymMembershipPlanStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    gym: GymCreateNestedOneWithoutPlansInput
    memberships?: GymMembershipContractCreateNestedManyWithoutPlanInput
  }

  export type GymMembershipPlanUncheckedCreateInput = {
    id?: string
    gymId: string
    name: string
    description?: string | null
    price: Decimal | DecimalJsLike | number | string
    durationDays: number
    visitLimit?: number | null
    status?: $Enums.GymMembershipPlanStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    memberships?: GymMembershipContractUncheckedCreateNestedManyWithoutPlanInput
  }

  export type GymMembershipPlanUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDays?: IntFieldUpdateOperationsInput | number
    visitLimit?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumGymMembershipPlanStatusFieldUpdateOperationsInput | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    gym?: GymUpdateOneRequiredWithoutPlansNestedInput
    memberships?: GymMembershipContractUpdateManyWithoutPlanNestedInput
  }

  export type GymMembershipPlanUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDays?: IntFieldUpdateOperationsInput | number
    visitLimit?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumGymMembershipPlanStatusFieldUpdateOperationsInput | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    memberships?: GymMembershipContractUncheckedUpdateManyWithoutPlanNestedInput
  }

  export type GymMembershipPlanCreateManyInput = {
    id?: string
    gymId: string
    name: string
    description?: string | null
    price: Decimal | DecimalJsLike | number | string
    durationDays: number
    visitLimit?: number | null
    status?: $Enums.GymMembershipPlanStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipPlanUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDays?: IntFieldUpdateOperationsInput | number
    visitLimit?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumGymMembershipPlanStatusFieldUpdateOperationsInput | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipPlanUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDays?: IntFieldUpdateOperationsInput | number
    visitLimit?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumGymMembershipPlanStatusFieldUpdateOperationsInput | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipContractCreateInput = {
    id?: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    gym: GymCreateNestedOneWithoutMembershipsInput
    plan: GymMembershipPlanCreateNestedOneWithoutMembershipsInput
    checkIns?: GymCheckInCreateNestedManyWithoutMembershipInput
    referral?: GymMembershipReferralCreateNestedOneWithoutMembershipContractInput
  }

  export type GymMembershipContractUncheckedCreateInput = {
    id?: string
    gymId: string
    planId: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    checkIns?: GymCheckInUncheckedCreateNestedManyWithoutMembershipInput
    referral?: GymMembershipReferralUncheckedCreateNestedOneWithoutMembershipContractInput
  }

  export type GymMembershipContractUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    gym?: GymUpdateOneRequiredWithoutMembershipsNestedInput
    plan?: GymMembershipPlanUpdateOneRequiredWithoutMembershipsNestedInput
    checkIns?: GymCheckInUpdateManyWithoutMembershipNestedInput
    referral?: GymMembershipReferralUpdateOneWithoutMembershipContractNestedInput
  }

  export type GymMembershipContractUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    planId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    checkIns?: GymCheckInUncheckedUpdateManyWithoutMembershipNestedInput
    referral?: GymMembershipReferralUncheckedUpdateOneWithoutMembershipContractNestedInput
  }

  export type GymMembershipContractCreateManyInput = {
    id?: string
    gymId: string
    planId: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipContractUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipContractUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    planId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymTrainerAffiliationCreateInput = {
    id?: string
    ptId: string
    status?: $Enums.AffiliationStatus
    employmentType?: $Enums.AffiliationEmployment
    visibility?: $Enums.GymTrainerVisibility
    commissionRate?: Decimal | DecimalJsLike | number | string | null
    invitedBy?: string | null
    joinedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    gym: GymCreateNestedOneWithoutAffiliationsInput
  }

  export type GymTrainerAffiliationUncheckedCreateInput = {
    id?: string
    gymId: string
    ptId: string
    status?: $Enums.AffiliationStatus
    employmentType?: $Enums.AffiliationEmployment
    visibility?: $Enums.GymTrainerVisibility
    commissionRate?: Decimal | DecimalJsLike | number | string | null
    invitedBy?: string | null
    joinedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymTrainerAffiliationUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptId?: StringFieldUpdateOperationsInput | string
    status?: EnumAffiliationStatusFieldUpdateOperationsInput | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFieldUpdateOperationsInput | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFieldUpdateOperationsInput | $Enums.GymTrainerVisibility
    commissionRate?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    invitedBy?: NullableStringFieldUpdateOperationsInput | string | null
    joinedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    gym?: GymUpdateOneRequiredWithoutAffiliationsNestedInput
  }

  export type GymTrainerAffiliationUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    ptId?: StringFieldUpdateOperationsInput | string
    status?: EnumAffiliationStatusFieldUpdateOperationsInput | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFieldUpdateOperationsInput | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFieldUpdateOperationsInput | $Enums.GymTrainerVisibility
    commissionRate?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    invitedBy?: NullableStringFieldUpdateOperationsInput | string | null
    joinedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymTrainerAffiliationCreateManyInput = {
    id?: string
    gymId: string
    ptId: string
    status?: $Enums.AffiliationStatus
    employmentType?: $Enums.AffiliationEmployment
    visibility?: $Enums.GymTrainerVisibility
    commissionRate?: Decimal | DecimalJsLike | number | string | null
    invitedBy?: string | null
    joinedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymTrainerAffiliationUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptId?: StringFieldUpdateOperationsInput | string
    status?: EnumAffiliationStatusFieldUpdateOperationsInput | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFieldUpdateOperationsInput | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFieldUpdateOperationsInput | $Enums.GymTrainerVisibility
    commissionRate?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    invitedBy?: NullableStringFieldUpdateOperationsInput | string | null
    joinedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymTrainerAffiliationUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    ptId?: StringFieldUpdateOperationsInput | string
    status?: EnumAffiliationStatusFieldUpdateOperationsInput | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFieldUpdateOperationsInput | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFieldUpdateOperationsInput | $Enums.GymTrainerVisibility
    commissionRate?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    invitedBy?: NullableStringFieldUpdateOperationsInput | string | null
    joinedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymCheckInCreateInput = {
    id?: string
    gymId: string
    clientId: string
    checkedInBy: string
    createdAt?: Date | string
    membership: GymMembershipContractCreateNestedOneWithoutCheckInsInput
  }

  export type GymCheckInUncheckedCreateInput = {
    id?: string
    membershipId: string
    gymId: string
    clientId: string
    checkedInBy: string
    createdAt?: Date | string
  }

  export type GymCheckInUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    checkedInBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    membership?: GymMembershipContractUpdateOneRequiredWithoutCheckInsNestedInput
  }

  export type GymCheckInUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    membershipId?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    checkedInBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymCheckInCreateManyInput = {
    id?: string
    membershipId: string
    gymId: string
    clientId: string
    checkedInBy: string
    createdAt?: Date | string
  }

  export type GymCheckInUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    checkedInBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymCheckInUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    membershipId?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    checkedInBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymReviewCreateInput = {
    id?: string
    clientId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    gym: GymCreateNestedOneWithoutReviewsInput
  }

  export type GymReviewUncheckedCreateInput = {
    id?: string
    gymId: string
    clientId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymReviewUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    gym?: GymUpdateOneRequiredWithoutReviewsNestedInput
  }

  export type GymReviewUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymReviewCreateManyInput = {
    id?: string
    gymId: string
    clientId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymReviewUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymReviewUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymPtCollaborationCreateInput = {
    id?: string
    ptUserId: string
    proposedPtRate: Decimal | DecimalJsLike | number | string
    proposedGymRate: Decimal | DecimalJsLike | number | string
    platformRate?: Decimal | DecimalJsLike | number | string
    status?: $Enums.CollaborationStatus
    proposedBy: $Enums.CollaborationParty
    round?: number
    expiresAt: Date | string
    acceptedAt?: Date | string | null
    terminatedAt?: Date | string | null
    terminatedBy?: string | null
    note?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    gym: GymCreateNestedOneWithoutCollaborationsInput
  }

  export type GymPtCollaborationUncheckedCreateInput = {
    id?: string
    gymId: string
    ptUserId: string
    proposedPtRate: Decimal | DecimalJsLike | number | string
    proposedGymRate: Decimal | DecimalJsLike | number | string
    platformRate?: Decimal | DecimalJsLike | number | string
    status?: $Enums.CollaborationStatus
    proposedBy: $Enums.CollaborationParty
    round?: number
    expiresAt: Date | string
    acceptedAt?: Date | string | null
    terminatedAt?: Date | string | null
    terminatedBy?: string | null
    note?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymPtCollaborationUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptUserId?: StringFieldUpdateOperationsInput | string
    proposedPtRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFieldUpdateOperationsInput | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFieldUpdateOperationsInput | $Enums.CollaborationParty
    round?: IntFieldUpdateOperationsInput | number
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    acceptedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    note?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    gym?: GymUpdateOneRequiredWithoutCollaborationsNestedInput
  }

  export type GymPtCollaborationUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    ptUserId?: StringFieldUpdateOperationsInput | string
    proposedPtRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFieldUpdateOperationsInput | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFieldUpdateOperationsInput | $Enums.CollaborationParty
    round?: IntFieldUpdateOperationsInput | number
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    acceptedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    note?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymPtCollaborationCreateManyInput = {
    id?: string
    gymId: string
    ptUserId: string
    proposedPtRate: Decimal | DecimalJsLike | number | string
    proposedGymRate: Decimal | DecimalJsLike | number | string
    platformRate?: Decimal | DecimalJsLike | number | string
    status?: $Enums.CollaborationStatus
    proposedBy: $Enums.CollaborationParty
    round?: number
    expiresAt: Date | string
    acceptedAt?: Date | string | null
    terminatedAt?: Date | string | null
    terminatedBy?: string | null
    note?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymPtCollaborationUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptUserId?: StringFieldUpdateOperationsInput | string
    proposedPtRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFieldUpdateOperationsInput | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFieldUpdateOperationsInput | $Enums.CollaborationParty
    round?: IntFieldUpdateOperationsInput | number
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    acceptedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    note?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymPtCollaborationUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    ptUserId?: StringFieldUpdateOperationsInput | string
    proposedPtRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFieldUpdateOperationsInput | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFieldUpdateOperationsInput | $Enums.CollaborationParty
    round?: IntFieldUpdateOperationsInput | number
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    acceptedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    note?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipReferralCreateInput = {
    id?: string
    gymId: string
    referrerPtUserId: string
    rate: Decimal | DecimalJsLike | number | string
    amount: Decimal | DecimalJsLike | number | string
    clawedBack?: Decimal | DecimalJsLike | number | string
    status?: string
    releasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    membershipContract: GymMembershipContractCreateNestedOneWithoutReferralInput
  }

  export type GymMembershipReferralUncheckedCreateInput = {
    id?: string
    membershipContractId: string
    gymId: string
    referrerPtUserId: string
    rate: Decimal | DecimalJsLike | number | string
    amount: Decimal | DecimalJsLike | number | string
    clawedBack?: Decimal | DecimalJsLike | number | string
    status?: string
    releasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipReferralUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    referrerPtUserId?: StringFieldUpdateOperationsInput | string
    rate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    clawedBack?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: StringFieldUpdateOperationsInput | string
    releasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    membershipContract?: GymMembershipContractUpdateOneRequiredWithoutReferralNestedInput
  }

  export type GymMembershipReferralUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    membershipContractId?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    referrerPtUserId?: StringFieldUpdateOperationsInput | string
    rate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    clawedBack?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: StringFieldUpdateOperationsInput | string
    releasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipReferralCreateManyInput = {
    id?: string
    membershipContractId: string
    gymId: string
    referrerPtUserId: string
    rate: Decimal | DecimalJsLike | number | string
    amount: Decimal | DecimalJsLike | number | string
    clawedBack?: Decimal | DecimalJsLike | number | string
    status?: string
    releasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipReferralUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    referrerPtUserId?: StringFieldUpdateOperationsInput | string
    rate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    clawedBack?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: StringFieldUpdateOperationsInput | string
    releasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipReferralUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    membershipContractId?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    referrerPtUserId?: StringFieldUpdateOperationsInput | string
    rate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    clawedBack?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: StringFieldUpdateOperationsInput | string
    releasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
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

  export type EnumGymStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.GymStatus | EnumGymStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymStatus[] | ListEnumGymStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymStatus[] | ListEnumGymStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymStatusFilter<$PrismaModel> | $Enums.GymStatus
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

  export type GymMembershipPlanListRelationFilter = {
    every?: GymMembershipPlanWhereInput
    some?: GymMembershipPlanWhereInput
    none?: GymMembershipPlanWhereInput
  }

  export type GymMembershipContractListRelationFilter = {
    every?: GymMembershipContractWhereInput
    some?: GymMembershipContractWhereInput
    none?: GymMembershipContractWhereInput
  }

  export type GymTrainerAffiliationListRelationFilter = {
    every?: GymTrainerAffiliationWhereInput
    some?: GymTrainerAffiliationWhereInput
    none?: GymTrainerAffiliationWhereInput
  }

  export type GymReviewListRelationFilter = {
    every?: GymReviewWhereInput
    some?: GymReviewWhereInput
    none?: GymReviewWhereInput
  }

  export type GymPtCollaborationListRelationFilter = {
    every?: GymPtCollaborationWhereInput
    some?: GymPtCollaborationWhereInput
    none?: GymPtCollaborationWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type GymMembershipPlanOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type GymMembershipContractOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type GymTrainerAffiliationOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type GymReviewOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type GymPtCollaborationOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type GymCountOrderByAggregateInput = {
    id?: SortOrder
    ownerId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    address?: SortOrder
    city?: SortOrder
    phone?: SortOrder
    email?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMaxOrderByAggregateInput = {
    id?: SortOrder
    ownerId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    address?: SortOrder
    city?: SortOrder
    phone?: SortOrder
    email?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMinOrderByAggregateInput = {
    id?: SortOrder
    ownerId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    address?: SortOrder
    city?: SortOrder
    phone?: SortOrder
    email?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
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

  export type EnumGymStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.GymStatus | EnumGymStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymStatus[] | ListEnumGymStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymStatus[] | ListEnumGymStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymStatusWithAggregatesFilter<$PrismaModel> | $Enums.GymStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumGymStatusFilter<$PrismaModel>
    _max?: NestedEnumGymStatusFilter<$PrismaModel>
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

  export type EnumGymMembershipPlanStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.GymMembershipPlanStatus | EnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymMembershipPlanStatus[] | ListEnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymMembershipPlanStatus[] | ListEnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymMembershipPlanStatusFilter<$PrismaModel> | $Enums.GymMembershipPlanStatus
  }

  export type GymRelationFilter = {
    is?: GymWhereInput
    isNot?: GymWhereInput
  }

  export type GymMembershipPlanCountOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    price?: SortOrder
    durationDays?: SortOrder
    visitLimit?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMembershipPlanAvgOrderByAggregateInput = {
    price?: SortOrder
    durationDays?: SortOrder
    visitLimit?: SortOrder
  }

  export type GymMembershipPlanMaxOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    price?: SortOrder
    durationDays?: SortOrder
    visitLimit?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMembershipPlanMinOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    price?: SortOrder
    durationDays?: SortOrder
    visitLimit?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMembershipPlanSumOrderByAggregateInput = {
    price?: SortOrder
    durationDays?: SortOrder
    visitLimit?: SortOrder
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

  export type EnumGymMembershipPlanStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.GymMembershipPlanStatus | EnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymMembershipPlanStatus[] | ListEnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymMembershipPlanStatus[] | ListEnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymMembershipPlanStatusWithAggregatesFilter<$PrismaModel> | $Enums.GymMembershipPlanStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumGymMembershipPlanStatusFilter<$PrismaModel>
    _max?: NestedEnumGymMembershipPlanStatusFilter<$PrismaModel>
  }

  export type EnumGymMembershipContractStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.GymMembershipContractStatus | EnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymMembershipContractStatus[] | ListEnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymMembershipContractStatus[] | ListEnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymMembershipContractStatusFilter<$PrismaModel> | $Enums.GymMembershipContractStatus
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

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type GymMembershipPlanRelationFilter = {
    is?: GymMembershipPlanWhereInput
    isNot?: GymMembershipPlanWhereInput
  }

  export type GymCheckInListRelationFilter = {
    every?: GymCheckInWhereInput
    some?: GymCheckInWhereInput
    none?: GymCheckInWhereInput
  }

  export type GymMembershipReferralNullableRelationFilter = {
    is?: GymMembershipReferralWhereInput | null
    isNot?: GymMembershipReferralWhereInput | null
  }

  export type GymCheckInOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type GymMembershipContractCountOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    planId?: SortOrder
    clientId?: SortOrder
    status?: SortOrder
    paymentTxnId?: SortOrder
    startDate?: SortOrder
    endDate?: SortOrder
    priceAtPurchase?: SortOrder
    durationDaysSnapshot?: SortOrder
    totalVisits?: SortOrder
    usedVisits?: SortOrder
    payoutReleasedAt?: SortOrder
    multiGymWarned?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMembershipContractAvgOrderByAggregateInput = {
    priceAtPurchase?: SortOrder
    durationDaysSnapshot?: SortOrder
    totalVisits?: SortOrder
    usedVisits?: SortOrder
  }

  export type GymMembershipContractMaxOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    planId?: SortOrder
    clientId?: SortOrder
    status?: SortOrder
    paymentTxnId?: SortOrder
    startDate?: SortOrder
    endDate?: SortOrder
    priceAtPurchase?: SortOrder
    durationDaysSnapshot?: SortOrder
    totalVisits?: SortOrder
    usedVisits?: SortOrder
    payoutReleasedAt?: SortOrder
    multiGymWarned?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMembershipContractMinOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    planId?: SortOrder
    clientId?: SortOrder
    status?: SortOrder
    paymentTxnId?: SortOrder
    startDate?: SortOrder
    endDate?: SortOrder
    priceAtPurchase?: SortOrder
    durationDaysSnapshot?: SortOrder
    totalVisits?: SortOrder
    usedVisits?: SortOrder
    payoutReleasedAt?: SortOrder
    multiGymWarned?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMembershipContractSumOrderByAggregateInput = {
    priceAtPurchase?: SortOrder
    durationDaysSnapshot?: SortOrder
    totalVisits?: SortOrder
    usedVisits?: SortOrder
  }

  export type EnumGymMembershipContractStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.GymMembershipContractStatus | EnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymMembershipContractStatus[] | ListEnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymMembershipContractStatus[] | ListEnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymMembershipContractStatusWithAggregatesFilter<$PrismaModel> | $Enums.GymMembershipContractStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumGymMembershipContractStatusFilter<$PrismaModel>
    _max?: NestedEnumGymMembershipContractStatusFilter<$PrismaModel>
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

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type EnumAffiliationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.AffiliationStatus | EnumAffiliationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.AffiliationStatus[] | ListEnumAffiliationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.AffiliationStatus[] | ListEnumAffiliationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumAffiliationStatusFilter<$PrismaModel> | $Enums.AffiliationStatus
  }

  export type EnumAffiliationEmploymentFilter<$PrismaModel = never> = {
    equals?: $Enums.AffiliationEmployment | EnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    in?: $Enums.AffiliationEmployment[] | ListEnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    notIn?: $Enums.AffiliationEmployment[] | ListEnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    not?: NestedEnumAffiliationEmploymentFilter<$PrismaModel> | $Enums.AffiliationEmployment
  }

  export type EnumGymTrainerVisibilityFilter<$PrismaModel = never> = {
    equals?: $Enums.GymTrainerVisibility | EnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    in?: $Enums.GymTrainerVisibility[] | ListEnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymTrainerVisibility[] | ListEnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    not?: NestedEnumGymTrainerVisibilityFilter<$PrismaModel> | $Enums.GymTrainerVisibility
  }

  export type DecimalNullableFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel> | null
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalNullableFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string | null
  }

  export type GymTrainerAffiliationGymIdPtIdCompoundUniqueInput = {
    gymId: string
    ptId: string
  }

  export type GymTrainerAffiliationCountOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptId?: SortOrder
    status?: SortOrder
    employmentType?: SortOrder
    visibility?: SortOrder
    commissionRate?: SortOrder
    invitedBy?: SortOrder
    joinedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymTrainerAffiliationAvgOrderByAggregateInput = {
    commissionRate?: SortOrder
  }

  export type GymTrainerAffiliationMaxOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptId?: SortOrder
    status?: SortOrder
    employmentType?: SortOrder
    visibility?: SortOrder
    commissionRate?: SortOrder
    invitedBy?: SortOrder
    joinedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymTrainerAffiliationMinOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptId?: SortOrder
    status?: SortOrder
    employmentType?: SortOrder
    visibility?: SortOrder
    commissionRate?: SortOrder
    invitedBy?: SortOrder
    joinedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymTrainerAffiliationSumOrderByAggregateInput = {
    commissionRate?: SortOrder
  }

  export type EnumAffiliationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AffiliationStatus | EnumAffiliationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.AffiliationStatus[] | ListEnumAffiliationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.AffiliationStatus[] | ListEnumAffiliationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumAffiliationStatusWithAggregatesFilter<$PrismaModel> | $Enums.AffiliationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAffiliationStatusFilter<$PrismaModel>
    _max?: NestedEnumAffiliationStatusFilter<$PrismaModel>
  }

  export type EnumAffiliationEmploymentWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AffiliationEmployment | EnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    in?: $Enums.AffiliationEmployment[] | ListEnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    notIn?: $Enums.AffiliationEmployment[] | ListEnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    not?: NestedEnumAffiliationEmploymentWithAggregatesFilter<$PrismaModel> | $Enums.AffiliationEmployment
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAffiliationEmploymentFilter<$PrismaModel>
    _max?: NestedEnumAffiliationEmploymentFilter<$PrismaModel>
  }

  export type EnumGymTrainerVisibilityWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.GymTrainerVisibility | EnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    in?: $Enums.GymTrainerVisibility[] | ListEnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymTrainerVisibility[] | ListEnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    not?: NestedEnumGymTrainerVisibilityWithAggregatesFilter<$PrismaModel> | $Enums.GymTrainerVisibility
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumGymTrainerVisibilityFilter<$PrismaModel>
    _max?: NestedEnumGymTrainerVisibilityFilter<$PrismaModel>
  }

  export type DecimalNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel> | null
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalNullableWithAggregatesFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedDecimalNullableFilter<$PrismaModel>
    _sum?: NestedDecimalNullableFilter<$PrismaModel>
    _min?: NestedDecimalNullableFilter<$PrismaModel>
    _max?: NestedDecimalNullableFilter<$PrismaModel>
  }

  export type GymMembershipContractRelationFilter = {
    is?: GymMembershipContractWhereInput
    isNot?: GymMembershipContractWhereInput
  }

  export type GymCheckInCountOrderByAggregateInput = {
    id?: SortOrder
    membershipId?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    checkedInBy?: SortOrder
    createdAt?: SortOrder
  }

  export type GymCheckInMaxOrderByAggregateInput = {
    id?: SortOrder
    membershipId?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    checkedInBy?: SortOrder
    createdAt?: SortOrder
  }

  export type GymCheckInMinOrderByAggregateInput = {
    id?: SortOrder
    membershipId?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    checkedInBy?: SortOrder
    createdAt?: SortOrder
  }

  export type GymReviewGymIdClientIdCompoundUniqueInput = {
    gymId: string
    clientId: string
  }

  export type GymReviewCountOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    rating?: SortOrder
    comment?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymReviewAvgOrderByAggregateInput = {
    rating?: SortOrder
  }

  export type GymReviewMaxOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    rating?: SortOrder
    comment?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymReviewMinOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    clientId?: SortOrder
    rating?: SortOrder
    comment?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymReviewSumOrderByAggregateInput = {
    rating?: SortOrder
  }

  export type EnumCollaborationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.CollaborationStatus | EnumCollaborationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.CollaborationStatus[] | ListEnumCollaborationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.CollaborationStatus[] | ListEnumCollaborationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumCollaborationStatusFilter<$PrismaModel> | $Enums.CollaborationStatus
  }

  export type EnumCollaborationPartyFilter<$PrismaModel = never> = {
    equals?: $Enums.CollaborationParty | EnumCollaborationPartyFieldRefInput<$PrismaModel>
    in?: $Enums.CollaborationParty[] | ListEnumCollaborationPartyFieldRefInput<$PrismaModel>
    notIn?: $Enums.CollaborationParty[] | ListEnumCollaborationPartyFieldRefInput<$PrismaModel>
    not?: NestedEnumCollaborationPartyFilter<$PrismaModel> | $Enums.CollaborationParty
  }

  export type GymPtCollaborationCountOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptUserId?: SortOrder
    proposedPtRate?: SortOrder
    proposedGymRate?: SortOrder
    platformRate?: SortOrder
    status?: SortOrder
    proposedBy?: SortOrder
    round?: SortOrder
    expiresAt?: SortOrder
    acceptedAt?: SortOrder
    terminatedAt?: SortOrder
    terminatedBy?: SortOrder
    note?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymPtCollaborationAvgOrderByAggregateInput = {
    proposedPtRate?: SortOrder
    proposedGymRate?: SortOrder
    platformRate?: SortOrder
    round?: SortOrder
  }

  export type GymPtCollaborationMaxOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptUserId?: SortOrder
    proposedPtRate?: SortOrder
    proposedGymRate?: SortOrder
    platformRate?: SortOrder
    status?: SortOrder
    proposedBy?: SortOrder
    round?: SortOrder
    expiresAt?: SortOrder
    acceptedAt?: SortOrder
    terminatedAt?: SortOrder
    terminatedBy?: SortOrder
    note?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymPtCollaborationMinOrderByAggregateInput = {
    id?: SortOrder
    gymId?: SortOrder
    ptUserId?: SortOrder
    proposedPtRate?: SortOrder
    proposedGymRate?: SortOrder
    platformRate?: SortOrder
    status?: SortOrder
    proposedBy?: SortOrder
    round?: SortOrder
    expiresAt?: SortOrder
    acceptedAt?: SortOrder
    terminatedAt?: SortOrder
    terminatedBy?: SortOrder
    note?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymPtCollaborationSumOrderByAggregateInput = {
    proposedPtRate?: SortOrder
    proposedGymRate?: SortOrder
    platformRate?: SortOrder
    round?: SortOrder
  }

  export type EnumCollaborationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.CollaborationStatus | EnumCollaborationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.CollaborationStatus[] | ListEnumCollaborationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.CollaborationStatus[] | ListEnumCollaborationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumCollaborationStatusWithAggregatesFilter<$PrismaModel> | $Enums.CollaborationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumCollaborationStatusFilter<$PrismaModel>
    _max?: NestedEnumCollaborationStatusFilter<$PrismaModel>
  }

  export type EnumCollaborationPartyWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.CollaborationParty | EnumCollaborationPartyFieldRefInput<$PrismaModel>
    in?: $Enums.CollaborationParty[] | ListEnumCollaborationPartyFieldRefInput<$PrismaModel>
    notIn?: $Enums.CollaborationParty[] | ListEnumCollaborationPartyFieldRefInput<$PrismaModel>
    not?: NestedEnumCollaborationPartyWithAggregatesFilter<$PrismaModel> | $Enums.CollaborationParty
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumCollaborationPartyFilter<$PrismaModel>
    _max?: NestedEnumCollaborationPartyFilter<$PrismaModel>
  }

  export type GymMembershipReferralCountOrderByAggregateInput = {
    id?: SortOrder
    membershipContractId?: SortOrder
    gymId?: SortOrder
    referrerPtUserId?: SortOrder
    rate?: SortOrder
    amount?: SortOrder
    clawedBack?: SortOrder
    status?: SortOrder
    releasedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMembershipReferralAvgOrderByAggregateInput = {
    rate?: SortOrder
    amount?: SortOrder
    clawedBack?: SortOrder
  }

  export type GymMembershipReferralMaxOrderByAggregateInput = {
    id?: SortOrder
    membershipContractId?: SortOrder
    gymId?: SortOrder
    referrerPtUserId?: SortOrder
    rate?: SortOrder
    amount?: SortOrder
    clawedBack?: SortOrder
    status?: SortOrder
    releasedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMembershipReferralMinOrderByAggregateInput = {
    id?: SortOrder
    membershipContractId?: SortOrder
    gymId?: SortOrder
    referrerPtUserId?: SortOrder
    rate?: SortOrder
    amount?: SortOrder
    clawedBack?: SortOrder
    status?: SortOrder
    releasedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type GymMembershipReferralSumOrderByAggregateInput = {
    rate?: SortOrder
    amount?: SortOrder
    clawedBack?: SortOrder
  }

  export type GymMembershipPlanCreateNestedManyWithoutGymInput = {
    create?: XOR<GymMembershipPlanCreateWithoutGymInput, GymMembershipPlanUncheckedCreateWithoutGymInput> | GymMembershipPlanCreateWithoutGymInput[] | GymMembershipPlanUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymMembershipPlanCreateOrConnectWithoutGymInput | GymMembershipPlanCreateOrConnectWithoutGymInput[]
    createMany?: GymMembershipPlanCreateManyGymInputEnvelope
    connect?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
  }

  export type GymMembershipContractCreateNestedManyWithoutGymInput = {
    create?: XOR<GymMembershipContractCreateWithoutGymInput, GymMembershipContractUncheckedCreateWithoutGymInput> | GymMembershipContractCreateWithoutGymInput[] | GymMembershipContractUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutGymInput | GymMembershipContractCreateOrConnectWithoutGymInput[]
    createMany?: GymMembershipContractCreateManyGymInputEnvelope
    connect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
  }

  export type GymTrainerAffiliationCreateNestedManyWithoutGymInput = {
    create?: XOR<GymTrainerAffiliationCreateWithoutGymInput, GymTrainerAffiliationUncheckedCreateWithoutGymInput> | GymTrainerAffiliationCreateWithoutGymInput[] | GymTrainerAffiliationUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymTrainerAffiliationCreateOrConnectWithoutGymInput | GymTrainerAffiliationCreateOrConnectWithoutGymInput[]
    createMany?: GymTrainerAffiliationCreateManyGymInputEnvelope
    connect?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
  }

  export type GymReviewCreateNestedManyWithoutGymInput = {
    create?: XOR<GymReviewCreateWithoutGymInput, GymReviewUncheckedCreateWithoutGymInput> | GymReviewCreateWithoutGymInput[] | GymReviewUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymReviewCreateOrConnectWithoutGymInput | GymReviewCreateOrConnectWithoutGymInput[]
    createMany?: GymReviewCreateManyGymInputEnvelope
    connect?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
  }

  export type GymPtCollaborationCreateNestedManyWithoutGymInput = {
    create?: XOR<GymPtCollaborationCreateWithoutGymInput, GymPtCollaborationUncheckedCreateWithoutGymInput> | GymPtCollaborationCreateWithoutGymInput[] | GymPtCollaborationUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymPtCollaborationCreateOrConnectWithoutGymInput | GymPtCollaborationCreateOrConnectWithoutGymInput[]
    createMany?: GymPtCollaborationCreateManyGymInputEnvelope
    connect?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
  }

  export type GymMembershipPlanUncheckedCreateNestedManyWithoutGymInput = {
    create?: XOR<GymMembershipPlanCreateWithoutGymInput, GymMembershipPlanUncheckedCreateWithoutGymInput> | GymMembershipPlanCreateWithoutGymInput[] | GymMembershipPlanUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymMembershipPlanCreateOrConnectWithoutGymInput | GymMembershipPlanCreateOrConnectWithoutGymInput[]
    createMany?: GymMembershipPlanCreateManyGymInputEnvelope
    connect?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
  }

  export type GymMembershipContractUncheckedCreateNestedManyWithoutGymInput = {
    create?: XOR<GymMembershipContractCreateWithoutGymInput, GymMembershipContractUncheckedCreateWithoutGymInput> | GymMembershipContractCreateWithoutGymInput[] | GymMembershipContractUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutGymInput | GymMembershipContractCreateOrConnectWithoutGymInput[]
    createMany?: GymMembershipContractCreateManyGymInputEnvelope
    connect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
  }

  export type GymTrainerAffiliationUncheckedCreateNestedManyWithoutGymInput = {
    create?: XOR<GymTrainerAffiliationCreateWithoutGymInput, GymTrainerAffiliationUncheckedCreateWithoutGymInput> | GymTrainerAffiliationCreateWithoutGymInput[] | GymTrainerAffiliationUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymTrainerAffiliationCreateOrConnectWithoutGymInput | GymTrainerAffiliationCreateOrConnectWithoutGymInput[]
    createMany?: GymTrainerAffiliationCreateManyGymInputEnvelope
    connect?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
  }

  export type GymReviewUncheckedCreateNestedManyWithoutGymInput = {
    create?: XOR<GymReviewCreateWithoutGymInput, GymReviewUncheckedCreateWithoutGymInput> | GymReviewCreateWithoutGymInput[] | GymReviewUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymReviewCreateOrConnectWithoutGymInput | GymReviewCreateOrConnectWithoutGymInput[]
    createMany?: GymReviewCreateManyGymInputEnvelope
    connect?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
  }

  export type GymPtCollaborationUncheckedCreateNestedManyWithoutGymInput = {
    create?: XOR<GymPtCollaborationCreateWithoutGymInput, GymPtCollaborationUncheckedCreateWithoutGymInput> | GymPtCollaborationCreateWithoutGymInput[] | GymPtCollaborationUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymPtCollaborationCreateOrConnectWithoutGymInput | GymPtCollaborationCreateOrConnectWithoutGymInput[]
    createMany?: GymPtCollaborationCreateManyGymInputEnvelope
    connect?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type EnumGymStatusFieldUpdateOperationsInput = {
    set?: $Enums.GymStatus
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type GymMembershipPlanUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymMembershipPlanCreateWithoutGymInput, GymMembershipPlanUncheckedCreateWithoutGymInput> | GymMembershipPlanCreateWithoutGymInput[] | GymMembershipPlanUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymMembershipPlanCreateOrConnectWithoutGymInput | GymMembershipPlanCreateOrConnectWithoutGymInput[]
    upsert?: GymMembershipPlanUpsertWithWhereUniqueWithoutGymInput | GymMembershipPlanUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymMembershipPlanCreateManyGymInputEnvelope
    set?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
    disconnect?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
    delete?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
    connect?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
    update?: GymMembershipPlanUpdateWithWhereUniqueWithoutGymInput | GymMembershipPlanUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymMembershipPlanUpdateManyWithWhereWithoutGymInput | GymMembershipPlanUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymMembershipPlanScalarWhereInput | GymMembershipPlanScalarWhereInput[]
  }

  export type GymMembershipContractUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymMembershipContractCreateWithoutGymInput, GymMembershipContractUncheckedCreateWithoutGymInput> | GymMembershipContractCreateWithoutGymInput[] | GymMembershipContractUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutGymInput | GymMembershipContractCreateOrConnectWithoutGymInput[]
    upsert?: GymMembershipContractUpsertWithWhereUniqueWithoutGymInput | GymMembershipContractUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymMembershipContractCreateManyGymInputEnvelope
    set?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    disconnect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    delete?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    connect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    update?: GymMembershipContractUpdateWithWhereUniqueWithoutGymInput | GymMembershipContractUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymMembershipContractUpdateManyWithWhereWithoutGymInput | GymMembershipContractUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymMembershipContractScalarWhereInput | GymMembershipContractScalarWhereInput[]
  }

  export type GymTrainerAffiliationUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymTrainerAffiliationCreateWithoutGymInput, GymTrainerAffiliationUncheckedCreateWithoutGymInput> | GymTrainerAffiliationCreateWithoutGymInput[] | GymTrainerAffiliationUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymTrainerAffiliationCreateOrConnectWithoutGymInput | GymTrainerAffiliationCreateOrConnectWithoutGymInput[]
    upsert?: GymTrainerAffiliationUpsertWithWhereUniqueWithoutGymInput | GymTrainerAffiliationUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymTrainerAffiliationCreateManyGymInputEnvelope
    set?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
    disconnect?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
    delete?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
    connect?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
    update?: GymTrainerAffiliationUpdateWithWhereUniqueWithoutGymInput | GymTrainerAffiliationUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymTrainerAffiliationUpdateManyWithWhereWithoutGymInput | GymTrainerAffiliationUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymTrainerAffiliationScalarWhereInput | GymTrainerAffiliationScalarWhereInput[]
  }

  export type GymReviewUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymReviewCreateWithoutGymInput, GymReviewUncheckedCreateWithoutGymInput> | GymReviewCreateWithoutGymInput[] | GymReviewUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymReviewCreateOrConnectWithoutGymInput | GymReviewCreateOrConnectWithoutGymInput[]
    upsert?: GymReviewUpsertWithWhereUniqueWithoutGymInput | GymReviewUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymReviewCreateManyGymInputEnvelope
    set?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
    disconnect?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
    delete?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
    connect?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
    update?: GymReviewUpdateWithWhereUniqueWithoutGymInput | GymReviewUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymReviewUpdateManyWithWhereWithoutGymInput | GymReviewUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymReviewScalarWhereInput | GymReviewScalarWhereInput[]
  }

  export type GymPtCollaborationUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymPtCollaborationCreateWithoutGymInput, GymPtCollaborationUncheckedCreateWithoutGymInput> | GymPtCollaborationCreateWithoutGymInput[] | GymPtCollaborationUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymPtCollaborationCreateOrConnectWithoutGymInput | GymPtCollaborationCreateOrConnectWithoutGymInput[]
    upsert?: GymPtCollaborationUpsertWithWhereUniqueWithoutGymInput | GymPtCollaborationUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymPtCollaborationCreateManyGymInputEnvelope
    set?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
    disconnect?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
    delete?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
    connect?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
    update?: GymPtCollaborationUpdateWithWhereUniqueWithoutGymInput | GymPtCollaborationUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymPtCollaborationUpdateManyWithWhereWithoutGymInput | GymPtCollaborationUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymPtCollaborationScalarWhereInput | GymPtCollaborationScalarWhereInput[]
  }

  export type GymMembershipPlanUncheckedUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymMembershipPlanCreateWithoutGymInput, GymMembershipPlanUncheckedCreateWithoutGymInput> | GymMembershipPlanCreateWithoutGymInput[] | GymMembershipPlanUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymMembershipPlanCreateOrConnectWithoutGymInput | GymMembershipPlanCreateOrConnectWithoutGymInput[]
    upsert?: GymMembershipPlanUpsertWithWhereUniqueWithoutGymInput | GymMembershipPlanUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymMembershipPlanCreateManyGymInputEnvelope
    set?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
    disconnect?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
    delete?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
    connect?: GymMembershipPlanWhereUniqueInput | GymMembershipPlanWhereUniqueInput[]
    update?: GymMembershipPlanUpdateWithWhereUniqueWithoutGymInput | GymMembershipPlanUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymMembershipPlanUpdateManyWithWhereWithoutGymInput | GymMembershipPlanUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymMembershipPlanScalarWhereInput | GymMembershipPlanScalarWhereInput[]
  }

  export type GymMembershipContractUncheckedUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymMembershipContractCreateWithoutGymInput, GymMembershipContractUncheckedCreateWithoutGymInput> | GymMembershipContractCreateWithoutGymInput[] | GymMembershipContractUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutGymInput | GymMembershipContractCreateOrConnectWithoutGymInput[]
    upsert?: GymMembershipContractUpsertWithWhereUniqueWithoutGymInput | GymMembershipContractUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymMembershipContractCreateManyGymInputEnvelope
    set?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    disconnect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    delete?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    connect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    update?: GymMembershipContractUpdateWithWhereUniqueWithoutGymInput | GymMembershipContractUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymMembershipContractUpdateManyWithWhereWithoutGymInput | GymMembershipContractUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymMembershipContractScalarWhereInput | GymMembershipContractScalarWhereInput[]
  }

  export type GymTrainerAffiliationUncheckedUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymTrainerAffiliationCreateWithoutGymInput, GymTrainerAffiliationUncheckedCreateWithoutGymInput> | GymTrainerAffiliationCreateWithoutGymInput[] | GymTrainerAffiliationUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymTrainerAffiliationCreateOrConnectWithoutGymInput | GymTrainerAffiliationCreateOrConnectWithoutGymInput[]
    upsert?: GymTrainerAffiliationUpsertWithWhereUniqueWithoutGymInput | GymTrainerAffiliationUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymTrainerAffiliationCreateManyGymInputEnvelope
    set?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
    disconnect?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
    delete?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
    connect?: GymTrainerAffiliationWhereUniqueInput | GymTrainerAffiliationWhereUniqueInput[]
    update?: GymTrainerAffiliationUpdateWithWhereUniqueWithoutGymInput | GymTrainerAffiliationUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymTrainerAffiliationUpdateManyWithWhereWithoutGymInput | GymTrainerAffiliationUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymTrainerAffiliationScalarWhereInput | GymTrainerAffiliationScalarWhereInput[]
  }

  export type GymReviewUncheckedUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymReviewCreateWithoutGymInput, GymReviewUncheckedCreateWithoutGymInput> | GymReviewCreateWithoutGymInput[] | GymReviewUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymReviewCreateOrConnectWithoutGymInput | GymReviewCreateOrConnectWithoutGymInput[]
    upsert?: GymReviewUpsertWithWhereUniqueWithoutGymInput | GymReviewUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymReviewCreateManyGymInputEnvelope
    set?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
    disconnect?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
    delete?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
    connect?: GymReviewWhereUniqueInput | GymReviewWhereUniqueInput[]
    update?: GymReviewUpdateWithWhereUniqueWithoutGymInput | GymReviewUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymReviewUpdateManyWithWhereWithoutGymInput | GymReviewUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymReviewScalarWhereInput | GymReviewScalarWhereInput[]
  }

  export type GymPtCollaborationUncheckedUpdateManyWithoutGymNestedInput = {
    create?: XOR<GymPtCollaborationCreateWithoutGymInput, GymPtCollaborationUncheckedCreateWithoutGymInput> | GymPtCollaborationCreateWithoutGymInput[] | GymPtCollaborationUncheckedCreateWithoutGymInput[]
    connectOrCreate?: GymPtCollaborationCreateOrConnectWithoutGymInput | GymPtCollaborationCreateOrConnectWithoutGymInput[]
    upsert?: GymPtCollaborationUpsertWithWhereUniqueWithoutGymInput | GymPtCollaborationUpsertWithWhereUniqueWithoutGymInput[]
    createMany?: GymPtCollaborationCreateManyGymInputEnvelope
    set?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
    disconnect?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
    delete?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
    connect?: GymPtCollaborationWhereUniqueInput | GymPtCollaborationWhereUniqueInput[]
    update?: GymPtCollaborationUpdateWithWhereUniqueWithoutGymInput | GymPtCollaborationUpdateWithWhereUniqueWithoutGymInput[]
    updateMany?: GymPtCollaborationUpdateManyWithWhereWithoutGymInput | GymPtCollaborationUpdateManyWithWhereWithoutGymInput[]
    deleteMany?: GymPtCollaborationScalarWhereInput | GymPtCollaborationScalarWhereInput[]
  }

  export type GymCreateNestedOneWithoutPlansInput = {
    create?: XOR<GymCreateWithoutPlansInput, GymUncheckedCreateWithoutPlansInput>
    connectOrCreate?: GymCreateOrConnectWithoutPlansInput
    connect?: GymWhereUniqueInput
  }

  export type GymMembershipContractCreateNestedManyWithoutPlanInput = {
    create?: XOR<GymMembershipContractCreateWithoutPlanInput, GymMembershipContractUncheckedCreateWithoutPlanInput> | GymMembershipContractCreateWithoutPlanInput[] | GymMembershipContractUncheckedCreateWithoutPlanInput[]
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutPlanInput | GymMembershipContractCreateOrConnectWithoutPlanInput[]
    createMany?: GymMembershipContractCreateManyPlanInputEnvelope
    connect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
  }

  export type GymMembershipContractUncheckedCreateNestedManyWithoutPlanInput = {
    create?: XOR<GymMembershipContractCreateWithoutPlanInput, GymMembershipContractUncheckedCreateWithoutPlanInput> | GymMembershipContractCreateWithoutPlanInput[] | GymMembershipContractUncheckedCreateWithoutPlanInput[]
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutPlanInput | GymMembershipContractCreateOrConnectWithoutPlanInput[]
    createMany?: GymMembershipContractCreateManyPlanInputEnvelope
    connect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
  }

  export type DecimalFieldUpdateOperationsInput = {
    set?: Decimal | DecimalJsLike | number | string
    increment?: Decimal | DecimalJsLike | number | string
    decrement?: Decimal | DecimalJsLike | number | string
    multiply?: Decimal | DecimalJsLike | number | string
    divide?: Decimal | DecimalJsLike | number | string
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type EnumGymMembershipPlanStatusFieldUpdateOperationsInput = {
    set?: $Enums.GymMembershipPlanStatus
  }

  export type GymUpdateOneRequiredWithoutPlansNestedInput = {
    create?: XOR<GymCreateWithoutPlansInput, GymUncheckedCreateWithoutPlansInput>
    connectOrCreate?: GymCreateOrConnectWithoutPlansInput
    upsert?: GymUpsertWithoutPlansInput
    connect?: GymWhereUniqueInput
    update?: XOR<XOR<GymUpdateToOneWithWhereWithoutPlansInput, GymUpdateWithoutPlansInput>, GymUncheckedUpdateWithoutPlansInput>
  }

  export type GymMembershipContractUpdateManyWithoutPlanNestedInput = {
    create?: XOR<GymMembershipContractCreateWithoutPlanInput, GymMembershipContractUncheckedCreateWithoutPlanInput> | GymMembershipContractCreateWithoutPlanInput[] | GymMembershipContractUncheckedCreateWithoutPlanInput[]
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutPlanInput | GymMembershipContractCreateOrConnectWithoutPlanInput[]
    upsert?: GymMembershipContractUpsertWithWhereUniqueWithoutPlanInput | GymMembershipContractUpsertWithWhereUniqueWithoutPlanInput[]
    createMany?: GymMembershipContractCreateManyPlanInputEnvelope
    set?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    disconnect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    delete?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    connect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    update?: GymMembershipContractUpdateWithWhereUniqueWithoutPlanInput | GymMembershipContractUpdateWithWhereUniqueWithoutPlanInput[]
    updateMany?: GymMembershipContractUpdateManyWithWhereWithoutPlanInput | GymMembershipContractUpdateManyWithWhereWithoutPlanInput[]
    deleteMany?: GymMembershipContractScalarWhereInput | GymMembershipContractScalarWhereInput[]
  }

  export type GymMembershipContractUncheckedUpdateManyWithoutPlanNestedInput = {
    create?: XOR<GymMembershipContractCreateWithoutPlanInput, GymMembershipContractUncheckedCreateWithoutPlanInput> | GymMembershipContractCreateWithoutPlanInput[] | GymMembershipContractUncheckedCreateWithoutPlanInput[]
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutPlanInput | GymMembershipContractCreateOrConnectWithoutPlanInput[]
    upsert?: GymMembershipContractUpsertWithWhereUniqueWithoutPlanInput | GymMembershipContractUpsertWithWhereUniqueWithoutPlanInput[]
    createMany?: GymMembershipContractCreateManyPlanInputEnvelope
    set?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    disconnect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    delete?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    connect?: GymMembershipContractWhereUniqueInput | GymMembershipContractWhereUniqueInput[]
    update?: GymMembershipContractUpdateWithWhereUniqueWithoutPlanInput | GymMembershipContractUpdateWithWhereUniqueWithoutPlanInput[]
    updateMany?: GymMembershipContractUpdateManyWithWhereWithoutPlanInput | GymMembershipContractUpdateManyWithWhereWithoutPlanInput[]
    deleteMany?: GymMembershipContractScalarWhereInput | GymMembershipContractScalarWhereInput[]
  }

  export type GymCreateNestedOneWithoutMembershipsInput = {
    create?: XOR<GymCreateWithoutMembershipsInput, GymUncheckedCreateWithoutMembershipsInput>
    connectOrCreate?: GymCreateOrConnectWithoutMembershipsInput
    connect?: GymWhereUniqueInput
  }

  export type GymMembershipPlanCreateNestedOneWithoutMembershipsInput = {
    create?: XOR<GymMembershipPlanCreateWithoutMembershipsInput, GymMembershipPlanUncheckedCreateWithoutMembershipsInput>
    connectOrCreate?: GymMembershipPlanCreateOrConnectWithoutMembershipsInput
    connect?: GymMembershipPlanWhereUniqueInput
  }

  export type GymCheckInCreateNestedManyWithoutMembershipInput = {
    create?: XOR<GymCheckInCreateWithoutMembershipInput, GymCheckInUncheckedCreateWithoutMembershipInput> | GymCheckInCreateWithoutMembershipInput[] | GymCheckInUncheckedCreateWithoutMembershipInput[]
    connectOrCreate?: GymCheckInCreateOrConnectWithoutMembershipInput | GymCheckInCreateOrConnectWithoutMembershipInput[]
    createMany?: GymCheckInCreateManyMembershipInputEnvelope
    connect?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
  }

  export type GymMembershipReferralCreateNestedOneWithoutMembershipContractInput = {
    create?: XOR<GymMembershipReferralCreateWithoutMembershipContractInput, GymMembershipReferralUncheckedCreateWithoutMembershipContractInput>
    connectOrCreate?: GymMembershipReferralCreateOrConnectWithoutMembershipContractInput
    connect?: GymMembershipReferralWhereUniqueInput
  }

  export type GymCheckInUncheckedCreateNestedManyWithoutMembershipInput = {
    create?: XOR<GymCheckInCreateWithoutMembershipInput, GymCheckInUncheckedCreateWithoutMembershipInput> | GymCheckInCreateWithoutMembershipInput[] | GymCheckInUncheckedCreateWithoutMembershipInput[]
    connectOrCreate?: GymCheckInCreateOrConnectWithoutMembershipInput | GymCheckInCreateOrConnectWithoutMembershipInput[]
    createMany?: GymCheckInCreateManyMembershipInputEnvelope
    connect?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
  }

  export type GymMembershipReferralUncheckedCreateNestedOneWithoutMembershipContractInput = {
    create?: XOR<GymMembershipReferralCreateWithoutMembershipContractInput, GymMembershipReferralUncheckedCreateWithoutMembershipContractInput>
    connectOrCreate?: GymMembershipReferralCreateOrConnectWithoutMembershipContractInput
    connect?: GymMembershipReferralWhereUniqueInput
  }

  export type EnumGymMembershipContractStatusFieldUpdateOperationsInput = {
    set?: $Enums.GymMembershipContractStatus
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type GymUpdateOneRequiredWithoutMembershipsNestedInput = {
    create?: XOR<GymCreateWithoutMembershipsInput, GymUncheckedCreateWithoutMembershipsInput>
    connectOrCreate?: GymCreateOrConnectWithoutMembershipsInput
    upsert?: GymUpsertWithoutMembershipsInput
    connect?: GymWhereUniqueInput
    update?: XOR<XOR<GymUpdateToOneWithWhereWithoutMembershipsInput, GymUpdateWithoutMembershipsInput>, GymUncheckedUpdateWithoutMembershipsInput>
  }

  export type GymMembershipPlanUpdateOneRequiredWithoutMembershipsNestedInput = {
    create?: XOR<GymMembershipPlanCreateWithoutMembershipsInput, GymMembershipPlanUncheckedCreateWithoutMembershipsInput>
    connectOrCreate?: GymMembershipPlanCreateOrConnectWithoutMembershipsInput
    upsert?: GymMembershipPlanUpsertWithoutMembershipsInput
    connect?: GymMembershipPlanWhereUniqueInput
    update?: XOR<XOR<GymMembershipPlanUpdateToOneWithWhereWithoutMembershipsInput, GymMembershipPlanUpdateWithoutMembershipsInput>, GymMembershipPlanUncheckedUpdateWithoutMembershipsInput>
  }

  export type GymCheckInUpdateManyWithoutMembershipNestedInput = {
    create?: XOR<GymCheckInCreateWithoutMembershipInput, GymCheckInUncheckedCreateWithoutMembershipInput> | GymCheckInCreateWithoutMembershipInput[] | GymCheckInUncheckedCreateWithoutMembershipInput[]
    connectOrCreate?: GymCheckInCreateOrConnectWithoutMembershipInput | GymCheckInCreateOrConnectWithoutMembershipInput[]
    upsert?: GymCheckInUpsertWithWhereUniqueWithoutMembershipInput | GymCheckInUpsertWithWhereUniqueWithoutMembershipInput[]
    createMany?: GymCheckInCreateManyMembershipInputEnvelope
    set?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
    disconnect?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
    delete?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
    connect?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
    update?: GymCheckInUpdateWithWhereUniqueWithoutMembershipInput | GymCheckInUpdateWithWhereUniqueWithoutMembershipInput[]
    updateMany?: GymCheckInUpdateManyWithWhereWithoutMembershipInput | GymCheckInUpdateManyWithWhereWithoutMembershipInput[]
    deleteMany?: GymCheckInScalarWhereInput | GymCheckInScalarWhereInput[]
  }

  export type GymMembershipReferralUpdateOneWithoutMembershipContractNestedInput = {
    create?: XOR<GymMembershipReferralCreateWithoutMembershipContractInput, GymMembershipReferralUncheckedCreateWithoutMembershipContractInput>
    connectOrCreate?: GymMembershipReferralCreateOrConnectWithoutMembershipContractInput
    upsert?: GymMembershipReferralUpsertWithoutMembershipContractInput
    disconnect?: GymMembershipReferralWhereInput | boolean
    delete?: GymMembershipReferralWhereInput | boolean
    connect?: GymMembershipReferralWhereUniqueInput
    update?: XOR<XOR<GymMembershipReferralUpdateToOneWithWhereWithoutMembershipContractInput, GymMembershipReferralUpdateWithoutMembershipContractInput>, GymMembershipReferralUncheckedUpdateWithoutMembershipContractInput>
  }

  export type GymCheckInUncheckedUpdateManyWithoutMembershipNestedInput = {
    create?: XOR<GymCheckInCreateWithoutMembershipInput, GymCheckInUncheckedCreateWithoutMembershipInput> | GymCheckInCreateWithoutMembershipInput[] | GymCheckInUncheckedCreateWithoutMembershipInput[]
    connectOrCreate?: GymCheckInCreateOrConnectWithoutMembershipInput | GymCheckInCreateOrConnectWithoutMembershipInput[]
    upsert?: GymCheckInUpsertWithWhereUniqueWithoutMembershipInput | GymCheckInUpsertWithWhereUniqueWithoutMembershipInput[]
    createMany?: GymCheckInCreateManyMembershipInputEnvelope
    set?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
    disconnect?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
    delete?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
    connect?: GymCheckInWhereUniqueInput | GymCheckInWhereUniqueInput[]
    update?: GymCheckInUpdateWithWhereUniqueWithoutMembershipInput | GymCheckInUpdateWithWhereUniqueWithoutMembershipInput[]
    updateMany?: GymCheckInUpdateManyWithWhereWithoutMembershipInput | GymCheckInUpdateManyWithWhereWithoutMembershipInput[]
    deleteMany?: GymCheckInScalarWhereInput | GymCheckInScalarWhereInput[]
  }

  export type GymMembershipReferralUncheckedUpdateOneWithoutMembershipContractNestedInput = {
    create?: XOR<GymMembershipReferralCreateWithoutMembershipContractInput, GymMembershipReferralUncheckedCreateWithoutMembershipContractInput>
    connectOrCreate?: GymMembershipReferralCreateOrConnectWithoutMembershipContractInput
    upsert?: GymMembershipReferralUpsertWithoutMembershipContractInput
    disconnect?: GymMembershipReferralWhereInput | boolean
    delete?: GymMembershipReferralWhereInput | boolean
    connect?: GymMembershipReferralWhereUniqueInput
    update?: XOR<XOR<GymMembershipReferralUpdateToOneWithWhereWithoutMembershipContractInput, GymMembershipReferralUpdateWithoutMembershipContractInput>, GymMembershipReferralUncheckedUpdateWithoutMembershipContractInput>
  }

  export type GymCreateNestedOneWithoutAffiliationsInput = {
    create?: XOR<GymCreateWithoutAffiliationsInput, GymUncheckedCreateWithoutAffiliationsInput>
    connectOrCreate?: GymCreateOrConnectWithoutAffiliationsInput
    connect?: GymWhereUniqueInput
  }

  export type EnumAffiliationStatusFieldUpdateOperationsInput = {
    set?: $Enums.AffiliationStatus
  }

  export type EnumAffiliationEmploymentFieldUpdateOperationsInput = {
    set?: $Enums.AffiliationEmployment
  }

  export type EnumGymTrainerVisibilityFieldUpdateOperationsInput = {
    set?: $Enums.GymTrainerVisibility
  }

  export type NullableDecimalFieldUpdateOperationsInput = {
    set?: Decimal | DecimalJsLike | number | string | null
    increment?: Decimal | DecimalJsLike | number | string
    decrement?: Decimal | DecimalJsLike | number | string
    multiply?: Decimal | DecimalJsLike | number | string
    divide?: Decimal | DecimalJsLike | number | string
  }

  export type GymUpdateOneRequiredWithoutAffiliationsNestedInput = {
    create?: XOR<GymCreateWithoutAffiliationsInput, GymUncheckedCreateWithoutAffiliationsInput>
    connectOrCreate?: GymCreateOrConnectWithoutAffiliationsInput
    upsert?: GymUpsertWithoutAffiliationsInput
    connect?: GymWhereUniqueInput
    update?: XOR<XOR<GymUpdateToOneWithWhereWithoutAffiliationsInput, GymUpdateWithoutAffiliationsInput>, GymUncheckedUpdateWithoutAffiliationsInput>
  }

  export type GymMembershipContractCreateNestedOneWithoutCheckInsInput = {
    create?: XOR<GymMembershipContractCreateWithoutCheckInsInput, GymMembershipContractUncheckedCreateWithoutCheckInsInput>
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutCheckInsInput
    connect?: GymMembershipContractWhereUniqueInput
  }

  export type GymMembershipContractUpdateOneRequiredWithoutCheckInsNestedInput = {
    create?: XOR<GymMembershipContractCreateWithoutCheckInsInput, GymMembershipContractUncheckedCreateWithoutCheckInsInput>
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutCheckInsInput
    upsert?: GymMembershipContractUpsertWithoutCheckInsInput
    connect?: GymMembershipContractWhereUniqueInput
    update?: XOR<XOR<GymMembershipContractUpdateToOneWithWhereWithoutCheckInsInput, GymMembershipContractUpdateWithoutCheckInsInput>, GymMembershipContractUncheckedUpdateWithoutCheckInsInput>
  }

  export type GymCreateNestedOneWithoutReviewsInput = {
    create?: XOR<GymCreateWithoutReviewsInput, GymUncheckedCreateWithoutReviewsInput>
    connectOrCreate?: GymCreateOrConnectWithoutReviewsInput
    connect?: GymWhereUniqueInput
  }

  export type GymUpdateOneRequiredWithoutReviewsNestedInput = {
    create?: XOR<GymCreateWithoutReviewsInput, GymUncheckedCreateWithoutReviewsInput>
    connectOrCreate?: GymCreateOrConnectWithoutReviewsInput
    upsert?: GymUpsertWithoutReviewsInput
    connect?: GymWhereUniqueInput
    update?: XOR<XOR<GymUpdateToOneWithWhereWithoutReviewsInput, GymUpdateWithoutReviewsInput>, GymUncheckedUpdateWithoutReviewsInput>
  }

  export type GymCreateNestedOneWithoutCollaborationsInput = {
    create?: XOR<GymCreateWithoutCollaborationsInput, GymUncheckedCreateWithoutCollaborationsInput>
    connectOrCreate?: GymCreateOrConnectWithoutCollaborationsInput
    connect?: GymWhereUniqueInput
  }

  export type EnumCollaborationStatusFieldUpdateOperationsInput = {
    set?: $Enums.CollaborationStatus
  }

  export type EnumCollaborationPartyFieldUpdateOperationsInput = {
    set?: $Enums.CollaborationParty
  }

  export type GymUpdateOneRequiredWithoutCollaborationsNestedInput = {
    create?: XOR<GymCreateWithoutCollaborationsInput, GymUncheckedCreateWithoutCollaborationsInput>
    connectOrCreate?: GymCreateOrConnectWithoutCollaborationsInput
    upsert?: GymUpsertWithoutCollaborationsInput
    connect?: GymWhereUniqueInput
    update?: XOR<XOR<GymUpdateToOneWithWhereWithoutCollaborationsInput, GymUpdateWithoutCollaborationsInput>, GymUncheckedUpdateWithoutCollaborationsInput>
  }

  export type GymMembershipContractCreateNestedOneWithoutReferralInput = {
    create?: XOR<GymMembershipContractCreateWithoutReferralInput, GymMembershipContractUncheckedCreateWithoutReferralInput>
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutReferralInput
    connect?: GymMembershipContractWhereUniqueInput
  }

  export type GymMembershipContractUpdateOneRequiredWithoutReferralNestedInput = {
    create?: XOR<GymMembershipContractCreateWithoutReferralInput, GymMembershipContractUncheckedCreateWithoutReferralInput>
    connectOrCreate?: GymMembershipContractCreateOrConnectWithoutReferralInput
    upsert?: GymMembershipContractUpsertWithoutReferralInput
    connect?: GymMembershipContractWhereUniqueInput
    update?: XOR<XOR<GymMembershipContractUpdateToOneWithWhereWithoutReferralInput, GymMembershipContractUpdateWithoutReferralInput>, GymMembershipContractUncheckedUpdateWithoutReferralInput>
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

  export type NestedEnumGymStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.GymStatus | EnumGymStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymStatus[] | ListEnumGymStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymStatus[] | ListEnumGymStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymStatusFilter<$PrismaModel> | $Enums.GymStatus
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

  export type NestedEnumGymStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.GymStatus | EnumGymStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymStatus[] | ListEnumGymStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymStatus[] | ListEnumGymStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymStatusWithAggregatesFilter<$PrismaModel> | $Enums.GymStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumGymStatusFilter<$PrismaModel>
    _max?: NestedEnumGymStatusFilter<$PrismaModel>
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

  export type NestedEnumGymMembershipPlanStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.GymMembershipPlanStatus | EnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymMembershipPlanStatus[] | ListEnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymMembershipPlanStatus[] | ListEnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymMembershipPlanStatusFilter<$PrismaModel> | $Enums.GymMembershipPlanStatus
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

  export type NestedEnumGymMembershipPlanStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.GymMembershipPlanStatus | EnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymMembershipPlanStatus[] | ListEnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymMembershipPlanStatus[] | ListEnumGymMembershipPlanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymMembershipPlanStatusWithAggregatesFilter<$PrismaModel> | $Enums.GymMembershipPlanStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumGymMembershipPlanStatusFilter<$PrismaModel>
    _max?: NestedEnumGymMembershipPlanStatusFilter<$PrismaModel>
  }

  export type NestedEnumGymMembershipContractStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.GymMembershipContractStatus | EnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymMembershipContractStatus[] | ListEnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymMembershipContractStatus[] | ListEnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymMembershipContractStatusFilter<$PrismaModel> | $Enums.GymMembershipContractStatus
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

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedEnumGymMembershipContractStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.GymMembershipContractStatus | EnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    in?: $Enums.GymMembershipContractStatus[] | ListEnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymMembershipContractStatus[] | ListEnumGymMembershipContractStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumGymMembershipContractStatusWithAggregatesFilter<$PrismaModel> | $Enums.GymMembershipContractStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumGymMembershipContractStatusFilter<$PrismaModel>
    _max?: NestedEnumGymMembershipContractStatusFilter<$PrismaModel>
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

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type NestedEnumAffiliationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.AffiliationStatus | EnumAffiliationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.AffiliationStatus[] | ListEnumAffiliationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.AffiliationStatus[] | ListEnumAffiliationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumAffiliationStatusFilter<$PrismaModel> | $Enums.AffiliationStatus
  }

  export type NestedEnumAffiliationEmploymentFilter<$PrismaModel = never> = {
    equals?: $Enums.AffiliationEmployment | EnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    in?: $Enums.AffiliationEmployment[] | ListEnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    notIn?: $Enums.AffiliationEmployment[] | ListEnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    not?: NestedEnumAffiliationEmploymentFilter<$PrismaModel> | $Enums.AffiliationEmployment
  }

  export type NestedEnumGymTrainerVisibilityFilter<$PrismaModel = never> = {
    equals?: $Enums.GymTrainerVisibility | EnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    in?: $Enums.GymTrainerVisibility[] | ListEnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymTrainerVisibility[] | ListEnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    not?: NestedEnumGymTrainerVisibilityFilter<$PrismaModel> | $Enums.GymTrainerVisibility
  }

  export type NestedDecimalNullableFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel> | null
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalNullableFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string | null
  }

  export type NestedEnumAffiliationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AffiliationStatus | EnumAffiliationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.AffiliationStatus[] | ListEnumAffiliationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.AffiliationStatus[] | ListEnumAffiliationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumAffiliationStatusWithAggregatesFilter<$PrismaModel> | $Enums.AffiliationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAffiliationStatusFilter<$PrismaModel>
    _max?: NestedEnumAffiliationStatusFilter<$PrismaModel>
  }

  export type NestedEnumAffiliationEmploymentWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AffiliationEmployment | EnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    in?: $Enums.AffiliationEmployment[] | ListEnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    notIn?: $Enums.AffiliationEmployment[] | ListEnumAffiliationEmploymentFieldRefInput<$PrismaModel>
    not?: NestedEnumAffiliationEmploymentWithAggregatesFilter<$PrismaModel> | $Enums.AffiliationEmployment
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAffiliationEmploymentFilter<$PrismaModel>
    _max?: NestedEnumAffiliationEmploymentFilter<$PrismaModel>
  }

  export type NestedEnumGymTrainerVisibilityWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.GymTrainerVisibility | EnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    in?: $Enums.GymTrainerVisibility[] | ListEnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    notIn?: $Enums.GymTrainerVisibility[] | ListEnumGymTrainerVisibilityFieldRefInput<$PrismaModel>
    not?: NestedEnumGymTrainerVisibilityWithAggregatesFilter<$PrismaModel> | $Enums.GymTrainerVisibility
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumGymTrainerVisibilityFilter<$PrismaModel>
    _max?: NestedEnumGymTrainerVisibilityFilter<$PrismaModel>
  }

  export type NestedDecimalNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel> | null
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalNullableWithAggregatesFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedDecimalNullableFilter<$PrismaModel>
    _sum?: NestedDecimalNullableFilter<$PrismaModel>
    _min?: NestedDecimalNullableFilter<$PrismaModel>
    _max?: NestedDecimalNullableFilter<$PrismaModel>
  }

  export type NestedEnumCollaborationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.CollaborationStatus | EnumCollaborationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.CollaborationStatus[] | ListEnumCollaborationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.CollaborationStatus[] | ListEnumCollaborationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumCollaborationStatusFilter<$PrismaModel> | $Enums.CollaborationStatus
  }

  export type NestedEnumCollaborationPartyFilter<$PrismaModel = never> = {
    equals?: $Enums.CollaborationParty | EnumCollaborationPartyFieldRefInput<$PrismaModel>
    in?: $Enums.CollaborationParty[] | ListEnumCollaborationPartyFieldRefInput<$PrismaModel>
    notIn?: $Enums.CollaborationParty[] | ListEnumCollaborationPartyFieldRefInput<$PrismaModel>
    not?: NestedEnumCollaborationPartyFilter<$PrismaModel> | $Enums.CollaborationParty
  }

  export type NestedEnumCollaborationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.CollaborationStatus | EnumCollaborationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.CollaborationStatus[] | ListEnumCollaborationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.CollaborationStatus[] | ListEnumCollaborationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumCollaborationStatusWithAggregatesFilter<$PrismaModel> | $Enums.CollaborationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumCollaborationStatusFilter<$PrismaModel>
    _max?: NestedEnumCollaborationStatusFilter<$PrismaModel>
  }

  export type NestedEnumCollaborationPartyWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.CollaborationParty | EnumCollaborationPartyFieldRefInput<$PrismaModel>
    in?: $Enums.CollaborationParty[] | ListEnumCollaborationPartyFieldRefInput<$PrismaModel>
    notIn?: $Enums.CollaborationParty[] | ListEnumCollaborationPartyFieldRefInput<$PrismaModel>
    not?: NestedEnumCollaborationPartyWithAggregatesFilter<$PrismaModel> | $Enums.CollaborationParty
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumCollaborationPartyFilter<$PrismaModel>
    _max?: NestedEnumCollaborationPartyFilter<$PrismaModel>
  }

  export type GymMembershipPlanCreateWithoutGymInput = {
    id?: string
    name: string
    description?: string | null
    price: Decimal | DecimalJsLike | number | string
    durationDays: number
    visitLimit?: number | null
    status?: $Enums.GymMembershipPlanStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    memberships?: GymMembershipContractCreateNestedManyWithoutPlanInput
  }

  export type GymMembershipPlanUncheckedCreateWithoutGymInput = {
    id?: string
    name: string
    description?: string | null
    price: Decimal | DecimalJsLike | number | string
    durationDays: number
    visitLimit?: number | null
    status?: $Enums.GymMembershipPlanStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    memberships?: GymMembershipContractUncheckedCreateNestedManyWithoutPlanInput
  }

  export type GymMembershipPlanCreateOrConnectWithoutGymInput = {
    where: GymMembershipPlanWhereUniqueInput
    create: XOR<GymMembershipPlanCreateWithoutGymInput, GymMembershipPlanUncheckedCreateWithoutGymInput>
  }

  export type GymMembershipPlanCreateManyGymInputEnvelope = {
    data: GymMembershipPlanCreateManyGymInput | GymMembershipPlanCreateManyGymInput[]
    skipDuplicates?: boolean
  }

  export type GymMembershipContractCreateWithoutGymInput = {
    id?: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    plan: GymMembershipPlanCreateNestedOneWithoutMembershipsInput
    checkIns?: GymCheckInCreateNestedManyWithoutMembershipInput
    referral?: GymMembershipReferralCreateNestedOneWithoutMembershipContractInput
  }

  export type GymMembershipContractUncheckedCreateWithoutGymInput = {
    id?: string
    planId: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    checkIns?: GymCheckInUncheckedCreateNestedManyWithoutMembershipInput
    referral?: GymMembershipReferralUncheckedCreateNestedOneWithoutMembershipContractInput
  }

  export type GymMembershipContractCreateOrConnectWithoutGymInput = {
    where: GymMembershipContractWhereUniqueInput
    create: XOR<GymMembershipContractCreateWithoutGymInput, GymMembershipContractUncheckedCreateWithoutGymInput>
  }

  export type GymMembershipContractCreateManyGymInputEnvelope = {
    data: GymMembershipContractCreateManyGymInput | GymMembershipContractCreateManyGymInput[]
    skipDuplicates?: boolean
  }

  export type GymTrainerAffiliationCreateWithoutGymInput = {
    id?: string
    ptId: string
    status?: $Enums.AffiliationStatus
    employmentType?: $Enums.AffiliationEmployment
    visibility?: $Enums.GymTrainerVisibility
    commissionRate?: Decimal | DecimalJsLike | number | string | null
    invitedBy?: string | null
    joinedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymTrainerAffiliationUncheckedCreateWithoutGymInput = {
    id?: string
    ptId: string
    status?: $Enums.AffiliationStatus
    employmentType?: $Enums.AffiliationEmployment
    visibility?: $Enums.GymTrainerVisibility
    commissionRate?: Decimal | DecimalJsLike | number | string | null
    invitedBy?: string | null
    joinedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymTrainerAffiliationCreateOrConnectWithoutGymInput = {
    where: GymTrainerAffiliationWhereUniqueInput
    create: XOR<GymTrainerAffiliationCreateWithoutGymInput, GymTrainerAffiliationUncheckedCreateWithoutGymInput>
  }

  export type GymTrainerAffiliationCreateManyGymInputEnvelope = {
    data: GymTrainerAffiliationCreateManyGymInput | GymTrainerAffiliationCreateManyGymInput[]
    skipDuplicates?: boolean
  }

  export type GymReviewCreateWithoutGymInput = {
    id?: string
    clientId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymReviewUncheckedCreateWithoutGymInput = {
    id?: string
    clientId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymReviewCreateOrConnectWithoutGymInput = {
    where: GymReviewWhereUniqueInput
    create: XOR<GymReviewCreateWithoutGymInput, GymReviewUncheckedCreateWithoutGymInput>
  }

  export type GymReviewCreateManyGymInputEnvelope = {
    data: GymReviewCreateManyGymInput | GymReviewCreateManyGymInput[]
    skipDuplicates?: boolean
  }

  export type GymPtCollaborationCreateWithoutGymInput = {
    id?: string
    ptUserId: string
    proposedPtRate: Decimal | DecimalJsLike | number | string
    proposedGymRate: Decimal | DecimalJsLike | number | string
    platformRate?: Decimal | DecimalJsLike | number | string
    status?: $Enums.CollaborationStatus
    proposedBy: $Enums.CollaborationParty
    round?: number
    expiresAt: Date | string
    acceptedAt?: Date | string | null
    terminatedAt?: Date | string | null
    terminatedBy?: string | null
    note?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymPtCollaborationUncheckedCreateWithoutGymInput = {
    id?: string
    ptUserId: string
    proposedPtRate: Decimal | DecimalJsLike | number | string
    proposedGymRate: Decimal | DecimalJsLike | number | string
    platformRate?: Decimal | DecimalJsLike | number | string
    status?: $Enums.CollaborationStatus
    proposedBy: $Enums.CollaborationParty
    round?: number
    expiresAt: Date | string
    acceptedAt?: Date | string | null
    terminatedAt?: Date | string | null
    terminatedBy?: string | null
    note?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymPtCollaborationCreateOrConnectWithoutGymInput = {
    where: GymPtCollaborationWhereUniqueInput
    create: XOR<GymPtCollaborationCreateWithoutGymInput, GymPtCollaborationUncheckedCreateWithoutGymInput>
  }

  export type GymPtCollaborationCreateManyGymInputEnvelope = {
    data: GymPtCollaborationCreateManyGymInput | GymPtCollaborationCreateManyGymInput[]
    skipDuplicates?: boolean
  }

  export type GymMembershipPlanUpsertWithWhereUniqueWithoutGymInput = {
    where: GymMembershipPlanWhereUniqueInput
    update: XOR<GymMembershipPlanUpdateWithoutGymInput, GymMembershipPlanUncheckedUpdateWithoutGymInput>
    create: XOR<GymMembershipPlanCreateWithoutGymInput, GymMembershipPlanUncheckedCreateWithoutGymInput>
  }

  export type GymMembershipPlanUpdateWithWhereUniqueWithoutGymInput = {
    where: GymMembershipPlanWhereUniqueInput
    data: XOR<GymMembershipPlanUpdateWithoutGymInput, GymMembershipPlanUncheckedUpdateWithoutGymInput>
  }

  export type GymMembershipPlanUpdateManyWithWhereWithoutGymInput = {
    where: GymMembershipPlanScalarWhereInput
    data: XOR<GymMembershipPlanUpdateManyMutationInput, GymMembershipPlanUncheckedUpdateManyWithoutGymInput>
  }

  export type GymMembershipPlanScalarWhereInput = {
    AND?: GymMembershipPlanScalarWhereInput | GymMembershipPlanScalarWhereInput[]
    OR?: GymMembershipPlanScalarWhereInput[]
    NOT?: GymMembershipPlanScalarWhereInput | GymMembershipPlanScalarWhereInput[]
    id?: StringFilter<"GymMembershipPlan"> | string
    gymId?: StringFilter<"GymMembershipPlan"> | string
    name?: StringFilter<"GymMembershipPlan"> | string
    description?: StringNullableFilter<"GymMembershipPlan"> | string | null
    price?: DecimalFilter<"GymMembershipPlan"> | Decimal | DecimalJsLike | number | string
    durationDays?: IntFilter<"GymMembershipPlan"> | number
    visitLimit?: IntNullableFilter<"GymMembershipPlan"> | number | null
    status?: EnumGymMembershipPlanStatusFilter<"GymMembershipPlan"> | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFilter<"GymMembershipPlan"> | Date | string
    updatedAt?: DateTimeFilter<"GymMembershipPlan"> | Date | string
  }

  export type GymMembershipContractUpsertWithWhereUniqueWithoutGymInput = {
    where: GymMembershipContractWhereUniqueInput
    update: XOR<GymMembershipContractUpdateWithoutGymInput, GymMembershipContractUncheckedUpdateWithoutGymInput>
    create: XOR<GymMembershipContractCreateWithoutGymInput, GymMembershipContractUncheckedCreateWithoutGymInput>
  }

  export type GymMembershipContractUpdateWithWhereUniqueWithoutGymInput = {
    where: GymMembershipContractWhereUniqueInput
    data: XOR<GymMembershipContractUpdateWithoutGymInput, GymMembershipContractUncheckedUpdateWithoutGymInput>
  }

  export type GymMembershipContractUpdateManyWithWhereWithoutGymInput = {
    where: GymMembershipContractScalarWhereInput
    data: XOR<GymMembershipContractUpdateManyMutationInput, GymMembershipContractUncheckedUpdateManyWithoutGymInput>
  }

  export type GymMembershipContractScalarWhereInput = {
    AND?: GymMembershipContractScalarWhereInput | GymMembershipContractScalarWhereInput[]
    OR?: GymMembershipContractScalarWhereInput[]
    NOT?: GymMembershipContractScalarWhereInput | GymMembershipContractScalarWhereInput[]
    id?: StringFilter<"GymMembershipContract"> | string
    gymId?: StringFilter<"GymMembershipContract"> | string
    planId?: StringFilter<"GymMembershipContract"> | string
    clientId?: StringFilter<"GymMembershipContract"> | string
    status?: EnumGymMembershipContractStatusFilter<"GymMembershipContract"> | $Enums.GymMembershipContractStatus
    paymentTxnId?: StringNullableFilter<"GymMembershipContract"> | string | null
    startDate?: DateTimeNullableFilter<"GymMembershipContract"> | Date | string | null
    endDate?: DateTimeNullableFilter<"GymMembershipContract"> | Date | string | null
    priceAtPurchase?: DecimalFilter<"GymMembershipContract"> | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFilter<"GymMembershipContract"> | number
    totalVisits?: IntNullableFilter<"GymMembershipContract"> | number | null
    usedVisits?: IntFilter<"GymMembershipContract"> | number
    payoutReleasedAt?: DateTimeNullableFilter<"GymMembershipContract"> | Date | string | null
    multiGymWarned?: BoolFilter<"GymMembershipContract"> | boolean
    createdAt?: DateTimeFilter<"GymMembershipContract"> | Date | string
    updatedAt?: DateTimeFilter<"GymMembershipContract"> | Date | string
  }

  export type GymTrainerAffiliationUpsertWithWhereUniqueWithoutGymInput = {
    where: GymTrainerAffiliationWhereUniqueInput
    update: XOR<GymTrainerAffiliationUpdateWithoutGymInput, GymTrainerAffiliationUncheckedUpdateWithoutGymInput>
    create: XOR<GymTrainerAffiliationCreateWithoutGymInput, GymTrainerAffiliationUncheckedCreateWithoutGymInput>
  }

  export type GymTrainerAffiliationUpdateWithWhereUniqueWithoutGymInput = {
    where: GymTrainerAffiliationWhereUniqueInput
    data: XOR<GymTrainerAffiliationUpdateWithoutGymInput, GymTrainerAffiliationUncheckedUpdateWithoutGymInput>
  }

  export type GymTrainerAffiliationUpdateManyWithWhereWithoutGymInput = {
    where: GymTrainerAffiliationScalarWhereInput
    data: XOR<GymTrainerAffiliationUpdateManyMutationInput, GymTrainerAffiliationUncheckedUpdateManyWithoutGymInput>
  }

  export type GymTrainerAffiliationScalarWhereInput = {
    AND?: GymTrainerAffiliationScalarWhereInput | GymTrainerAffiliationScalarWhereInput[]
    OR?: GymTrainerAffiliationScalarWhereInput[]
    NOT?: GymTrainerAffiliationScalarWhereInput | GymTrainerAffiliationScalarWhereInput[]
    id?: StringFilter<"GymTrainerAffiliation"> | string
    gymId?: StringFilter<"GymTrainerAffiliation"> | string
    ptId?: StringFilter<"GymTrainerAffiliation"> | string
    status?: EnumAffiliationStatusFilter<"GymTrainerAffiliation"> | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFilter<"GymTrainerAffiliation"> | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFilter<"GymTrainerAffiliation"> | $Enums.GymTrainerVisibility
    commissionRate?: DecimalNullableFilter<"GymTrainerAffiliation"> | Decimal | DecimalJsLike | number | string | null
    invitedBy?: StringNullableFilter<"GymTrainerAffiliation"> | string | null
    joinedAt?: DateTimeNullableFilter<"GymTrainerAffiliation"> | Date | string | null
    createdAt?: DateTimeFilter<"GymTrainerAffiliation"> | Date | string
    updatedAt?: DateTimeFilter<"GymTrainerAffiliation"> | Date | string
  }

  export type GymReviewUpsertWithWhereUniqueWithoutGymInput = {
    where: GymReviewWhereUniqueInput
    update: XOR<GymReviewUpdateWithoutGymInput, GymReviewUncheckedUpdateWithoutGymInput>
    create: XOR<GymReviewCreateWithoutGymInput, GymReviewUncheckedCreateWithoutGymInput>
  }

  export type GymReviewUpdateWithWhereUniqueWithoutGymInput = {
    where: GymReviewWhereUniqueInput
    data: XOR<GymReviewUpdateWithoutGymInput, GymReviewUncheckedUpdateWithoutGymInput>
  }

  export type GymReviewUpdateManyWithWhereWithoutGymInput = {
    where: GymReviewScalarWhereInput
    data: XOR<GymReviewUpdateManyMutationInput, GymReviewUncheckedUpdateManyWithoutGymInput>
  }

  export type GymReviewScalarWhereInput = {
    AND?: GymReviewScalarWhereInput | GymReviewScalarWhereInput[]
    OR?: GymReviewScalarWhereInput[]
    NOT?: GymReviewScalarWhereInput | GymReviewScalarWhereInput[]
    id?: StringFilter<"GymReview"> | string
    gymId?: StringFilter<"GymReview"> | string
    clientId?: StringFilter<"GymReview"> | string
    rating?: IntFilter<"GymReview"> | number
    comment?: StringNullableFilter<"GymReview"> | string | null
    createdAt?: DateTimeFilter<"GymReview"> | Date | string
    updatedAt?: DateTimeFilter<"GymReview"> | Date | string
  }

  export type GymPtCollaborationUpsertWithWhereUniqueWithoutGymInput = {
    where: GymPtCollaborationWhereUniqueInput
    update: XOR<GymPtCollaborationUpdateWithoutGymInput, GymPtCollaborationUncheckedUpdateWithoutGymInput>
    create: XOR<GymPtCollaborationCreateWithoutGymInput, GymPtCollaborationUncheckedCreateWithoutGymInput>
  }

  export type GymPtCollaborationUpdateWithWhereUniqueWithoutGymInput = {
    where: GymPtCollaborationWhereUniqueInput
    data: XOR<GymPtCollaborationUpdateWithoutGymInput, GymPtCollaborationUncheckedUpdateWithoutGymInput>
  }

  export type GymPtCollaborationUpdateManyWithWhereWithoutGymInput = {
    where: GymPtCollaborationScalarWhereInput
    data: XOR<GymPtCollaborationUpdateManyMutationInput, GymPtCollaborationUncheckedUpdateManyWithoutGymInput>
  }

  export type GymPtCollaborationScalarWhereInput = {
    AND?: GymPtCollaborationScalarWhereInput | GymPtCollaborationScalarWhereInput[]
    OR?: GymPtCollaborationScalarWhereInput[]
    NOT?: GymPtCollaborationScalarWhereInput | GymPtCollaborationScalarWhereInput[]
    id?: StringFilter<"GymPtCollaboration"> | string
    gymId?: StringFilter<"GymPtCollaboration"> | string
    ptUserId?: StringFilter<"GymPtCollaboration"> | string
    proposedPtRate?: DecimalFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFilter<"GymPtCollaboration"> | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFilter<"GymPtCollaboration"> | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFilter<"GymPtCollaboration"> | $Enums.CollaborationParty
    round?: IntFilter<"GymPtCollaboration"> | number
    expiresAt?: DateTimeFilter<"GymPtCollaboration"> | Date | string
    acceptedAt?: DateTimeNullableFilter<"GymPtCollaboration"> | Date | string | null
    terminatedAt?: DateTimeNullableFilter<"GymPtCollaboration"> | Date | string | null
    terminatedBy?: StringNullableFilter<"GymPtCollaboration"> | string | null
    note?: StringNullableFilter<"GymPtCollaboration"> | string | null
    createdAt?: DateTimeFilter<"GymPtCollaboration"> | Date | string
    updatedAt?: DateTimeFilter<"GymPtCollaboration"> | Date | string
  }

  export type GymCreateWithoutPlansInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    memberships?: GymMembershipContractCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationCreateNestedManyWithoutGymInput
    reviews?: GymReviewCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationCreateNestedManyWithoutGymInput
  }

  export type GymUncheckedCreateWithoutPlansInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    memberships?: GymMembershipContractUncheckedCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationUncheckedCreateNestedManyWithoutGymInput
    reviews?: GymReviewUncheckedCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationUncheckedCreateNestedManyWithoutGymInput
  }

  export type GymCreateOrConnectWithoutPlansInput = {
    where: GymWhereUniqueInput
    create: XOR<GymCreateWithoutPlansInput, GymUncheckedCreateWithoutPlansInput>
  }

  export type GymMembershipContractCreateWithoutPlanInput = {
    id?: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    gym: GymCreateNestedOneWithoutMembershipsInput
    checkIns?: GymCheckInCreateNestedManyWithoutMembershipInput
    referral?: GymMembershipReferralCreateNestedOneWithoutMembershipContractInput
  }

  export type GymMembershipContractUncheckedCreateWithoutPlanInput = {
    id?: string
    gymId: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    checkIns?: GymCheckInUncheckedCreateNestedManyWithoutMembershipInput
    referral?: GymMembershipReferralUncheckedCreateNestedOneWithoutMembershipContractInput
  }

  export type GymMembershipContractCreateOrConnectWithoutPlanInput = {
    where: GymMembershipContractWhereUniqueInput
    create: XOR<GymMembershipContractCreateWithoutPlanInput, GymMembershipContractUncheckedCreateWithoutPlanInput>
  }

  export type GymMembershipContractCreateManyPlanInputEnvelope = {
    data: GymMembershipContractCreateManyPlanInput | GymMembershipContractCreateManyPlanInput[]
    skipDuplicates?: boolean
  }

  export type GymUpsertWithoutPlansInput = {
    update: XOR<GymUpdateWithoutPlansInput, GymUncheckedUpdateWithoutPlansInput>
    create: XOR<GymCreateWithoutPlansInput, GymUncheckedCreateWithoutPlansInput>
    where?: GymWhereInput
  }

  export type GymUpdateToOneWithWhereWithoutPlansInput = {
    where?: GymWhereInput
    data: XOR<GymUpdateWithoutPlansInput, GymUncheckedUpdateWithoutPlansInput>
  }

  export type GymUpdateWithoutPlansInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    memberships?: GymMembershipContractUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUpdateManyWithoutGymNestedInput
  }

  export type GymUncheckedUpdateWithoutPlansInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    memberships?: GymMembershipContractUncheckedUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUncheckedUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUncheckedUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUncheckedUpdateManyWithoutGymNestedInput
  }

  export type GymMembershipContractUpsertWithWhereUniqueWithoutPlanInput = {
    where: GymMembershipContractWhereUniqueInput
    update: XOR<GymMembershipContractUpdateWithoutPlanInput, GymMembershipContractUncheckedUpdateWithoutPlanInput>
    create: XOR<GymMembershipContractCreateWithoutPlanInput, GymMembershipContractUncheckedCreateWithoutPlanInput>
  }

  export type GymMembershipContractUpdateWithWhereUniqueWithoutPlanInput = {
    where: GymMembershipContractWhereUniqueInput
    data: XOR<GymMembershipContractUpdateWithoutPlanInput, GymMembershipContractUncheckedUpdateWithoutPlanInput>
  }

  export type GymMembershipContractUpdateManyWithWhereWithoutPlanInput = {
    where: GymMembershipContractScalarWhereInput
    data: XOR<GymMembershipContractUpdateManyMutationInput, GymMembershipContractUncheckedUpdateManyWithoutPlanInput>
  }

  export type GymCreateWithoutMembershipsInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationCreateNestedManyWithoutGymInput
    reviews?: GymReviewCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationCreateNestedManyWithoutGymInput
  }

  export type GymUncheckedCreateWithoutMembershipsInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanUncheckedCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationUncheckedCreateNestedManyWithoutGymInput
    reviews?: GymReviewUncheckedCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationUncheckedCreateNestedManyWithoutGymInput
  }

  export type GymCreateOrConnectWithoutMembershipsInput = {
    where: GymWhereUniqueInput
    create: XOR<GymCreateWithoutMembershipsInput, GymUncheckedCreateWithoutMembershipsInput>
  }

  export type GymMembershipPlanCreateWithoutMembershipsInput = {
    id?: string
    name: string
    description?: string | null
    price: Decimal | DecimalJsLike | number | string
    durationDays: number
    visitLimit?: number | null
    status?: $Enums.GymMembershipPlanStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    gym: GymCreateNestedOneWithoutPlansInput
  }

  export type GymMembershipPlanUncheckedCreateWithoutMembershipsInput = {
    id?: string
    gymId: string
    name: string
    description?: string | null
    price: Decimal | DecimalJsLike | number | string
    durationDays: number
    visitLimit?: number | null
    status?: $Enums.GymMembershipPlanStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipPlanCreateOrConnectWithoutMembershipsInput = {
    where: GymMembershipPlanWhereUniqueInput
    create: XOR<GymMembershipPlanCreateWithoutMembershipsInput, GymMembershipPlanUncheckedCreateWithoutMembershipsInput>
  }

  export type GymCheckInCreateWithoutMembershipInput = {
    id?: string
    gymId: string
    clientId: string
    checkedInBy: string
    createdAt?: Date | string
  }

  export type GymCheckInUncheckedCreateWithoutMembershipInput = {
    id?: string
    gymId: string
    clientId: string
    checkedInBy: string
    createdAt?: Date | string
  }

  export type GymCheckInCreateOrConnectWithoutMembershipInput = {
    where: GymCheckInWhereUniqueInput
    create: XOR<GymCheckInCreateWithoutMembershipInput, GymCheckInUncheckedCreateWithoutMembershipInput>
  }

  export type GymCheckInCreateManyMembershipInputEnvelope = {
    data: GymCheckInCreateManyMembershipInput | GymCheckInCreateManyMembershipInput[]
    skipDuplicates?: boolean
  }

  export type GymMembershipReferralCreateWithoutMembershipContractInput = {
    id?: string
    gymId: string
    referrerPtUserId: string
    rate: Decimal | DecimalJsLike | number | string
    amount: Decimal | DecimalJsLike | number | string
    clawedBack?: Decimal | DecimalJsLike | number | string
    status?: string
    releasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipReferralUncheckedCreateWithoutMembershipContractInput = {
    id?: string
    gymId: string
    referrerPtUserId: string
    rate: Decimal | DecimalJsLike | number | string
    amount: Decimal | DecimalJsLike | number | string
    clawedBack?: Decimal | DecimalJsLike | number | string
    status?: string
    releasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipReferralCreateOrConnectWithoutMembershipContractInput = {
    where: GymMembershipReferralWhereUniqueInput
    create: XOR<GymMembershipReferralCreateWithoutMembershipContractInput, GymMembershipReferralUncheckedCreateWithoutMembershipContractInput>
  }

  export type GymUpsertWithoutMembershipsInput = {
    update: XOR<GymUpdateWithoutMembershipsInput, GymUncheckedUpdateWithoutMembershipsInput>
    create: XOR<GymCreateWithoutMembershipsInput, GymUncheckedCreateWithoutMembershipsInput>
    where?: GymWhereInput
  }

  export type GymUpdateToOneWithWhereWithoutMembershipsInput = {
    where?: GymWhereInput
    data: XOR<GymUpdateWithoutMembershipsInput, GymUncheckedUpdateWithoutMembershipsInput>
  }

  export type GymUpdateWithoutMembershipsInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUpdateManyWithoutGymNestedInput
  }

  export type GymUncheckedUpdateWithoutMembershipsInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUncheckedUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUncheckedUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUncheckedUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUncheckedUpdateManyWithoutGymNestedInput
  }

  export type GymMembershipPlanUpsertWithoutMembershipsInput = {
    update: XOR<GymMembershipPlanUpdateWithoutMembershipsInput, GymMembershipPlanUncheckedUpdateWithoutMembershipsInput>
    create: XOR<GymMembershipPlanCreateWithoutMembershipsInput, GymMembershipPlanUncheckedCreateWithoutMembershipsInput>
    where?: GymMembershipPlanWhereInput
  }

  export type GymMembershipPlanUpdateToOneWithWhereWithoutMembershipsInput = {
    where?: GymMembershipPlanWhereInput
    data: XOR<GymMembershipPlanUpdateWithoutMembershipsInput, GymMembershipPlanUncheckedUpdateWithoutMembershipsInput>
  }

  export type GymMembershipPlanUpdateWithoutMembershipsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDays?: IntFieldUpdateOperationsInput | number
    visitLimit?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumGymMembershipPlanStatusFieldUpdateOperationsInput | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    gym?: GymUpdateOneRequiredWithoutPlansNestedInput
  }

  export type GymMembershipPlanUncheckedUpdateWithoutMembershipsInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDays?: IntFieldUpdateOperationsInput | number
    visitLimit?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumGymMembershipPlanStatusFieldUpdateOperationsInput | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymCheckInUpsertWithWhereUniqueWithoutMembershipInput = {
    where: GymCheckInWhereUniqueInput
    update: XOR<GymCheckInUpdateWithoutMembershipInput, GymCheckInUncheckedUpdateWithoutMembershipInput>
    create: XOR<GymCheckInCreateWithoutMembershipInput, GymCheckInUncheckedCreateWithoutMembershipInput>
  }

  export type GymCheckInUpdateWithWhereUniqueWithoutMembershipInput = {
    where: GymCheckInWhereUniqueInput
    data: XOR<GymCheckInUpdateWithoutMembershipInput, GymCheckInUncheckedUpdateWithoutMembershipInput>
  }

  export type GymCheckInUpdateManyWithWhereWithoutMembershipInput = {
    where: GymCheckInScalarWhereInput
    data: XOR<GymCheckInUpdateManyMutationInput, GymCheckInUncheckedUpdateManyWithoutMembershipInput>
  }

  export type GymCheckInScalarWhereInput = {
    AND?: GymCheckInScalarWhereInput | GymCheckInScalarWhereInput[]
    OR?: GymCheckInScalarWhereInput[]
    NOT?: GymCheckInScalarWhereInput | GymCheckInScalarWhereInput[]
    id?: StringFilter<"GymCheckIn"> | string
    membershipId?: StringFilter<"GymCheckIn"> | string
    gymId?: StringFilter<"GymCheckIn"> | string
    clientId?: StringFilter<"GymCheckIn"> | string
    checkedInBy?: StringFilter<"GymCheckIn"> | string
    createdAt?: DateTimeFilter<"GymCheckIn"> | Date | string
  }

  export type GymMembershipReferralUpsertWithoutMembershipContractInput = {
    update: XOR<GymMembershipReferralUpdateWithoutMembershipContractInput, GymMembershipReferralUncheckedUpdateWithoutMembershipContractInput>
    create: XOR<GymMembershipReferralCreateWithoutMembershipContractInput, GymMembershipReferralUncheckedCreateWithoutMembershipContractInput>
    where?: GymMembershipReferralWhereInput
  }

  export type GymMembershipReferralUpdateToOneWithWhereWithoutMembershipContractInput = {
    where?: GymMembershipReferralWhereInput
    data: XOR<GymMembershipReferralUpdateWithoutMembershipContractInput, GymMembershipReferralUncheckedUpdateWithoutMembershipContractInput>
  }

  export type GymMembershipReferralUpdateWithoutMembershipContractInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    referrerPtUserId?: StringFieldUpdateOperationsInput | string
    rate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    clawedBack?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: StringFieldUpdateOperationsInput | string
    releasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipReferralUncheckedUpdateWithoutMembershipContractInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    referrerPtUserId?: StringFieldUpdateOperationsInput | string
    rate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    clawedBack?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: StringFieldUpdateOperationsInput | string
    releasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymCreateWithoutAffiliationsInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanCreateNestedManyWithoutGymInput
    memberships?: GymMembershipContractCreateNestedManyWithoutGymInput
    reviews?: GymReviewCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationCreateNestedManyWithoutGymInput
  }

  export type GymUncheckedCreateWithoutAffiliationsInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanUncheckedCreateNestedManyWithoutGymInput
    memberships?: GymMembershipContractUncheckedCreateNestedManyWithoutGymInput
    reviews?: GymReviewUncheckedCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationUncheckedCreateNestedManyWithoutGymInput
  }

  export type GymCreateOrConnectWithoutAffiliationsInput = {
    where: GymWhereUniqueInput
    create: XOR<GymCreateWithoutAffiliationsInput, GymUncheckedCreateWithoutAffiliationsInput>
  }

  export type GymUpsertWithoutAffiliationsInput = {
    update: XOR<GymUpdateWithoutAffiliationsInput, GymUncheckedUpdateWithoutAffiliationsInput>
    create: XOR<GymCreateWithoutAffiliationsInput, GymUncheckedCreateWithoutAffiliationsInput>
    where?: GymWhereInput
  }

  export type GymUpdateToOneWithWhereWithoutAffiliationsInput = {
    where?: GymWhereInput
    data: XOR<GymUpdateWithoutAffiliationsInput, GymUncheckedUpdateWithoutAffiliationsInput>
  }

  export type GymUpdateWithoutAffiliationsInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUpdateManyWithoutGymNestedInput
    memberships?: GymMembershipContractUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUpdateManyWithoutGymNestedInput
  }

  export type GymUncheckedUpdateWithoutAffiliationsInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUncheckedUpdateManyWithoutGymNestedInput
    memberships?: GymMembershipContractUncheckedUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUncheckedUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUncheckedUpdateManyWithoutGymNestedInput
  }

  export type GymMembershipContractCreateWithoutCheckInsInput = {
    id?: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    gym: GymCreateNestedOneWithoutMembershipsInput
    plan: GymMembershipPlanCreateNestedOneWithoutMembershipsInput
    referral?: GymMembershipReferralCreateNestedOneWithoutMembershipContractInput
  }

  export type GymMembershipContractUncheckedCreateWithoutCheckInsInput = {
    id?: string
    gymId: string
    planId: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    referral?: GymMembershipReferralUncheckedCreateNestedOneWithoutMembershipContractInput
  }

  export type GymMembershipContractCreateOrConnectWithoutCheckInsInput = {
    where: GymMembershipContractWhereUniqueInput
    create: XOR<GymMembershipContractCreateWithoutCheckInsInput, GymMembershipContractUncheckedCreateWithoutCheckInsInput>
  }

  export type GymMembershipContractUpsertWithoutCheckInsInput = {
    update: XOR<GymMembershipContractUpdateWithoutCheckInsInput, GymMembershipContractUncheckedUpdateWithoutCheckInsInput>
    create: XOR<GymMembershipContractCreateWithoutCheckInsInput, GymMembershipContractUncheckedCreateWithoutCheckInsInput>
    where?: GymMembershipContractWhereInput
  }

  export type GymMembershipContractUpdateToOneWithWhereWithoutCheckInsInput = {
    where?: GymMembershipContractWhereInput
    data: XOR<GymMembershipContractUpdateWithoutCheckInsInput, GymMembershipContractUncheckedUpdateWithoutCheckInsInput>
  }

  export type GymMembershipContractUpdateWithoutCheckInsInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    gym?: GymUpdateOneRequiredWithoutMembershipsNestedInput
    plan?: GymMembershipPlanUpdateOneRequiredWithoutMembershipsNestedInput
    referral?: GymMembershipReferralUpdateOneWithoutMembershipContractNestedInput
  }

  export type GymMembershipContractUncheckedUpdateWithoutCheckInsInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    planId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    referral?: GymMembershipReferralUncheckedUpdateOneWithoutMembershipContractNestedInput
  }

  export type GymCreateWithoutReviewsInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanCreateNestedManyWithoutGymInput
    memberships?: GymMembershipContractCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationCreateNestedManyWithoutGymInput
  }

  export type GymUncheckedCreateWithoutReviewsInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanUncheckedCreateNestedManyWithoutGymInput
    memberships?: GymMembershipContractUncheckedCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationUncheckedCreateNestedManyWithoutGymInput
    collaborations?: GymPtCollaborationUncheckedCreateNestedManyWithoutGymInput
  }

  export type GymCreateOrConnectWithoutReviewsInput = {
    where: GymWhereUniqueInput
    create: XOR<GymCreateWithoutReviewsInput, GymUncheckedCreateWithoutReviewsInput>
  }

  export type GymUpsertWithoutReviewsInput = {
    update: XOR<GymUpdateWithoutReviewsInput, GymUncheckedUpdateWithoutReviewsInput>
    create: XOR<GymCreateWithoutReviewsInput, GymUncheckedCreateWithoutReviewsInput>
    where?: GymWhereInput
  }

  export type GymUpdateToOneWithWhereWithoutReviewsInput = {
    where?: GymWhereInput
    data: XOR<GymUpdateWithoutReviewsInput, GymUncheckedUpdateWithoutReviewsInput>
  }

  export type GymUpdateWithoutReviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUpdateManyWithoutGymNestedInput
    memberships?: GymMembershipContractUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUpdateManyWithoutGymNestedInput
  }

  export type GymUncheckedUpdateWithoutReviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUncheckedUpdateManyWithoutGymNestedInput
    memberships?: GymMembershipContractUncheckedUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUncheckedUpdateManyWithoutGymNestedInput
    collaborations?: GymPtCollaborationUncheckedUpdateManyWithoutGymNestedInput
  }

  export type GymCreateWithoutCollaborationsInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanCreateNestedManyWithoutGymInput
    memberships?: GymMembershipContractCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationCreateNestedManyWithoutGymInput
    reviews?: GymReviewCreateNestedManyWithoutGymInput
  }

  export type GymUncheckedCreateWithoutCollaborationsInput = {
    id?: string
    ownerId: string
    name: string
    description?: string | null
    address: string
    city?: string | null
    phone?: string | null
    email?: string | null
    status?: $Enums.GymStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    plans?: GymMembershipPlanUncheckedCreateNestedManyWithoutGymInput
    memberships?: GymMembershipContractUncheckedCreateNestedManyWithoutGymInput
    affiliations?: GymTrainerAffiliationUncheckedCreateNestedManyWithoutGymInput
    reviews?: GymReviewUncheckedCreateNestedManyWithoutGymInput
  }

  export type GymCreateOrConnectWithoutCollaborationsInput = {
    where: GymWhereUniqueInput
    create: XOR<GymCreateWithoutCollaborationsInput, GymUncheckedCreateWithoutCollaborationsInput>
  }

  export type GymUpsertWithoutCollaborationsInput = {
    update: XOR<GymUpdateWithoutCollaborationsInput, GymUncheckedUpdateWithoutCollaborationsInput>
    create: XOR<GymCreateWithoutCollaborationsInput, GymUncheckedCreateWithoutCollaborationsInput>
    where?: GymWhereInput
  }

  export type GymUpdateToOneWithWhereWithoutCollaborationsInput = {
    where?: GymWhereInput
    data: XOR<GymUpdateWithoutCollaborationsInput, GymUncheckedUpdateWithoutCollaborationsInput>
  }

  export type GymUpdateWithoutCollaborationsInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUpdateManyWithoutGymNestedInput
    memberships?: GymMembershipContractUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUpdateManyWithoutGymNestedInput
  }

  export type GymUncheckedUpdateWithoutCollaborationsInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    address?: StringFieldUpdateOperationsInput | string
    city?: NullableStringFieldUpdateOperationsInput | string | null
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumGymStatusFieldUpdateOperationsInput | $Enums.GymStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plans?: GymMembershipPlanUncheckedUpdateManyWithoutGymNestedInput
    memberships?: GymMembershipContractUncheckedUpdateManyWithoutGymNestedInput
    affiliations?: GymTrainerAffiliationUncheckedUpdateManyWithoutGymNestedInput
    reviews?: GymReviewUncheckedUpdateManyWithoutGymNestedInput
  }

  export type GymMembershipContractCreateWithoutReferralInput = {
    id?: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    gym: GymCreateNestedOneWithoutMembershipsInput
    plan: GymMembershipPlanCreateNestedOneWithoutMembershipsInput
    checkIns?: GymCheckInCreateNestedManyWithoutMembershipInput
  }

  export type GymMembershipContractUncheckedCreateWithoutReferralInput = {
    id?: string
    gymId: string
    planId: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    checkIns?: GymCheckInUncheckedCreateNestedManyWithoutMembershipInput
  }

  export type GymMembershipContractCreateOrConnectWithoutReferralInput = {
    where: GymMembershipContractWhereUniqueInput
    create: XOR<GymMembershipContractCreateWithoutReferralInput, GymMembershipContractUncheckedCreateWithoutReferralInput>
  }

  export type GymMembershipContractUpsertWithoutReferralInput = {
    update: XOR<GymMembershipContractUpdateWithoutReferralInput, GymMembershipContractUncheckedUpdateWithoutReferralInput>
    create: XOR<GymMembershipContractCreateWithoutReferralInput, GymMembershipContractUncheckedCreateWithoutReferralInput>
    where?: GymMembershipContractWhereInput
  }

  export type GymMembershipContractUpdateToOneWithWhereWithoutReferralInput = {
    where?: GymMembershipContractWhereInput
    data: XOR<GymMembershipContractUpdateWithoutReferralInput, GymMembershipContractUncheckedUpdateWithoutReferralInput>
  }

  export type GymMembershipContractUpdateWithoutReferralInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    gym?: GymUpdateOneRequiredWithoutMembershipsNestedInput
    plan?: GymMembershipPlanUpdateOneRequiredWithoutMembershipsNestedInput
    checkIns?: GymCheckInUpdateManyWithoutMembershipNestedInput
  }

  export type GymMembershipContractUncheckedUpdateWithoutReferralInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    planId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    checkIns?: GymCheckInUncheckedUpdateManyWithoutMembershipNestedInput
  }

  export type GymMembershipPlanCreateManyGymInput = {
    id?: string
    name: string
    description?: string | null
    price: Decimal | DecimalJsLike | number | string
    durationDays: number
    visitLimit?: number | null
    status?: $Enums.GymMembershipPlanStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipContractCreateManyGymInput = {
    id?: string
    planId: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymTrainerAffiliationCreateManyGymInput = {
    id?: string
    ptId: string
    status?: $Enums.AffiliationStatus
    employmentType?: $Enums.AffiliationEmployment
    visibility?: $Enums.GymTrainerVisibility
    commissionRate?: Decimal | DecimalJsLike | number | string | null
    invitedBy?: string | null
    joinedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymReviewCreateManyGymInput = {
    id?: string
    clientId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymPtCollaborationCreateManyGymInput = {
    id?: string
    ptUserId: string
    proposedPtRate: Decimal | DecimalJsLike | number | string
    proposedGymRate: Decimal | DecimalJsLike | number | string
    platformRate?: Decimal | DecimalJsLike | number | string
    status?: $Enums.CollaborationStatus
    proposedBy: $Enums.CollaborationParty
    round?: number
    expiresAt: Date | string
    acceptedAt?: Date | string | null
    terminatedAt?: Date | string | null
    terminatedBy?: string | null
    note?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipPlanUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDays?: IntFieldUpdateOperationsInput | number
    visitLimit?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumGymMembershipPlanStatusFieldUpdateOperationsInput | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    memberships?: GymMembershipContractUpdateManyWithoutPlanNestedInput
  }

  export type GymMembershipPlanUncheckedUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDays?: IntFieldUpdateOperationsInput | number
    visitLimit?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumGymMembershipPlanStatusFieldUpdateOperationsInput | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    memberships?: GymMembershipContractUncheckedUpdateManyWithoutPlanNestedInput
  }

  export type GymMembershipPlanUncheckedUpdateManyWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDays?: IntFieldUpdateOperationsInput | number
    visitLimit?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumGymMembershipPlanStatusFieldUpdateOperationsInput | $Enums.GymMembershipPlanStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipContractUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    plan?: GymMembershipPlanUpdateOneRequiredWithoutMembershipsNestedInput
    checkIns?: GymCheckInUpdateManyWithoutMembershipNestedInput
    referral?: GymMembershipReferralUpdateOneWithoutMembershipContractNestedInput
  }

  export type GymMembershipContractUncheckedUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    planId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    checkIns?: GymCheckInUncheckedUpdateManyWithoutMembershipNestedInput
    referral?: GymMembershipReferralUncheckedUpdateOneWithoutMembershipContractNestedInput
  }

  export type GymMembershipContractUncheckedUpdateManyWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    planId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymTrainerAffiliationUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptId?: StringFieldUpdateOperationsInput | string
    status?: EnumAffiliationStatusFieldUpdateOperationsInput | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFieldUpdateOperationsInput | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFieldUpdateOperationsInput | $Enums.GymTrainerVisibility
    commissionRate?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    invitedBy?: NullableStringFieldUpdateOperationsInput | string | null
    joinedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymTrainerAffiliationUncheckedUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptId?: StringFieldUpdateOperationsInput | string
    status?: EnumAffiliationStatusFieldUpdateOperationsInput | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFieldUpdateOperationsInput | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFieldUpdateOperationsInput | $Enums.GymTrainerVisibility
    commissionRate?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    invitedBy?: NullableStringFieldUpdateOperationsInput | string | null
    joinedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymTrainerAffiliationUncheckedUpdateManyWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptId?: StringFieldUpdateOperationsInput | string
    status?: EnumAffiliationStatusFieldUpdateOperationsInput | $Enums.AffiliationStatus
    employmentType?: EnumAffiliationEmploymentFieldUpdateOperationsInput | $Enums.AffiliationEmployment
    visibility?: EnumGymTrainerVisibilityFieldUpdateOperationsInput | $Enums.GymTrainerVisibility
    commissionRate?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    invitedBy?: NullableStringFieldUpdateOperationsInput | string | null
    joinedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymReviewUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymReviewUncheckedUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymReviewUncheckedUpdateManyWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymPtCollaborationUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptUserId?: StringFieldUpdateOperationsInput | string
    proposedPtRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFieldUpdateOperationsInput | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFieldUpdateOperationsInput | $Enums.CollaborationParty
    round?: IntFieldUpdateOperationsInput | number
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    acceptedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    note?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymPtCollaborationUncheckedUpdateWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptUserId?: StringFieldUpdateOperationsInput | string
    proposedPtRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFieldUpdateOperationsInput | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFieldUpdateOperationsInput | $Enums.CollaborationParty
    round?: IntFieldUpdateOperationsInput | number
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    acceptedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    note?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymPtCollaborationUncheckedUpdateManyWithoutGymInput = {
    id?: StringFieldUpdateOperationsInput | string
    ptUserId?: StringFieldUpdateOperationsInput | string
    proposedPtRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    proposedGymRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    platformRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    status?: EnumCollaborationStatusFieldUpdateOperationsInput | $Enums.CollaborationStatus
    proposedBy?: EnumCollaborationPartyFieldUpdateOperationsInput | $Enums.CollaborationParty
    round?: IntFieldUpdateOperationsInput | number
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    acceptedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    terminatedBy?: NullableStringFieldUpdateOperationsInput | string | null
    note?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymMembershipContractCreateManyPlanInput = {
    id?: string
    gymId: string
    clientId: string
    status?: $Enums.GymMembershipContractStatus
    paymentTxnId?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    priceAtPurchase: Decimal | DecimalJsLike | number | string
    durationDaysSnapshot: number
    totalVisits?: number | null
    usedVisits?: number
    payoutReleasedAt?: Date | string | null
    multiGymWarned?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type GymMembershipContractUpdateWithoutPlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    gym?: GymUpdateOneRequiredWithoutMembershipsNestedInput
    checkIns?: GymCheckInUpdateManyWithoutMembershipNestedInput
    referral?: GymMembershipReferralUpdateOneWithoutMembershipContractNestedInput
  }

  export type GymMembershipContractUncheckedUpdateWithoutPlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    checkIns?: GymCheckInUncheckedUpdateManyWithoutMembershipNestedInput
    referral?: GymMembershipReferralUncheckedUpdateOneWithoutMembershipContractNestedInput
  }

  export type GymMembershipContractUncheckedUpdateManyWithoutPlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    status?: EnumGymMembershipContractStatusFieldUpdateOperationsInput | $Enums.GymMembershipContractStatus
    paymentTxnId?: NullableStringFieldUpdateOperationsInput | string | null
    startDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    priceAtPurchase?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    durationDaysSnapshot?: IntFieldUpdateOperationsInput | number
    totalVisits?: NullableIntFieldUpdateOperationsInput | number | null
    usedVisits?: IntFieldUpdateOperationsInput | number
    payoutReleasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    multiGymWarned?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymCheckInCreateManyMembershipInput = {
    id?: string
    gymId: string
    clientId: string
    checkedInBy: string
    createdAt?: Date | string
  }

  export type GymCheckInUpdateWithoutMembershipInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    checkedInBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymCheckInUncheckedUpdateWithoutMembershipInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    checkedInBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GymCheckInUncheckedUpdateManyWithoutMembershipInput = {
    id?: StringFieldUpdateOperationsInput | string
    gymId?: StringFieldUpdateOperationsInput | string
    clientId?: StringFieldUpdateOperationsInput | string
    checkedInBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use GymCountOutputTypeDefaultArgs instead
     */
    export type GymCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymMembershipPlanCountOutputTypeDefaultArgs instead
     */
    export type GymMembershipPlanCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymMembershipPlanCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymMembershipContractCountOutputTypeDefaultArgs instead
     */
    export type GymMembershipContractCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymMembershipContractCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymDefaultArgs instead
     */
    export type GymArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymMembershipPlanDefaultArgs instead
     */
    export type GymMembershipPlanArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymMembershipPlanDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymMembershipContractDefaultArgs instead
     */
    export type GymMembershipContractArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymMembershipContractDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymTrainerAffiliationDefaultArgs instead
     */
    export type GymTrainerAffiliationArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymTrainerAffiliationDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymCheckInDefaultArgs instead
     */
    export type GymCheckInArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymCheckInDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymReviewDefaultArgs instead
     */
    export type GymReviewArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymReviewDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymPtCollaborationDefaultArgs instead
     */
    export type GymPtCollaborationArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymPtCollaborationDefaultArgs<ExtArgs>
    /**
     * @deprecated Use GymMembershipReferralDefaultArgs instead
     */
    export type GymMembershipReferralArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = GymMembershipReferralDefaultArgs<ExtArgs>

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